import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_TASK = "DailyInformationDigest";

export async function getSchedule(config, taskName = DEFAULT_TASK) {
  if (process.platform !== "win32") return { supported: false, installed: false, message: "首版仅支持 Windows Task Scheduler" };
  const script = `$task=Get-ScheduledTask -TaskName '${escapePs(taskName)}' -ErrorAction SilentlyContinue;if(-not $task){'null';exit};$info=Get-ScheduledTaskInfo -TaskName '${escapePs(taskName)}';[pscustomobject]@{state=[string]$task.State;lastRunTime=$info.LastRunTime;nextRunTime=$info.NextRunTime;lastTaskResult=$info.LastTaskResult}|ConvertTo-Json -Compress`;
  const output = await powershell(script);
  if (output.trim() === "null") return { supported: true, installed: false, taskName };
  return { supported: true, installed: true, taskName, ...JSON.parse(output) };
}

export async function installSchedule(config, at, taskName = DEFAULT_TASK) {
  if (process.platform !== "win32") throw new Error("首版仅支持 Windows Task Scheduler");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new Error("执行时间必须使用 HH:mm");
  const scriptPath = path.resolve(config.configDir, "scripts", "install_task.ps1");
  await powershell(`& '${escapePs(scriptPath)}' -TaskName '${escapePs(taskName)}' -At '${at}'`);
  return getSchedule(config, taskName);
}

export async function removeSchedule(config, taskName = DEFAULT_TASK) {
  if (process.platform !== "win32") throw new Error("首版仅支持 Windows Task Scheduler");
  await powershell(`Unregister-ScheduledTask -TaskName '${escapePs(taskName)}' -Confirm:$false -ErrorAction SilentlyContinue`);
  return { supported: true, installed: false, taskName };
}

function powershell(command) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);${command}`], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `PowerShell exit ${code}`)));
  });
}
function escapePs(value) { return String(value).replaceAll("'", "''"); }
