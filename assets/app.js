/* =============================================================================
 * AI 资讯速递 — 前端逻辑
 * 纯原生 ES Module，无构建步骤：读取 ./data/news.json 后在前端完成筛选、
 * 分组、搜索、日历查询与本地收藏/已读。所有来自 feed 的文本都经过转义。
 * ========================================================================== */

import {
  buildHashString,
  countByCategory,
  heroWindowDays,
  parseHashString,
  selectItems,
} from './filters.mjs';

const DATA_URL = 'data/news.json';
const PAGE_SIZE = 40;

const STORAGE_KEYS = {
  theme: 'ainews.theme',
  read: 'ainews.read',
  bookmarks: 'ainews.bookmarks',
  lang: 'ainews.lang',
};

/** 分类 -> 标签配色（见 styles.css 的 tone-*） */
const CATEGORY_TONES = {
  模型发布: 'tone-1',
  产品动态: 'tone-2',
  研究前沿: 'tone-3',
  行业动态: 'tone-4',
  开源工具: 'tone-5',
  观点方法: 'tone-6',
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const state = {
  data: null,
  view: 'all', // all | today | day | bookmarks（默认展示全部归档，最新在前）
  day: null,
  category: 'all',
  lang: 'zh', // 默认只看中文，切换后会记在本地
  sort: 'time',
  query: '',
  hideRead: false,
  onlyPapers: false,
  limit: PAGE_SIZE,
  cal: { mode: 'day', year: 0, month: 1 },
  read: new Set(),
  bookmarks: new Set(),
  sourceHome: new Map(),
};

/* --------------------------------------------------------------- 工具函数 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timezone() {
  return state.data?.timezone || 'Asia/Shanghai';
}

/** 时间戳 -> 指定时区下的 YYYY-MM-DD */
function dayKeyOf(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

function todayKey() {
  return dayKeyOf(Date.now());
}

function clockOf(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone(),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

/** 相对时间：今天/昨天显示时分，更早显示月日 */
function relativeTime(timestamp) {
  const day = dayKeyOf(timestamp);
  const today = todayKey();
  const yesterday = dayKeyOf(Date.now() - 86400000);
  if (day === today) return `今天 ${clockOf(timestamp)}`;
  if (day === yesterday) return `昨天 ${clockOf(timestamp)}`;
  const [, month, dayOfMonth] = day.split('-');
  return `${Number(month)}月${Number(dayOfMonth)}日 ${clockOf(timestamp)}`;
}

function dayLabelOf(day) {
  const found = state.data?.days?.find((entry) => entry.day === day);
  if (found) return found.label;
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', weekday: 'short' }).format(
    new Date(Date.UTC(year, month - 1, dayOfMonth)),
  );
  return `${month}月${dayOfMonth}日 · ${weekday}`;
}

function debounce(fn, wait = 180) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function loadSet(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* 隐私模式下忽略 */
  }
}

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-on');
    setTimeout(() => {
      el.hidden = true;
    }, 220);
  }, 1800);
}

/* ----------------------------------------------------------------- 主题 */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  } catch {
    /* 忽略 */
  }
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEYS.theme);
  } catch {
    /* 忽略 */
  }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

/* ------------------------------------------------------------- 路由状态 */

/** 解析地址栏状态：#/all、#/day/2026-10-08、#/bookmarks、#/all/lang/en/cat/模型发布 */
function parseHash() {
  return parseHashString(location.hash);
}

function writeHash() {
  const next = buildHashString(state);
  if (location.hash !== next) history.replaceState(null, '', next);
}

/** 把地址栏状态应用到 state（未出现在地址栏里的字段保持不变） */
function applyRouteState(initial = false) {
  const next = parseHash();
  state.view = next.view;
  state.day = next.day;
  state.category = next.category;
  if (next.lang) state.lang = next.lang;
  state.limit = PAGE_SIZE;
  if (!initial) render();
}

function applyRoute() {
  applyRouteState(false);
}

/* --------------------------------------------------------------- 数据加载 */

