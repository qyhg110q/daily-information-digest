import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConfigConflictError, ConfigStore } from "../src/config-store.js";
import { migrateConfig, validateConfig } from "../src/config.js";
import { markPersistentLogin, persistentLoginMarkerPath, profilePath, usesPersistentProfile } from "../src/browser.js";
import { JobManager } from "../src/jobs.js";
import { detectSource, listPlatforms, normalizeSource } from "../src/platforms/registry.js";
import { persistentSessionIsValid, sessionStatus } from "../src/sessions/manager.js";
import { startServer } from "../src/server.js";
import { exportBilibiliCookies } from "../src/video/ingest.js";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "digest-control-test-"));
const configPath = path.join(directory, "config.json");
const base = { version: 1, timezone: "Asia/Shanghai", reportTime: "00:30", sources: [] };

try {
  const schema = JSON.parse(await fs.readFile(new URL("../config.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.properties.version.const, 1);
  assert.ok(schema.$defs.source.properties.platform.enum.includes("xiaoyuzhou"));
  assert.equal(migrateConfig({ timezone: "Asia/Shanghai" }).version, 1);
  assert.doesNotThrow(() => validateConfig(base));
  assert.equal(normalizeSource({ id: "creator", platform: "bilibili", displayName: "Creator", url: "https://space.bilibili.com/432597324/video/" }).uid, "432597324");
  assert.equal((await detectSource("https://space.bilibili.com/432597324")).uid, "432597324");
  assert.equal((await detectSource("https://x.com/example")).id, "x_example");
  const bilibiliPlatform = listPlatforms().find((platform) => platform.id === "bilibili");
  assert.equal(bilibiliPlatform.capabilities.login, false);
  assert.equal(bilibiliPlatform.capabilities.loginOptional, true);
  assert.equal(listPlatforms().find((platform) => platform.id === "x").capabilities.persistentLogin, true);
  const sessionConfig = { ...base, browser: { sessionDir: path.join(directory, "sessions"), profileDir: path.join(directory, "profiles"), storageStatePath: path.join(directory, "legacy.json") }, video: { workDir: path.join(directory, "video-work") } };
  assert.equal(usesPersistentProfile("x"), true);
  assert.equal(usesPersistentProfile("weibo"), true);
  assert.equal(usesPersistentProfile("bilibili"), false);
  assert.equal(profilePath(sessionConfig, "x"), path.join(directory, "profiles", "x"));
  assert.equal(persistentSessionIsValid("x", { cookieNames: ["auth_token", "ct0"], invalid: false, homeLinks: 1 }), true);
  assert.equal(persistentSessionIsValid("x", { cookieNames: ["auth_token", "ct0"], invalid: false, authenticatedUrl: true, homeLinks: 0 }), true);
  assert.equal(persistentSessionIsValid("x", { cookieNames: ["ct0"], invalid: false, homeLinks: 1 }), false);
  assert.equal(persistentSessionIsValid("weibo", { cookieNames: ["SUB"], invalid: false, profileLinks: 1, articles: 0 }), true);
  assert.equal(persistentSessionIsValid("weibo", { cookieNames: ["SUB"], invalid: true, profileLinks: 1, articles: 1 }), false);
  await fs.mkdir(sessionConfig.browser.sessionDir, { recursive: true });
  await fs.writeFile(path.join(sessionConfig.browser.sessionDir, "x.json"), JSON.stringify({ cookies: [] }));
  const legacyX = await sessionStatus(sessionConfig, "x", false);
  assert.equal(legacyX.status, "expired");
  assert.match(legacyX.message, /旧版登录快照不会继续使用/);
  await markPersistentLogin(sessionConfig, "x");
  assert.equal(await fs.access(persistentLoginMarkerPath(sessionConfig, "x")).then(() => true), true);
  assert.equal((await sessionStatus(sessionConfig, "x", false)).status, "unknown");
  const anonymousBilibili = await sessionStatus(sessionConfig, "bilibili");
  assert.equal(anonymousBilibili.status, "not_needed");
  assert.match(anonymousBilibili.message, /如需访问会员内容，请登录 Bilibili/);
  await fs.writeFile(path.join(sessionConfig.browser.sessionDir, "bilibili.json"), JSON.stringify({ cookies: [{ name: "SESSDATA", value: "test-session", domain: ".bilibili.com", path: "/", expires: 2000000000, httpOnly: true, secure: true }] }));
  const cookieFile = await exportBilibiliCookies(sessionConfig);
  assert.match(await fs.readFile(cookieFile, "utf8"), /#HttpOnly_\.bilibili\.com\tTRUE\t\/\tTRUE\t2000000000\tSESSDATA\ttest-session/);

  await fs.writeFile(configPath, `${JSON.stringify(base, null, 2)}\n`);
  const store = new ConfigStore(configPath);
  const first = await store.read();
  const saved = await store.write({ ...first.config, reportTime: "01:15" }, first.revision);
  assert.equal(saved.config.reportTime, "01:15");
  await assert.rejects(() => store.write(first.config, first.revision), ConfigConflictError);
  assert.equal(JSON.parse(await fs.readFile(`${configPath}.bak`, "utf8")).reportTime, "00:30");

  const jobs = new JobManager();
  const pending = jobs.start("pipeline", async () => new Promise((resolve) => setTimeout(() => resolve("ok"), 20)), { exclusive: true });
  assert.throws(() => jobs.start("pipeline", async () => {}, { exclusive: true }), /already running/);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(jobs.get(pending.id).status, "completed");

  const running = await startServer({ configPath, port: 0 });
  try {
    const status = await fetch(`${running.url}/api/status`).then((response) => response.json());
    assert.equal(status.ok, true);
    const page = await fetch(running.url).then((response) => response.text());
    assert.match(page, /每日信息日报/);
    const detected = await fetch(`${running.url}/api/sources/detect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://x.com/example" }) }).then((response) => response.json());
    assert.equal(detected.id, "x_example");
    const forbidden = await fetch(`${running.url}/api/sources/detect`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ url: "https://x.com/example" }) });
    assert.equal(forbidden.status, 403);
    const conflict = await fetch(`${running.url}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: saved.config, revision: "stale" }) });
    assert.equal(conflict.status, 409);
  } finally {
    await new Promise((resolve) => running.server.close(resolve));
  }
  console.log("All control-plane tests passed.");
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
