# Open-source Local Control Plane ExecPlan

## Status

- State: Completed
- Started: 2026-08-02
- Completed: 2026-08-02
- Owner: project maintainers and future implementation agents

## Goal

将当前面向单机脚本使用者的日报系统演进为可开源发布的本地优先产品。新用户应能通过本地 Web 控制台完成关注对象、平台登录、登录状态、转录模型、邮件和定时任务配置；CLI、JSON 配置文件和 AI 直接编辑配置的能力必须保留，并与页面共享同一套数据和校验规则。

首个可发布版本的核心体验是：用户完成一次安装，打开本地页面，添加博主、完成必要的平台登录、下载并选择转录模型、配置邮件和执行时间，然后成功收到第一封日报。

## Context and Orientation

当前项目位于 `periodic_jobs/daily_information_digest/`，主要事实如下：

- Node.js ESM 负责采集、日报、邮件和 CLI。
- Playwright 负责 X、微博和 Bilibili 的浏览器访问。
- YouTube 使用频道 RSS；小宇宙读取公开 Show Notes；微信公众号依赖 WeWe RSS。
- 视频链路使用独立 Python 环境、CUDA 和 Qwen3-ASR 0.6B，模型目录已可配置到 D 盘。
- Windows Task Scheduler 通过统一 PowerShell 任务先执行视频处理，再生成并发送日报。
- `config.json`、状态 JSON、运行日志和 Markdown 是当前主要持久化形式。
- 平台登录状态当前集中在一个浏览器 storage-state 文件中；开源版本需要按平台隔离、主动检测并避免静默误采。

## Product and Architecture Decisions

### Local-first control plane

第一版采用本地 Node HTTP 服务和浏览器 Web 控制台，默认仅监听 `127.0.0.1`。暂不以 Electron、云端 SaaS 或 Docker 作为主要产品形态。现有 CLI 和系统定时任务可在页面关闭后继续工作。

### One canonical configuration

`config.json` 是 UI、CLI 和 AI 的共同事实来源。增加 `config.schema.json` 和配置版本号；页面通过后端原子写入该文件，不建立第二套配置数据库。写入必须包含校验、备份、revision/mtime 冲突检测和失败回滚。

开源仓库只跟踪 `config.example.json` 与 Schema。真实 `config.json`、认证状态、SMTP 授权码、模型文件、转录结果和日报默认忽略。

### Platform adapters

平台能力统一为适配器契约，至少描述：

- 平台标识、显示名称和能力声明
- 来源配置 Schema 与 URL 归一化
- 是否需要登录，以及登录和状态检测入口
- 关注对象识别与测试
- 内容发现、采集和错误分类
- 是否支持视频、字幕和本地转录

Web 表单根据 Schema 和能力声明生成通用部分，复杂平台保留专用控件。

### Login is platform-scoped

登录按平台管理，而非按关注对象管理。目标状态为 `valid`、`expired`、`not_needed`、`unknown`、`checking` 和 `error`。X、微博保存必需认证状态；Bilibili 登录是会员或受限内容的可选增强，公开视频匿名处理；YouTube RSS 和小宇宙显示“无需登录”；微信公众号显示 WeWe RSS 服务健康状态和对应入口。

每次日报运行前主动探测登录有效性。Cookie 文件存在或过期时间未到不等于登录有效。必需登录的平台探测失败时丢弃该平台数据并发送失败提醒；Bilibili 可选登录失效时降级为匿名采集，并提醒会员内容可能漏采。

### Model artifacts stay outside the repository

模型文件不进入 Git。下载目录必须可配置，安装前检查目标盘剩余空间，默认尊重现有 `video.modelDir` 和 `video.qwenModelDir`，避免把大模型缓存写入 C 盘。

## Scope

### 1. Repository and configuration foundation

- 增加 `config.schema.json`、配置 `version` 和迁移机制。
- 把示例账号、真实账号、秘密和机器专属路径分离。
- 实现原子配置读写、备份、revision 冲突检测和文件变更通知。
- 保持现有 CLI 参数兼容，给 AI 提供稳定、可发现的配置说明。
- 建立平台适配器注册表与能力契约。

