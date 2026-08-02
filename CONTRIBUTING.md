# Contributing

欢迎提交平台适配、解析 fixture、文档和可靠性改进。

1. 使用 Node.js 20+ 和 Python 3.11。
2. 从 `config.example.json` 复制本机 `config.json`，不要提交真实账号、Cookie、邮件地址或生成内容。
3. 修改后运行 `npm test` 和 `npm run validate`。
4. 平台 DOM 变更应附带合成 fixture 或最小化测试；不要提交绕过验证码、风控或访问限制的实现。
5. 一个提交聚焦一个可回滚的主题，并在说明中记录平台、操作系统和验证方式。

架构和适配器边界见 `docs/architecture.md`，敏感数据边界见 `docs/privacy.md`。