async function loadData() {
  const response = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.items)) throw new Error('数据格式不正确');
  state.data = data;
  state.sourceHome = new Map(
    data.items.filter((item) => item.source && item.home).map((item) => [item.source, item.home]),
  );
  const latest = data.days?.[0]?.day || todayKey();
  const [year, month] = latest.split('-').map(Number);
  state.cal = { mode: 'day', year, month };
}

/* --------------------------------------------------------------- 筛选范围 */

/** 把当前 state 翻译成纯逻辑层要的筛选条件 */
function scopeOptions() {
  return {
    view: state.view,
    day: state.day,
    today: todayKey(),
    category: state.category,
    lang: state.lang,
    query: state.query,
    hideRead: state.hideRead,
    onlyPapers: state.onlyPapers,
    sort: state.sort,
    readIds: state.read,
    bookmarkIds: state.bookmarks,
  };
}

/**
 * 应用全部筛选条件（见 assets/filters.mjs）。
 * ignoreCategory 用于统计分类数量：分类芯片与侧栏分布需要的是「除了分类本身之外
 * 其余条件都生效」的分布，否则选中某个分类后其它分类的条数就没有意义了。
 */
function scopedItems({ ignoreCategory = false } = {}) {
  if (!state.data) return [];
  return selectItems(state.data.items, { ...scopeOptions(), ignoreCategory });
}

/** 当前列表内容（应用了全部分类筛选 + 排序） */
function scopeItems() {
  return scopedItems();
}

/* --------------------------------------------------------------- Hero */

/** Hero 展示当前语言偏好下、最新一天里热度最高的一条 */
function renderHero() {
  const box = $('#hero');
  const all = state.data.items;
  if (!all.length) {
    box.hidden = true;
    return;
  }
  // 跨零点后最新一天可能只有零星几条，这时把前一天一起纳入头条窗口
  const windowDays = heroWindowDays(state.data.days);
  const todays = all.filter((item) => windowDays.includes(item.day));
  const preferred = state.lang === 'all' ? todays : todays.filter((item) => item.lang === state.lang);
  const pool = preferred.length ? preferred : todays;
  const featured = [...pool].sort((a, b) => b.hot - a.hot)[0] || all[0];
  const isToday = featured.day === todayKey();
  const scopeLabel = state.lang === 'zh' ? '中文更新' : state.lang === 'en' ? '英文更新' : '当日更新';

  box.hidden = false;
  box.innerHTML = `
    <div class="hero-top">
      <span class="hero-eyebrow">Today Top News</span>
      <span class="hero-date">${escapeHtml(dayLabelOf(featured.day))}${isToday ? ' · 今日' : ''}</span>
    </div>
    <h1 class="hero-title">
      <a href="${escapeHtml(featured.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(featured.title)}</a>
    </h1>
    <p class="hero-summary">${escapeHtml(featured.summary || '点击查看原文详情。')}</p>
    <div class="hero-foot">
      <span class="hero-chip">${escapeHtml(featured.category)}</span>
      <span class="hero-chip">来源 ${escapeHtml(featured.source)}</span>
      <span class="hero-chip">${escapeHtml(relativeTime(featured.publishedTs))}</span>
      <a class="hero-cta" href="#/day/${encodeURIComponent(featured.day)}">查看当天 ${pool.length} 条 →</a>
    </div>
    <div class="hero-stats">
      <div class="hero-stat"><b>${pool.length}</b><span>${scopeLabel}</span></div>
      <div class="hero-stat"><b>${state.data.stats.sources.length}</b><span>覆盖来源</span></div>
      <div class="hero-stat"><b>${all.length}</b><span>归档条目</span></div>
    </div>
  `;
}

/* --------------------------------------------------------------- 筛选控件 */

