import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectVideoResults } from "../src/collectors/video.js";
import { normalizeBilibiliVideo, normalizeYouTubeFeed } from "../src/video/discovery.js";
import { buildDigestEmailMessage, sendDigestEmail } from "../src/email.js";

const tests = [];

test("YouTube RSS entries are normalized", () => {
  const xml = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
    <entry><yt:videoId>video123</yt:videoId><title>New video</title><published>2026-07-19T02:00:00Z</published>
      <media:group><media:content duration="321"/><media:description>Summary</media:description></media:group>
    </entry></feed>`;
  const [video] = normalizeYouTubeFeed(xml, { id: "youtube_test", displayName: "Creator" });
  assert.equal(video.id, "video123");
  assert.equal(video.url, "https://www.youtube.com/watch?v=video123");
  assert.equal(video.durationSeconds, 321);
  assert.equal(video.publishedAt, "2026-07-19T02:00:00.000Z");
});

test("Bilibili API records are normalized", () => {
  const video = normalizeBilibiliVideo({
    bvid: "BV1TEST12345",
    title: "测试视频",
    pubdate: 1784426400,
    duration: 463,
    owner: { name: "章夏Sean" }
  }, { id: "bilibili_test", displayName: "章夏Sean" });
  assert.equal(video.id, "BV1TEST12345");
  assert.equal(video.author, "章夏Sean");
  assert.equal(video.durationSeconds, 463);
});

test("Completed video jobs become digest items and transcript attachments", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "digest-video-test-"));
  try {
    const statePath = path.join(directory, "state.json");
    const transcriptPath = path.join(directory, "transcript.md");
    await fs.writeFile(transcriptPath, "# transcript\n", "utf8");
    await fs.writeFile(statePath, JSON.stringify({
      sourceRuns: {
        bilibili_test: { reportDate: "2026-07-19", status: "success" }
      },
      jobs: {
        "bilibili:BV1TEST12345": {
          id: "BV1TEST12345",
          sourceId: "bilibili_test",
          platform: "bilibili",
          author: "章夏Sean",
          title: "测试视频",
          url: "https://www.bilibili.com/video/BV1TEST12345/",
          publishedAt: "2026-07-19T02:00:00.000Z",
          updatedAt: "2026-07-20T00:30:00.000Z",
          reportDate: "2026-07-19",
          status: "completed",
          transcriptPath,
          transcriptChars: 1234,
          transcriptionSource: "openai-whisper",
          transcriptionDevice: "NVIDIA GeForce RTX 2050",
          excerpt: "文字摘录"
        }
      }
    }), "utf8");

    const config = {
      video: { statePath },
      email: { from: "digest@example.com", to: ["reader@example.com"] },
      sources: [{ id: "bilibili_test", enabled: true }]
    };
    const [item] = await collectVideoResults(config.sources[0], config, { reportDate: "2026-07-19" });
    assert.match(item.text, /RTX 2050/);
    assert.doesNotMatch(item.text, /文字摘录/);
    assert.equal(item.transcriptPath, transcriptPath);

    const message = buildDigestEmailMessage(config, {
      reportDate: "2026-07-19",
      reportPath: path.join(directory, "digest.md"),
      reportItems: [item],
      errors: []
    }, "report");
    assert.equal(message.attachments.length, 2);
    assert.equal(message.attachments[1].path, transcriptPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("A failed video transcript marks the email as partially failed", () => {
  const config = {
    email: { from: "digest@example.com", to: ["reader@example.com"] },
    sources: [{ id: "bilibili_test", enabled: true }, { id: "youtube_test", enabled: true }]
  };
  const message = buildDigestEmailMessage(config, {
    reportDate: "2026-07-19",
    reportPath: "digest.md",
    reportItems: [{ transcriptStatus: "failed" }],
    errors: []
  }, "report");
  assert.match(message.subject, /^\[部分失败\]/);
});

test("Digest email embeds full video transcripts with readable paragraphs", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "digest-email-transcript-test-"));
  try {
    const reportPath = path.join(directory, "digest.md");
    const transcriptPath = path.join(directory, "transcript.md");
    await fs.writeFile(reportPath, "# 日报\n\n视频内容摘录…\n", "utf8");
    await fs.writeFile(transcriptPath, [
      "# 完整标题",
      "",
      "## 文字稿",
      "",
      "这是第一段完整内容。",
      "",
      "这是第二段完整内容，包含 <script>不应作为 HTML 执行</script>。",
      ""
    ].join("\n"), "utf8");

    let delivered;
    await sendDigestEmail({
      email: {
        enabled: true,
        from: "digest@example.com",
        to: ["reader@example.com"],
        retries: 0
      },
      sources: [{ id: "bilibili_test", enabled: true }]
    }, {
      reportDate: "2026-07-19",
      reportPath,
      reportItems: [{
        transcriptPath,
        transcriptStatus: "completed"
      }],
      errors: []
    }, {
      transport: {
        async sendMail(message) {
          delivered = message;
          return { messageId: "embedded-transcript-test" };
        },
        close() {}
      }
    });

    assert.match(delivered.text, /# 完整视频文字稿/);
    assert.match(delivered.text, /这是第一段完整内容。\n\n这是第二段完整内容/);
    assert.match(delivered.html, /<h3[^>]*>完整标题<\/h3>/);
    assert.match(delivered.html, /<p[^>]*>这是第一段完整内容。<\/p>/);
    assert.match(delivered.html, /&lt;script&gt;不应作为 HTML 执行&lt;\/script&gt;/);
    assert.doesNotMatch(delivered.html, /<pre>/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

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
