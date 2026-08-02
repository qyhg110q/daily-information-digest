import crypto from "node:crypto";
import { EventEmitter } from "node:events";

export class JobManager {
  constructor({ maxHistory = 100 } = {}) {
    this.jobs = new Map();
    this.events = new EventEmitter();
    this.maxHistory = maxHistory;
    this.pipelineRunning = false;
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id) { return this.jobs.get(id); }

  start(type, work, options = {}) {
    if (options.exclusive && this.pipelineRunning) throw new Error("A digest pipeline is already running");
    const job = { id: crypto.randomUUID(), type, status: "queued", progress: 0, message: "等待执行", createdAt: new Date().toISOString(), startedAt: "", finishedAt: "", result: null, error: "" };
    this.jobs.set(job.id, job);
    if (options.exclusive) this.pipelineRunning = true;
    this.emit(job);
    queueMicrotask(async () => {
      Object.assign(job, { status: "running", startedAt: new Date().toISOString(), message: "正在执行" });
      this.emit(job);
      const update = (progress, message, detail) => {
        Object.assign(job, { progress: Math.max(0, Math.min(100, Number(progress))), message, detail });
        this.emit(job);
      };
      try {
        job.result = await work(update);
        Object.assign(job, { status: "completed", progress: 100, message: "完成" });
      } catch (error) {
        Object.assign(job, { status: "failed", error: error.stack ?? error.message, message: error.message });
      } finally {
        job.finishedAt = new Date().toISOString();
        if (options.exclusive) this.pipelineRunning = false;
        this.emit(job);
        this.trim();
      }
    });
    return job;
  }

  subscribe(listener) {
    this.events.on("job", listener);
    return () => this.events.off("job", listener);
  }

  emit(job) { this.events.emit("job", structuredClone(job)); }
  trim() {
    const removable = this.list().slice(this.maxHistory).filter((job) => ["completed", "failed"].includes(job.status));
    for (const job of removable) this.jobs.delete(job.id);
  }
}