function renderFilters() {
  // 计数随语言/搜索/已读等条件变化，但不随分类本身变化
  const base = scopedItems({ ignoreCategory: true });
  const counts = countByCategory(base);

  const chips = [
    `<button type="button" class="chip ${state.category === 'all' ? 'is-active' : ''}" data-cat="all">全部<span class="chip-n">${base.length}</span></button>`,
    ...Object.keys(CATEGORY_TONES).map(
      (name) =>
        `<button type="button" class="chip ${state.category === name ? 'is-active' : ''}" data-cat="${escapeHtml(name)}">${escapeHtml(name)}<span class="chip-n">${counts.get(name) || 0}</span></button>`,
    ),
  ];
  $('#catRow').innerHTML = chips.join('');

  $$('#langSeg button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.lang === state.lang);
  });
  $$('#sortSeg button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.sort === state.sort);
  });
  $('#hideRead').checked = state.hideRead;
  $('#onlyPapers').checked = state.onlyPapers;
}

/* --------------------------------------------------------------- 资讯流 */

function itemHtml(item) {
  const tone = CATEGORY_TONES[item.category] || 'tone-6';
  const isRead = state.read.has(item.id);
  const isSaved = state.bookmarks.has(item.id);
  const alsoIn = item.alsoIn?.length ? ` · 另见 ${item.alsoIn.slice(0, 2).map(escapeHtml).join('、')}` : '';
  return `
    <article class="item ${isRead ? 'is-read' : ''}" data-id="${escapeHtml(item.id)}">
      <div class="item-top">
        <span class="tag ${tone}">${escapeHtml(item.category)}</span>
        ${item.bulk ? '<span class="tag paper">论文</span>' : ''}
        ${item.estimate ? '<span class="tag paper">时间待确认</span>' : ''}
        <span class="item-hot">热度 ${item.hot}</span>
      </div>
      <h3 class="item-title">
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" data-act="open">${escapeHtml(item.title)}</a>
      </h3>
      ${item.summary ? `<p class="item-summary">${escapeHtml(item.summary)}</p>` : ''}
      <div class="item-bottom">
        <span class="item-source"><i></i>${escapeHtml(item.source)}</span>
        <span>${escapeHtml(relativeTime(item.publishedTs))}</span>
        <span>${escapeHtml(item.lang === 'zh' ? '中文' : 'EN')}</span>${alsoIn ? `<span>${alsoIn}</span>` : ''}
        <span class="item-actions">
          <button type="button" class="act ${isSaved ? 'is-on' : ''}" data-act="save" title="收藏">
            ${isSaved ? '★' : '☆'}<span> 收藏</span>
          </button>
          <button type="button" class="act ${isRead ? 'is-on' : ''}" data-act="read" title="标记已读">
            ${isRead ? '✓' : '○'}<span> 已读</span>
          </button>
          <button type="button" class="act" data-act="copy" title="复制原文链接">⧉<span> 复制</span></button>
        </span>
      </div>
    </article>
  `;
}

