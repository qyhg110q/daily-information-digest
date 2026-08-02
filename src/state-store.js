import fs from "node:fs/promises";
import path from "node:path";

export class StateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = { seen: {}, lastRunAt: "" };
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw);
      this.state.seen ??= {};
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  has(id) {
    return Boolean(this.state.seen[id]);
  }

  mark(item) {
    this.state.seen[item.id] = {
      sourceId: item.sourceId,
      author: item.author,
      url: item.url,
      publishedAt: item.publishedAt,
      firstSeenAt: this.state.seen[item.id]?.firstSeenAt ?? new Date().toISOString()
    };
  }

  async save() {
    this.state.lastRunAt = new Date().toISOString();
    const entries = Object.entries(this.state.seen);
    if (entries.length > 10000) {
      entries.sort((left, right) => String(right[1].firstSeenAt).localeCompare(String(left[1].firstSeenAt)));
      this.state.seen = Object.fromEntries(entries.slice(0, 10000));
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }
}
