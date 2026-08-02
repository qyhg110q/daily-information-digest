export const WEIBO_LOGIN_EXPIRED_MESSAGE = "微博登录态已失效，请运行 npm run login";

export function isWeiboLoginPage(pageUrl, pageTitle = "") {
  const url = String(pageUrl ?? "");
  return /passport\.weibo\.com\/visitor|login\.sina\.com|weibo\.com\/(?:newlogin|login\.php)|[?&]retcode=6102(?:&|$)/i.test(url) ||
    /Sina Visitor System/i.test(String(pageTitle));
}

export function filterWeiboRecordsBySource(records, source) {
  const expectedUid = extractWeiboUid(source?.url);
  if (!expectedUid) throw new Error(`微博来源 ${source?.id ?? "(unknown)"} 的 URL 中缺少数字 UID`);
  return records.filter((record) => extractWeiboUid(record.url) === expectedUid);
}

export function assertOwnedWeiboRecords(records, ownedRecords) {
  if (records.length > 0 && ownedRecords.length === 0) {
    throw new Error(`微博页面返回了其他账号的内容，${WEIBO_LOGIN_EXPIRED_MESSAGE}`);
  }
}

export function extractWeiboUid(value) {
  if (!value) return "";
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    if (parts[0] === "u" && /^\d+$/.test(parts[1] ?? "")) return parts[1];
    return /^\d+$/.test(parts[0] ?? "") ? parts[0] : "";
  } catch {
    return "";
  }
}
