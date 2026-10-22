/* =============================================================================
 * news 云函数的分页纯逻辑（不碰网络，便于单元测试，见 test/mp-paginate.test.mjs）
 * ========================================================================== */

export const DEFAULT_PAGE_SIZE = 200;
export const MAX_PAGE_SIZE = 500;
export const MAX_IDS = 200;

function clampInteger(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 由完整数据集构造分页 / 按 id 响应。
 * meta（generatedAt / timezone / count / days / stats / total）随每次响应返回，
 * 让每一页都自包含，客户端无需区分「首包」与「翻页包」。
 */
export function respond(dataset, params = {}) {
  const meta = {
    generatedAt: dataset.generatedAt,
    timezone: dataset.timezone,
    count: dataset.count,
    days: dataset.days,
    stats: dataset.stats,
    total: dataset.items.length,
  };

  // 按 id 补取：收藏页解析本地收藏 id → 条目
  if (Array.isArray(params.ids) && params.ids.length) {
    const wanted = new Set(params.ids.slice(0, MAX_IDS).map(String));
    return { ...meta, items: dataset.items.filter((item) => wanted.has(item.id)), hasMore: false };
  }

  const pageSize = clampInteger(params.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const page = clampInteger(params.page, 0, Number.MAX_SAFE_INTEGER, 0);
  const start = page * pageSize;
  const items = dataset.items.slice(start, start + pageSize);
  return { ...meta, page, pageSize, items, hasMore: start + items.length < dataset.items.length };
}
