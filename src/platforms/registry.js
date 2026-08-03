const platforms = [
  descriptor("x", "X / Twitter", { login: true, persistentLogin: true, browser: true }, [field("url", "主页 URL", "url", true), field("includeReplies", "包含回复", "boolean"), field("includeReposts", "包含转发", "boolean")]),
  descriptor("weibo", "微博", { login: true, persistentLogin: true, browser: true }, [field("url", "主页 URL", "url", true), field("includeReposts", "包含转发", "boolean")]),
  descriptor("wechat", "微信公众号", { service: "WeWe RSS" }, [field("feedUrl", "Feed URL", "url", true), field("accountName", "公众号名称", "text")]),
  descriptor("youtube", "YouTube", { video: true, subtitles: true }, [field("url", "频道主页", "url", true), field("channelId", "Channel ID", "text", true), field("feedUrl", "RSS URL", "url", true), field("language", "语言", "text")]),
  descriptor("bilibili", "哔哩哔哩", { loginOptional: true, browser: true, video: true, subtitles: true }, [field("url", "空间主页", "url", true), field("uid", "UID", "text", true), field("language", "语言", "text")]),
  descriptor("xiaoyuzhou", "小宇宙", { showNotes: true }, [field("url", "播客主页", "url", true), field("pid", "Podcast ID", "text", true)])
];

export function listPlatforms() {
  return structuredClone(platforms);
}

export function getPlatform(id) {
  return platforms.find((platform) => platform.id === id);
}

export function normalizeSource(input) {
  const source = { ...input, id: String(input.id ?? "").trim().toLowerCase(), displayName: String(input.displayName ?? "").trim(), enabled: input.enabled !== false };
  if (source.url) source.url = normalizeUrl(source.url, source.platform);
  if (source.platform === "bilibili" && !source.uid) source.uid = source.url?.match(/space\.bilibili\.com\/(\d+)/)?.[1];
  if (source.platform === "youtube" && !source.feedUrl && source.channelId) source.feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${source.channelId}`;
  if (source.platform === "xiaoyuzhou" && !source.pid) source.pid = source.url?.match(/podcast\/([a-f0-9]{24})/i)?.[1];
  return source;
}

export async function detectSource(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  let source;
  if (host === "x.com" || host === "twitter.com") {
    const handle = url.pathname.split("/").filter(Boolean)[0];
    source = { platform: "x", displayName: handle, id: safeId(`x_${handle}`), url: `https://x.com/${handle}`, includeReplies: false, includeReposts: false };
  } else if (host.endsWith("weibo.com")) {
    const uid = url.pathname.match(/\/(?:u\/)?(\d+)/)?.[1];
    source = { platform: "weibo", displayName: uid ? `微博 ${uid}` : "微博用户", id: safeId(`weibo_${uid ?? "creator"}`), url: uid ? `https://weibo.com/u/${uid}` : url.toString(), includeReposts: false };
  } else if (host === "space.bilibili.com") {
    const uid = url.pathname.match(/\/(\d+)/)?.[1];
    source = { platform: "bilibili", displayName: uid ? `Bilibili ${uid}` : "Bilibili UP 主", id: safeId(`bilibili_${uid ?? "creator"}`), url: `https://space.bilibili.com/${uid}/video`, uid, language: "zh", subtitleLanguages: ["zh-Hans", "zh-CN", "zh"] };
  } else if (host.endsWith("youtube.com")) {
    const html = await fetchPage(url.toString());
    const channelId = html.match(/"channelId":"(UC[\w-]+)"/)?.[1] ?? html.match(/<meta itemprop="channelId" content="([^"]+)"/)?.[1];
    const name = decodeHtml(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? url.pathname.split("/").filter(Boolean).at(-1) ?? "YouTube 频道");
    source = { platform: "youtube", displayName: name, id: safeId(`youtube_${name}`), url: url.toString().replace(/\/$/, ""), channelId, feedUrl: channelId ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}` : "", language: "auto" };
  } else if (host.endsWith("xiaoyuzhoufm.com")) {
    const pid = url.pathname.match(/podcast\/([a-f0-9]{24})/i)?.[1];
    source = { platform: "xiaoyuzhou", displayName: "小宇宙播客", id: safeId(`xiaoyuzhou_${pid?.slice(-8) ?? "podcast"}`), url: url.toString().replace(/\/$/, ""), pid, contentMode: "shownotes", transcribeFallback: false };
  } else throw new Error("无法识别该主页 URL 的平台");
  return normalizeSource({ ...source, enabled: true });
}

function normalizeUrl(value, platform) {
  const url = new URL(value);
  url.hash = "";
  if (platform === "bilibili") url.pathname = url.pathname.replace(/\/(video)?\/?$/, "");
  return url.toString().replace(/\/$/, "");
}
async function fetchPage(url) { const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 DailyInformationDigest/0.2" }, signal: AbortSignal.timeout(20000) }); if (!response.ok) throw new Error(`主页识别失败：HTTP ${response.status}`); return response.text(); }
function safeId(value) { return String(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || `source_${Date.now()}`; }
function decodeHtml(value) { return String(value).replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'"); }

function descriptor(id, displayName, capabilities, fields) {
  return { id, displayName, capabilities: { login: false, loginOptional: false, persistentLogin: false, browser: false, video: false, subtitles: false, showNotes: false, ...capabilities }, fields };
}

function field(name, label, type, required = false) {
  return { name, label, type, required };
}
