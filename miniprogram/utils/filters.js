/* =============================================================================
 * AI 资讯速递小程序 — 纯逻辑层
 * 由 assets/filters.mjs 移植（小程序无 hash 路由，去掉了 parse/buildHashString）。
 * 保持 ESM 导出，Node 测试可直接 import（见 test/mp-filters.test.mjs）。
 * ========================================================================== */

export const DEFAULT_LANG = 'zh';

/** 视图范围：某个日期 / 今天 / 收藏 / 全部 */
function baseScope(items, options) {
  const { view, day, today, bookmarkIds } = options;
  if (view === 'bookmarks') return items.filter((item) => bookmarkIds.has(item.id));
  if (view === 'today') return items.filter((item) => item.day === today);
  if (view === 'day' && day) return items.filter((item) => item.day === day);
  return items;
}

/**
 * 应用筛选并返回列表。
 * ignoreCategory=true 时跳过分类筛选本身——分类计数要的正是这个口径：
 * 语言/搜索/已读等条件都生效，但不因为「已经选了某个分类」而把其它分类抹掉。
 */
export function selectItems(items, options = {}) {
  const {
    ignoreCategory = false,
    category = 'all',
    lang = 'all',
    query = '',
    hideRead = false,
    onlyPapers = false,
    sort = 'time',
    readIds = new Set(),
    bookmarkIds = new Set(),
    today = '',
    day = null,
    view = 'all',
  } = options;

  let result = baseScope(items, { view, day, today, bookmarkIds });

  if (!ignoreCategory && category !== 'all') result = result.filter((item) => item.category === category);
  if (lang !== 'all') result = result.filter((item) => item.lang === lang);
  if (onlyPapers) result = result.filter((item) => item.bulk);
  if (hideRead) result = result.filter((item) => !readIds.has(item.id));

  const keyword = String(query || '').trim().toLowerCase();
  if (keyword) {
    result = result.filter((item) =>
      `${item.title} ${item.summary} ${item.source} ${(item.alsoIn || []).join(' ')}`.toLowerCase().includes(keyword),
    );
  }

  if (sort === 'hot') {
    result = [...result].sort((a, b) => b.hot - a.hot || b.publishedTs - a.publishedTs);
  }
  return result;
}

/** 分类计数（输入应当是「忽略分类筛选」之后的列表） */
export function countByCategory(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.category, (counts.get(item.category) || 0) + 1);
  return counts;
}

/** Hero 头条窗口：最新一天条目太少时把前一天一起纳入（跨零点常见） */
export function heroWindowDays(days, minimum = 10) {
  const list = Array.isArray(days) ? days : [];
  if (!list.length) return [];
  const window = [list[0].day];
  if ((list[0].count ?? 0) < minimum && list[1]) window.push(list[1].day);
  return window;
}