### 2. Local server and control API

- 增加本地服务启动命令，例如 `npm run web` 和 `digest serve`。
- 提供配置、来源、平台状态、运行、报告、邮件、调度和模型 API。
- 长任务通过 job id 表达；下载、登录检测、采集和转录进度通过 SSE 推送。
- 默认仅监听 loopback；未来 LAN 模式必须单独启用并配置认证。
- 服务端与 CLI 调用同一 core service，不在 HTTP handler 中复制业务逻辑。

### 3. Web control console

首版页面包括：

- Dashboard：上次和下次运行、来源健康度、平台登录、GPU、模型、邮件和最近日报。
- Sources：添加、编辑、启用、停用和删除关注对象；粘贴主页 URL 后识别名称与 UID/channel id。
- Accounts：打开可见浏览器完成登录、重新登录、主动检测和查看最后有效时间。
- Models：硬件检测、模型目录、可用模型、下载、校验、选择和卸载保护。
- Schedule：设置执行时间、补跑策略、安装或取消系统任务。
- Delivery：配置 SMTP、保存授权码和发送测试邮件。
- Runs：查看进行中的步骤、历史日志、错误、生成的 Markdown 和邮件结果。
- Advanced：查看配置 JSON、校验结果和文件 revision。

### 4. Transcription model center

模型中心是首版范围，不作为后续附加功能。它需要同时支持页面和 CLI。

#### Model registry

建立声明式模型注册表。每个条目至少包括：

- 稳定 model id、名称、提供方和版本
- 支持语言、预计磁盘占用和最低/推荐显存
- 下载来源、许可信息和缓存布局
- worker backend、必要 Python 包和运行参数
- 推荐切片长度、设备和精度策略
- 安装检测与完整性校验方法

首个正式条目为当前使用的 Qwen3-ASR 0.6B。注册表允许未来增加更大 Qwen ASR、Whisper/faster-whisper 或其他后端，但首版不承诺尚未验证的模型质量。

#### Model lifecycle

统一状态为：

```text
not_installed -> downloading -> verifying -> installed -> selected
                         |             |
                         +-> error <---+
```

需要支持：

- 显示下载体积、目标目录、可用空间和进度。
- 下载失败后重试，尽可能复用已有缓存和断点。
- 下载完成后校验必要文件和最小推理 smoke test。
- 设置全局默认模型，并允许未来增加按来源覆盖。
- 明确显示 CPU/CUDA、GPU 名称、显存和兼容性建议。
- 下载和验证在后台 job 中运行，页面关闭不破坏服务端任务。
- 删除模型前二次确认；当前选中或正在使用的模型禁止直接删除。
- 安装异常不得破坏当前可用模型和既有配置。

#### CLI parity

页面中的关键操作需要对应 CLI，例如：

```text
digest models list
digest models doctor
digest models install qwen3-asr-0.6b
digest models select qwen3-asr-0.6b
digest models remove <model-id>
```

AI 可以修改选中模型配置，但模型下载、完整性验证和删除应调用 CLI，以获得进度、锁和安全检查。

### 5. Scheduling and execution lifecycle

- 保留视频任务完成后立即生成日报的统一顺序。
- UI 负责展示和管理现有 Windows Task Scheduler 配置。
- 抽象 scheduler adapter，为后续 systemd timer 和 launchd 留出边界。
- 保留错过执行时间后的补跑语义，并在页面明确显示下一次正常运行和待补跑日期。
- 同一时间只允许一个日报 pipeline；手动运行、计划运行和补跑共享锁与进度模型。

### 6. Open-source delivery

