# Security Policy

请勿在公开 issue 中粘贴 Cookie、storage state、SMTP 授权码、完整配置或私人日报。安全问题请通过仓库维护者提供的私密联系方式报告。

控制台默认只监听 `127.0.0.1`，当前版本拒绝绑定局域网地址。不要通过反向代理公开控制台：它具有修改配置、启动浏览器登录、发送邮件和删除未选中模型的本机权限。

认证状态、DPAPI 密文、模型、日志、转录和 `config.json` 均被 `.gitignore` 排除。提交前仍应检查 `git diff --cached`，因为历史上已跟踪过的文件不会仅凭 ignore 自动移除。
