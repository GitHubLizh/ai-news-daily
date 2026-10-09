/* =============================================================================
 * AI 资讯速递 — 纯逻辑层
 * 筛选、计数与地址栏解析都不依赖 DOM，抽出来便于单元测试（见 test/filters.test.mjs）。
 * 原先这些逻辑散在 app.js 里，导致「分类计数不随语言筛选变化」和「#/all/cat/x 解析
 * 丢分类」两个 bug 都没有测试兜底。
 * ============================================================================= */

export const VIEWS = ['all', 'today', 'day', 'bookmarks'];
export const LANGS = ['zh', 'en', 'all'];
export const DEFAULT_LANG = 'zh';

/** 解析地址栏哈希：#/all、#/today、#/bookmarks、#/day/2026-10-08、#/all/lang/en/cat/模型发布 */
export function parseHashString(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });

  const next = { view: 'all', day: null, category: 'all', lang: null };
  const head = parts[0];

  if (head === 'all' || head === 'today' || head === 'bookmarks') next.view = head;
  else if (head === 'day' && parts[1]) {
    next.view = 'day';
    next.day = parts[1];
  }

  // 视图段（day 还带一个日期）之后的才是 key/value 对；
  // 漏掉这个偏移会把 cat 当成值吃掉，分类筛选就会失效。
  const start = head === 'day' ? 2 : VIEWS.includes(head) ? 1 : 0;
  for (let i = start; i + 1 < parts.length; i += 2) {
    const key = parts[i];
    const value = parts[i + 1];
    if (key === 'cat' && value) next.category = value;
    else if (key === 'lang' && LANGS.includes(value)) next.lang = value;
  }
  return next;
}

/** 由状态生成哈希（省略默认值，保持链接简洁） */
export function buildHashString(state) {
  const parts = [];
  if (state.view === 'bookmarks') parts.push('bookmarks');
  else if (state.view === 'today') parts.push('today');
  else if (state.view === 'day' && state.day) parts.push('day', state.day);
  else parts.push('all');

  if ((state.lang || DEFAULT_LANG) !== DEFAULT_LANG) parts.push('lang', state.lang);
  if (state.category && state.category !== 'all') parts.push('cat', state.category);
  return `#/${parts.map(encodeURIComponent).join('/')}`;
}

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