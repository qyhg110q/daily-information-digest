# YouTube / Bilibili 视频文字稿

这套视频流程不使用收费平台 API：YouTube 通过频道 RSS 发现更新，Bilibili 通过浏览器搜索页发现更新。发现视频后优先下载平台字幕；没有字幕时，所有语言统一使用本机 NVIDIA GPU 运行 Qwen3-ASR 0.6B，生成 Markdown 文字稿并随次日邮件作为附件发送。

## 首次安装

在项目目录执行：

```powershell
.\scripts\setup_video_pipeline.ps1
npm run video:latest
```

安装脚本会使用 uv 管理的独立 Python 3.11，安装固定版本的 CUDA PyTorch，并验证 NVIDIA GPU。独立 Python 可以避免 Anaconda DLL 与 PyTorch 冲突。Qwen3-ASR 0.6B 下载到 `data/video_models/Qwen3-ASR-0.6B`。

无字幕音频会先由 ffmpeg 转换为单声道 16 kHz WAV，并按 5 分钟切片。Qwen模型只加载一次并顺序处理各分片，避免4GB显存处理长视频时溢出；所有临时分片会随单次视频工作目录自动清理。

当前默认配置为：

```json
{
  "qwenModelDir": "./data/video_models/Qwen3-ASR-0.6B",
  "device": "cuda"
}
```

当 `device` 为 `cuda` 且显卡不可用时，任务会明确失败，不会静默退回 CPU。

## 统一定时任务

视频处理和日报发送由同一个 Windows 任务顺序执行。任务到点后先处理视频，视频进程结束便立即生成并发送日报，不再等待另一个固定时间：

```powershell
.\scripts\install_task.ps1 -At "07:00"
```

`-At` 表示整个流程的启动时间，而不是邮件的固定发送时间。例如 07:00 启动，视频在 07:12 结束，日报就从 07:12 开始生成；如果视频到 08:10 才结束，日报就在 08:10 开始。即使视频发现或转写失败，日报仍会记录失败信息并照常发出。视频文字稿保存在 `contexts/daily_records/video_transcripts/YYYY-MM-DD/`，邮件会附加对应 Markdown 文件。

如果电脑在计划时间不可用，任务会在开机或唤醒后补跑，并始终保持“视频结束 → 立即执行日报”的顺序。

查看或取消任务：

```powershell
Get-ScheduledTask -TaskName DailyInformationDigest
Unregister-ScheduledTask -TaskName DailyInformationDigest -Confirm:$false
```

## 添加博主

编辑 `config.json` 的 `sources`。YouTube 需要频道 ID 和 RSS 地址：

```json
{
  "id": "youtube_creator",
  "platform": "youtube",
  "displayName": "Creator",
  "url": "https://www.youtube.com/@creator",
  "channelId": "UC...",
  "feedUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UC...",
  "enabled": true,
  "language": "en",
  "subtitleLanguages": ["en", "en-orig"],
  "minDurationSeconds": 60
}
```

Bilibili 需要空间主页 UID：

```json
{
  "id": "bilibili_creator",
  "platform": "bilibili",
  "displayName": "UP 主名称",
  "url": "https://space.bilibili.com/123456/video",
  "uid": "123456",
  "enabled": true,
  "language": "zh",
  "subtitleLanguages": ["zh-Hans", "zh-CN", "zh"],
  "minDurationSeconds": 60
}
```

手动处理指定日期或检查最新一条：

```powershell
npm run video:ingest -- --date 2026-07-19
npm run video:ingest -- --date 2026-07-19 --force
npm run video:latest
```

`--force` 会重新处理状态中已经完成的视频，适合更换转录模型后重建文字稿。
