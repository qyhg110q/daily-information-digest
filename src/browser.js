import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const PERSISTENT_PLATFORMS = new Set(["x", "weibo"]);

export async function openBrowserContext(config, options = {}) {
  if (usesPersistentProfile(options.platform)) {
    return openPersistentBrowserContext(config, options);
  }

  const browser = await chromium.launch({
    executablePath: config.browser.executablePath,
    headless: options.headless ?? config.browser.headless,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: ["--disable-background-mode"]
  });
  const storageStatePath = sessionPath(config, options.platform);
  let storageState;
  if (options.useStorageState !== false) {
    storageState = await fileExists(storageStatePath)
      ? storageStatePath
      : options.platform && await fileExists(config.browser.storageStatePath) ? config.browser.storageStatePath : undefined;
  }
  const context = await browser.newContext(contextOptions(config, { storageState }));
  return { browser, context, persistent: false };
}

async function openPersistentBrowserContext(config, options) {
  const platform = options.platform;
  const userDataDir = profilePath(config, platform);
  await fs.mkdir(userDataDir, { recursive: true });
  const releaseLock = await acquireProfileLock(config, platform);
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: config.browser.executablePath,
      headless: options.headless ?? config.browser.headless,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      args: ["--disable-background-mode"],
      ...contextOptions(config)
    });
  } catch (error) {
    await releaseLock();
    throw error;
  }
  context.once("close", () => { releaseLock().catch(() => {}); });

  let closed = false;
  const browser = {
    async close() {
      if (closed) return;
      closed = true;
      try { await context.close(); }
      finally { await releaseLock(); }
    }
  };
  return { browser, context, persistent: true, userDataDir };
}

export async function launchPersistentLoginBrowser(config, platform, url, options = {}) {
  if (!usesPersistentProfile(platform)) throw new Error(`${platform} 不使用专用持久浏览器资料`);
  const userDataDir = profilePath(config, platform);
  await fs.mkdir(userDataDir, { recursive: true });
  const releaseLock = await acquireProfileLock(config, platform);
  const child = spawn(config.browser.executablePath, [
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
    ...(options.headless ? ["--headless=new"] : []),
    url
  ], {
    stdio: "ignore",
    windowsHide: false
  });

  let exited = false;
  let resolveExit;
  const exitPromise = new Promise((resolve) => { resolveExit = resolve; });
  child.once("exit", () => {
    exited = true;
    releaseLock().catch(() => {}).finally(resolveExit);
  });
  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  } catch (error) {
    exited = true;
    await releaseLock();
    resolveExit();
    throw error;
  }
  return { process: child, exitPromise, isExited: () => exited, userDataDir };
}

export async function runInteractiveLogin(config) {
  return runPlatformLogin(config);
}

export async function runPlatformLogin(config, platform) {
  if (!platform) throw new Error("请使用 --platform x 或 --platform weibo 分别登录持久浏览器资料");
  const opened = await openBrowserContext(config, { headless: false, platform });
  const browserSources = config.sources.filter(
    (source) => source.enabled !== false && source.platform === platform
  );

  for (const source of browserSources) {
    const page = await opened.context.newPage();
    await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: config.browser.navigationTimeoutMs });
  }

  console.log(`浏览器已打开。请完成 ${platform} 登录，然后回到终端按 Ctrl+C 保存并退出。`);
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  if (opened.persistent) {
    await opened.browser.close();
    await markPersistentLogin(config, platform);
    return;
  } else {
    const storageStatePath = sessionPath(config, platform);
    await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
    await opened.context.storageState({ path: storageStatePath, indexedDB: true });
  }
  await opened.browser.close();
}

export function usesPersistentProfile(platform) {
  return PERSISTENT_PLATFORMS.has(platform);
}

export function profilePath(config, platform) {
  const root = config.browser.profileDir ?? path.join(path.dirname(config.browser.sessionDir), "browser_profiles");
  return path.join(root, platform);
}

export function persistentLoginMarkerPath(config, platform) {
  return path.join(profilePath(config, platform), ".digest-login.json");
}

export async function markPersistentLogin(config, platform) {
  const marker = persistentLoginMarkerPath(config, platform);
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs.writeFile(marker, `${JSON.stringify({ platform, savedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

export function sessionPath(config, platform) {
  return platform ? path.join(config.browser.sessionDir, `${platform}.json`) : config.browser.storageStatePath;
}

function contextOptions(config, extra = {}) {
  return {
    locale: "zh-CN",
    timezoneId: config.timezone,
    viewport: { width: 1440, height: 1000 },
    ...extra
  };
}

async function acquireProfileLock(config, platform) {
  const profileRoot = path.dirname(profilePath(config, platform));
  const lockPath = path.join(profileRoot, `.${platform}.lock`);
  await fs.mkdir(profileRoot, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await handle.close().catch(() => {});
        await fs.unlink(lockPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stale = await isStaleLock(lockPath);
      if (stale && attempt === 0) {
        await fs.unlink(lockPath).catch(() => {});
        continue;
      }
      throw new Error(`${platform} 的专用浏览器资料正在被另一个登录窗口或日报任务使用，请稍后重试`);
    }
  }
  throw new Error(`无法锁定 ${platform} 的专用浏览器资料`);
}

async function isStaleLock(lockPath) {
  try {
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
    if (!Number.isInteger(lock.pid) || lock.pid < 1) return true;
    try { process.kill(lock.pid, 0); return false; }
    catch { return true; }
  } catch {
    return true;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