- 增加许可证、贡献指南、架构说明、隐私与平台风险说明。
- 提供 Windows 首次启动向导；Linux/macOS 按能力分阶段支持。
- 安装器检查 Node、Chrome/Edge、Python、CUDA、ffmpeg、yt-dlp、磁盘空间和端口。
- 所有登录状态、邮件秘密和本地内容目录纳入默认忽略规则。
- 提供合成 fixture 和可选 live smoke test，降低平台页面变化造成的维护成本。

## Non-goals for the First Public Release

- 多用户云服务、云端托管 Cookie 或远程账号密码管理。
- 绕过验证码、风控或平台访问限制。
- 移动端原生应用。
- 通用插件市场。
- 在 UI 中训练或微调 ASR 模型。
- 自动删除旧模型、原视频或用户生成的日报。

## Work Breakdown and Progress

- [x] 记录本地优先、Web + CLI 双入口的总体方向。
- [x] 将转录模型下载、选择和硬件检测纳入首版产品范围。
- [x] Phase 0：建立配置 Schema、示例配置、秘密边界和迁移测试。
- [x] Phase 1：抽取 core service 与平台 adapter 契约，保持现有 CLI 回归通过。
- [x] Phase 2：实现登录管理器、分平台 storage state 和主动健康检测。
- [x] Phase 3：实现本地 HTTP API、job 状态、SSE 和配置文件并发保护。
- [x] Phase 4：实现 Dashboard、Sources 和 Accounts 页面。
- [x] Phase 5：实现模型注册表、下载 job、硬件检测、选择、CLI parity 和 Models 页面。
- [x] Phase 6：接入 Schedule、Delivery、Runs 页面和统一诊断。
- [x] Phase 7：完成开源清理、首次启动向导、文档、许可证和发布验收。

每个 Phase 开始前应把范围拆成可独立验证的小任务；若一个 Phase 跨多个会话，可建立子 ExecPlan 并在 `PLANS.md` 中索引。

## API Direction

首轮 API 以以下资源为边界，字段由实现阶段的 Schema 固化：

```text
GET/PUT  /api/config
GET/POST /api/sources
PUT/DELETE /api/sources/:id
GET      /api/platforms
GET      /api/platforms/:id/session
POST     /api/platforms/:id/login
POST     /api/platforms/:id/check-session
GET      /api/models
POST     /api/models/:id/install
POST     /api/models/:id/select
DELETE   /api/models/:id
GET      /api/hardware
POST     /api/runs
GET      /api/runs/:id
GET      /api/events
GET/PUT  /api/schedule
POST     /api/email/test
```

写操作需要 revision 或等价的 If-Match 机制，防止页面覆盖 AI 在磁盘上完成的新修改。

## Risks and Mitigations

- 平台 DOM 经常变化：适配器隔离、来源 UID 校验、fixture 测试和 fail-closed。
- 浏览器认证包含敏感信息：按平台分文件、默认忽略、禁止通过 API 返回 Cookie 内容。
- 页面与 AI 同时改配置：revision 检测、原子写入、备份和显式冲突提示。
- 模型下载占用大量磁盘：下载前空间检查、明确目标盘、显示体积、失败可恢复。
- CUDA/PyTorch 组合差异：hardware doctor、兼容矩阵、最小推理验证和 CPU fallback 提示。
- 多任务争用 GPU 或输出文件：全局 pipeline 锁、模型下载锁和明确 job 状态。
- 开源用户操作系统差异：scheduler、secret store 和 hardware probe 均通过 adapter 隔离。
- 平台条款和风控：控制频率、公开能力边界、拒绝自动绕过验证。

## Validation

### Plan creation validation

- [x] `PLANS.md` 中的 active 链接可以解析到本文件。
- [x] 本文件包含 Status、Goal、Scope、Progress、Surprises & Discoveries、Decision Log、Validation、Outcomes & Retrospective。
- [x] Git 暂存范围只包含本计划和计划索引。

### Implementation gates

