# Architecture

系统是本地优先的双入口应用：Web 控制台、CLI 和 AI 编辑都操作同一份 `config.json`，采集与转录业务由共享 core service 调用。

```mermaid
flowchart LR
  UI["Local Web UI"] --> API["Loopback HTTP API"]
  CLI["CLI / AI"] --> Core["Core service"]
  API --> Core
  Core --> Config["config.json + revision"]
  Core --> Jobs["Jobs + SSE"]
  Core --> Adapters["Platform adapters"]
  Adapters --> Report["Markdown + email"]
  Core --> Models["Local model registry"]
  Scheduler["Windows Task Scheduler"] --> CLI
```

## Boundaries

- `src/platforms/registry.js` 声明平台能力和来源字段；采集实现仍位于 `src/collectors/` 与 `src/video/`。
- `src/config-store.js` 负责迁移、校验、备份、原子替换和 revision 冲突。
- `src/core/service.js` 是 HTTP 与业务流程之间的边界；HTTP handler 不实现采集逻辑。
- `src/jobs.js` 管理进程内长任务与 SSE。服务重启不会恢复下载 job，但模型下载工具会复用目标目录。
- `src/browser.js` 为 X、微博分别维护 `data/browser_profiles/<platform>/`。人工登录使用不带 Playwright 自动化控制的真实 Chrome 进程，避免 Google 等身份提供方拒绝自动化浏览器；检测与采集使用 Playwright 持久 Chromium Context。跨进程锁防止登录窗口、状态检测和日报任务同时占用，窗口异常关闭时自动释放。平台续签的 Cookie、Local Storage 和 IndexedDB 随浏览器关闭自动落盘；登录无效时 X、微博 fail closed，不做匿名兜底。
- `src/sessions/manager.js` 负责持久 Profile 的登录标记和真实身份探测。Bilibili 仍使用 `data/sessions/bilibili.json` 作为可选会员登录，并在本机转换为 yt-dlp 可读的 Netscape Cookie 文件；公开内容始终允许匿名处理。
- Windows 计划任务不依赖 Web 页面存活，它直接运行统一 PowerShell pipeline。

第一版无数据库、无云端账号和无远程控制。跨平台 scheduler、持久 job queue 与更多 ASR 后端是后续扩展点。
