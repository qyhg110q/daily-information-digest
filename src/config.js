import fs from "node:fs/promises";
import path from "node:path";

export const CONFIG_VERSION = 1;
export const SUPPORTED_PLATFORMS = new Set(["x", "weibo", "wechat", "youtube", "bilibili", "xiaoyuzhou"]);

export const DEFAULTS = {
  version: CONFIG_VERSION,
  timezone: "Asia/Shanghai",
  reportTime: "08:00",
  statePath: "./data/state.json",
  logDir: "./data/logs",
  outputDir: "../../contexts/daily_records/information_digest",
  browser: {
    storageStatePath: "./data/browser_state.json",
    sessionDir: "./data/sessions",
    profileDir: "./data/browser_profiles",
    headless: true,
    executablePath: "",
    navigationTimeoutMs: 45000,
    settleMs: 5000,
    scrollRounds: 2,
    maxItemsPerSource: 30
  },
  summarization: {
    provider: "none",
    endpoint: "http://127.0.0.1:11434",
    model: "qwen3:8b",
    timeoutMs: 120000
  },
  video: {
    statePath: "./data/video_ingest_state.json",
    workDir: "./data/video_work",
    modelDir: "./data/video_models",
    qwenModelDir: "./data/video_models/Qwen3-ASR-0.6B",
    transcriptDir: "../../contexts/daily_records/video_transcripts",
    pythonPath: process.platform === "win32" ? "./data/video_venv/Scripts/python.exe" : "./data/video_venv/bin/python",
    workerPath: "./scripts/video_worker.py",
    device: "cuda",
    excerptChars: 1800,
    maxVideosPerSource: 5,
    maxDiscoveryItems: 20,
    maxDurationMinutes: 120
  },
  email: {
    enabled: false,
    host: "smtp.qq.com",
    port: 465,
    secure: true,
    username: "",
    passwordEnv: "DAILY_DIGEST_SMTP_PASSWORD",
    passwordFile: "./data/email_auth_code.dpapi",
    from: "",
    to: [],
    retries: 2,
    timeoutMs: 30000
  },
  sources: []
};

export async function loadConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  const configDir = path.dirname(absolutePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const userConfig = migrateConfig(JSON.parse(raw.replace(/^\uFEFF/, "")));
  const config = mergeConfig(DEFAULTS, userConfig);

  validateConfig(config);

  config.configPath = absolutePath;
  config.configDir = configDir;
  config.statePath = path.resolve(configDir, config.statePath);
  config.logDir = path.resolve(configDir, config.logDir);
  config.outputDir = path.resolve(configDir, config.outputDir);
  config.browser.storageStatePath = path.resolve(configDir, config.browser.storageStatePath);
  config.browser.sessionDir = path.resolve(configDir, config.browser.sessionDir);
  config.browser.profileDir = path.resolve(configDir, config.browser.profileDir);
  config.email.passwordFile = path.resolve(configDir, config.email.passwordFile);
  for (const key of ["statePath", "workDir", "modelDir", "qwenModelDir", "transcriptDir", "pythonPath", "workerPath"]) {
    config.video[key] = path.resolve(configDir, config.video[key]);
  }
  config.browser.executablePath = config.browser.executablePath
    ? path.resolve(configDir, config.browser.executablePath)
    : await findInstalledBrowser();

  return config;
}

export function validateConfig(config) {
  if (config.version !== undefined && config.version !== CONFIG_VERSION) throw new Error(`Unsupported config version: ${config.version}`);
  if (!Array.isArray(config.sources)) throw new Error("sources must be an array");

  try {
    new Intl.DateTimeFormat("en", { timeZone: config.timezone }).format();
  } catch {
    throw new Error(`Invalid timezone: ${config.timezone}`);
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.reportTime)) {
    throw new Error("reportTime must use HH:mm format");
  }

  const ids = new Set();
  for (const source of config.sources) {
    if (!source.id || !/^[a-z0-9_]+$/.test(source.id)) {
      throw new Error(`Invalid source id: ${source.id ?? "(missing)"}`);
    }
    if (ids.has(source.id)) throw new Error(`Duplicate source id: ${source.id}`);
    ids.add(source.id);

    if (!SUPPORTED_PLATFORMS.has(source.platform)) {
      throw new Error(`Unsupported platform for ${source.id}: ${source.platform}`);
    }
    if (!source.displayName) throw new Error(`Missing displayName for ${source.id}`);
    if ((source.platform === "x" || source.platform === "weibo") && !source.url) {
      throw new Error(`Missing url for ${source.id}`);
    }
    if (source.platform === "wechat" && !source.feedUrl) {
      throw new Error(`Missing feedUrl for ${source.id}`);
    }
    if (source.platform === "youtube" && (!source.url || !source.channelId || !source.feedUrl)) {
      throw new Error(`YouTube source ${source.id} requires url, channelId, and feedUrl`);
    }
    if (source.platform === "bilibili" && (!source.url || !/^\d+$/.test(String(source.uid ?? "")))) {
      throw new Error(`Bilibili source ${source.id} requires url and numeric uid`);
    }
    if (source.platform === "xiaoyuzhou" && (!source.url || !/^[a-f0-9]{24}$/i.test(String(source.pid ?? "")))) {
      throw new Error(`Xiaoyuzhou source ${source.id} requires url and a 24-character pid`);
    }
  }

  const videoConfig = { ...DEFAULTS.video, ...(config.video ?? {}) };
  for (const key of ["excerptChars", "maxVideosPerSource", "maxDiscoveryItems", "maxDurationMinutes"]) {
    if (!Number.isInteger(videoConfig[key]) || videoConfig[key] < 1) {
      throw new Error(`video.${key} must be a positive integer`);
    }
  }

  if (config.email?.enabled) {
    if (!config.email.host || !config.email.username || !config.email.from) {
      throw new Error("email host, username, and from are required when email is enabled");
    }
    if (!Array.isArray(config.email.to) || config.email.to.length === 0) {
      throw new Error("email.to must contain at least one recipient");
    }
    if (!Number.isInteger(config.email.port) || config.email.port < 1 || config.email.port > 65535) {
      throw new Error("email.port must be a valid TCP port");
    }
    if (!Number.isInteger(config.email.retries) || config.email.retries < 0) {
      throw new Error("email.retries must be a non-negative integer");
    }
  }
}

export function migrateConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("config must be a JSON object");
  const version = input.version ?? 0;
  if (version > CONFIG_VERSION) throw new Error(`Config version ${version} is newer than supported version ${CONFIG_VERSION}`);
  const migrated = version === 0 ? { version: CONFIG_VERSION, ...input } : { ...input };
  migrated.sources = (migrated.sources ?? []).map((source) => ({
    ...source,
    ...(typeof source.subtitleLanguages === "string" ? { subtitleLanguages: source.subtitleLanguages.split(/[\s,]+/).filter(Boolean) } : {})
  }));
  return migrated;
}

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    browser: { ...base.browser, ...(override.browser ?? {}) },
    summarization: { ...base.summarization, ...(override.summarization ?? {}) },
    video: { ...base.video, ...(override.video ?? {}) },
    email: { ...base.email, ...(override.email ?? {}) },
    sources: override.sources ?? base.sources
  };
}

async function findInstalledBrowser() {
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next installed-browser location.
    }
  }

  throw new Error("Chrome or Edge was not found. Set browser.executablePath in config.json.");
}
