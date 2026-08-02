param(
    [string]$TaskName = "DailyInformationDigest",
    [string]$At = ""
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
$Config = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectDir "config.json") | ConvertFrom-Json
if (-not $At) {
    $At = $Config.reportTime
}
$RunScript = Join-Path $PSScriptRoot "run_daily.ps1"
$PowerShell = (Get-Command powershell.exe).Source
$ActionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$RunScript`""
$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $ActionArgs
$TriggerTime = [DateTime]::Today.Add([TimeSpan]::Parse($At))
$Trigger = New-ScheduledTaskTrigger -Daily -At $TriggerTime
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 12)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "Ingest previous-day videos, then immediately collect and email one unified digest." `
    -Force

Write-Host "Installed unified task $TaskName. The workflow starts at $At; digest delivery begins immediately after video ingestion finishes."
