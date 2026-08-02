import fs from "node:fs/promises";
import path from "node:path";

export class VideoState {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: 1, jobs: {}, sourceRuns: {} };
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.data = JSON.parse(raw);
      this.data.jobs ??= {};
      this.data.sourceRuns ??= {};
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
  }
}
