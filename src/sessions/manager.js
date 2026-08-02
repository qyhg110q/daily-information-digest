import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { openBrowserContext, sessionPath } from "../browser.js";
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
    if (platformId === "weibo") {
      const response = await opened.context.request.get("https://weibo.com/ajax/config/get_config", { timeout: config.browser.navigationTimeoutMs });
      const payload = await response.json().catch(() => ({}));
      const valid = response.ok() && (payload?.data?.login === true || Boolean(payload?.data?.uid));
      return { platform: platformId, status: valid ? "valid" : "expired", checkedAt: new Date().toISOString(), message: valid ? "微博登录有效" : "微博接口未检测到登录身份" };
    }
    const page = await opened.context.newPage();
    await page.goto(rule.url, { waitUntil: "domcontentloaded", timeout: config.browser.navigationTimeoutMs });
    await page.waitForTimeout(Math.min(config.browser.settleMs, 3000));
    const invalid = rule.invalidUrl.test(page.url());
    const valid = await page.locator(rule.validSelector).first().isVisible().catch(() => false);
    const status = !invalid && valid ? "valid" : "expired";
    return { platform: platformId, status, checkedAt: new Date().toISOString(), message: status === "valid" ? "登录有效" : "页面未检测到登录身份" };
  } catch (error) {
    return { platform: platformId, status: "error", checkedAt: new Date().toISOString(), message: error.message };
  } finally {
    await browser?.close().catch(() => {});
  }
}

export async function startLogin(config, platformId) {
  if (!probes[platformId]) throw new Error(`Platform ${platformId} does not support browser login`);
  if ([...activeLogins.values()].some((entry) => entry.platformId === platformId)) throw new Error(`${platformId} login is already open`);
  const opened = await openBrowserContext(config, { platform: platformId, headless: false });
  const page = await opened.context.newPage();
  const sourceUrl = config.sources.find((source) => source.platform === platformId)?.url ?? probes[platformId].url;
  try { await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: config.browser.navigationTimeoutMs }); }
  catch (error) { await opened.browser.close().catch(() => {}); throw error; }
  const id = crypto.randomUUID();
  activeLogins.set(id, { platformId, ...opened, startedAt: new Date().toISOString() });
  return { id, platform: platformId, status: "waiting_for_user" };
}

export async function completeLogin(config, loginId) {
  const entry = activeLogins.get(loginId);
  if (!entry) throw new Error("Login session not found or already closed");
  activeLogins.delete(loginId);
  const file = sessionPath(config, entry.platformId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await entry.context.storageState({ path: file });
  } finally {
    await entry.browser.close().catch(() => {});
  }
  return sessionStatus(config, entry.platformId, true);
}

export async function cancelLogin(loginId) {
  const entry = activeLogins.get(loginId);
  if (!entry) return false;
  activeLogins.delete(loginId);
  await entry.browser.close().catch(() => {});
  return true;
}
