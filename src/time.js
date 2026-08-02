export function localDate(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function previousLocalDate(value, timeZone) {
  const current = localDate(value, timeZone);
  if (!current) return "";
  const [year, month, day] = current.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return previous.toISOString().slice(0, 10);
}

export function localTime(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function localDateTime(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

export function parseWeiboDate(raw, now = new Date()) {
  if (!raw) return "";
  const text = String(raw).trim();
  const direct = Date.parse(text);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();

  const full = text.match(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?\s+(\d{1,2}):(\d{2})/);
  if (full) return chinaTimeToIso(full[1], full[2], full[3], full[4], full[5]);

  const chinaParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const current = Object.fromEntries(chinaParts.map((part) => [part.type, part.value]));

  const today = text.match(/今天\s*(\d{1,2}):(\d{2})/);
  if (today) return chinaTimeToIso(current.year, current.month, current.day, today[1], today[2]);

  const monthDay = text.match(/(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
  if (monthDay) {
    return chinaTimeToIso(current.year, monthDay[1], monthDay[2], monthDay[3], monthDay[4]);
  }

  return "";
}

function chinaTimeToIso(year, month, day, hour, minute) {
  const padded = [month, day, hour, minute].map((value) => String(value).padStart(2, "0"));
  const parsed = new Date(`${year}-${padded[0]}-${padded[1]}T${padded[2]}:${padded[3]}:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}
