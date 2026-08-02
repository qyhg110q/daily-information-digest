import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { migrateConfig, validateConfig } from "./config.js";

export class ConfigConflictError extends Error {
  constructor(currentRevision) {
    super("Configuration changed on disk. Reload before saving.");
    this.name = "ConfigConflictError";
    this.currentRevision = currentRevision;
  }
}

export class ConfigStore {
  constructor(configPath) {
    this.configPath = path.resolve(configPath);
  }

  async read() {
    const text = await fs.readFile(this.configPath, "utf8");
    const config = migrateConfig(JSON.parse(text.replace(/^\uFEFF/, "")));
    validateConfig(config);
    const stat = await fs.stat(this.configPath);
    return { config, revision: revisionOf(text), mtime: stat.mtime.toISOString() };
  }

  async write(config, expectedRevision) {
    const current = await this.read();
    if (expectedRevision && expectedRevision !== current.revision) {
      throw new ConfigConflictError(current.revision);
    }
    const migrated = migrateConfig(config);
    validateConfig(migrated);
    const text = `${JSON.stringify(migrated, null, 2)}\n`;
    const directory = path.dirname(this.configPath);
    const temporary = path.join(directory, `.${path.basename(this.configPath)}.${process.pid}.${Date.now()}.tmp`);
    const backup = `${this.configPath}.bak`;
    await fs.mkdir(directory, { recursive: true });
    await fs.copyFile(this.configPath, backup);
    try {
      await fs.writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
      await fs.rename(temporary, this.configPath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    return this.read();
  }
}

export function revisionOf(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}
