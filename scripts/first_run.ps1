param([switch]$NoStart)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectDir

function Show-ToolStatus([string]$Name, [string]$Command, [bool]$Required) {
    $Found = Get-Command $Command -ErrorAction SilentlyContinue
    if ($Found) { Write-Host "[OK] $Name - $($Found.Source)" -ForegroundColor Green; return $true }
    $Level = if ($Required) { "缺少（必需）" } else { "缺少（视频功能需要）" }
    Write-Host "[!] $Name - $Level" -ForegroundColor Yellow
    return -not $Required
}

if (-not (Show-ToolStatus "Node.js" "node.exe" $true)) { throw "请先安装 Node.js 20 或更高版本。" }
Show-ToolStatus "ffmpeg" "ffmpeg.exe" $false | Out-Null
Show-ToolStatus "uv" "uv.exe" $false | Out-Null
Show-ToolStatus "NVIDIA 驱动" "nvidia-smi.exe" $false | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir "config.json"))) {
    $Starter = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectDir "config.example.json") | ConvertFrom-Json
    $Starter.sources = @()
    $Starter | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 (Join-Path $ProjectDir "config.json")
    Write-Host "已从 config.example.json 创建本机 config.json。" -ForegroundColor Green
}

& npm install
if ($LASTEXITCODE -ne 0) { throw "npm install 失败。" }
& node src/cli.js validate --config config.json
if ($LASTEXITCODE -ne 0) { throw "配置校验失败。" }

if (-not $NoStart) {
    $ServerArgs = @("src/cli.js", "serve", "--config", "config.json")
    Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList $ServerArgs -WorkingDirectory $ProjectDir -WindowStyle Hidden
    Start-Sleep -Seconds 1
    Start-Process "http://127.0.0.1:4317"
    Write-Host "控制台已启动：http://127.0.0.1:4317" -ForegroundColor Green
} else {
    Write-Host "运行 npm run web 打开控制台。"
}
