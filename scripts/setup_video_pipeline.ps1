$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
$VenvDir = Join-Path $ProjectDir "data\video_venv"
$Python = Join-Path $VenvDir "Scripts\python.exe"
$Requirements = Join-Path $ProjectDir "requirements-video.txt"
$UvCache = Join-Path $ProjectDir "data\uv_cache"
$TempDir = Join-Path $ProjectDir "data\tmp"
$QwenModelDir = Join-Path $ProjectDir "data\video_models\Qwen3-ASR-0.6B"
$TorchVersion = "2.10.0"

New-Item -ItemType Directory -Force -Path (Join-Path $ProjectDir "data"), $TempDir | Out-Null
$env:TEMP = $TempDir
$env:TMP = $TempDir

if (-not (Get-Command uv.exe -ErrorAction SilentlyContinue)) {
    throw "uv.exe was not found. Install uv or add it to PATH."
}

& uv.exe python install 3.11
if ($LASTEXITCODE -ne 0) { throw "Failed to install standalone Python 3.11." }

$UvPythonDir = (& uv.exe python dir | Select-Object -Last 1).Trim()
$ManagedPython = Get-ChildItem -LiteralPath $UvPythonDir -Directory |
    Where-Object { $_.Name -match '^cpython-(3\.11\.\d+)-windows-x86_64-none$' } |
    ForEach-Object {
        if ($_.Name -match '^cpython-(3\.11\.\d+)-windows-x86_64-none$') {
            [PSCustomObject]@{ Version = [Version]$Matches[1]; Path = (Join-Path $_.FullName "python.exe") }
        }
    } |
    Sort-Object Version -Descending |
    Select-Object -First 1
if (-not $ManagedPython -or -not (Test-Path -LiteralPath $ManagedPython.Path)) {
    throw "Could not locate a uv-managed standalone Python 3.11."
}

$NeedsRebuild = -not (Test-Path -LiteralPath $Python)
if (-not $NeedsRebuild) {
    $VenvConfig = Get-Content -LiteralPath (Join-Path $VenvDir "pyvenv.cfg") -Raw
    $NeedsRebuild = $VenvConfig -notmatch [Regex]::Escape($UvPythonDir)
}
if ($NeedsRebuild) {
    Write-Host "Rebuilding the video environment with standalone Python to avoid Anaconda DLL conflicts..."
    & uv.exe venv --clear $VenvDir --python $ManagedPython.Path
    if ($LASTEXITCODE -ne 0) { throw "Failed to create the video Python environment." }
}

$env:UV_CACHE_DIR = $UvCache
& uv.exe pip install --python $Python "torch==$TorchVersion" --index-url https://download.pytorch.org/whl/cu126
if ($LASTEXITCODE -ne 0) { throw "Failed to install CUDA-enabled PyTorch." }

& uv.exe pip install --python $Python -r $Requirements
if ($LASTEXITCODE -ne 0) { throw "Failed to install video dependencies." }

if (-not (Test-Path -LiteralPath (Join-Path $QwenModelDir "config.json"))) {
    New-Item -ItemType Directory -Force -Path $QwenModelDir | Out-Null
    $ModelScope = Join-Path $VenvDir "Scripts\modelscope.exe"
    & $ModelScope download "Qwen/Qwen3-ASR-0.6B" --local-dir $QwenModelDir --max-workers 4
    if ($LASTEXITCODE -ne 0) { throw "Failed to download Qwen3-ASR 0.6B." }
}

Write-Host "Video processing environment is ready: $Python"
& $Python -c "import torch; assert torch.cuda.is_available(), 'PyTorch did not detect a CUDA GPU'; print('CUDA:', torch.cuda.get_device_name(0))"
if ($LASTEXITCODE -ne 0) { throw "CUDA validation failed." }

Write-Host "Captionless videos use Qwen3-ASR 0.6B from data/video_models/Qwen3-ASR-0.6B."
Write-Host "All captionless videos use Qwen3-ASR 0.6B; source language is used as a hint when available."
