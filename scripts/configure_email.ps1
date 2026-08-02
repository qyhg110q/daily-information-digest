$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
$SecretPath = Join-Path $ProjectDir "data\email_auth_code.dpapi"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $SecretPath) | Out-Null

Write-Host "请输入 QQ 邮箱生成的 SMTP 授权码。输入内容不会显示。"
$SecureCode = Read-Host "QQ SMTP 授权码" -AsSecureString
$Encrypted = ConvertFrom-SecureString -SecureString $SecureCode
Set-Content -LiteralPath $SecretPath -Value $Encrypted -Encoding utf8 -NoNewline

Write-Host "授权码已使用 Windows DPAPI 加密保存到 data/email_auth_code.dpapi。"
$Config = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectDir "config.json") | ConvertFrom-Json
$Recipients = @($Config.email.to) -join ", "
Write-Host "正在发送测试邮件到 $Recipients..."
Set-Location -LiteralPath $ProjectDir
& node src/cli.js email-test --config config.json
exit $LASTEXITCODE
