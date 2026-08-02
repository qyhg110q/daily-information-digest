#!/usr/bin/env python3
"""Extract platform captions first, then use local ASR on CUDA."""

from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    args = parse_args()
    work_dir = Path(args.work_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    result_path = Path(args.result_json).resolve()
    result_path.parent.mkdir(parents=True, exist_ok=True)

    import yt_dlp

    base_options = ytdlp_options(args)
    with yt_dlp.YoutubeDL(base_options) as ydl:
        info = ydl.extract_info(args.url, download=False)
    info = flatten_info(info)
    duration = int(info.get("duration") or 0)
    if duration and duration > args.max_duration_minutes * 60:
        raise RuntimeError(f"视频时长 {duration // 60} 分钟，超过配置上限 {args.max_duration_minutes} 分钟")
    if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
        raise RuntimeError("直播或尚未结束的视频暂不转录")

    with tempfile.TemporaryDirectory(prefix="media_", dir=work_dir) as temporary:
        temporary_dir = Path(temporary)
        caption = extract_caption(args, info, temporary_dir)
        if caption and len(caption[0]) >= 50:
            text, source, language = caption
            transcription_device = "platform"
        else:
            audio_path = download_audio(args, temporary_dir)
            text, language, transcription_device, source = transcribe_audio(args, audio_path)

    result = {
        "title": info.get("title") or "",
        "durationSeconds": duration,
        "language": language,
        "transcriptionSource": source,
        "transcriptionDevice": transcription_device,
        "text": text.strip(),
    }
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--result-json", required=True)
    parser.add_argument("--qwen-model-dir", required=True)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--subtitle-language", action="append", default=[])
    parser.add_argument("--cookie-file", default="")
    parser.add_argument("--max-duration-minutes", type=int, default=120)
    return parser.parse_args()


def ytdlp_options(args: argparse.Namespace) -> dict:
    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 45,
        "retries": 10,
        "fragment_retries": 10,
        "file_access_retries": 3,
        "continuedl": True,
        "http_chunk_size": 10 * 1024 * 1024,
        "sleep_interval": 2,
        "max_sleep_interval": 3,
    }
    if args.cookie_file and Path(args.cookie_file).exists():
        options["cookiefile"] = args.cookie_file
    return options


def flatten_info(info: dict) -> dict:
    if info.get("entries"):
        return next((entry for entry in info["entries"] if entry), info)
    return info


def extract_caption(args: argparse.Namespace, info: dict, directory: Path):
    candidates = []
    for source_name, tracks in (("platform-subtitle", info.get("subtitles") or {}), ("platform-auto-subtitle", info.get("automatic_captions") or {})):
        language = choose_language(tracks, args.subtitle_language)
        if language:
            candidates.append((source_name, language))

    import yt_dlp

    for source_name, language in candidates:
        options = ytdlp_options(args)
        options.update({
            "skip_download": True,
            "writesubtitles": source_name == "platform-subtitle",
            "writeautomaticsub": source_name == "platform-auto-subtitle",
            "subtitleslangs": [language],
            "subtitlesformat": "json3/vtt/best",
            "outtmpl": str(directory / "caption.%(ext)s"),
        })
        try:
            with yt_dlp.YoutubeDL(options) as ydl:
                ydl.download([args.url])
            caption_files = [path for path in directory.iterdir() if path.suffix.lower() in {".json3", ".json", ".vtt", ".srt"}]
            if caption_files:
                text = parse_caption_file(max(caption_files, key=lambda path: path.stat().st_size))
                if text:
                    return text, source_name, language
        except Exception:
            continue
    return None


def choose_language(tracks: dict, preferred: list[str]) -> str:
    if not tracks:
        return ""
    for language in preferred:
        if language in tracks:
            return language
    for language in preferred:
        match = next((candidate for candidate in tracks if candidate.lower().startswith(language.lower() + "-")), "")
        if match:
            return match
    return next(iter(tracks), "")


def parse_caption_file(path: Path) -> str:
    if path.suffix.lower() in {".json3", ".json"}:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
        if isinstance(payload.get("events"), list):
            chunks = ["".join(segment.get("utf8", "") for segment in event.get("segs", [])) for event in payload["events"]]
        elif isinstance(payload.get("body"), list):
            chunks = [str(item.get("content", "")) for item in payload["body"]]
        else:
            chunks = []
    else:
        chunks = []
        for line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
            stripped = re.sub(r"<[^>]+>", "", line).strip()
            if not stripped or stripped.startswith(("WEBVTT", "NOTE", "STYLE")) or "-->" in stripped or stripped.isdigit():
                continue
            chunks.append(html.unescape(stripped))
    return paragraphize(dedupe_chunks(chunks))


def dedupe_chunks(chunks: list[str]) -> list[str]:
    result = []
    for chunk in chunks:
        clean = re.sub(r"\s+", " ", html.unescape(chunk)).strip()
        if not clean or clean == "[Music]":
            continue
        if result and (clean == result[-1] or clean in result[-1]):
            continue
        if result and result[-1] in clean:
            result[-1] = clean
        else:
            result.append(clean)
    return result