function renderFeed() {
  const feed = $('#feed');
  const head = $('#feedHead');
  const empty = $('#empty');
  const moreWrap = $('#moreWrap');
  const items = scopeItems();

  const scopeText = state.view === 'bookmarks'
    ? '我的收藏'
    : state.view === 'today'
      ? `${dayLabelOf(todayKey())} · 今天`
      : state.view === 'day' && state.day
        ? dayLabelOf(state.day)
        : '全部归档 · 最新在前';

  head.innerHTML = `<b>${escapeHtml(scopeText)}</b><span>共 ${items.length} 条${
    state.query ? ` · 关键词“${escapeHtml(state.query)}”` : ''
  }${state.category !== 'all' ? ` · ${escapeHtml(state.category)}` : ''}</span>`;

  if (!items.length) {
    feed.innerHTML = '';
    moreWrap.hidden = true;
    empty.hidden = false;
    const langScope = scopedItems({ ignoreCategory: true });
    const otherLang = langScope.filter((item) => item.lang !== state.lang);
    const langHint =
      state.lang !== 'all' && otherLang.length
        ? `<br />当前范围还有 ${otherLang.length} 条${state.lang === 'zh' ? '英文' : '中文'}资讯，可切换语言查看。`
        : '';
    empty.innerHTML = state.view === 'bookmarks' && !state.bookmarks.size
      ? '<b>还没有收藏</b>点击资讯卡片右下角的「☆ 收藏」，之后可以在这里集中查看。'
      : `<b>没有符合条件的资讯</b>试试放宽筛选条件，或切换日期 / 分类。${langHint}<br /><button type="button" class="ghost-btn" data-action="reset" style="margin-top:12px">重置筛选</button>`;
    return;
  }

  empty.hidden = true;

  const visible = items.slice(0, state.limit);
  let groups;
  if (state.sort === 'hot') {
    groups = [{ key: 'hot', label: '热度排序', items: visible, total: items.length, flat: true }];
  } else {
    const map = new Map();
    for (const item of items) {
      if (!map.has(item.day)) map.set(item.day, []);
      map.get(item.day).push(item);
    }
    // 先按天分组（保留完整数量用于表头），再按分页上限截取
    let remaining = state.limit;
    groups = [];
    for (const [day, list] of map.entries()) {
      if (remaining <= 0) break;
      const taken = list.slice(0, remaining);
      remaining -= taken.length;
      groups.push({ key: day, label: dayLabelOf(day), items: taken, total: list.length, day });
    }
  }

  const today = todayKey();
  feed.innerHTML = groups
    .map(
      (group) => `
      <section class="day-group">
        <header class="day-head">
          <span class="triangle">▸</span>
          <h3>${escapeHtml(group.label)}</h3>
          ${group.day === today ? '<span class="today-tag">今天</span>' : ''}
          <span class="day-count">${group.items.length < group.total ? `显示 ${group.items.length} / 共 ${group.total} 条` : `${group.total} 条`}</span>
          ${group.day ? `<a class="day-link" href="#/day/${encodeURIComponent(group.day)}">仅看这天 →</a>` : ''}
        </header>
        <div class="items">${group.items.map(itemHtml).join('')}</div>
      </section>`,
    )
    .join('');

  moreWrap.hidden = items.length <= state.limit;
  if (!moreWrap.hidden) {
    $('#loadMore').textContent = `加载更多（还有 ${items.length - state.limit} 条）`;
  }
}

/* --------------------------------------------------------------- 日历 */

function daysWithNews() {
  const map = new Map();
  for (const entry of state.data.days || []) map.set(entry.day, entry.count);
  return map;
}

