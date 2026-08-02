# Daily Information Digest

[English](README_EN.md) | 简体中文

一个免费、本地优先的创作者信息日报。它将 X、微博、微信公众号、YouTube、Bilibili 和小宇宙的每日更新汇总为 Markdown，并可定时发送到邮箱。视频优先读取字幕；没有字幕时使用本机 Qwen3-ASR 0.6B 和 NVIDIA GPU 转录。

Web 控制台、CLI、`config.json` 和 AI 直接编辑共用同一套配置与校验规则。登录状态、SMTP 授权码、模型、文字稿和日报默认只保存在本机。

## 功能

- 管理六个平台的关注对象，支持按博主搜索和按平台筛选。
- X、微博分平台登录；Bilibili 公开视频匿名处理，会员内容可选登录。
- 本地下载、检测和切换 Qwen3-ASR 转录模型。
- 视频完成后立即生成统一日报，部分失败也会发送说明邮件。
- Windows 定时执行与错过时间后的开机补跑。
- 后台任务进度、日志、Markdown 报告和邮件投递状态。
- 配置原子写入、备份与 revision 冲突检测，方便页面、CLI 和 AI 协作修改。

## 部署

### 1. 环境要求

基础功能：

- Windows 10/11（Web 和 CLI 可移植，当前自动安装定时任务与 DPAPI 密钥存储为 Windows 实现）
- Node.js 20 或更高版本
- Chrome 或 Edge

视频转录还需要：

- `uv`
- ffmpeg
- NVIDIA 显卡及兼容驱动；默认安装 CUDA 版 PyTorch
- 足够的 D 盘或自定义模型目录空间

### 2. 克隆并启动

```powershell
git clone https://github.com/qyhg110q/daily-information-digest.git
Set-Location daily-information-digest
.\scripts\first_run.ps1
```

`first_run.ps1` 会检查环境、安装 Node 依赖、从示例创建不受 Git 跟踪的 `config.json`，并打开 [http://127.0.0.1:4317](http://127.0.0.1:4317)。首次生成的配置不会自动启用示例博主，请在页面选择需要关注的对象，或把 `config.example.json` 中的 `sources` 复制过去。

手动安装方式：

```powershell
Copy-Item config.example.json config.json
npm install
npm run validate
npm run web
```

控制台只监听 `127.0.0.1`，不要通过公网反向代理暴露。

### 3. 安装视频转录环境（可选）

```powershell
.\scripts\setup_video_pipeline.ps1
```

脚本将 Python、虚拟环境、依赖、缓存与 Qwen3-ASR 模型放在项目的 `data/` 下，避免占用系统盘的默认缓存。也可以在 Web 控制台“转录模型”页面下载和选择模型。

### 4. 安装每日任务（可选）

在 Web 控制台选择北京时间并点击“安装 / 更新任务”，或执行：

```powershell
.\scripts\install_task.ps1 -At "00:30"
```

任务先处理前一天的视频，结束后立即生成并发送日报。Windows Task Scheduler 使用 `StartWhenAvailable`：设定时间电脑未开机时，会在下次开机后补跑；`MultipleInstances IgnoreNew` 防止重复运行。

取消任务可在页面操作，或执行：

```powershell
Unregister-ScheduledTask -TaskName "DailyInformationDigest" -Confirm:$false
```

## 配置

真实配置位于 `config.json`，该文件和备份已被 `.gitignore` 排除。完整字段约束见 `config.schema.json`，可公开参考配置见 `config.example.json`。

### 关注来源

页面可添加、编辑、停用和删除博主，也可以直接编辑 `sources`。每项至少包含：

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

示例配置包含本项目实际使用的一组公开创作者，可直接作为 X、微博、微信公众号、YouTube、Bilibili 和小宇宙的字段参考。公众号需要自行部署或替换 `feedUrl` 指向的 WeWe RSS 服务。

### 平台登录

- X、微博：在“平台账号”打开登录窗口，登录完成后保存并主动检测。
- Bilibili：公开内容无需登录；如需访问账号有权限观看的会员、付费或受限内容，请完成可选登录。
- YouTube：使用频道 RSS，无需登录。
- 小宇宙：读取公开 Show Notes，无需登录。
- 微信公众号：检测的是 WeWe RSS 服务状态。

浏览器会话保存在 `data/sessions/`，其中含 Cookie，禁止提交或分享。项目不会绕过验证码、会员权限或平台访问限制。

### 邮件

在“邮件投递”中设置 SMTP 主机、端口、发件邮箱、收件邮箱和授权码。QQ 邮箱必须使用 SMTP 授权码，而不是 QQ 密码。

Windows 会使用当前用户的 DPAPI 将授权码加密到 `data/email_auth_code.dpapi`：

```powershell
.\scripts\configure_email.ps1
```

非 Windows 环境可通过 `DAILY_DIGEST_SMTP_PASSWORD` 提供授权码。邮箱地址写在本机 `config.json` 中；授权码不要直接写入任何 JSON 文件。

### 常用路径

| 内容 | 默认路径 |
| --- | --- |
| 本机配置 | `config.json` |
| 登录态和 SMTP 密文 | `data/` |
| 视频模型与虚拟环境 | `data/video_models/`、`data/video_venv/` |
| 日报 | `./output/reports/` |
| 视频文字稿 | `./output/transcripts/` |

也可以把 `outputDir` 和 `video.transcriptDir` 改为自己的绝对路径。

## 使用

```powershell
npm run validate                         # 校验配置
npm run login -- --platform weibo       # 平台登录
npm run once                             # 处理今天
npm run daily                            # 处理北京时间前一天
npm run backfill -- 2026-08-01           # 回溯指定日期
npm run video:latest                     # 测试每个视频来源的最新视频
npm run email:test                       # 测试邮件
node src/cli.js models doctor --config config.json
```

日期边界、展示和归档统一使用 `timezone`，默认 `Asia/Shanghai`。同一日期可以重复运行，日报不会因为内容已经进入 state 而变为空白。

## 安全与隐私

以下内容不会进入 Git：`config.json`、`data/`、`.env`、模型、登录 Cookie、SMTP 授权码、日志和生成结果。公开前仍建议执行：

```powershell
git status --ignored
git diff --cached
```

更多信息见 [隐私说明](docs/privacy.md)、[安全策略](SECURITY.md) 和 [架构说明](docs/architecture.md)。

## 开发

```powershell
npm test
npm run validate
```

贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。项目使用 [MIT License](LICENSE)。
