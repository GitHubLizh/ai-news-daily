/* =============================================================================
 * news 云函数的纯逻辑（不碰网络，便于单元测试，见 test/mp-paginate.test.mjs）
 * ========================================================================== */

export const DEFAULT_PAGE_SIZE = 200;
export const MAX_PAGE_SIZE = 500;
export const MAX_IDS = 200;

/** 页面用不到的字段（author / sourceId / weight / publishedAt），约省 20~30% 体积 */
const DROP_FIELDS = new Set(['author', 'sourceId', 'weight', 'publishedAt']);

/** 上游 JSON -> 小程序数据集：meta 原样透传，条目裁掉页面用不到的字段 */
export function shapeDataset(raw) {
  if (!Array.isArray(raw.items)) throw new Error('数据格式不正确');
  return {
    generatedAt: raw.generatedAt,
    timezone: raw.timezone,
    count: raw.count,
    days: raw.days,
    stats: raw.stats,
    items: raw.items.map((item) => {
      const kept = {};
      for (const [key, value] of Object.entries(item)) {
        if (!DROP_FIELDS.has(key)) kept[key] = value;
      }
      return kept;
    }),
  };
}

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
