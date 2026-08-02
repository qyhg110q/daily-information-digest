import fs from "node:fs/promises";

export async function collectVideoResults(source, config, options = {}) {
  const state = await loadState(config.video.statePath);
  const sourceRun = state.sourceRuns?.[source.id];
  if (!sourceRun || sourceRun.reportDate !== options.reportDate) {
    throw new Error(`视频预处理尚未完成目标日期 ${options.reportDate}，请检查 DailyVideoIngest 任务`);
  }
  if (sourceRun.status === "failed") {
    throw new Error(`视频发现失败：${sourceRun.error || "未知错误"}`);
  }

  return Object.values(state.jobs ?? {})
    .filter((job) => job.sourceId === source.id && job.reportDate === options.reportDate)
    .map((job) => ({
      id: `${job.platform}:${job.id}`,
      sourceId: source.id,
      platform: job.platform,
      author: job.author || source.displayName,
      title: job.title,
      text: videoText(job),
      url: job.url,
      publishedAt: job.publishedAt,
      collectedAt: job.updatedAt,
      transcriptPath: job.status === "completed" ? job.transcriptPath : "",
      transcriptStatus: job.status,
      durationSeconds: job.durationSeconds
    }));
}

function videoText(job) {
  if (job.status === "completed") {
    const device = job.transcriptionDevice ? `，设备：${job.transcriptionDevice}` : "";
    return `文字稿已提取，共 ${job.transcriptChars} 字，来源：${job.transcriptionSource}${device}。`;
  }
  if (job.status === "failed") return `文字提取失败：${job.error}`;
  return "文字提取处理中，将在后续任务中重试。";
}

async function loadState(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { jobs: {}, sourceRuns: {} };
    throw error;
  }
}
