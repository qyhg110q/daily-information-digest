# Privacy and Platform Risks

所有配置、登录状态、模型、原始文字稿、日报和日志默认保存在本机。项目不会上传遥测。只有用户明确配置的外部请求会发生：访问内容平台、下载模型、访问本地 WeWe RSS/Ollama，以及向 SMTP 服务器发送日报。

## Sensitive local files

- `config.json`：可能包含关注列表和邮箱地址。
- `data/sessions/*.json`：浏览器 Cookie 与登录状态，等同敏感凭据。
- `data/email_auth_code.dpapi`：Windows 当前用户可解密的 SMTP 授权码密文。
- `data/video_models/`、转录和日报：可能体积很大或包含私人研究内容。

这些路径默认不进入 Git。备份、同步盘和杀毒软件仍可能复制它们，请按自己的威胁模型管理磁盘权限。

## Platform behavior

网页结构、访问规则和风控会变化。本项目不绕过验证码或平台限制。登录探测失败时应 fail closed：舍弃该平台结果，并把错误写入页面、日志和邮件。使用者需要自行确认采集频率与平台条款相符。
