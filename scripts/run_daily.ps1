$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectDir

Write-Host "Starting previous-day video ingestion..."
& node src/cli.js video-ingest --config config.json --previous-day
$VideoExitCode = $LASTEXITCODE
if ($VideoExitCode -ne 0) {
    Write-Warning "Video ingestion reported failures (exit $VideoExitCode). The digest will still be sent."
}

Write-Host "Video ingestion finished. Starting previous-day digest generation and email delivery immediately..."
& node src/cli.js once --config config.json --previous-day
exit $LASTEXITCODE
