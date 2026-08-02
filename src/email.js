import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import nodemailer from "nodemailer";
import { localDateTime } from "./time.js";

export async function sendDigestEmail(config, result, options = {}) {
  if (!config.email.enabled) return { skipped: true };

  const report = await fs.readFile(result.reportPath, "utf8");
  const emailMarkdown = await appendFullContent(report, result.reportItems);
  const message = buildDigestEmailMessage(config, result, emailMarkdown);
  return sendMessage(config, message, options.transport);
}

export async function sendFatalEmail(config, error, options = {}) {
  if (!config.email.enabled) return { skipped: true };
  return sendMessage(config, buildFatalEmailMessage(config, error), options.transport);
}

export async function sendTestEmail(config, options = {}) {
  if (!config.email.enabled) throw new Error("email.enabled is false");
  const now = `${localDateTime(new Date(), config.timezone)}（北京时间）`;
  return sendMessage(config, {
    from: config.email.from,
    to: config.email.to,
    subject: "[测试成功] 每日信息日报邮件配置",
    text: `QQ SMTP 配置可用。\n测试时间：${now}`,
    html: `<h2>每日信息日报邮件配置成功</h2><p>QQ SMTP 配置可用。</p><p>测试时间：${escapeHtml(now)}</p>`
  }, options.transport);
}

export async function saveSmtpPassword(config, password) {
  if (process.platform !== "win32") throw new Error(`非 Windows 系统请通过环境变量 ${config.email.passwordEnv} 配置授权码`);
  if (!String(password).trim()) throw new Error("SMTP 授权码不能为空");
  await fs.mkdir(path.dirname(config.email.passwordFile), { recursive: true });
  const script = [
    "$ErrorActionPreference='Stop'",
    "$secret=[Console]::In.ReadToEnd().TrimEnd([char]13,[char]10)",
    "$secure=ConvertTo-SecureString $secret -AsPlainText -Force",
    "$secure|ConvertFrom-SecureString|Set-Content -Encoding UTF8 -LiteralPath $env:DAILY_DIGEST_SECRET_FILE"
  ].join(";");
  const powershell = await findPowerShell();
  await new Promise((resolve, reject) => {
    const child = spawn(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, DAILY_DIGEST_SECRET_FILE: config.email.passwordFile }, windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `PowerShell exit ${code}`)));
    child.stdin.end(String(password));
  });
  return { saved: true, storage: "Windows DPAPI" };
}

export function buildDigestEmailMessage(config, result, report) {
  const enabledSourceCount = config.sources.filter((source) => source.enabled !== false).length;
  const sourceErrorCount = result.errors.filter((error) =>
    config.sources.some((source) => source.id === error.sourceId && source.enabled !== false)
  ).length;
  const failedTranscriptCount = result.reportItems.filter((item) => item.transcriptStatus === "failed").length;
  const status = sourceErrorCount === 0 && failedTranscriptCount === 0
    ? "成功"
    : sourceErrorCount >= enabledSourceCount ? "失败" : "部分失败";
  const subject = `[${status}] 关注对象信息日报 ${result.reportDate} · ${result.reportItems.length} 条`;
  const contentAttachments = [...new Set(result.reportItems.flatMap(
    (item) => [item.transcriptPath, item.contentPath].filter(Boolean)
  ))].map((filePath) => ({ filename: path.basename(filePath), path: filePath }));

  return {
    from: config.email.from,
    to: config.email.to,
    subject,
    text: report,
    html: renderReportHtml(subject, report),
    attachments: [
      { filename: `${result.reportDate}-information-digest.md`, path: result.reportPath },
      ...contentAttachments
    ]
  };
}

export function buildFatalEmailMessage(config, error) {
  const detail = error?.stack ?? error?.message ?? String(error);
  const subject = `[失败] 关注对象信息日报未生成 · ${localDateTime(new Date(), config.timezone)} 北京时间`;
  return {
    from: config.email.from,
    to: config.email.to,
    subject,
    text: `采集任务发生致命错误，日报未能正常生成。\n\n${detail}`,
    html: `<h2>采集任务发生致命错误</h2><p>日报未能正常生成。</p><pre>${escapeHtml(detail)}</pre>`
  };
}

