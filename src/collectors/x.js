export async function collectX(page, source, config) {
  await page.goto(source.url, {
    waitUntil: "domcontentloaded",
    timeout: config.browser.navigationTimeoutMs
  });
  await page.waitForTimeout(config.browser.settleMs);

  for (let index = 0; index < config.browser.scrollRounds; index += 1) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(1000);
  }

  const records = await page.locator("article").evaluateAll((articles) =>
    articles.map((article) => {
      const semanticUrl = article.querySelector('meta[itemprop="url"]')?.getAttribute("content") ?? "";
      const semanticDate = article.querySelector('meta[itemprop="datePublished"]')?.getAttribute("content") ?? "";
      const semanticText = article.querySelector('meta[itemprop="articleBody"]')?.getAttribute("content") ??
        article.querySelector('meta[itemprop="text"]')?.getAttribute("content") ?? "";
      const statusLinks = [...article.querySelectorAll('a[href*="/status/"]')];
      const ownStatusLink = statusLinks.find((link) => {
        try {
          const pathname = new URL(link.href).pathname.toLowerCase();
          return pathname.includes(`/${location.pathname.split("/")[1].toLowerCase()}/status/`);
        } catch {
          return false;
        }
      }) ?? statusLinks[0];
      const textElement = article.querySelector('[data-testid="tweetText"]');
      const timeElement = ownStatusLink?.querySelector("time") ?? article.querySelector("time");
      const userName = article.querySelector('[data-testid="User-Name"]');

      return {
        url: semanticUrl || ownStatusLink?.href || "",
        publishedAt: semanticDate || timeElement?.getAttribute("datetime") || "",
        text: semanticText || textElement?.innerText?.trim() || "",
        authorText: userName?.innerText?.trim() ?? "",
        cardText: article.innerText ?? "",
        isReply: /Replying to|正在回复|回复\s*@/i.test(article.innerText ?? ""),
        isRepost: Boolean(article.querySelector('[data-testid="socialContext"]'))
      };
    })
  );

  return normalizeXRecords(records, source).slice(0, config.browser.maxItemsPerSource);
}

export function normalizeXRecords(records, source) {
  const handle = new URL(source.url).pathname.split("/").filter(Boolean)[0] ?? "";
  const items = [];
  const seen = new Set();

  for (const record of records) {
    const match = record.url.match(/\/status\/(\d+)/);
    if (!match || seen.has(match[1])) continue;
    if (!source.includeReplies && record.isReply) continue;
    if (!source.includeReposts && record.isRepost) continue;

    seen.add(match[1]);
    items.push({
      id: `x:${match[1]}`,
      sourceId: source.id,
      platform: "x",
      author: source.displayName || record.authorText || `@${handle}`,
      text: cleanText(record.text || record.cardText),
      url: record.url,
      publishedAt: normalizeIso(record.publishedAt),
      collectedAt: new Date().toISOString()
    });
  }

  return items;
}

function normalizeIso(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function cleanText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}