def download_audio(args: argparse.Namespace, directory: Path) -> Path:
    import yt_dlp

    options = ytdlp_options(args)
    options.update({
        "format": "bestaudio/best",
        "outtmpl": str(directory / "audio.%(ext)s"),
    })
    with yt_dlp.YoutubeDL(options) as ydl:
        ydl.download([args.url])
    files = [path for path in directory.iterdir() if path.is_file() and path.suffix.lower() not in {".json", ".json3", ".vtt", ".srt", ".part", ".ytdl"}]
    if not files:
        raise RuntimeError("yt-dlp 未生成可转录的音频文件")
    return max(files, key=lambda path: path.stat().st_size)


def transcribe_audio(args: argparse.Namespace, audio_path: Path):
    return transcribe_qwen(args, audio_path)


def transcribe_qwen(args: argparse.Namespace, audio_path: Path):
    import torch

    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("配置要求使用 CUDA，但 PyTorch 未检测到 NVIDIA GPU")
    model_dir = Path(args.qwen_model_dir).resolve()
    if not (model_dir / "config.json").exists():
        raise RuntimeError(f"Qwen3-ASR 0.6B 模型不存在：{model_dir}。请重新运行 setup_video_pipeline.ps1")

    from qwen_asr import Qwen3ASRModel

    model = Qwen3ASRModel.from_pretrained(
        str(model_dir),
        dtype=torch.float16 if args.device == "cuda" else torch.float32,
        device_map="cuda:0" if args.device == "cuda" else "cpu",
        max_inference_batch_size=1,
        max_new_tokens=2048,
    )
    texts = []
    detected_language = ""
    for chunk_path in split_audio_for_qwen(audio_path):
        result = model.transcribe(audio=str(chunk_path), language=qwen_language(args.language))
        if result and result[0].text.strip():
            texts.append(result[0].text.strip())
            detected_language = detected_language or str(result[0].language or "")
        if args.device == "cuda":
            torch.cuda.empty_cache()
    text = " ".join(texts)
    if not text:
        raise RuntimeError("Qwen3-ASR 0.6B 未识别出有效文字")
    device_name = torch.cuda.get_device_name(0) if args.device == "cuda" else args.device
    language = normalize_result_language(detected_language, args.language)
    return semantic_paragraphize(text, language=language), language, device_name, "qwen3-asr-0.6b"


def split_audio_for_qwen(audio_path: Path, segment_seconds: int = 300) -> list[Path]:
    segment_dir = audio_path.parent / "qwen_segments"
    segment_dir.mkdir(parents=True, exist_ok=True)
    output_pattern = segment_dir / "chunk_%03d.wav"
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(audio_path),
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-f",
        "segment",
        "-segment_time",
        str(segment_seconds),
        "-reset_timestamps",
        "1",
        str(output_pattern),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError as error:
        raise RuntimeError("未找到 ffmpeg，无法为 Qwen3-ASR 切分长音频") from error
    except subprocess.CalledProcessError as error:
        message = (error.stderr or error.stdout or str(error)).strip()
        raise RuntimeError(f"ffmpeg 音频切分失败：{message}") from error
    chunks = sorted(segment_dir.glob("chunk_*.wav"))
    if not chunks:
        raise RuntimeError("ffmpeg 未生成 Qwen3-ASR 音频分片")
    return chunks


def qwen_language(language: str):
    normalized = str(language or "").strip().lower().replace("_", "-")
    if normalized in {"", "auto"}:
        return None
    if normalized == "chinese" or normalized.startswith(("zh", "cmn")):
        return "Chinese"
    if normalized == "english" or normalized.startswith("en"):
        return "English"
    return None


def normalize_result_language(detected: str, configured: str) -> str:
    value = str(detected or configured or "").strip()
    normalized = value.lower().replace("_", "-")
    if normalized == "chinese" or normalized.startswith(("zh", "cmn")):
        return "zh"
    if normalized == "english" or normalized.startswith("en"):
        return "en"
    return value


def semantic_paragraphize(text: str, target_chars: int = 240, language: str = "zh") -> str:
    sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[。！？!?])\s*", re.sub(r"\s+", " ", text).strip())
        if sentence.strip()
    ]
    separator = "" if str(language).lower().startswith(("zh", "cmn")) else " "
    return paragraphize(sentences, target_chars=target_chars, separator=separator)


def paragraphize(chunks: list[str], target_chars: int = 500, separator: str = " ") -> str:
    paragraphs = []
    current = []
    length = 0
    for chunk in chunks:
        clean = re.sub(r"\s+", " ", str(chunk)).strip()
        if not clean:
            continue
        current.append(clean)
        length += len(clean)
        if length >= target_chars:
            paragraphs.append(separator.join(current))
            current = []
            length = 0
    if current:
        paragraphs.append(separator.join(current))
    return "\n\n".join(paragraphs)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"video worker failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
