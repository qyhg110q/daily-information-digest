import fs from "node:fs/promises";
import path from "node:path";
import { localDateTime, localTime } from "./time.js";

const PLATFORM_NAMES = { x: "X", weibo: "微博", wechat: "微信公众号", xiaoyuzhou: "小宇宙" };

export async function writeReport({ config, reportDate, items, errors, aiSummary, isBackfill = false, isPreviousDay = false }) {
  await fs.mkdir(config.outputDir, { recursive: true });
  const reportPath = path.join(config.outputDir, `${reportDate}.md`);
  const grouped = groupBy(items, (item) => item.sourceId);
  const lines = [
    `# ${reportDate} 关注对象信息日报${isBackfill ? "（回溯）" : ""}`,
    "",
    isBackfill
      ? `目标日期共找到 ${items.length} 条已采集内容，涉及 ${grouped.size} 位关注对象。`
      : isPreviousDay
        ? `前一天共找到 ${items.length} 条内容，涉及 ${grouped.size} 位关注对象。`
      : `本次发现 ${items.length} 条当天新增内容，涉及 ${grouped.size} 位关注对象。`,
    ""
  ];

  if (aiSummary) {
    lines.push("## 本地模型归纳", "", aiSummary, "");
  }

  lines.push("## 按人查看", "");
  if (items.length === 0) lines.push("今天暂未发现新增内容。", "");

  for (const [sourceId, sourceItems] of grouped) {
    const source = config.sources.find((candidate) => candidate.id === sourceId);
    const detectedAuthor = sourceItems[0].author;
    const displayName = source?.platform === "weibo" && /^微博用户 \d+$/.test(source.displayName)
      ? detectedAuthor
      : source?.displayName ?? detectedAuthor;
    lines.push(`### ${displayName}`, "");
    for (const item of sourceItems.sort(compareTime)) {
      const label = `${localTime(item.publishedAt, config.timezone)} · ${PLATFORM_NAMES[item.platform] ?? item.platform}`;
      lines.push(`- [${escapeInline(label)}](${item.url || source?.url || "#"})`);
      if (item.title) lines.push(`  - ${escapeInline(item.title)}`);
      lines.push(`  - ${escapeInline(truncate(item.text || "无可提取文字，请查看原文。", 1200))}`, "");
    }
  }

  lines.push("## 采集状态", "");
  for (const source of config.sources.filter((candidate) => candidate.enabled !== false)) {
    const failure = errors.find((error) => error.sourceId === source.id);
    const count = grouped.get(source.id)?.length ?? 0;
    lines.push(failure
      ? `- ${source.displayName}：失败，${escapeInline(failure.message)}`
      : `- ${source.displayName}：成功，${isBackfill ? "目标日期" : isPreviousDay ? "前一天" : "当天新增"} ${count} 条`);
  }
  lines.push("", `生成时间：${localDateTime(new Date(), config.timezone)}（北京时间）`, "");

  await fs.writeFile(reportPath, lines.join("\n"), "utf8");
  return reportPath;
}

function groupBy(items, keySelector) {
  const result = new Map();
  for (const item of items) {
    const key = keySelector(item);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(item);
  }
  return result;
}

function compareTime(left, right) {
  return (Date.parse(left.publishedAt) || 0) - (Date.parse(right.publishedAt) || 0);
}

function truncate(text, maxLength) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

function escapeInline(text) {
  return String(text).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}
