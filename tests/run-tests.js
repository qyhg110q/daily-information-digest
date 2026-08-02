import assert from "node:assert/strict";
import { validateConfig } from "../src/config.js";
import { normalizeXRecords } from "../src/collectors/x.js";
import { normalizeWeiboRecords } from "../src/collectors/weibo.js";
import { normalizeWeChatPayload } from "../src/collectors/wechat.js";
import { selectReportItems } from "../src/digest.js";
import { buildDigestEmailMessage, buildFatalEmailMessage, sendFatalEmail, sendTestEmail } from "../src/email.js";
import { localDate, localDateTime, parseWeiboDate, previousLocalDate } from "../src/time.js";

test("X records are filtered and normalized", () => {
  const source = {
    id: "x_test",
    platform: "x",
    displayName: "Test",
    url: "https://x.com/test",
    includeReplies: false,
    includeReposts: false
  };
  const records = [
    { url: "https://x.com/test/status/123", publishedAt: "2026-07-18T15:00:00Z", text: "hello", isReply: false, isRepost: false },
    { url: "https://x.com/test/status/124", publishedAt: "2026-07-18T16:00:00Z", text: "reply", isReply: true, isRepost: false }
  ];
  const result = normalizeXRecords(records, source);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "x:123");
  assert.equal(result[0].publishedAt, "2026-07-18T15:00:00.000Z");
});

test("Weibo Chinese dates use China time", () => {
  assert.equal(parseWeiboDate("2026-07-19 08:30"), "2026-07-19T00:30:00.000Z");
  const result = normalizeWeiboRecords([
    { url: "https://weibo.com/1769173661/ABC123", publishedRaw: "2026-07-19 08:30", text: "正文", authorText: "作者", isRepost: false }
  ], { id: "weibo_test", displayName: "作者", includeReposts: false });
  assert.equal(result[0].id, "weibo:ABC123");
});

test("WeChat all feed is filtered by account", () => {
  const payload = { items: [
    { id: "a", title: "目标", url: "https://mp.weixin.qq.com/a", author: { name: "付鹏的财经世界" }, date_published: "2026-07-19T01:00:00Z" },
    { id: "b", title: "其他", url: "https://mp.weixin.qq.com/b", author: { name: "其他号" }, date_published: "2026-07-19T01:00:00Z" }
  ] };
  const result = normalizeWeChatPayload(payload, {
    id: "wechat_test",
    displayName: "付鹏的财经世界",
    accountName: "付鹏的财经世界"
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "wechat:a");
});

test("Timezone date conversion uses Beijing date boundary", () => {
  assert.equal(localDate("2026-07-18T16:00:00Z", "Asia/Shanghai"), "2026-07-19");
  assert.equal(localDateTime("2026-07-18T16:00:00Z", "Asia/Shanghai"), "2026-07-19 00:00:00");
  assert.equal(previousLocalDate("2026-07-18T16:15:00Z", "Asia/Shanghai"), "2026-07-18");
  assert.equal(previousLocalDate("2026-01-01T00:00:00Z", "Asia/Shanghai"), "2025-12-31");
});

test("Config detects duplicate source ids", () => {
  assert.throws(() => validateConfig({
    timezone: "Asia/Shanghai",
    reportTime: "08:00",
    sources: [
      { id: "same", platform: "x", displayName: "A", url: "https://x.com/a" },
      { id: "same", platform: "x", displayName: "B", url: "https://x.com/b" }
    ]
  }), /Duplicate source id/);
});

test("Report remains stable even when items are already in state", () => {
  const items = [{ id: "x:seen", publishedAt: "2026-07-17T15:00:00Z" }];
  assert.equal(selectReportItems(items, "2026-07-17", "Asia/Shanghai").length, 1);
});

test("Email subject distinguishes partial failure", () => {
  const config = {
    timezone: "Asia/Shanghai",
    email: { from: "Digest <sender@qq.com>", to: ["recipient@qq.com"] },
    sources: [{ id: "x_test", enabled: true }, { id: "weibo_test", enabled: true }]
  };
  const result = {
    reportDate: "2026-07-17",
    reportItems: [{ id: "x:1" }],
    reportPath: "report.md",
    errors: [{ sourceId: "weibo_test", message: "failed" }]
  };
  const message = buildDigestEmailMessage(config, result, "# report");
  assert.match(message.subject, /^\[部分失败\]/);
  assert.deepEqual(message.to, ["recipient@qq.com"]);
});

test("Fatal email contains error details", () => {
  const config = { timezone: "Asia/Shanghai", email: { from: "Digest <sender@qq.com>", to: ["recipient@qq.com"] } };
  const message = buildFatalEmailMessage(config, new Error("browser failed"));
  assert.match(message.subject, /^\[失败\]/);
  assert.match(message.text, /browser failed/);
});

await testAsync("Email delivery works with an injected SMTP transport", async () => {
  let delivered;
  let closed = false;
  const result = await sendTestEmail({
    timezone: "Asia/Shanghai",
    email: {
      enabled: true,
      from: "Digest <sender@qq.com>",
      to: ["recipient@qq.com"],
      retries: 0
    }
  }, {
    transport: {
      async sendMail(message) {
        delivered = message;
        return { messageId: "test-message-id" };
      },
      close() {
        closed = true;
      }
    }
  });
  assert.equal(result.messageId, "test-message-id");
  assert.match(delivered.subject, /^\[测试成功\]/);
  assert.equal(closed, true);
});

await testAsync("Fatal collection errors are deliverable by email", async () => {
  let delivered;
  await sendFatalEmail({
    timezone: "Asia/Shanghai",
    email: {
      enabled: true,
      from: "Digest <sender@qq.com>",
      to: ["recipient@qq.com"],
      retries: 0
    }
  }, new Error("collector crashed"), {
    transport: {
      async sendMail(message) {
        delivered = message;
        return { messageId: "fatal-message-id" };
      },
      close() {}
    }
  });
  assert.match(delivered.subject, /^\[失败\]/);
  assert.match(delivered.text, /collector crashed/);
});

console.log("All tests passed.");

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
