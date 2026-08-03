import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import {
  markPersistentLogin,
  launchPersistentLoginBrowser,
  openBrowserContext,
  persistentLoginMarkerPath,
  sessionPath,
  usesPersistentProfile
} from "../browser.js";
import { getPlatform, listPlatforms } from "../platforms/registry.js";

const activeLogins = new Map();
const probes = {
  x: { url: "https://x.com/home", invalidUrl: /\/i\/flow\/login|\/login(?:\?|$)/i, validSelector: '[data-testid="SideNav_AccountSwitcher_Button"], a[href="/home"]' },
  weibo: { url: "https://weibo.com/", invalidUrl: /passport\.weibo\.com\/visitor|login\.sina\.com|\/newlogin/i, validSelector: 'a[href*="/u/"], [class*="Profile"]' },
  bilibili: { url: "https://www.bilibili.com/", invalidUrl: /passport\.bilibili\.com\/login/i, validSelector: ".header-avatar-wrap" }
};

export async function listSessionStatuses(config) {
  return Promise.all(listPlatforms().map((platform) => sessionStatus(config, platform.id, false)));
}

export async function sessionStatus(config, platformId, probe = true) {
  const platform = getPlatform(platformId);
  if (!platform) throw new Error(`Unknown platform: ${platformId}`);
  if (platformId === "wechat") {
    const feedUrl = config.sources.find((source) => source.platform === "wechat" && source.enabled !== false)?.feedUrl;
    if (!feedUrl) return { platform: platformId, status: "not_needed", checkedAt: new Date().toISOString(), message: "未配置 WeWe RSS 来源" };
    if (!probe) return { platform: platformId, status: "unknown", checkedAt: new Date().toISOString(), message: "WeWe RSS 尚未检测" };
    try {
      const response = await fetch(feedUrl, { signal: AbortSignal.timeout(10000) });
      return { platform: platformId, status: response.ok ? "valid" : "error", checkedAt: new Date().toISOString(), message: response.ok ? "WeWe RSS 服务可用" : `WeWe RSS HTTP ${response.status}` };
    } catch (error) {
      return { platform: platformId, status: "error", checkedAt: new Date().toISOString(), message: `WeWe RSS 不可用：${error.message}` };
    }
  }
  if (usesPersistentProfile(platformId)) {
    const marker = persistentLoginMarkerPath(config, platformId);
    try { await fs.access(marker); }
    catch {
      const legacyFile = sessionPath(config, platformId);
      const hasLegacySnapshot = await fs.access(legacyFile).then(() => true).catch(() => false);
      return {
        platform: platformId,
        status: "expired",
        checkedAt: new Date().toISOString(),
        message: hasLegacySnapshot
          ? "旧版登录快照不会继续使用，请重新登录一次以创建专用持久浏览器资料"
          : "尚未登录，请登录一次以创建专用持久浏览器资料"
      };
    }
    if (!probe) {
      const stat = await fs.stat(marker);
      return { platform: platformId, status: "unknown", savedAt: stat.mtime.toISOString(), message: "专用持久浏览器资料已存在，尚未主动检测" };
    }
  }
  if (platform.capabilities.loginOptional) {
    const optionalFile = sessionPath(config, platformId);
    try { await fs.access(optionalFile); }
    catch { return { platform: platformId, status: "not_needed", checkedAt: new Date().toISOString(), message: "公开内容无需登录；如需访问会员内容，请登录 Bilibili" }; }
    if (!probe) {
      const stat = await fs.stat(optionalFile);
      return { platform: platformId, status: "unknown", savedAt: stat.mtime.toISOString(), message: "已配置会员内容登录，尚未主动检测" };
    }
  }
  if (!platform.capabilities.login && !platform.capabilities.loginOptional) return { platform: platformId, status: "not_needed", checkedAt: new Date().toISOString() };
  if (!usesPersistentProfile(platformId)) {
    const file = sessionPath(config, platformId);
    let savedFile = file;
    try { await fs.access(savedFile); } catch {
      savedFile = config.browser.storageStatePath;
      try { await fs.access(savedFile); } catch { return { platform: platformId, status: "expired", checkedAt: new Date().toISOString(), message: "尚未登录" }; }
    }
    if (!probe) {
      const stat = await fs.stat(savedFile);
      return { platform: platformId, status: "unknown", savedAt: stat.mtime.toISOString(), message: "登录文件存在，尚未主动检测" };
    }
  }
  const rule = probes[platformId];
  let browser;
  try {
    const opened = await openBrowserContext(config, { platform: platformId, headless: true });
    browser = opened.browser;
    if (platformId === "bilibili") {
      const response = await opened.context.request.get("https://api.bilibili.com/x/web-interface/nav", { timeout: config.browser.navigationTimeoutMs });
      const payload = await response.json().catch(() => ({}));
      const valid = response.ok() && payload?.data?.isLogin === true;
      return { platform: platformId, status: valid ? "valid" : "expired", checkedAt: new Date().toISOString(), message: valid ? `会员内容登录有效：${payload.data.uname ?? "Bilibili 用户"}` : "Bilibili 登录已失效；公开内容仍会处理" };
    }
    const page = await opened.context.newPage();
    await page.goto(rule.url, { waitUntil: "domcontentloaded", timeout: config.browser.navigationTimeoutMs });
    await page.waitForTimeout(Math.min(config.browser.settleMs, 3000));
    const invalid = rule.invalidUrl.test(page.url());
    const cookies = await opened.context.cookies();
    let evidence;
    if (platformId === "x") {
      evidence = {
        cookieNames: cookies.filter((cookie) => /(^|\.)x\.com$/i.test(cookie.domain)).map((cookie) => cookie.name),
        invalid,
        authenticatedUrl: /^https:\/\/x\.com\/home(?:[/?#]|$)/i.test(page.url()),
        homeLinks: await page.locator('a[href="/home"]').count()
      };
    } else if (platformId === "weibo") {
      evidence = {
        cookieNames: cookies.filter((cookie) => /(^|\.)weibo\.com$|(^|\.)sina\.com$/i.test(cookie.domain)).map((cookie) => cookie.name),
        invalid,
        profileLinks: await page.locator('a[href^="/u/"], a[href*="weibo.com/u/"]').count(),
        articles: await page.locator("article").count()
      };
    } else {
      evidence = { invalid, visible: await page.locator(rule.validSelector).first().isVisible().catch(() => false) };
    }
    const valid = persistentSessionIsValid(platformId, evidence);
    const status = !invalid && valid ? "valid" : "expired";
    return { platform: platformId, status, checkedAt: new Date().toISOString(), message: status === "valid" ? `${platformId === "x" ? "X" : "微博"} 登录有效` : "持久浏览器资料中未检测到有效登录身份" };
  } catch (error) {
    return { platform: platformId, status: "error", checkedAt: new Date().toISOString(), message: error.message };
  } finally {
    await browser?.close().catch(() => {});
  }
}

export function persistentSessionIsValid(platformId, evidence) {
  const names = new Set(evidence.cookieNames ?? []);
  if (evidence.invalid) return false;
  if (platformId === "x") return names.has("auth_token") && names.has("ct0") && (evidence.authenticatedUrl || evidence.homeLinks > 0);
  if (platformId === "weibo") return names.has("SUB") && (evidence.profileLinks > 0 || evidence.articles > 0);
  return evidence.visible === true;
}

export async function startLogin(config, platformId) {
  if (!probes[platformId]) throw new Error(`Platform ${platformId} does not support browser login`);
  const existing = [...activeLogins.entries()].find(([, entry]) => entry.platformId === platformId);
  if (existing) {
    if (existing[1].manual?.isExited()) {
      await existing[1].manual.exitPromise;
      activeLogins.delete(existing[0]);
    } else {
      throw new Error(`${platformId} login is already open`);
    }
  }
  const sourceUrl = config.sources.find((source) => source.platform === platformId)?.url ?? probes[platformId].url;
  const id = crypto.randomUUID();
  if (usesPersistentProfile(platformId)) {
    const manual = await launchPersistentLoginBrowser(config, platformId, sourceUrl);
    const entry = { platformId, persistent: true, manual, startedAt: new Date().toISOString() };
    activeLogins.set(id, entry);
    manual.exitPromise.then(() => markPersistentLogin(config, platformId)).catch(() => {});
    return { id, platform: platformId, status: "waiting_for_user", browserMode: "manual" };
  }

  const opened = await openBrowserContext(config, { platform: platformId, headless: false });
  const page = await opened.context.newPage();
  try { await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: config.browser.navigationTimeoutMs }); }
  catch (error) { await opened.browser.close().catch(() => {}); throw error; }
  activeLogins.set(id, { platformId, ...opened, startedAt: new Date().toISOString() });
  return { id, platform: platformId, status: "waiting_for_user" };
}

export async function completeLogin(config, loginId) {
  const entry = activeLogins.get(loginId);
  if (!entry) throw new Error("Login session not found or already closed");
  if (entry.manual && !entry.manual.isExited()) throw new Error("请先关闭专用登录窗口，再点击“登录完成，检测”");
  activeLogins.delete(loginId);
  if (entry.manual) {
    await entry.manual.exitPromise;
    await markPersistentLogin(config, entry.platformId);
  } else if (entry.persistent) {
    await entry.browser.close();
    await markPersistentLogin(config, entry.platformId);
  } else {
    const file = sessionPath(config, entry.platformId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      await entry.context.storageState({ path: file, indexedDB: true });
    } finally {
      await entry.browser.close().catch(() => {});
    }
  }
  return sessionStatus(config, entry.platformId, true);
}

export async function cancelLogin(loginId) {
  const entry = activeLogins.get(loginId);
  if (!entry) return false;
  activeLogins.delete(loginId);
  if (entry.manual) {
    if (!entry.manual.isExited()) throw new Error("请先关闭专用登录窗口");
    await entry.manual.exitPromise;
    return true;
  }
  await entry.browser.close().catch(() => {});
  return true;
}
