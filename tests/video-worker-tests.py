import argparse
import importlib.util
import unittest
from pathlib import Path


WORKER_PATH = Path(__file__).resolve().parents[1] / "scripts" / "video_worker.py"
SPEC = importlib.util.spec_from_file_location("video_worker", WORKER_PATH)
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


class VideoWorkerTests(unittest.TestCase):
    def test_all_languages_use_qwen(self):
        original_qwen = WORKER.transcribe_qwen
        try:
            WORKER.transcribe_qwen = lambda _args, _path: ("qwen", _args.language, "cuda", "qwen3-asr-0.6b")
            args = argparse.Namespace(language="zh-CN")
            self.assertEqual(WORKER.transcribe_audio(args, Path("audio.wav"))[0], "qwen")
            args.language = "en"
            self.assertEqual(WORKER.transcribe_audio(args, Path("audio.wav"))[0], "qwen")
        finally:
            WORKER.transcribe_qwen = original_qwen

    def test_language_hints_are_mapped_for_qwen(self):
        self.assertEqual(WORKER.qwen_language("zh-CN"), "Chinese")
        self.assertEqual(WORKER.qwen_language("en"), "English")
        self.assertIsNone(WORKER.qwen_language("auto"))

    def test_qwen_text_is_split_on_sentence_boundaries(self):
        text = f"{'甲' * 120}。{'乙' * 120}。{'丙' * 120}。"
        paragraphs = WORKER.semantic_paragraphize(text).split("\n\n")
        self.assertEqual(len(paragraphs), 2)
        self.assertTrue(paragraphs[0].endswith("。"))
        self.assertNotIn(" ", paragraphs[0])

    def test_english_sentences_keep_spaces(self):
        text = "First sentence. Second sentence."
        self.assertEqual(
            WORKER.semantic_paragraphize(text, language="en"),
            "First sentence. Second sentence.",
        )


if __name__ == "__main__":
    unittest.main()
