import assert from "node:assert/strict";
import { buildDigestEmailMessage } from "../src/email.js";
import { collectWeibo, normalizeWeiboRecords } from "../src/collectors/weibo.js";
import {
  assertOwnedWeiboRecords,
  extractWeiboUid,
  filterWeiboRecordsBySource,
  isWeiboLoginPage,
  WEIBO_LOGIN_EXPIRED_MESSAGE
} from "../src/collectors/weibo-safety.js";

const source = {
  id: "weibo_1769173661",
  platform: "weibo",
  displayName: "付鹏的财经世界",
  url: "https://weibo.com/u/1769173661",
  includeReposts: false,
  enabled: true
};

assert.equal(isWeiboLoginPage("https://passport.weibo.com/visitor/visitor", "Sina Visitor System"), true);
assert.equal(isWeiboLoginPage("https://weibo.com/newlogin?url=x&retcode=6102", "微博"), true);
assert.equal(isWeiboLoginPage("https://weibo.com/u/1769173661", "付鹏的财经世界的微博"), false);

await assert.rejects(
  () => collectWeibo({
    async goto() {},
    async waitForTimeout() {},
    async title() { return "微博"; },
    url() { return "https://weibo.com/newlogin?url=x&retcode=6102"; }
  }, source, {
    browser: { navigationTimeoutMs: 1000, settleMs: 0 }
  }),
  new RegExp(WEIBO_LOGIN_EXPIRED_MESSAGE)
);

assert.equal(extractWeiboUid(source.url), "1769173661");
assert.equal(extractWeiboUid("https://weibo.com/7308140398/RblRlla1R"), "7308140398");

const records = [
  {
    url: "https://weibo.com/1769173661/OWN123",
    publishedRaw: "2026-08-01 09:00",
    text: "目标账号内容",
    authorText: "付鹏的财经世界",
    isRepost: false
  },
  {
    url: "https://weibo.com/7308140398/OTHER123",
    publishedRaw: "2026-08-01 10:51",
    text: "热门推荐内容",
    authorText: "大象新闻",
    isRepost: false
  }
];

const owned = filterWeiboRecordsBySource(records, source);
assert.equal(owned.length, 1);
assert.match(owned[0].url, /1769173661/);

const normalized = normalizeWeiboRecords(records, source);
assert.equal(normalized.length, 1);
assert.equal(normalized[0].text, "目标账号内容");

assert.throws(
  () => assertOwnedWeiboRecords(records.slice(1), []),
  new RegExp(WEIBO_LOGIN_EXPIRED_MESSAGE)
);

const message = buildDigestEmailMessage({
  email: { from: "digest@example.com", to: ["reader@example.com"] },
  sources: [source, { id: "x_test", enabled: true }]
}, {
  reportDate: "2026-08-01",
  reportPath: "digest.md",
  reportItems: [],
  errors: [{ sourceId: source.id, message: WEIBO_LOGIN_EXPIRED_MESSAGE }]
}, "report");
assert.match(message.subject, /^\[部分失败\]/);

console.log("All Weibo safety tests passed.");
