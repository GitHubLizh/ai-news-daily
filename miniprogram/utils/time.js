/* =============================================================================
 * AI 资讯速递小程序 — 时间工具
 * 不依赖 Intl.DateTimeFormat（小程序 iOS 老 JSCore 支持不完整）；
 * 数据 timezone 固定 Asia/Shanghai，直接手写 UTC+8 换算。
 * ========================================================================== */

const OFFSET_MS = 8 * 3600 * 1000;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad(value) {
  return String(value).padStart(2, '0');
}

/** 时间戳 -> UTC+8 下的 YYYY-MM-DD */
export function dayKeyOf(timestamp) {
  const date = new Date(timestamp + OFFSET_MS);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function todayKey(now = Date.now()) {
  return dayKeyOf(now);
}

export function clockOf(timestamp) {
  const date = new Date(timestamp + OFFSET_MS);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** 相对时间：今天/昨天显示时分，更早显示月日 */
export function relativeTime(timestamp, now = Date.now()) {
  const day = dayKeyOf(timestamp);
  const today = todayKey(now);
  const yesterday = dayKeyOf(now - 86400000);
  if (day === today) return `今天 ${clockOf(timestamp)}`;
  if (day === yesterday) return `昨天 ${clockOf(timestamp)}`;
  const [, month, dayOfMonth] = day.split('-');
  return `${Number(month)}月${Number(dayOfMonth)}日 ${clockOf(timestamp)}`;
}

/** 日期 -> 「10月13日 · 周二」，优先取数据里抓好的 label */
export function dayLabelOf(day, daysList) {
  const found = (daysList || []).find((entry) => entry.day === day);
  if (found) return found.label;
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay()];
  return `${month}月${dayOfMonth}日 · ${weekday}`;
}

/** 数据概览用：10-13 09:57 */
export function shortDateTime(timestamp) {
  const date = new Date(timestamp + OFFSET_MS);
  return `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** 完整时间：2026-10-13 09:57 */
export function fullDateTime(timestamp) {
  const date = new Date(timestamp + OFFSET_MS);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
