import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { openBrowserContext, sessionPath } from "../browser.js";
import { sessionStatus } from "../sessions/manager.js";
import { localDate } from "../time.js";
import { discoverBilibili, discoverYouTube } from "./discovery.js";
import { VideoState } from "./state.js";

const VIDEO_PLATFORMS = new Set(["youtube", "bilibili"]);

export async function runVideoIngest(config, options = {}) {
  const sources = config.sources.filter((source) => source.enabled !== false && VIDEO_PLATFORMS.has(source.platform));
  if (sources.length === 0) return { discovered: 0, completed: 0, failed: 0, jobs: [], sourceErrors: [] };

  const sourceErrors = [];
  let bilibiliCookieFile = "";
  if (sources.some((source) => source.platform === "bilibili")) {
    const status = await sessionStatus(config, "bilibili", true);
    if (status.status === "valid") {
      bilibiliCookieFile = await exportBilibiliCookies(config);
    } else if (["expired", "error"].includes(status.status)) {
      for (const source of sources.filter((candidate) => candidate.platform === "bilibili")) {
        sourceErrors.push({ sourceId: source.id, message: `${status.message}；本次继续匿名处理公开内容，会员内容可能漏采` });
      }
    }
  }

  await ensurePipelineReady(config);
  const state = new VideoState(config.video.statePath);
  await state.load();
  let browser;
  let context;
  const processedJobs = [];

  try {
    if (sources.some((source) => source.platform === "bilibili")) {
      ({ browser, context } = await openBrowserContext(config, { platform: "bilibili", useStorageState: Boolean(bilibiliCookieFile) }));
    }
    for (const source of sources) {
      const startedAt = new Date().toISOString();
      try {
        let videos;
        if (source.platform === "youtube") {
          videos = await discoverYouTube(source, config, options);
        } else {
          const page = await context.newPage();
          try {
            videos = await discoverBilibili(page, source, config, options);
          } finally {
            await page.close();
          }
        }

        for (const video of videos) {
          const key = `${video.platform}:${video.id}`;
          const existing = state.data.jobs[key];
          if (!options.force && existing?.status === "completed" && await fileExists(existing.transcriptPath)) {
            processedJobs.push(existing);
            continue;
          }

          const job = {
            ...existing,
            ...video,
            key,
            reportDate: localDate(video.publishedAt, config.timezone),
            status: "processing",
            attempts: Number(existing?.attempts ?? 0) + 1,
            updatedAt: new Date().toISOString(),
            error: ""
          };
          state.data.jobs[key] = job;
          await state.save();

          try {
            const result = await transcribeVideo(config, source, job, { bilibiliCookieFile });
            const transcriptPath = await writeTranscript(config, job, result);
            Object.assign(job, {
              status: "completed",
              transcriptPath,
              transcriptionSource: result.transcriptionSource,
              transcriptionDevice: result.transcriptionDevice,
              transcriptLanguage: result.language,
              transcriptChars: result.text.length,
              excerpt: excerpt(result.text, config.video.excerptChars),
              updatedAt: new Date().toISOString()
            });
          } catch (error) {
            Object.assign(job, {
              status: "failed",
              error: error.message,
              updatedAt: new Date().toISOString()
            });
          }
          processedJobs.push(job);
          await state.save();
        }

        const sourceJobs = processedJobs.filter((job) => job.sourceId === source.id);
        state.data.sourceRuns[source.id] = {
          reportDate: options.reportDate || sourceJobs[0]?.reportDate || "",
          mode: options.latest ? "latest" : "date",
          status: sourceJobs.some((job) => job.status === "failed") ? "partial" : "success",
          discovered: videos.length,
          completed: sourceJobs.filter((job) => job.status === "completed").length,
          failed: sourceJobs.filter((job) => job.status === "failed").length,
          startedAt,
          finishedAt: new Date().toISOString(),
          error: ""
        };
      } catch (error) {
        state.data.sourceRuns[source.id] = {
          reportDate: options.reportDate ?? "",
          mode: options.latest ? "latest" : "date",
          status: "failed",
          discovered: 0,
          completed: 0,
          failed: 0,
          startedAt,
          finishedAt: new Date().toISOString(),
          error: error.message
        };
      }
      await state.save();
    }
  } finally {
    await state.save();
    await browser?.close().catch(() => {});
  }

  sourceErrors.push(...sources
    .map((source) => ({ sourceId: source.id, run: state.data.sourceRuns[source.id] }))
    .filter(({ run }) => run?.status === "failed")
    .map(({ sourceId, run }) => ({ sourceId, message: run.error })));
  return {
    discovered: processedJobs.length,
    completed: processedJobs.filter((job) => job.status === "completed").length,
    failed: processedJobs.filter((job) => job.status === "failed").length + sourceErrors.length,
    jobs: processedJobs,
    sourceErrors
  };
}