function renderCalendar() {
  const box = $('#calendar');
  const withNews = daysWithNews();
  const days = state.data.days || [];
  if (!days.length) {
    box.innerHTML = '<p class="muted">暂无数据</p>';
    return;
  }
  const earliest = days[days.length - 1].day;
  const latest = days[0].day;
  const [eYear, eMonth] = earliest.split('-').map(Number);
  const [lYear, lMonth] = latest.split('-').map(Number);

  if (state.cal.mode === 'year') {
    const years = [...new Set(days.map((entry) => Number(entry.day.slice(0, 4))))].sort((a, b) => b - a);
    box.innerHTML = `
      <div class="cal-head"><b>选择年份</b></div>
      <div class="cal-grid years">
        ${years
          .map((year) => {
            const count = days.filter((entry) => entry.day.startsWith(`${year}-`)).reduce((acc, entry) => acc + entry.count, 0);
            return `<button type="button" class="cal-year has-news" data-year="${year}">${year}<br /><small class="muted">${count} 条</small></button>`;
          })
          .join('')}
      </div>`;
    return;
  }

  if (state.cal.mode === 'month') {
    const year = state.cal.year;
    const canNext = year < lYear;
    const canPrev = year > eYear;
    box.innerHTML = `
      <div class="cal-head">
        <b>${year} 年</b>
        <span class="cal-nav">
          <button type="button" data-step="-1" ${canPrev ? '' : 'disabled'} aria-label="上一年">‹</button>
          <button type="button" data-step="1" ${canNext ? '' : 'disabled'} aria-label="下一年">›</button>
        </span>
      </div>
      <div class="cal-grid months">
        ${Array.from({ length: 12 }, (_, index) => index + 1)
          .map((month) => {
            const prefix = `${year}-${String(month).padStart(2, '0')}`;
            const count = days.filter((entry) => entry.day.startsWith(prefix)).reduce((acc, entry) => acc + entry.count, 0);
            const inRange =
              (year > eYear || (year === eYear && month >= eMonth)) && (year < lYear || (year === lYear && month <= lMonth));
            const active = state.day?.startsWith(prefix);
            return `<button type="button" class="cal-month ${count ? 'has-news' : ''} ${active ? 'is-active' : ''}" data-month="${month}" ${inRange ? '' : 'disabled'}>
              ${month} 月${count ? `<br /><small class="muted">${count}</small>` : ''}
            </button>`;
          })
          .join('')}
      </div>`;
    return;
  }

  const year = state.cal.year;
  const month = state.cal.month;
  const canNext = year < lYear || (year === lYear && month < lMonth);
  const canPrev = year > eYear || (year === eYear && month > eMonth);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startPad = (first.getUTCDay() + 6) % 7; // 周一为一周起点
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];

  for (let i = 0; i < startPad; i += 1) cells.push('<span></span>');
  for (let dayOfMonth = 1; dayOfMonth <= daysInMonth; dayOfMonth += 1) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
    const count = withNews.get(key) || 0;
    const inRange = key >= earliest && key <= latest;
    const active = state.day === key;
    const isToday = key === todayKey();
    cells.push(
      `<button type="button" class="cal-day ${count ? 'has-news' : ''} ${active ? 'is-active' : ''} ${isToday ? 'is-today' : ''}" data-day="${key}" title="${count ? `${count} 条资讯` : '无数据'}" ${inRange ? '' : 'disabled'}>${dayOfMonth}</button>`,
    );
  }

  box.innerHTML = `
    <div class="cal-head">
      <b>${year} 年 ${month} 月</b>
      <span class="cal-nav">
        <button type="button" data-step="-1" ${canPrev ? '' : 'disabled'} aria-label="上一月">‹</button>
        <button type="button" data-step="1" ${canNext ? '' : 'disabled'} aria-label="下一月">›</button>
      </span>
    </div>
    <div class="cal-grid">
      ${['一', '二', '三', '四', '五', '六', '日'].map((w) => `<span class="cal-wd">${w}</span>`).join('')}
      ${cells.join('')}
    </div>
  `;
}

/* --------------------------------------------------------------- 侧栏统计 */

