/* =============================================================================
 * 数据自动刷新的纯逻辑（不碰 DOM，便于单元测试；见 test/refresh.test.mjs）
 *
 * 站点是纯静态的：定时流水线在 GitHub 上跑完后，页面只有自己再取一次
 * data/news.json 才能看到当天资讯。页面本身不会重载，所以这里回答两个问题：
 *   1. 此刻该不该向服务端重新校验？（后台标签页、刚查过就不查）
 *   2. 取回来的数据要不要重绘？（没变化就别动用户的阅读位置）
 * ========================================================================== */

/** 页面可见时的轮询间隔：10 分钟 */
export const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/** 两次网络校验之间的最小间隔：来回切标签页时不重复打请求 */
export const REFRESH_MIN_GAP_MS = 2 * 60 * 1000;

/**
 * 此刻是否该向服务端重新校验数据。
 *
 * @param {{hidden?: boolean, lastCheckedAt?: number, now?: number, minGapMs?: number}} [options]
 *   hidden        页面是否在后台（后台标签页不刷新，省流量也省电）
 *   lastCheckedAt 上次校验的时刻，0 表示本次会话还没查过
 * @returns {boolean}
 */
export function shouldRecheck({
  hidden = false,
  lastCheckedAt = 0,
  now = Date.now(),
  minGapMs = REFRESH_MIN_GAP_MS,
} = {}) {
  if (hidden) return false;
  if (!lastCheckedAt) return true;
  return now - lastCheckedAt >= minGapMs;
}

/**
 * 新取到的数据集是否需要重绘页面。
 * 以 generatedAt 为版本号：相同即「没变」，避免把同样的数据重画一遍打断阅读。
 * 抓取管线也按这个字段判断是否提交，语义一致。
 *
 * @param {{generatedAt?: string}|null} current 当前页面里的数据集
 * @param {{generatedAt?: string, items?: unknown[]}|null} next 刚取回的数据集
 * @returns {boolean}
 */
export function datasetChanged(current, next) {
  if (!Array.isArray(next?.items) || next.items.length === 0) return false; // 空数据一律不覆盖
  if (!current?.generatedAt) return true;
  return next.generatedAt !== current.generatedAt;
}