async function transcribeVideo(config, source, job, options = {}) {
  const jobDir = path.join(config.video.workDir, job.key.replace(/[^a-zA-Z0-9_-]/g, "_"));
  const resultPath = path.join(jobDir, "result.json");
  await fs.mkdir(jobDir, { recursive: true });
  const args = [
    config.video.workerPath,
    "--url", job.url,
    "--work-dir", jobDir,
    "--result-json", resultPath,
    "--qwen-model-dir", config.video.qwenModelDir,
    "--device", source.device ?? config.video.device,
    "--language", source.language ?? "auto",
    "--max-duration-minutes", String(source.maxDurationMinutes ?? config.video.maxDurationMinutes)
  ];
  for (const language of source.subtitleLanguages ?? [source.language].filter(Boolean)) {
    args.push("--subtitle-language", language);
  }
  const cookieFile = source.cookieFile
    ? path.resolve(config.configDir, source.cookieFile)
    : source.platform === "bilibili" ? options.bilibiliCookieFile : "";
  if (cookieFile) args.push("--cookie-file", cookieFile);

  await runProcess(config.video.pythonPath, args, {
    ...process.env,
    HF_HOME: config.video.modelDir,
    MODELSCOPE_CACHE: config.video.modelDir,
    HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
    PYTORCH_ALLOC_CONF: "expandable_segments:True",
    PYTHONUTF8: "1"
  });
  return JSON.parse(await fs.readFile(resultPath, "utf8"));
}

export async function exportBilibiliCookies(config) {
  const state = JSON.parse(await fs.readFile(sessionPath(config, "bilibili"), "utf8"));
  const cookies = (state.cookies ?? []).filter((cookie) => /(^|\.)bilibili\.com$/i.test(String(cookie.domain).replace(/^\./, "")));
  if (cookies.length === 0) return "";
  const directory = path.join(config.video.workDir, "platform_sessions");
  const cookieFile = path.join(directory, "bilibili.cookies.txt");
  await fs.mkdir(directory, { recursive: true });
  const lines = ["# Netscape HTTP Cookie File", "# Generated locally from the Bilibili browser session."];
  for (const cookie of cookies) {
    const domain = cookie.httpOnly ? `#HttpOnly_${cookie.domain}` : cookie.domain;
    lines.push([
      domain,
      String(cookie.domain).startsWith(".") ? "TRUE" : "FALSE",
      cookie.path || "/",
      cookie.secure ? "TRUE" : "FALSE",
      Math.max(0, Math.floor(Number(cookie.expires) || 0)),
      String(cookie.name).replace(/[\t\r\n]/g, ""),
      String(cookie.value).replace(/[\t\r\n]/g, "")
    ].join("\t"));
  }
  await fs.writeFile(cookieFile, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  return cookieFile;
}

async function writeTranscript(config, job, result) {
  const directory = path.join(config.video.transcriptDir, job.reportDate);
  await fs.mkdir(directory, { recursive: true });
  const filename = `${job.platform}_${job.id}_${slug(job.title)}.md`;
  const transcriptPath = path.join(directory, filename);
  const lines = [
    `# ${job.title}`,
    "",
    `- 博主：${job.author}`,
    `- 平台：${job.platform}`,
    `- 发布时间：${job.publishedAt}`,
    `- 时长：${formatDuration(job.durationSeconds)}`,
    `- 文字来源：${result.transcriptionSource}`,
    `- 转录设备：${result.transcriptionDevice}`,
    `- 原视频：${job.url}`,
    "",
    "## 文字稿",
    "",
    result.text.trim(),
    ""
  ];
  await fs.writeFile(transcriptPath, lines.join("\n"), "utf8");
  return transcriptPath;
}

async function ensurePipelineReady(config) {
  for (const [label, filePath] of [["视频 Python 环境", config.video.pythonPath], ["视频转录工作器", config.video.workerPath]]) {
    if (!await fileExists(filePath)) {
      throw new Error(`${label}不存在：${filePath}。请先运行 scripts/setup_video_pipeline.ps1`);
    }
  }
}

function runProcess(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error((stderr || stdout || `exit ${code}`).trim()));
    });
  });
}

function excerpt(text, maxLength) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength)}…`;
}

function slug(value) {
  return String(value).normalize("NFKC").replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, "_").slice(0, 60) || "video";
}

function formatDuration(seconds) {
  const minutes = Math.floor(Number(seconds || 0) / 60);
  const remainder = Math.floor(Number(seconds || 0) % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
