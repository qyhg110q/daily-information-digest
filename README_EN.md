# Daily Information Digest

English | [简体中文](README.md)

A free, local-first daily digest for creator updates. It collects posts from X, Weibo, WeChat Official Accounts, YouTube, Bilibili, and Xiaoyuzhou into Markdown and can deliver the result by email on a schedule. Video captions are preferred; when captions are unavailable, local Qwen3-ASR 0.6B inference on an NVIDIA GPU is used for transcription.

The web console, CLI, `config.json`, and AI-assisted editing share the same schema and validation rules. Login sessions, SMTP credentials, models, transcripts, and reports stay on the local machine by default.

## Features

- Manage creators across six platforms, with creator search and platform filtering.
- Platform-scoped login for X and Weibo; anonymous public Bilibili access with optional login for member content.
- Download, inspect, and switch local Qwen3-ASR transcription models.
- Run video ingestion first, then immediately build one digest; partial failures are still reported by email.
- Windows scheduling with catch-up execution after a missed run time.
- Background job progress, logs, Markdown reports, and email delivery status.
- Atomic config writes, backups, and revision conflict detection for safe web, CLI, and AI-assisted editing.

## Deployment

### 1. Requirements

Core features:

- Windows 10/11. The web app and CLI are portable, while automatic task installation and DPAPI secret storage are currently Windows-specific.
- Node.js 20 or newer
- Chrome or Edge

Video transcription also requires:

- `uv`
- ffmpeg
- An NVIDIA GPU and compatible driver; the setup script installs CUDA-enabled PyTorch
- Enough space on drive D or another configured model directory

### 2. Clone and start

```powershell
git clone https://github.com/qyhg110q/daily-information-digest.git
Set-Location daily-information-digest
.\scripts\first_run.ps1
```

`first_run.ps1` checks the environment, installs Node dependencies, creates an untracked `config.json` from the example, and opens [http://127.0.0.1:4317](http://127.0.0.1:4317). The initial local config does not enable the example creators automatically; select creators in the UI or copy the desired `sources` from `config.example.json`.

Manual setup:

```powershell
Copy-Item config.example.json config.json
npm install
npm run validate
npm run web
```

The control plane only listens on `127.0.0.1`. Do not expose it through a public reverse proxy.

### 3. Install video transcription support (optional)

```powershell
.\scripts\setup_video_pipeline.ps1
```

The script keeps Python, the virtual environment, package caches, and the Qwen3-ASR model under the project's `data/` directory instead of using system-drive caches. Models can also be downloaded and selected from the web console.

### 4. Install the daily task (optional)

Choose a Beijing-time schedule in the web console, or run:

```powershell
.\scripts\install_task.ps1 -At "00:30"
```

The task ingests the previous day's videos and starts the digest immediately afterward. Windows Task Scheduler uses `StartWhenAvailable`, so a missed run starts after the next boot. `MultipleInstances IgnoreNew` prevents overlapping runs.

To remove the task from PowerShell:

```powershell
Unregister-ScheduledTask -TaskName "DailyInformationDigest" -Confirm:$false
```

## Configuration

Local settings live in `config.json`, which is excluded from Git together with its backups. See `config.schema.json` for the complete schema and `config.example.json` for a publishable reference configuration.

### Creator sources

Creators can be managed in the UI or edited directly under `sources`. A typical entry is:

```json
{
  "id": "bilibili_class_monitor",
  "platform": "bilibili",
  "displayName": "课代表立正",
  "url": "https://space.bilibili.com/491306902/video",
  "uid": "491306902",
  "enabled": true,
  "language": "zh"
}
```

The example config includes the public creators used by this project and demonstrates fields for every supported platform. WeChat Official Accounts require a separately deployed WeWe RSS service or a replacement `feedUrl`.

### Platform sessions

- X and Weibo: open the login window under Platform Accounts, then save and verify the session.
- Bilibili: public content works anonymously. Log in only for member, paid, or restricted content your account is entitled to access.
- YouTube: channel RSS; no login required.
- Xiaoyuzhou: public show notes; no login required.
- WeChat Official Accounts: the health check targets the configured WeWe RSS service.

Browser sessions are stored under `data/sessions/` and contain cookies. Never commit or share them. This project does not bypass CAPTCHA, membership, payment, or platform access controls.

### Email delivery

Configure the SMTP host, port, sender, recipient, and authorization code in the web console. QQ Mail requires an SMTP authorization code, not the account password.

On Windows, the authorization code is encrypted with DPAPI for the current user and saved to `data/email_auth_code.dpapi`:

```powershell
.\scripts\configure_email.ps1
```

On other systems, provide it through `DAILY_DIGEST_SMTP_PASSWORD`. Email addresses belong in the local `config.json`; never store the authorization code directly in JSON.

### Default paths

| Data | Default path |
| --- | --- |
| Local configuration | `config.json` |
| Sessions and encrypted SMTP secret | `data/` |
| Models and Python environment | `data/video_models/`, `data/video_venv/` |
| Digest reports | `./output/reports/` |
| Video transcripts | `./output/transcripts/` |

`outputDir` and `video.transcriptDir` can also point to absolute paths of your choice.

## Usage

```powershell
npm run validate                         # Validate config
npm run login -- --platform weibo       # Log in to a platform
npm run once                             # Process today
npm run daily                            # Process the previous Beijing date
npm run backfill -- 2026-08-01           # Rebuild a specific date
npm run video:latest                     # Test the latest video per source
npm run email:test                       # Test SMTP delivery
node src/cli.js models doctor --config config.json
```

Date boundaries, display, and archive paths use the configured `timezone`, which defaults to `Asia/Shanghai`. A date can be rerun without producing an empty report merely because its items already exist in state.

## Security and privacy

The following are excluded from Git: `config.json`, `data/`, `.env`, models, login cookies, SMTP secrets, logs, and generated output. Before publishing changes, still inspect:

```powershell
git status --ignored
git diff --cached
```

See [Privacy](docs/privacy.md), [Security Policy](SECURITY.md), and [Architecture](docs/architecture.md) for details.

## Development

```powershell
npm test
npm run validate
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under the [MIT License](LICENSE).