async function sendMessage(config, message, injectedTransport) {
  const password = injectedTransport ? "injected-for-test" : await loadSmtpPassword(config.email);
  const transport = injectedTransport ?? nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: { user: config.email.username, pass: password },
    connectionTimeout: config.email.timeoutMs,
    greetingTimeout: config.email.timeoutMs,
    socketTimeout: config.email.timeoutMs
  });

  try {
    let lastError;
    for (let attempt = 0; attempt <= config.email.retries; attempt += 1) {
      try {
        const info = await transport.sendMail(message);
        return { sent: true, messageId: info.messageId ?? "" };
      } catch (error) {
        lastError = error;
        if (attempt < config.email.retries) await delay(1000 * (attempt + 1));
      }
    }
    throw lastError;
  } finally {
    transport.close?.();
  }
}

async function loadSmtpPassword(emailConfig) {
  const fromEnvironment = process.env[emailConfig.passwordEnv];
  if (fromEnvironment) return fromEnvironment;

  try {
    await fs.access(emailConfig.passwordFile);
  } catch {
    throw new Error(`SMTP 授权码尚未配置，请运行 scripts/configure_email.ps1`);
  }

  if (process.platform !== "win32") {
    throw new Error(`请通过环境变量 ${emailConfig.passwordEnv} 注入 SMTP 授权码`);
  }

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
    "$encrypted = Get-Content -Raw -LiteralPath $env:DAILY_DIGEST_SECRET_FILE",
    "$secure = ConvertTo-SecureString $encrypted",
    "$ptr = [IntPtr]::Zero",
    "try { $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) } }"
  ].join("; ");
  const powershell = await findPowerShell();
  const password = await captureProcess(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    ...process.env,
    DAILY_DIGEST_SECRET_FILE: emailConfig.passwordFile
  });
  if (!password.trim()) throw new Error("无法解密 SMTP 授权码");
  return password.trim();
}

async function findPowerShell() {
  const programFiles = process.env.ProgramW6432 || process.env.ProgramFiles || "C:\\Program Files";
  const candidates = [
    path.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    ...(process.env.Path ?? process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory.replace(/^"|"$/g, ""), "pwsh.exe"))
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next PowerShell installation.
    }
  }
  return path.join(process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function captureProcess(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`SMTP 授权码解密失败：${stderr.trim() || `exit ${code}`}`));
    });
  });
}

function renderReportHtml(subject, report) {
  const content = renderMarkdownBlocks(report);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#ffffff;color:#24292f">
<div style="max-width:860px;margin:0 auto;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.75">
<div style="padding:12px 16px;background:#f6f8fa;border-radius:8px;margin-bottom:24px"><strong>${escapeHtml(subject)}</strong></div>
${content}
</div></body></html>`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function appendFullContent(report, reportItems) {
  const groups = [
    { key: "transcriptPath", heading: "完整视频文字稿" },
    { key: "contentPath", heading: "完整小宇宙文字内容" }
  ];
  let output = report.trim();

  for (const group of groups) {
    const paths = [...new Set((reportItems ?? []).map((item) => item[group.key]).filter(Boolean))];
    if (paths.length === 0) continue;

    const sections = [];
    for (const filePath of paths) {
      const content = await fs.readFile(filePath, "utf8");
      sections.push(demoteHeadings(content.trim()));
    }
    output += `\n\n# ${group.heading}\n\n${sections.join("\n\n---\n\n")}`;
  }
  return `${output}\n`;
}

function demoteHeadings(markdown) {
  return markdown.replace(/^(#{1,4})(?=\s)/gm, "##$1");
}

function renderMarkdownBlocks(markdown) {
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p style="margin:0 0 16px">${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  };

  for (const line of String(markdown).replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const sizes = { 1: 24, 2: 21, 3: 18, 4: 16, 5: 15, 6: 14 };
      blocks.push(`<h${level} style="font-size:${sizes[level]}px;line-height:1.35;margin:28px 0 12px">${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      blocks.push('<hr style="border:0;border-top:1px solid #d0d7de;margin:28px 0">');
      continue;
    }

    const bullet = line.match(/^(\s*)-\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      const depth = Math.floor(bullet[1].length / 2);
      blocks.push(`<div style="margin:4px 0 4px ${depth * 20}px;padding-left:16px;text-indent:-14px">• ${renderInlineMarkdown(bullet[2])}</div>`);
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();
  return blocks.join("\n");
}

function renderInlineMarkdown(value) {
  const text = String(value);
  const output = [];
  let cursor = 0;
  const links = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of text.matchAll(links)) {
    output.push(escapeHtml(text.slice(cursor, match.index)));
    output.push(`<a href="${escapeHtml(match[2])}" style="color:#0969da;text-decoration:none">${escapeHtml(match[1])}</a>`);
    cursor = match.index + match[0].length;
  }
  output.push(escapeHtml(text.slice(cursor)));
  return output.join("");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
