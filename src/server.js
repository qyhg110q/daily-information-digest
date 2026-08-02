import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigConflictError } from "./config-store.js";
import { CoreService } from "./core/service.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function startServer({ configPath = "config.json", host = "127.0.0.1", port = 4317 } = {}) {
  if (!isLoopback(host)) throw new Error("Non-loopback binding is disabled in this release");
  const service = new CoreService(path.resolve(configPath));
  const server = http.createServer((request, response) => route(request, response, service).catch((error) => sendError(response, error)));
  server.on("close", () => service.close());
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  return { server, service, url: `http://${host}:${server.address().port}` };
}

async function route(request, response, service) {
  const url = new URL(request.url, "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);
  if (!["GET", "HEAD"].includes(request.method) && request.headers.origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(request.headers.origin)) return json(response, 403, { error: "Cross-origin writes are not allowed" });
  if (request.method === "GET" && url.pathname === "/api/events") return streamEvents(response, service);
  if (request.method === "GET" && url.pathname === "/api/status") return json(response, 200, { ok: true, version: "0.2.0", jobs: service.jobs.list() });
  if (request.method === "GET" && url.pathname === "/api/config") return json(response, 200, await service.config());
  if (request.method === "PUT" && url.pathname === "/api/config") { const body = await readJson(request); return json(response, 200, await service.saveConfig(body.config, revision(request, body))); }
  if (request.method === "GET" && url.pathname === "/api/sources") { const snapshot = await service.config(); return json(response, 200, { sources: snapshot.config.sources, revision: snapshot.revision }); }
  if (request.method === "POST" && url.pathname === "/api/sources/detect") { const body = await readJson(request); return json(response, 200, await service.detectSource(body.url)); }
  if (request.method === "POST" && url.pathname === "/api/sources") { const body = await readJson(request); return json(response, 201, await service.addSource(body.source ?? body, revision(request, body))); }
  if (segments[0] === "api" && segments[1] === "sources" && segments[2]) {
    const body = request.method === "DELETE" ? await readOptionalJson(request) : await readJson(request);
    if (request.method === "PUT") return json(response, 200, await service.updateSource(decodeURIComponent(segments[2]), body.source ?? body, revision(request, body)));
    if (request.method === "DELETE") return json(response, 200, await service.deleteSource(decodeURIComponent(segments[2]), revision(request, body)));
  }
  if (request.method === "GET" && url.pathname === "/api/platforms") return json(response, 200, await service.platforms({ probe: url.searchParams.get("probe") === "true" }));
  if (segments[0] === "api" && segments[1] === "platforms" && segments[2]) {
    const platform = segments[2];
    if (request.method === "GET" && segments[3] === "session") return json(response, 200, await service.checkSession(platform));
    if (request.method === "POST" && segments[3] === "check-session") return json(response, 200, await service.checkSession(platform));
    if (request.method === "POST" && segments[3] === "login" && !segments[4]) return json(response, 202, await service.beginLogin(platform));
    if (request.method === "POST" && segments[3] === "login" && segments[4] && segments[5] === "complete") return json(response, 200, await service.finishLogin(segments[4]));
  }
  if (request.method === "GET" && url.pathname === "/api/models") return json(response, 200, await service.models());
  if (request.method === "GET" && url.pathname === "/api/hardware") return json(response, 200, await service.hardware());
  if (segments[0] === "api" && segments[1] === "models" && segments[2]) {
    const id = segments[2]; const body = await readOptionalJson(request);
    if (request.method === "POST" && segments[3] === "install") return json(response, 202, service.installModel(id));
    if (request.method === "POST" && segments[3] === "select") return json(response, 200, await service.selectModel(id, revision(request, body)));
    if (request.method === "DELETE" && segments.length === 3) return json(response, 200, await service.removeModel(id));
  }
  if (request.method === "POST" && url.pathname === "/api/runs") { const body = await readOptionalJson(request); return json(response, 202, service.startPipeline(body)); }
  if (request.method === "GET" && url.pathname === "/api/runs") return json(response, 200, { jobs: service.jobs.list(), artifacts: await service.runArtifacts() });
  if (request.method === "GET" && segments[0] === "api" && segments[1] === "runs" && segments[2]) { const job = service.jobs.get(segments[2]); return job ? json(response, 200, job) : json(response, 404, { error: "Job not found" }); }
  if (request.method === "GET" && segments[0] === "api" && segments[1] === "artifacts" && segments[2] && segments[3]) return json(response, 200, await service.readArtifact(segments[2], decodeURIComponent(segments.slice(3).join("/"))));
  if (request.method === "POST" && url.pathname === "/api/email/test") return json(response, 202, service.jobs.start("email-test", () => service.testEmail()));
  if (request.method === "POST" && url.pathname === "/api/email/secret") { const body = await readJson(request); return json(response, 200, await service.saveEmailSecret(body.password)); }
  if (request.method === "GET" && url.pathname === "/api/schedule") return json(response, 200, await service.schedule());
  if (request.method === "PUT" && url.pathname === "/api/schedule") { const body = await readJson(request); return json(response, 200, await service.installSchedule(body.at)); }
  if (request.method === "DELETE" && url.pathname === "/api/schedule") return json(response, 200, await service.removeSchedule());
  if (request.method === "GET" && !url.pathname.startsWith("/api/")) return serveStatic(url.pathname, response);
  return json(response, 404, { error: "Not found" });
}

function streamEvents(response, service) {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Content-Type-Options": "nosniff" });
  response.write(`event: snapshot\ndata: ${JSON.stringify(service.jobs.list())}\n\n`);
  const unsubscribe = service.jobs.subscribe((job) => response.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`));
  const unsubscribeConfig = service.subscribeConfig((revision) => response.write(`event: config\ndata: ${JSON.stringify({ revision })}\n\n`));
  const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 20000);
  response.on("close", () => { clearInterval(heartbeat); unsubscribe(); unsubscribeConfig(); });
}

async function serveStatic(pathname, response) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const webRoot = path.join(rootDir, "web");
  const file = path.resolve(webRoot, relative);
  if (file !== webRoot && !file.startsWith(`${webRoot}${path.sep}`)) return json(response, 403, { error: "Forbidden" });
  try {
    const content = await fs.readFile(file);
    const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" }[path.extname(file)] ?? "application/octet-stream";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" }); response.end(content);
  } catch (error) { if (error.code === "ENOENT") return serveStatic("/index.html", response); throw error; }
}

async function readJson(request) { const text = await readBody(request); try { return JSON.parse(text || "{}"); } catch { throw Object.assign(new Error("Invalid JSON body"), { statusCode: 400 }); } }
async function readOptionalJson(request) { const text = await readBody(request); return text ? JSON.parse(text) : {}; }
function readBody(request) { return new Promise((resolve, reject) => { let data = ""; request.on("data", (chunk) => { data += chunk; if (data.length > 1024 * 1024) request.destroy(new Error("Request body too large")); }); request.on("end", () => resolve(data)); request.on("error", reject); }); }
function revision(request, body) { return request.headers["if-match"]?.replace(/^W\/|"/g, "").replace(/"$/, "") || body?.revision; }
function json(response, status, payload) { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "none" }); response.end(JSON.stringify(payload)); }
function sendError(response, error) { const status = error instanceof ConfigConflictError ? 409 : error.statusCode ?? (/not found/i.test(error.message) ? 404 : 400); json(response, status, { error: error.message, currentRevision: error.currentRevision }); }
function isLoopback(host) { return ["127.0.0.1", "localhost", "::1"].includes(host); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = argumentValue("--config") ?? "config.json";
  const host = argumentValue("--host") ?? "127.0.0.1";
  const port = Number(argumentValue("--port") ?? 4317);
  const running = await startServer({ configPath, host, port });
  console.log(`每日信息日报控制台：${running.url}`);
}
function argumentValue(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ""; }