- [x] 配置：Schema 解析、旧配置迁移、原子写入、备份和冲突测试。
- [x] Core：现有 `npm test`、真实本机配置校验和 CLI 兼容检查。
- [x] Login：主动接口/页面身份探测、分平台状态和 fail-closed 路径。
- [x] Models：安装状态、空间预检、必要文件、backend import、CUDA doctor 和卸载保护。
- [x] API：handler、非法写入、跨域写保护、并发 revision 和敏感字段边界测试。
- [x] UI：关键导航、弹窗、URL 识别和模型中心真实浏览器 smoke test。
- [x] Scheduler：现有任务查询、安装/取消接口、StartWhenAvailable 语义和重复运行锁。
- [x] Release：无本机配置、数据和依赖的临时副本首次安装演练；既有 SMTP 测试邮件已成功送达。

## Surprises & Discoveries

- 微博登录态文件仍存在且 Cookie 表面未全部过期时，服务端仍可能把用户导向游客推荐流，因此状态检测必须执行真实页面探测。
- 当前 Qwen 模型和 Python 环境已经支持自定义 D 盘路径，这应成为模型中心的正式产品能力，而非机器专属约定。
- 当前统一定时任务已经表达了视频完成后立即生成日报的关键顺序，Web 控制台应管理这条 pipeline，而不是重新引入两个相互独立的定时器。
- Windows 上对单个配置文件执行 `fs.watch` 会在原子替换后丢失监听，因此实现改为监听父目录并过滤文件名。
- Playwright 真实浏览器验收发现 `<dialog method="dialog">` 的取消按钮被保存 handler 拦截；已按 submitter 明确区分保存与取消。

## Decision Log

- 2026-08-02：采用本地 Web 控制台，不把 Electron 或云服务作为首版基础。
- 2026-08-02：保留 `config.json` 为唯一配置事实来源，UI、CLI 和 AI 共享 Schema。
- 2026-08-02：登录按平台隔离并主动探测，登录失效采用 fail-closed。
- 2026-08-02：模型中心进入首版范围，模型文件保存在用户选择的本地目录。
- 2026-08-02：模型关键操作必须提供 CLI parity，便于 AI 安全调用。
- 2026-08-02：第一版继续以 Windows 为完整支持目标，同时预留跨平台 adapter。
- 2026-08-02：首版前端使用无构建步骤的原生 Web 控制台，由 Node 静态托管，减少首次安装依赖并保持可维护的 API 边界。
- 2026-08-02：本地服务仅接受 loopback 绑定，并拒绝非本机 Origin 的写请求。

## Completion Definition

满足以下条件后，本计划可以转入 `completed/`：

- 新用户可通过页面完成来源、登录、模型、邮箱和定时任务设置。
- AI 可仅通过 Schema、配置文件和 CLI 完成同样的设置。
- 页面能下载、验证、选择 Qwen3-ASR 0.6B，并显示 GPU 与磁盘状态。
- 页面关闭后，计划任务仍能按统一 pipeline 运行并执行补跑。
- 登录失效、模型失败、采集失败和邮件失败均在页面、日志和日报邮件中可见。
- 开源仓库不包含真实配置、Cookie、密码、模型或用户日报。
- 在一台干净 Windows 机器上完成从安装到收到第一封日报的验收。

## Outcomes & Retrospective

计划已完成。最终实现提供统一的本地 Web 控制台、CLI parity、版本化 Schema、原子配置写入、平台隔离登录态、真实登录/服务探测、后台 job 与 SSE、模型中心、系统计划任务、SMTP DPAPI 保存和运行历史。

验收包括完整 `npm test`、所有 JavaScript 语法检查、真实 RTX 2050/CUDA/Python/模型 doctor、Playwright 页面与 URL 自动识别流程，以及不含 `config.json`、`data`、`node_modules` 的临时副本首次安装。临时副本成功生成 `version: 1` 且空来源的配置并通过校验，随后已删除。

首版有意保留的边界：Windows 是完整支持平台；job 状态存于服务进程内，服务重启后通过持久日志和报告追溯，但不会恢复进行中的 job；模型注册表目前只承诺已验证的 Qwen3-ASR 0.6B。
