import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

export async function openBrowserContext(config, options = {}) {
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
  const context = await browser.newContext({
    storageState,
    locale: "zh-CN",
    timezoneId: config.timezone,
    viewport: { width: 1440, height: 1000 }
  });
  return { browser, context };
}

export async function runInteractiveLogin(config) {
  return runPlatformLogin(config);
}

export async function runPlatformLogin(config, platform) {
  const storageStatePath = sessionPath(config, platform);
  await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
  const { browser, context } = await openBrowserContext(config, { headless: false, platform });
  const browserSources = config.sources.filter(
    (source) => source.enabled !== false && (source.platform === platform || (!platform && ["x", "weibo", "bilibili"].includes(source.platform)))
  );

  for (const source of browserSources) {
    const page = await context.newPage();
    await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: config.browser.navigationTimeoutMs });
  }

  console.log(`浏览器已打开。请完成${platform ? ` ${platform}` : "各平台"}登录，然后回到终端按 Ctrl+C 保存并退出。`);
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await context.storageState({ path: storageStatePath });
  await browser.close();
}

export function sessionPath(config, platform) {
  return platform ? path.join(config.browser.sessionDir, `${platform}.json`) : config.browser.storageStatePath;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
