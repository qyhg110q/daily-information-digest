import fs from "node:fs/promises";
import path from "node:path";
import { localDate, localDateTime } from "../time.js";

const EPISODE_BASE_URL = "https://www.xiaoyuzhoufm.com/episode/";

export async function collectXiaoyuzhou(source, config, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const reportDate = options.reportDate ?? localDate(new Date(), config.timezone);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), source.timeoutMs ?? 30000);

  try {
    const response = await fetchImpl(source.url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());

    const podcast = parseXiaoyuzhouPage(await response.text());
    const episodes = normalizeXiaoyuzhouEpisodes(podcast, source);
    const targetEpisodes = episodes.filter(
      (episode) => localDate(episode.publishedAt, config.timezone) === reportDate
    );

    const notesDirectory = path.resolve(config.outputDir, "..", "podcast_notes", reportDate);
    const items = [];
    for (const episode of targetEpisodes) {
      let contentPath = "";
      if (episode.description) {
        await fs.mkdir(notesDirectory, { recursive: true });
        contentPath = path.join(notesDirectory, `${safeFilename(episode.title, episode.eid)}.md`);
        await fs.writeFile(contentPath, renderEpisodeNotes(episode, podcast, config.timezone), "utf8");
      }
      items.push({
        id: `xiaoyuzhou:${episode.eid}`,
        sourceId: source.id,
        platform: "xiaoyuzhou",
        author: episode.author,
        title: episode.title,
        text: episode.description
          ? `小宇宙已提供本期文字内容，共 ${episode.description.length} 字。`
          : "小宇宙未提供本期文字内容，请查看原单集。",
        url: episode.url,
        publishedAt: episode.publishedAt,
        collectedAt: new Date().toISOString(),
        contentPath,
        durationSeconds: episode.durationSeconds
      });
    }
    return items;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`小宇宙节目页请求超时（${source.timeoutMs ?? 30000}ms）`);
    }
    throw new Error(`小宇宙采集失败：${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export function parseXiaoyuzhouPage(html) {
  const match = String(html).match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error("节目页中未找到 __NEXT_DATA__");

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`节目页数据解析失败：${error.message}`);
  }

  const podcast = data?.props?.pageProps?.podcast;
  if (!podcast || !Array.isArray(podcast.episodes)) {
    throw new Error("节目页中未找到播客单集数据");
  }
  return podcast;
}

export function normalizeXiaoyuzhouEpisodes(podcast, source) {
  return podcast.episodes.flatMap((episode) => {
    const eid = String(episode.eid ?? episode.id ?? "").trim();
    const published = new Date(episode.pubDate ?? episode.publishedAt ?? "");
    if (!eid || Number.isNaN(published.getTime())) return [];

    return [{
      eid,
      title: cleanText(episode.title) || "未命名单集",
      description: cleanDescription(episode.description),
      author: cleanText(podcast.author) || source.displayName,
      url: `${EPISODE_BASE_URL}${eid}`,
      publishedAt: published.toISOString(),
      durationSeconds: Number(episode.duration) || 0
    }];
  });
}

function renderEpisodeNotes(episode, podcast, timezone) {
  return [
    `# ${episode.title}`,
    "",
    `- 节目：${cleanText(podcast.title) || "小宇宙播客"}`,
    `- 作者：${episode.author}`,
    `- 发布时间：${localDateTime(episode.publishedAt, timezone)}（北京时间）`,
    `- 时长：${formatDuration(episode.durationSeconds)}`,
    `- 原单集：${episode.url}`,
    "",
    "## 小宇宙文字内容",
    "",
    episode.description,
    ""
  ].join("\n");
}

function cleanDescription(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function safeFilename(title, fallback) {
  const name = String(title)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  return name || fallback;
}
