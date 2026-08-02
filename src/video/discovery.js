import { XMLParser } from "fast-xml-parser";
import { localDate } from "../time.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  trimValues: true
});

export async function discoverYouTube(source, config, options = {}) {
  const response = await (options.fetchImpl ?? fetch)(source.feedUrl, {
    headers: { Accept: "application/atom+xml, application/xml;q=0.9" }
  });
  if (!response.ok) throw new Error(`YouTube RSS 请求失败：HTTP ${response.status}`);
  const videos = normalizeYouTubeFeed(await response.text(), source);
  return selectVideos(videos, source, config, options);
}

export function normalizeYouTubeFeed(xml, source) {
  const parsed = xmlParser.parse(xml);
  const entries = asArray(parsed.feed?.entry);
  return entries.map((entry) => {
    const group = entry.group ?? {};
    const content = asArray(group.content)[0] ?? {};
    const videoId = textValue(entry.videoId) || textValue(entry.id).replace(/^yt:video:/, "");
    return {
      id: videoId,
      sourceId: source.id,
      platform: "youtube",
      author: source.displayName,
      title: textValue(entry.title) || textValue(group.title) || "无标题",
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : linkHref(entry.link),
      publishedAt: normalizeIso(textValue(entry.published)),
      durationSeconds: Number(content["@duration"] ?? 0),
      description: textValue(group.description)
    };
  }).filter((video) => video.id && video.publishedAt);
}

export async function discoverBilibili(page, source, config, options = {}) {
  const keyword = source.searchKeyword ?? source.displayName;
  const searchUrl = `https://search.bilibili.com/video?keyword=${encodeURIComponent(keyword)}&order=pubdate`;
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: config.browser.navigationTimeoutMs });
  await page.locator(".bili-video-card").first().waitFor({ timeout: config.browser.navigationTimeoutMs });
  const bvids = await page.locator(".bili-video-card").evaluateAll((cards, limit) => [...new Set(cards
    .map((card) => card.querySelector('a[href*="/video/BV"]')?.href.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] ?? "")
    .filter(Boolean))].slice(0, limit), config.video.maxDiscoveryItems);

  const videos = [];
  for (const bvid of bvids) {
    const response = await (options.fetchImpl ?? fetch)(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: `https://www.bilibili.com/video/${bvid}/` }
    });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0 || String(payload.data?.owner?.mid) !== String(source.uid)) continue;
    videos.push(normalizeBilibiliVideo(payload.data, source));
    if (options.latest && videos.length >= config.video.maxVideosPerSource) break;
  }
  return selectVideos(videos, source, config, options);
}

export function normalizeBilibiliVideo(data, source) {
  return {
    id: data.bvid,
    sourceId: source.id,
    platform: "bilibili",
    author: data.owner?.name || source.displayName,
    title: data.title || "无标题",
    url: `https://www.bilibili.com/video/${data.bvid}/`,
    publishedAt: normalizeIso(Number(data.pubdate) * 1000),
    durationSeconds: Number(data.duration ?? 0),
    description: String(data.desc ?? ""),
    cid: String(data.cid ?? "")
  };
}

function selectVideos(videos, source, config, options) {
  const minDuration = Number(source.minDurationSeconds ?? 0);
  const maxDuration = Number(source.maxDurationMinutes ?? config.video.maxDurationMinutes) * 60;
  const filtered = videos
    .filter((video) => !video.durationSeconds || (video.durationSeconds >= minDuration && video.durationSeconds <= maxDuration))
    .filter((video) => options.latest || localDate(video.publishedAt, config.timezone) === options.reportDate)
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  return filtered.slice(0, options.latest ? 1 : config.video.maxVideosPerSource);
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return String(value["#text"] ?? "").trim();
}

function linkHref(value) {
  return asArray(value).find((link) => link?.["@rel"] === "alternate")?.["@href"] ?? "";
}

function normalizeIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
