import { loadConfig, validateConfig } from "../config.js";
import { ConfigStore } from "../config-store.js";
import { runDigest } from "../digest.js";
import { saveSmtpPassword, sendTestEmail } from "../email.js";
import { JobManager } from "../jobs.js";
import { detectSource, listPlatforms, normalizeSource } from "../platforms/registry.js";
import { completeLogin, listSessionStatuses, sessionStatus, startLogin } from "../sessions/manager.js";
import { previousLocalDate } from "../time.js";
import { runVideoIngest } from "../video/ingest.js";
import { hardwareDoctor, installModel, listModels, removeModel, selectModel } from "../models/service.js";
import { getSchedule, installSchedule, removeSchedule } from "../scheduler/windows.js";
import { listRunArtifacts, readArtifact } from "../runs.js";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";

export class CoreService {
  constructor(configPath) {
    this.configPath = path.resolve(configPath);
    this.configStore = new ConfigStore(this.configPath);
    this.jobs = new JobManager();
    this.configEvents = new EventEmitter();
    this.watcher = fs.watch(path.dirname(this.configPath), { persistent: false }, (_event, filename) => {
      if (!filename || String(filename) === path.basename(this.configPath)) this.notifyConfigChange();
    });
  }

  config() { return this.configStore.read(); }
  saveConfig(config, revision) { return this.configStore.write(config, revision); }
  subscribeConfig(listener) { this.configEvents.on("change", listener); return () => this.configEvents.off("change", listener); }
  close() { this.watcher?.close(); }
  async notifyConfigChange() { clearTimeout(this.watchTimer); this.watchTimer = setTimeout(async () => { const snapshot = await this.config().catch(() => null); if (snapshot) this.configEvents.emit("change", snapshot.revision); }, 80); }

  async platforms({ probe = false } = {}) {
    const config = await loadConfig(this.configPath);
    const statuses = await Promise.all(listPlatforms().map((item) => sessionStatus(config, item.id, probe)));
    return listPlatforms().map((item) => ({ ...item, session: statuses.find((status) => status.platform === item.id) }));
  }

  async addSource(source, revision) {
    const snapshot = await this.config();
    snapshot.config.sources.push(normalizeSource(source));
    validateConfig(snapshot.config);
    return this.saveConfig(snapshot.config, revision ?? snapshot.revision);
  }
  detectSource(url) { return detectSource(url); }

  async updateSource(id, source, revision) {
    const snapshot = await this.config();
    const index = snapshot.config.sources.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error(`Source not found: ${id}`);
    snapshot.config.sources[index] = normalizeSource({ ...snapshot.config.sources[index], ...source, id: source.id ?? id });
    validateConfig(snapshot.config);
    return this.saveConfig(snapshot.config, revision ?? snapshot.revision);
  }

  async deleteSource(id, revision) {
    const snapshot = await this.config();
    const next = snapshot.config.sources.filter((entry) => entry.id !== id);
    if (next.length === snapshot.config.sources.length) throw new Error(`Source not found: ${id}`);
    snapshot.config.sources = next;
    return this.saveConfig(snapshot.config, revision ?? snapshot.revision);
  }

  async beginLogin(platform) { return startLogin(await loadConfig(this.configPath), platform); }
  async finishLogin(loginId) { return completeLogin(await loadConfig(this.configPath), loginId); }
  async checkSession(platform) { return sessionStatus(await loadConfig(this.configPath), platform, true); }
  async sessions() { return listSessionStatuses(await loadConfig(this.configPath)); }
  async testEmail() { return sendTestEmail(await loadConfig(this.configPath)); }
  async saveEmailSecret(password) { return saveSmtpPassword(await loadConfig(this.configPath), password); }
  models() { return listModels(this.configPath); }
  hardware() { return hardwareDoctor(this.configPath); }
  installModel(id) { return this.jobs.start("model-install", (update) => installModel(this.configPath, id, update)); }
  selectModel(id, revision) { return selectModel(this.configPath, id, revision); }
  removeModel(id) { return removeModel(this.configPath, id); }
  async schedule() { return getSchedule(await loadConfig(this.configPath)); }
  async installSchedule(at) { return installSchedule(await loadConfig(this.configPath), at); }
  async removeSchedule() { return removeSchedule(await loadConfig(this.configPath)); }
  async runArtifacts() { return listRunArtifacts(await loadConfig(this.configPath)); }
  async readArtifact(type, name) { return readArtifact(await loadConfig(this.configPath), type, name); }

  startPipeline({ reportDate, previousDay = false, force = false } = {}) {
    return this.jobs.start("pipeline", async (update) => {
      const config = await loadConfig(this.configPath);
      const date = previousDay ? previousLocalDate(new Date(), config.timezone) : reportDate;
      update(5, "处理视频与平台登录检测");
      const video = await runVideoIngest(config, { reportDate: date, force });
      update(70, "生成日报并发送邮件");
      const digest = await runDigest(config, { reportDate: date, isBackfill: Boolean(reportDate), isPreviousDay: previousDay });
      return { video, digest };
    }, { exclusive: true });
  }
}
