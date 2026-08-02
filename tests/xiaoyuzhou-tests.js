import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectXiaoyuzhou, parseXiaoyuzhouPage } from "../src/collectors/xiaoyuzhou.js";
import { sendDigestEmail } from "../src/email.js";

const tests = [];

test("Xiaoyuzhou public page is parsed and filtered by Beijing date", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "digest-xiaoyuzhou-test-"));
  try {
    const html = makePage([
      {
        eid: "6a655fdca3fec224d5a353e7",
        title: "现金流的重要性",
        description: "这是第一段。\n\n这是第二段。",
        pubDate: "2026-07-25T16:30:00.000Z",
        duration: 1127
      },
      {
        eid: "6a555fdca3fec224d5a353e6",
        title: "前一天",
        description: "不应入选",
        pubDate: "2026-07-25T08:00:00.000Z",
        duration: 600
      }
    ]);
    const source = {
      id: "xiaoyuzhou_fupeng_finance",
      displayName: "付鹏的财经世界（小宇宙）",
      url: "https://example.test/podcast",
      timeoutMs: 1000
    };
    const config = {
      timezone: "Asia/Shanghai",
      outputDir: path.join(directory, "information_digest")
    };

    const items = await collectXiaoyuzhou(source, config, {
      reportDate: "2026-07-26",
      fetchImpl: async () => ({ ok: true, text: async () => html })
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].id, "xiaoyuzhou:6a655fdca3fec224d5a353e7");
    assert.equal(items[0].platform, "xiaoyuzhou");
    assert.match(items[0].text, /共 14 字/);
    assert.ok(items[0].contentPath);
    const notes = await fs.readFile(items[0].contentPath, "utf8");
    assert.match(notes, /## 小宇宙文字内容/);
    assert.match(notes, /这是第一段。\n\n这是第二段。/);
    assert.match(notes, /发布时间：2026-07-26 00:30:00（北京时间）/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Xiaoyuzhou page without text does not invoke transcription", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "digest-xiaoyuzhou-empty-test-"));
  try {
    const source = {
      id: "xiaoyuzhou_test",
      displayName: "测试节目",
      url: "https://example.test/podcast"
    };
    const items = await collectXiaoyuzhou(source, {
      timezone: "Asia/Shanghai",
      outputDir: path.join(directory, "information_digest")
    }, {
      reportDate: "2026-07-26",
      fetchImpl: async () => ({
        ok: true,
        text: async () => makePage([{
          eid: "6a655fdca3fec224d5a353e7",
          title: "没有文字",
          description: "",
          pubDate: "2026-07-26T01:00:00.000Z",
          duration: 10
        }])
      })
    });

    assert.equal(items[0].contentPath, "");
    assert.match(items[0].text, /未提供本期文字内容/);
    assert.equal(items[0].transcriptPath, undefined);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Xiaoyuzhou text is embedded in email and attached", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "digest-xiaoyuzhou-email-test-"));
  try {
    const reportPath = path.join(directory, "digest.md");
    const contentPath = path.join(directory, "episode.md");
    await fs.writeFile(reportPath, "# 日报\n\n本期有小宇宙更新。\n", "utf8");
    await fs.writeFile(contentPath, "# 单集标题\n\n## 小宇宙文字内容\n\n第一段。\n\n第二段。\n", "utf8");

    let delivered;
    await sendDigestEmail({
      email: { enabled: true, from: "digest@example.com", to: ["reader@example.com"], retries: 0 },
      sources: [{ id: "xiaoyuzhou_test", enabled: true }]
    }, {
      reportDate: "2026-07-26",
      reportPath,
      reportItems: [{ contentPath }],
      errors: []
    }, {
      transport: {
        async sendMail(message) {
          delivered = message;
          return { messageId: "xiaoyuzhou-email-test" };
        },
        close() {}
      }
    });

    assert.match(delivered.text, /# 完整小宇宙文字内容/);
    assert.match(delivered.text, /第一段。\n\n第二段。/);
    assert.match(delivered.html, /<p[^>]*>第一段。<\/p>/);
    assert.equal(delivered.attachments.length, 2);
    assert.equal(delivered.attachments[1].path, contentPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Malformed Xiaoyuzhou page reports a clear parsing error", () => {
  assert.throws(() => parseXiaoyuzhouPage("<html></html>"), /未找到 __NEXT_DATA__/);
});

function makePage(episodes) {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: {
        podcast: {
          title: "有“鹏”自远方来",
          author: "付鹏的财经世界",
          episodes
        }
      }
    }
  })}</script></html>`;
}

function test(name, fn) {
  tests.push({ name, fn });
}

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error.stack ?? error.message);
  }
}
if (failed > 0) process.exitCode = 1;
