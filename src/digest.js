import fs from "node:fs/promises";
import path from "node:path";
import { openBrowserContext } from "./browser.js";
import { sendDigestEmail, sendFatalEmail } from "./email.js";
import { collectX } from "./collectors/x.js";
import { collectWeibo } from "./collectors/weibo.js";
import { collectWeChat } from "./collectors/wechat.js";
import { collectXiaoyuzhou } from "./collectors/xiaoyuzhou.js";
import { collectVideoResults } from "./collectors/video.js";
import { writeReport } from "./report.js";
import { StateStore } from "./state-store.js";
import { summarizeWithLocalModel } from "./summarizer.js";
import { localDate, localDateTime } from "./time.js";
import { sessionStatus } from "./sessions/manager.js";

export async function runDigest(config, options = {}) {
  const now = options.now ?? new Date();
  const reportDate = options.reportDate ?? localDate(now, config.timezone);
  const configuredSources = config.sources.filter((source) => source.enabled !== false);
  const state = new StateStore(config.statePath);

  const browserContexts = new Map();
  let emailAttempted = false;
  const collected = [];
  const errors = [];
  const invalidPlatforms = new Set();

  try {
    await state.load();
    for (const platform of ["x", "weibo"].filter((id) => configuredSources.some((source) => source.platform === id))) {
      const status = await sessionStatus(config, platform, true);
      if (status.status !== "valid") {
        invalidPlatforms.add(platform);
        for (const source of configuredSources.filter((candidate) => candidate.platform === platform)) {
          errors.push({ sourceId: source.id, message: `${platform} 登录检测失败：${status.message}` });
        }
      }
    }
    const sources = configuredSources.filter((source) => !invalidPlatforms.has(source.platform));
    for (const source of sources) {
      try {
        let items;
        if (source.platform === "x") {
          const context = await contextFor(source.platform);
          const page = await context.newPage();
          try {
            items = await collectX(page, source, config, { reportDate });
          } finally {
            await page.close();
          }
        } else if (source.platform === "weibo") {
          const context = await contextFor(source.platform);
          const page = await context.newPage();
          try {
            items = await collectWeibo(page, source, config, { reportDate });
          } finally {
            await page.close();
          }
        } else if (source.platform === "wechat") {
          items = await collectWeChat(source);
        } else if (source.platform === "xiaoyuzhou") {
          items = await collectXiaoyuzhou(source, config, { reportDate });
        } else {
          items = await collectVideoResults(source, config, { reportDate });
        }
        collected.push(...items);
      } catch (error) {
        errors.push({ sourceId: source.id, message: error.message });
      }
    }
    const unique = dedupe(collected);
    const reportItems = selectReportItems(unique, reportDate, config.timezone);

    for (const item of unique) state.mark(item);
    await state.save();

    let aiSummary = "";
    if (config.summarization.provider !== "none") {
      try {
        aiSummary = await summarizeWithLocalModel(reportItems, config);
      } catch (error) {
        errors.push({ sourceId: "local_summarizer", message: error.message });
      }
    }

    const reportPath = await writeReport({
      config,
      reportDate,
      items: reportItems,
      errors,
      aiSummary,
      isBackfill: options.isBackfill ?? false,
      isPreviousDay: options.isPreviousDay ?? false
    });
    const result = { reportPath, reportDate, fetched: unique.length, reportItems, errors };
    emailAttempted = true;
    try {
      result.email = await sendDigestEmail(config, result);
    } catch (error) {
      result.errors.push({ sourceId: "email_delivery", message: error.message });
      await writeRunLog(config, result);
      throw error;
    }
    await writeRunLog(config, result);
    return result;
  } catch (error) {
    if (!emailAttempted) {
      try {
        await sendFatalEmail(config, error);
      } catch (emailError) {
        error.message = `${error.message}; failure email also failed: ${emailError.message}`;
      }
    }
    throw error;
  } finally {
    await Promise.all([...browserContexts.values()].map(({ browser }) => browser.close().catch(() => {})));
  }

  async function contextFor(platform) {
    if (!browserContexts.has(platform)) browserContexts.set(platform, await openBrowserContext(config, { platform }));
    return browserContexts.get(platform).context;
  }
}

function dedupe(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export function selectReportItems(items, reportDate, timezone) {
  return items.filter((item) => {
    if (!item.publishedAt) return false;
    return localDate(item.publishedAt, timezone) === reportDate;
  });
}

async function writeRunLog(config, result) {
  await fs.mkdir(config.logDir, { recursive: true });
  const loggedAt = new Date();
  const stamp = localDateTime(loggedAt, config.timezone).replace(" ", "_").replaceAll(":", "-");
  const logPath = path.join(config.logDir, `run_${stamp}.log`);
  const lines = [
    `[${localDateTime(loggedAt, config.timezone)} 北京时间] 日报完成：抓取 ${result.fetched} 条，日报内容 ${result.reportItems.length} 条，错误 ${result.errors.length} 个`,
    `report=${result.reportPath}`,
    `email=${result.email?.sent ? `sent messageId=${result.email.messageId}` : result.email?.skipped ? "skipped" : "failed"}`,
    ...result.errors.map((error) => `[${error.sourceId}] ${error.message}`),
    ""
  ];
  await fs.writeFile(logPath, lines.join("\n"), "utf8");
}
