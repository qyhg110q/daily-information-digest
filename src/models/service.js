import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig } from "../config.js";
import { ConfigStore } from "../config-store.js";
import { MODEL_REGISTRY, getModel } from "./registry.js";

export async function listModels(configPath) {
  const config = await loadConfig(configPath);
  return Promise.all(MODEL_REGISTRY.map(async (model) => {
    const directory = modelDirectory(config, model);
    const validation = await verifyModel(directory, model);
    return { ...model, directory, installed: validation.valid, validation, selected: (config.video.modelId ?? "qwen3-asr-0.6b") === model.id };
  }));
}

export async function hardwareDoctor(configPath) {
  const config = await loadConfig(configPath);
  const disk = await fs.statfs(config.video.modelDir).catch(async () => {
    await fs.mkdir(config.video.modelDir, { recursive: true });
    return fs.statfs(config.video.modelDir);
  });
  const gpu = await capture("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"]).catch(() => "");
  const [name = "", memory = "", driver = ""] = gpu.trim().split(",").map((value) => value.trim());
  const python = await capture(config.video.pythonPath, ["-c", "import sys; print(sys.version.split()[0])"]).catch(() => "");
  return {
    platform: process.platform,
    gpu: name ? { available: true, name, vramMb: Number(memory), driver } : { available: false },
    python: { available: Boolean(python.trim()), version: python.trim(), path: config.video.pythonPath },
    modelDirectory: config.video.modelDir,
    disk: { freeBytes: Number(disk.bavail) * Number(disk.bsize), totalBytes: Number(disk.blocks) * Number(disk.bsize) },
    recommendedDevice: name ? "cuda" : "cpu"
  };
}

export async function installModel(configPath, id, update = () => {}) {
  const model = requireModel(id);
  const config = await loadConfig(configPath);
  const target = modelDirectory(config, model);
  const hardware = await hardwareDoctor(configPath);
  if (hardware.disk.freeBytes < model.estimatedBytes * 1.2) throw new Error(`模型目录空间不足，需要至少 ${formatBytes(model.estimatedBytes * 1.2)}`);
  await fs.mkdir(target, { recursive: true });
  update(5, `下载到 ${target}`);
  const executable = process.platform === "win32" ? path.join(path.dirname(config.video.pythonPath), "modelscope.exe") : path.join(path.dirname(config.video.pythonPath), "modelscope");
  await runStreaming(executable, ["download", model.source.repository, "--local-dir", target, "--max-workers", "4"], (line) => update(10, line.slice(-240)));
  update(90, "校验模型文件");
  const validation = await verifyModel(target, model);
  if (!validation.valid) throw new Error(`模型校验失败：缺少 ${validation.missing.join(", ")}`);
  await capture(config.video.pythonPath, ["-c", "from qwen_asr import Qwen3ASRModel; print('qwen-asr backend ok')"]);
  update(100, "模型安装完成");
  return { id, directory: target, validation };
}

export async function selectModel(configPath, id, expectedRevision) {
  const model = requireModel(id);
  const config = await loadConfig(configPath);
  const validation = await verifyModel(modelDirectory(config, model), model);
  if (!validation.valid) throw new Error("模型尚未完整安装");
  const store = new ConfigStore(configPath);
  const snapshot = await store.read();
  snapshot.config.video = { ...(snapshot.config.video ?? {}), modelId: id, qwenModelDir: path.join(snapshot.config.video?.modelDir ?? "./data/video_models", model.directory).replaceAll("\\", "/") };
  return store.write(snapshot.config, expectedRevision ?? snapshot.revision);
}

export async function removeModel(configPath, id) {
  const model = requireModel(id);
  const config = await loadConfig(configPath);
  if ((config.video.modelId ?? "qwen3-asr-0.6b") === id) throw new Error("当前选中的模型不能删除，请先选择其他模型");
  const target = modelDirectory(config, model);
  await fs.rm(target, { recursive: true, force: true });
  return { id, removed: true };
}

export async function verifyModel(directory, model) {
  const missing = [];
  for (const file of model.requiredFiles) {
    try { await fs.access(path.join(directory, file)); } catch { missing.push(file); }
  }
  return { valid: missing.length === 0, missing };
}

function modelDirectory(config, model) {
  if (model.id === (config.video.modelId ?? "qwen3-asr-0.6b") && config.video.qwenModelDir) return config.video.qwenModelDir;
  return path.join(config.video.modelDir, model.directory);
}
function requireModel(id) { const model = getModel(id); if (!model) throw new Error(`Unknown model: ${id}`); return model; }
function capture(command, args) { return new Promise((resolve, reject) => { const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); let out = "", err = ""; child.stdout.on("data", (c) => { out += c; }); child.stderr.on("data", (c) => { err += c; }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`))); }); }
function runStreaming(command, args, onLine) { return new Promise((resolve, reject) => { const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUTF8: "1" } }); let tail = ""; const consume = (chunk) => { tail = `${tail}${chunk}`.slice(-4000); onLine(String(chunk).trim()); }; child.stdout.on("data", consume); child.stderr.on("data", consume); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(tail || `exit ${code}`))); }); }
function formatBytes(value) { return `${(value / 1024 ** 3).toFixed(1)} GB`; }