function renderSidebar() {
  const items = scopeItems();
  // 分类分布同样不受「当前选中的分类」影响，否则切换分类后这张表就只剩一行
  const catScope = scopedItems({ ignoreCategory: true });

  const catCounts = countByCategory(catScope);
  const srcCounts = new Map();
  for (const item of items) {
    srcCounts.set(item.source, (srcCounts.get(item.source) || 0) + 1);
  }
  const catMax = Math.max(1, ...catCounts.values());
  $('#catStats').innerHTML = [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([name, count]) => `
      <button type="button" class="stat" data-cat="${escapeHtml(name)}">
        <span class="stat-name">${escapeHtml(name)}</span>
        <span class="stat-n">${count}</span>
        <span class="stat-bar"><i style="width:${Math.round((count / catMax) * 100)}%"></i></span>
      </button>`,
    )
    .join('') || '<p class="muted">当前范围暂无数据</p>';

  // 来源分布
  const srcMax = Math.max(1, ...srcCounts.values());
  $('#srcStats').innerHTML = [...srcCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(
      ([name, count]) => `
      <a class="stat" href="${escapeHtml(state.sourceHome.get(name) || '#')}" target="_blank" rel="noopener noreferrer">
        <span class="stat-name">${escapeHtml(name)}</span>
        <span class="stat-n">${count}</span>
        <span class="stat-bar"><i style="width:${Math.round((count / srcMax) * 100)}%"></i></span>
      </a>`,
    )
    .join('') || '<p class="muted">当前范围暂无数据</p>';

  // 热度榜
  const ranked = [...items].sort((a, b) => b.hot - a.hot || b.publishedTs - a.publishedTs).slice(0, 10);
  $('#hotList').innerHTML = ranked
    .map(
      (item, index) => `
      <li>
        <span class="hot-rank">${index + 1}</span>
        <span>
          <a class="hot-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
          <span class="hot-meta">${escapeHtml(item.source)} · 热度 ${item.hot}</span>
        </span>
      </li>`,
    )
    .join('') || '<li class="muted">当前范围暂无数据</li>';

  // 数据信息
  const generated = new Date(state.data.generatedAt);
  const estimated = state.data.stats.estimatedTime || 0;
  $('#dataMeta').innerHTML = `
    <b>数据概览</b><br />
    条目 ${state.data.count} 条 · 覆盖 ${state.data.days.length} 天<br />
    中文 ${state.data.stats.languages.zh} / 英文 ${state.data.stats.languages.en}<br />
    最近更新：${escapeHtml(
      new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone(),
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(generated),
    )}${estimated ? `<br />${estimated} 条时间待确认（源未提供发布时间）` : ''}
  `;
}

/* --------------------------------------------------------------- 关于弹窗 */

function renderAbout() {
  const stats = state.data.stats;
  const body = $('#aboutBody');
  const sourceLinks = stats.sources
    .slice(0, 40)
    .map((entry) => {
      const home = state.sourceHome.get(entry.name);
      return `<a href="${escapeHtml(home || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.name)}<small class="muted">${entry.count}</small></a>`;
    })
    .join('');
  body.innerHTML = `
    <p>本站是一个自建的 AI 资讯聚合站：每天定时抓取公开 RSS 源，去重、分类后写入一份静态 JSON，页面纯前端渲染。没有账号、没有广告，方便自己和朋友每天花几分钟扫一眼 AI 圈发生了什么。</p>

    <h3>数据是怎么来的</h3>
    <ul>
      <li><code>npm run fetch</code> 抓取 <code>data/feeds.json</code> 中启用的源，写入 <code>data/news.json</code></li>
      <li><code>npm run build</code> 生成可发布的 <code>dist/</code> 目录（也可直接部署仓库根目录）</li>
      <li>同时导出订阅源 <a class="footer-link" href="data/feed.xml" target="_blank" rel="noopener">data/feed.xml</a>，可直接加进 RSS 阅读器</li>
      <li><code>npm run dev</code> 本地预览（默认 http://127.0.0.1:5173）</li>
      <li>整站无第三方依赖，可整体发布到 GitHub Pages / Vercel / Netlify 等静态托管</li>
    </ul>

    <h3>热度口径</h3>
    <p>热度 = 50% 时效衰减（36 小时半衰期）+ 25% 来源权重（<code>feeds.json</code> 中的 weight）+ 25% 热点关键词命中，归一到 0~100。它只是排序辅助，不代表真实阅读量。</p>

    <h3>浏览方式</h3>
    <p>默认只显示中文资讯，切换「英文 / 全部语言」后会记住你的选择。日期、分类、语言、排序状态都会写进地址栏，可以直接把链接分享给别人。</p>

    <h3>去重与分类</h3>
    <p>按规范化 URL 与标题去重，跨源转载会合并并标注「另见」；分类由关键词规则自动判定（标题命中权重更高），可能有个别误判。</p>

    <h3>数据现状</h3>
    <p>共 ${state.data.count} 条，覆盖 ${state.data.days.length} 天，来自 ${stats.sources.length} 个源；中文 ${stats.languages.zh} 条，英文 ${stats.languages.en} 条。</p>

    <h3>来源</h3>
    <div class="src-grid">${sourceLinks}</div>

    <h3>免责声明</h3>
    <p>所有内容版权归原作者与原网站所有，本站只做标题、摘要与链接的聚合，点击标题即可跳转原文。</p>
  `;
}

/* --------------------------------------------------------------- 渲染入口 */

function render() {
  if (!state.data) return;
  renderHero();
  renderFilters();
  renderFeed();
  renderCalendar();
  renderSidebar();
  updateNav();
  renderFooter();
  writeHash();
}

function renderFooter() {
  const generated = new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(state.data.generatedAt));
  $('#footerMeta').textContent = `数据更新于 ${generated}（${timezone()}）· 共 ${state.data.count} 条 · 覆盖 ${state.data.stats.sources.length} 个来源`;
}

