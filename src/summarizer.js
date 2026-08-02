export async function summarizeWithLocalModel(items, config) {
  if (config.summarization.provider === "none" || items.length === 0) return "";
  if (config.summarization.provider !== "ollama") {
    throw new Error(`Unsupported summarization provider: ${config.summarization.provider}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.summarization.timeoutMs);
  const content = items.map((item, index) =>
    `${index + 1}. [${item.author} / ${item.platform}] ${item.text}\n原文：${item.url}`
  ).join("\n\n");

  try {
    const response = await fetch(`${config.summarization.endpoint.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.summarization.model,
        stream: false,
        messages: [
          {
            role: "system",
            content: "你负责整理每日信息。严格依据输入，用中文输出：共同主题、关键观点、作者分歧、最值得读的三条。区分作者观点与自己的归纳，不补充输入中不存在的事实。"
          },
          { role: "user", content }
        ]
      })
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const payload = await response.json();
    return payload.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timer);
  }
}
