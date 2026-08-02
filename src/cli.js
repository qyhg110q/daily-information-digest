#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { runInteractiveLogin } from "./browser.js";
import { runDigest } from "./digest.js";
import { sendTestEmail } from "./email.js";
import { previousLocalDate } from "./time.js";
import { runVideoIngest } from "./video/ingest.js";
import { hardwareDoctor, installModel, listModels, removeModel, selectModel } from "./models/service.js";

const command = process.argv[2] ?? "once";
const configPath = argumentValue("--config") ?? "config.json";
const requestedDate = argumentValue("--date");
const previousDay = process.argv.includes("--previous-day");
const latest = process.argv.includes("--latest");
const force = process.argv.includes("--force");

try {
  if (command === "serve") {
    const { startServer } = await import("./server.js");
    const running = await startServer({
      configPath,
      host: argumentValue("--host") || "127.0.0.1",
      port: Number(argumentValue("--port") || 4317)
    });
    console.log(`每日信息日报控制台：${running.url}`);
    await new Promise(() => {});
  }

  const config = await loadConfig(configPath);

  if (command === "validate") {
    console.log(`配置有效：${config.sources.length} 个来源，浏览器 ${config.browser.executablePath}`);
  } else if (command === "login") {
    const platform = argumentValue("--platform");
    const { runPlatformLogin } = await import("./browser.js");
    await (platform ? runPlatformLogin(config, platform) : runInteractiveLogin(config));
  } else if (command === "email-test") {
    const result = await sendTestEmail(config);
    console.log(`测试邮件已发送：${result.messageId}`);
  } else if (command === "video-ingest") {
    if (latest && (requestedDate || previousDay)) {
      throw new Error("--latest cannot be combined with --date or --previous-day");
    }
    if (requestedDate && previousDay) {
      throw new Error("--date and --previous-day cannot be used together");
    }
    if (requestedDate && !isValidDate(requestedDate)) {
      throw new Error("--date must use a valid YYYY-MM-DD date");
    }
    const reportDate = previousDay
      ? previousLocalDate(new Date(), config.timezone)
      : requestedDate || (latest ? undefined : previousLocalDate(new Date(), config.timezone));
    const result = await runVideoIngest(config, { reportDate, latest, force });
    console.log(`视频处理完成：发现 ${result.discovered} 个，成功 ${result.completed} 个，失败 ${result.failed} 个`);
    for (const job of result.jobs.filter((candidate) => candidate.status === "failed")) {
      console.error(`[${job.sourceId}/${job.id}] ${job.error}`);
    }
    for (const error of result.sourceErrors) console.error(`[${error.sourceId}] ${error.message}`);
    if (result.failed > 0) process.exitCode = 1;
  } else if (command === "once") {
    if (requestedDate && previousDay) {
      throw new Error("--date and --previous-day cannot be used together");
    }
    if (requestedDate && !isValidDate(requestedDate)) {
      throw new Error("--date must use a valid YYYY-MM-DD date");
    }
    const reportDate = previousDay
      ? previousLocalDate(new Date(), config.timezone)
      : requestedDate || undefined;
    const result = await runDigest(config, {
      reportDate,
      isBackfill: Boolean(requestedDate),
      isPreviousDay: previousDay
    });
    const label = requestedDate ? "目标日期内容" : previousDay ? "前一天内容" : "当天新增";
    const summary = `日报完成：抓取 ${result.fetched} 条，${label} ${result.reportItems.length} 条，错误 ${result.errors.length} 个\n${result.reportPath}`;
    console.log(summary);
    for (const error of result.errors) console.error(`[${error.sourceId}] ${error.message}`);
  } else if (command === "models") {
    const [action = "list", modelId] = positionalArguments(process.argv.slice(3));
    if (action === "list") {
      for (const model of await listModels(configPath)) {
        console.log(`${model.selected ? "*" : " "} ${model.id}\t${model.installed ? "installed" : "not installed"}\t${model.directory}`);
      }
    } else if (action === "doctor") {
      console.log(JSON.stringify(await hardwareDoctor(configPath), null, 2));
    } else if (action === "install") {
      if (!modelId) throw new Error("Usage: digest models install <model-id>");
      const result = await installModel(configPath, modelId, (progress, message) => console.log(`[${progress}%] ${message}`));
      console.log(`模型安装完成：${result.directory}`);
    } else if (action === "select") {
      if (!modelId) throw new Error("Usage: digest models select <model-id>");
      await selectModel(configPath, modelId);
      console.log(`默认模型已设为 ${modelId}`);
    } else if (action === "remove") {
      if (!modelId || !force) throw new Error("Usage: digest models remove <model-id> --force");
      await removeModel(configPath, modelId);
      console.log(`模型已删除：${modelId}`);
    } else {
      throw new Error(`Unknown models action: ${action}`);
    }
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function positionalArguments(args) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    if (["--config", "--date", "--host", "--port", "--platform"].includes(args[index])) index += 1;
    else if (!args[index].startsWith("--")) result.push(args[index]);
  }
  return result;
}
