import { parseWeiboDate } from "../time.js";
import {
  assertOwnedWeiboRecords,
  filterWeiboRecordsBySource,
  isWeiboLoginPage,
  WEIBO_LOGIN_EXPIRED_MESSAGE
} from "./weibo-safety.js";

export async function collectWeibo(page, source, config) {
  await page.goto(source.url, {
    waitUntil: "domcontentloaded",
    timeout: config.browser.navigationTimeoutMs
  });
  await page.waitForTimeout(config.browser.settleMs);

  const pageTitle = await page.title();
  if (isWeiboLoginPage(page.url(), pageTitle)) {
    throw new Error(WEIBO_LOGIN_EXPIRED_MESSAGE);
  }

  for (let index = 0; index < config.browser.scrollRounds; index += 1) {
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(1200);
  }

  const records = await page.locator('article, [action-type="feed_list_item"], [class*="Feed_wrap"], .card-wrap')
    .evaluateAll((cards) => cards.map((card) => {
      const links = [...card.querySelectorAll("a[href]")];
      const statusLink = links.find((link) => {
        try {
          const url = new URL(link.href);
          return /\/status\/[A-Za-z0-9]+/.test(url.pathname) ||
            /^\/\d+\/[A-Za-z0-9]+$/.test(url.pathname) ||
            /^\/u\/\d+\/[A-Za-z0-9]+$/.test(url.pathname);
        } catch {
          return false;
        }
      });
      const timeLink = links.find((link) => link.querySelector("time") || link.getAttribute("title")?.match(/20\d{2}/)) ?? statusLink;
      const textElement = card.querySelector(
        '[node-type="feed_list_content"], [class*="detail_wbtext"], [class*="Feed_body"], .weibo-text, .m-text-cut'
      );
      const nameElement = card.querySelector('[class*="name"], [class*="head-info"] a, .m-text-box h3');
      const rawText = textElement?.innerText?.trim() ?? "";

      return {
        url: statusLink?.href ?? "",
        publishedRaw: timeLink?.querySelector("time")?.getAttribute("datetime") ??
          timeLink?.getAttribute("title") ?? timeLink?.innerText?.trim() ?? "",
        text: rawText,
        authorText: nameElement?.innerText?.trim() ?? "",
        cardText: card.innerText ?? "",
        isRepost: /^(转发微博|轉發微博)|\/\/@/.test(rawText)
      };
    }));

  const ownedRecords = filterWeiboRecordsBySource(records, source);
  assertOwnedWeiboRecords(records, ownedRecords);
  const items = normalizeWeiboRecords(ownedRecords, source).slice(0, config.browser.maxItemsPerSource);
  if (items.length === 0) {
    const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 2000);
    if (/登录|注册|visitor/i.test(bodyText)) {
      throw new Error("微博页面未返回内容，登录态可能已失效，请运行 npm run login");
    }
    throw new Error("微博页面未找到可解析的博文，页面结构可能已变化");
  }
  return items;
}

export function normalizeWeiboRecords(records, source, now = new Date()) {
  const items = [];
  const seen = new Set();
  const ownedRecords = source.url ? filterWeiboRecordsBySource(records, source) : records;

  for (const record of ownedRecords) {
    const statusId = extractStatusId(record.url);
    if (!statusId || seen.has(statusId)) continue;
    if (!source.includeReposts && record.isRepost) continue;

    seen.add(statusId);
    items.push({
      id: `weibo:${statusId}`,
      sourceId: source.id,
      platform: "weibo",
      author: record.authorText || source.displayName,
      text: cleanText(record.text || record.cardText),
      url: record.url,
      publishedAt: parseWeiboDate(record.publishedRaw, now),
      collectedAt: new Date().toISOString()
    });
  }

  return items;
}

function extractStatusId(url) {
  if (!url) return "";
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const statusIndex = parts.indexOf("status");
    return statusIndex >= 0 ? parts[statusIndex + 1] ?? "" : parts.at(-1) ?? "";
  } catch {
    return "";
  }
}

function cleanText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}