function updateNav() {
  $$('#nav a[data-nav]').forEach((link) => {
    const key = link.dataset.nav;
    const active =
      (key === 'all' && (state.view === 'all' || state.view === 'today' || state.view === 'day')) ||
      (key === 'bookmarks' && state.view === 'bookmarks');
    link.classList.toggle('is-active', active);
  });
  const count = state.bookmarks.size;
  const badge = $('#bmCount');
  badge.hidden = count === 0;
  badge.textContent = String(count);
}

/* --------------------------------------------------------------- 事件绑定 */

function setCategory(category) {
  state.category = state.category === category ? 'all' : category;
  state.limit = PAGE_SIZE;
  render();
}

function selectDay(day) {
  state.view = 'day';
  state.day = day;
  state.limit = PAGE_SIZE;
  render();
  $('#feed')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleBookmark(id) {
  if (state.bookmarks.has(id)) state.bookmarks.delete(id);
  else state.bookmarks.add(id);
  saveSet(STORAGE_KEYS.bookmarks, state.bookmarks);
}

function toggleRead(id) {
  if (state.read.has(id)) state.read.delete(id);
  else state.read.add(id);
  saveSet(STORAGE_KEYS.read, state.read);
}

function bindEvents() {
  $('#search').addEventListener(
    'input',
    debounce((event) => {
      state.query = event.target.value;
      state.limit = PAGE_SIZE;
      renderFeed();
      renderSidebar();
    }),
  );

  $('#catRow').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (chip) setCategory(chip.dataset.cat);
  });

  $('#catStats').addEventListener('click', (event) => {
    const stat = event.target.closest('.stat');
    if (stat) setCategory(stat.dataset.cat);
  });

  $('#langSeg').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-lang]');
    if (!button) return;
    state.lang = button.dataset.lang;
    state.limit = PAGE_SIZE;
    try {
      localStorage.setItem(STORAGE_KEYS.lang, state.lang);
    } catch {
      /* 隐私模式下忽略 */
    }
    render();
  });

  $('#sortSeg').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-sort]');
    if (!button) return;
    state.sort = button.dataset.sort;
    state.limit = PAGE_SIZE;
    render();
  });

  $('#hideRead').addEventListener('change', (event) => {
    state.hideRead = event.target.checked;
    state.limit = PAGE_SIZE;
    render();
  });

  $('#onlyPapers').addEventListener('change', (event) => {
    state.onlyPapers = event.target.checked;
    state.limit = PAGE_SIZE;
    render();
  });

  $('#loadMore').addEventListener('click', () => {
    state.limit += PAGE_SIZE;
    renderFeed();
  });

  $('#calTabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    state.cal.mode = button.dataset.mode;
    $$('#calTabs button').forEach((item) => item.classList.toggle('is-active', item === button));
    renderCalendar();
  });

  $('#calendar').addEventListener('click', (event) => {
    const step = event.target.closest('button[data-step]');
    if (step) {
      const delta = Number(step.dataset.step);
      if (state.cal.mode === 'day') {
        const date = new Date(Date.UTC(state.cal.year, state.cal.month - 1 + delta, 1));
        state.cal.year = date.getUTCFullYear();
        state.cal.month = date.getUTCMonth() + 1;
      } else if (state.cal.mode === 'month') {
        state.cal.year += delta;
      }
      renderCalendar();
      return;
    }
    const day = event.target.closest('button[data-day]');
    if (day && !day.disabled) {
      selectDay(day.dataset.day);
      return;
    }
    const month = event.target.closest('button[data-month]');
    if (month && !month.disabled) {
      state.cal.mode = 'day';
      state.cal.month = Number(month.dataset.month);
      $$('#calTabs button').forEach((item) => item.classList.toggle('is-active', item.dataset.mode === 'day'));
      renderCalendar();
      return;
    }
    const year = event.target.closest('button[data-year]');
    if (year) {
      state.cal.mode = 'month';
      state.cal.year = Number(year.dataset.year);
      $$('#calTabs button').forEach((item) => item.classList.toggle('is-active', item.dataset.mode === 'month'));
      renderCalendar();
    }
  });

  $('#feed').addEventListener('click', (event) => {
    const action = event.target.closest('[data-act]');
    if (!action) return;
    const card = action.closest('.item');
    const id = card?.dataset.id;
    if (!id) return;
    const kind = action.dataset.act;

    if (kind === 'open') {
      toggleRead(id);
      card.classList.add('is-read');
      return;
    }
    event.preventDefault();
    if (kind === 'save') {
      toggleBookmark(id);
      const saved = state.bookmarks.has(id);
      action.classList.toggle('is-on', saved);
      action.innerHTML = `${saved ? '★' : '☆'}<span> 收藏</span>`;
      toast(saved ? '已加入收藏' : '已取消收藏');
      updateNav();
    } else if (kind === 'read') {
      toggleRead(id);
      const read = state.read.has(id);
      card.classList.toggle('is-read', read);
      action.classList.toggle('is-on', read);
      action.innerHTML = `${read ? '✓' : '○'}<span> 已读</span>`;
    } else if (kind === 'copy') {
      const url = action.closest('.item')?.querySelector('.item-title a')?.href || '';
      navigator.clipboard?.writeText(url).then(
        () => toast('链接已复制'),
        () => toast('复制失败，请手动复制'),
      );
    }
  });

  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const kind = action.dataset.action;
    if (kind === 'theme') {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    } else if (kind === 'about') {
      renderAbout();
      $('#aboutDialog').showModal?.();
    } else if (kind === 'reset') {
      state.category = 'all';
      state.lang = 'zh';
      state.sort = 'time';
      state.query = '';
      state.hideRead = false;
      state.onlyPapers = false;
      state.day = null;
      state.view = 'all';
      state.limit = PAGE_SIZE;
      $('#search').value = '';
      try {
        localStorage.setItem(STORAGE_KEYS.lang, state.lang);
      } catch {
        /* 忽略 */
      }
      render();
    } else if (kind === 'menu') {
      const nav = $('#nav');
      const open = nav.classList.toggle('is-open');
      action.setAttribute('aria-expanded', String(open));
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) {
      event.preventDefault();
      $('#search').focus();
    }
    if (event.key === 'Escape') {
      $('#nav').classList.remove('is-open');
      if (document.activeElement === $('#search')) {
        $('#search').value = '';
        state.query = '';
        renderFeed();
      }
    }
  });

  window.addEventListener('hashchange', applyRoute);
}

/* --------------------------------------------------------------- 启动 */

async function main() {
  initTheme();
  state.read = loadSet(STORAGE_KEYS.read);
  state.bookmarks = loadSet(STORAGE_KEYS.bookmarks);
  try {
    const savedLang = localStorage.getItem(STORAGE_KEYS.lang);
    if (savedLang === 'zh' || savedLang === 'en' || savedLang === 'all') state.lang = savedLang;
  } catch {
    /* 忽略 */
  }
  bindEvents();

  $('#feed').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';

  try {
    await loadData();
  } catch (error) {
    $('#feed').innerHTML = '';
    $('#hero').hidden = true;
    const empty = $('#empty');
    empty.hidden = false;
    empty.innerHTML =
      location.protocol === 'file:'
        ? '<b>需要通过本地服务打开</b>浏览器直接打开文件时无法读取 <code>data/news.json</code>。<br />请在项目目录执行 <code>npm run dev</code>，然后访问 http://127.0.0.1:5173'
        : `<b>数据加载失败</b>${escapeHtml(error.message)}<br />可先执行 <code>npm run fetch</code> 生成数据。`;
    return;
  }

  applyRouteState(true);
  render();
}

main();