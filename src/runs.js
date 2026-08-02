import fs from "node:fs/promises";
import path from "node:path";

export async function listRunArtifacts(config, limit = 30) {
  const logs = await listFiles(config.logDir, ".log");
  const reports = await listFiles(config.outputDir, ".md");
  return {
    logs: logs.slice(0, limit),
    reports: reports.slice(0, limit)
  };
}

export async function readArtifact(config, type, name) {
  const root = type === "report" ? config.outputDir : config.logDir;
  const file = path.resolve(root, path.basename(name));
  if (path.dirname(file) !== path.resolve(root)) throw new Error("Invalid artifact path");
  return { name: path.basename(file), content: await fs.readFile(file, "utf8") };
}

async function listFiles(directory, extension) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(extension)).map(async (entry) => {
    const file = path.join(directory, entry.name);
    const stat = await fs.stat(file);
    return { name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
  }));
  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
