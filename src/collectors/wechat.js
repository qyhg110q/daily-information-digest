export async function collectWeChat(source) {
  const url = new URL(source.feedUrl);
  if (source.forceUpdate) url.searchParams.set("update", "true");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), source.timeoutMs ?? 30000);

  try {
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return normalizeWeChatPayload(payload, source);
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`公众号 feed 请求超时：${url.origin}`);
      }
      throw new Error(`公众号 feed 不可用：${url.origin}，请确认 WeWe RSS 已启动（${error.message}）`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeWeChatPayload(payload, source) {
  const records = extractItems(payload);
  const items = [];
  const seen = new Set();

  for (const record of records) {
    const author = firstString(
      record.author?.name,
      record.authors?.[0]?.name,
      record.feed?.title,
      record.account,
      record.mpName,
      record.author,
      record.publisher
    );
    if (source.accountName && author && author !== source.accountName) continue;

    const articleUrl = firstString(record.url, record.link, record.external_url, record.articleUrl, record.mpUrl);
    const title = firstString(record.title, record.name);
    const publishedAt = normalizeTime(
      record.date_published ?? record.pubDate ?? record.published ?? record.createTime ?? record.publishTime
    );
    const id = firstString(record.id, record.guid, record.uid, record.articleId, articleUrl, `${title}|${publishedAt}`);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    items.push({
      id: `wechat:${id}`,
      sourceId: source.id,
      platform: "wechat",
      author: author || source.displayName,
      title: title || "无标题",
      text: cleanText(firstString(record.summary, record.description, record.content_text, stripHtml(record.content_html))),
      url: articleUrl,
      publishedAt,
      collectedAt: new Date().toISOString()
    });
  }

  return items;
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  return payload.items ?? payload.data?.items ?? payload.data ?? payload.entries ?? payload.item ?? [];
}

function normalizeTime(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function stripHtml(value) {
  return typeof value === "string" ? value.replace(/<[^>]+>/g, " ") : "";
}

function cleanText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}
