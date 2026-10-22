/* 最新页：hero 头条 + 搜索/筛选 + 按天分组资讯流（对照 web 版 renderHero/renderFilters/renderFeed） */

import { countByCategory, heroWindowDays, selectItems } from '../../utils/filters.js';
import { dayLabelOf, todayKey } from '../../utils/time.js';
import { STORAGE_KEYS, decorate, loadLang, loadSet, saveLang, saveSet } from '../../utils/store.js';

const PAGE_SIZE = 40;
const CATEGORIES = ['模型发布', '产品动态', '研究前沿', '行业动态', '开源工具', '观点方法'];

const app = getApp();

Page({
  data: {
    loading: true,
    error: '',
    hero: null,
    chips: [],
    lang: 'zh',
    sort: 'time',
    hideRead: false,
    onlyPapers: false,
    filtersOpen: false,
    filterAdjusted: false,
    query: '',
    scopeText: '',
    totalText: '',
    groups: [],
    hasMore: false,
    moreText: '',
    emptyShow: false,
    emptyTitle: '',
    emptyDesc: '',
    emptyReset: false,
  },

  state: {
    view: 'all',
    day: null,
    category: 'all',
    limit: PAGE_SIZE,
  },
  read: new Set(),
  bookmarks: new Set(),
  unsubscribe: null,
  searchTimer: null,

  onLoad() {
    this.read = loadSet(STORAGE_KEYS.read);
    this.bookmarks = loadSet(STORAGE_KEYS.bookmarks);
    this.setData({ lang: loadLang() });
    this.unsubscribe = app.onDataset(({ data, error }) => {
      if (data) {
        this.setData({ loading: false, error: '' });
        this.render();
      } else if (error) {
        this.setData({ loading: false, error });
      }
    });
  },

  onShow() {
    // 归档页点某天 → 切到「这天」
    if (app.globalData.pendingDay) {
      this.state.view = 'day';
      this.state.day = app.globalData.pendingDay;
      app.globalData.pendingDay = null;
      this.state.limit = PAGE_SIZE;
      if (app.globalData.data) this.render();
    } else {
      // 其它页可能改过收藏/已读，重新同步一次
      this.read = loadSet(STORAGE_KEYS.read);
      this.bookmarks = loadSet(STORAGE_KEYS.bookmarks);
      if (app.globalData.data) this.render();
    }
    app.refresh();
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  scopeOptions(overrides = {}) {
    return {
      view: this.state.view,
      day: this.state.day,
      today: todayKey(),
      category: this.state.category,
      lang: this.data.lang,
      query: this.data.query,
      hideRead: this.data.hideRead,
      onlyPapers: this.data.onlyPapers,
      sort: this.data.sort,
      readIds: this.read,
      bookmarkIds: this.bookmarks,
      ...overrides,
    };
  },

  scopedItems(options = {}) {
    const data = app.globalData.data;
    if (!data) return [];
    return selectItems(data.items, this.scopeOptions(options));
  },

  render() {
    const data = app.globalData.data;
    if (!data) return;
    this.renderHero(data);
    this.renderChips();
    this.renderFeed(data);
  },

  renderHero(data) {
    if (!['all', 'today', 'day'].includes(this.state.view) || !data.items.length) {
      this.setData({ hero: null });
      return;
    }
    const windowDays = heroWindowDays(data.days);
    const todays = data.items.filter((item) => windowDays.includes(item.day));
    const preferred =
      this.data.lang === 'all' ? todays : todays.filter((item) => item.lang === this.data.lang);
    const pool = preferred.length ? preferred : todays;
    const featured = [...pool].sort((a, b) => b.hot - a.hot)[0] || data.items[0];
    this.setData({
      hero: {
        id: featured.id,
        url: featured.url,
        dateLabel: dayLabelOf(featured.day, data.days) + (featured.day === todayKey() ? ' · 今日' : ''),
        title: featured.title,
        summary: featured.summary || '点击查看原文详情。',
        source: featured.source,
        category: featured.category,
        timeText: decorate(featured).timeText,
        day: featured.day,
        dayCount: pool.length,
      },
    });
  },

  renderChips() {
    const base = this.scopedItems({ ignoreCategory: true });
    const counts = countByCategory(base);
    const chips = [
      { key: 'all', name: '全部', count: base.length, active: this.state.category === 'all' },
      ...CATEGORIES.map((name) => ({
        key: name,
        name,
        count: counts.get(name) || 0,
        active: this.state.category === name,
      })),
    ];
    this.setData({
      chips,
      filterAdjusted:
        this.data.lang !== 'zh' || this.data.sort !== 'time' || this.data.hideRead || this.data.onlyPapers,
    });
  },

  renderFeed(data) {
    const items = this.scopedItems();
    const view = this.state.view;
    const scopeText =
      view === 'day' && this.state.day
        ? dayLabelOf(this.state.day, data.days)
        : view === 'today'
          ? `${dayLabelOf(todayKey(), data.days)} · 今天`
          : '全部归档 · 最新在前';

    const parts = [`共 ${items.length} 条`];
    if (this.data.query) parts.push(`关键词“${this.data.query}”`);
    if (this.state.category !== 'all') parts.push(this.state.category);

    if (!items.length) {
      const langScope = this.scopedItems({ ignoreCategory: true });
      const otherLang = langScope.filter((item) => item.lang !== this.data.lang);
      let desc = '试试放宽筛选条件，或切换日期 / 分类。';
      if (this.data.lang !== 'all' && otherLang.length) {
        desc += `\n当前范围还有 ${otherLang.length} 条${this.data.lang === 'zh' ? '英文' : '中文'}资讯，可切换语言查看。`;
      }
      this.setData({
        scopeText,
        totalText: parts.join(' · '),
        groups: [],
        hasMore: false,
        emptyShow: true,
        emptyTitle: '没有符合条件的资讯',
        emptyDesc: desc,
        emptyReset: true,
      });
      return;
    }

    const visible = items.slice(0, this.state.limit);
    const today = todayKey();
    let groups;
    if (this.data.sort === 'hot') {
      groups = [{ key: 'hot', label: '热度排序', day: '', isToday: false, total: items.length, items: visible }];
    } else {
      const map = new Map();
      for (const item of items) {
        if (!map.has(item.day)) map.set(item.day, []);
        map.get(item.day).push(item);
      }
      let remaining = this.state.limit;
      groups = [];
      for (const [day, list] of map.entries()) {
        if (remaining <= 0) break;
        const taken = list.slice(0, remaining);
        remaining -= taken.length;
        groups.push({ key: day, label: dayLabelOf(day, data.days), day, isToday: day === today, total: list.length, items: taken });
      }
    }

    const now = Date.now();
    for (const group of groups) {
      group.items = group.items.map((item) => ({
        ...decorate(item, now),
        isRead: this.read.has(item.id),
        isSaved: this.bookmarks.has(item.id),
      }));
      group.countText =
        group.items.length < group.total ? `显示 ${group.items.length} / 共 ${group.total} 条` : `${group.total} 条`;
    }

    const serverHasMore = Boolean(data.hasMore);
    const clientHasMore = items.length > this.state.limit;
    this.setData({
      scopeText,
      totalText: parts.join(' · '),
      groups,
      hasMore: clientHasMore || serverHasMore,
      moreText: clientHasMore ? `加载更多（还有 ${items.length - this.state.limit} 条）` : '加载更多',
      emptyShow: false,
    });
  },

  /* ---------------------------------------------------------- 事件 */

  onSearchInput(event) {
    clearTimeout(this.searchTimer);
    const value = event.detail.value;
    this.searchTimer = setTimeout(() => {
      this.setData({ query: value });
      this.state.limit = PAGE_SIZE;
      if (app.globalData.data) {
        this.renderChips();
        this.renderFeed(app.globalData.data);
      }
    }, 180);
  },

  onChipTap(event) {
    const key = event.currentTarget.dataset.cat;
    this.state.category = this.state.category === key ? 'all' : key;
    this.state.limit = PAGE_SIZE;
    this.render();
  },

  onLangTap(event) {
    const lang = event.currentTarget.dataset.lang;
    this.setData({ lang });
    saveLang(lang);
    this.state.limit = PAGE_SIZE;
    this.render();
  },

  onSortTap(event) {
    this.setData({ sort: event.currentTarget.dataset.sort });
    this.state.limit = PAGE_SIZE;
    this.render();
  },

  onHideReadChange(event) {
    this.setData({ hideRead: event.detail.value });
    this.state.limit = PAGE_SIZE;
    this.render();
  },

  onPapersChange(event) {
    this.setData({ onlyPapers: event.detail.value });
    this.state.limit = PAGE_SIZE;
    this.render();
  },

  onToggleFilters() {
    this.setData({ filtersOpen: !this.data.filtersOpen });
  },

  onResetFilters() {
    this.state.view = 'all';
    this.state.day = null;
    this.state.category = 'all';
    this.state.limit = PAGE_SIZE;
    this.setData({ lang: 'zh', sort: 'time', query: '', hideRead: false, onlyPapers: false });
    saveLang('zh');
    this.render();
  },

  onHeroDayTap(event) {
    this.state.view = 'day';
    this.state.day = event.currentTarget.dataset.day;
    this.state.limit = PAGE_SIZE;
    this.render();
  },

  /** 点头条标题/摘要：与列表卡片一致，标记已读并进阅读页 */
  onHeroOpen() {
    const hero = this.data.hero;
    if (!hero || !hero.url) return;
    if (!this.read.has(hero.id)) {
      this.read.add(hero.id);
      saveSet(STORAGE_KEYS.read, this.read);
      this.render();
    }
    openReader(hero.url, hero.title, hero.source);
  },

  onDayOnlyTap(event) {
    this.state.view = 'day';
    this.state.day = event.currentTarget.dataset.day;
    this.state.limit = PAGE_SIZE;
    this.render();
  },

  onBackAll() {
    this.state.view = 'all';
    this.state.day = null;
    this.state.limit = PAGE_SIZE;
    this.render();
  },

  onReachBottom() {
    const data = app.globalData.data;
    if (!data) return;
    // 先消化客户端已加载的条目（每次 40 条）；已加载的都看完了再向服务端翻页
    if (this.scopedItems().length > this.state.limit) {
      this.state.limit += PAGE_SIZE;
      this.renderFeed(data);
    } else if (data.hasMore) {
      app.loadMore();
    }
  },

  /* ---------------------------------------------------- 卡片操作 */

  onItemOpen(event) {
    const { id, url, title, source } = event.detail;
    if (!this.read.has(id)) {
      this.read.add(id);
      saveSet(STORAGE_KEYS.read, this.read);
      this.render();
    }
    openReader(url, title, source);
  },

  onItemSave(event) {
    const { id } = event.detail;
    if (this.bookmarks.has(id)) this.bookmarks.delete(id);
    else this.bookmarks.add(id);
    saveSet(STORAGE_KEYS.bookmarks, this.bookmarks);
    wx.showToast({ title: this.bookmarks.has(id) ? '已加入收藏' : '已取消收藏', icon: 'none' });
    this.render();
  },

  onItemRead(event) {
    const { id } = event.detail;
    if (this.read.has(id)) this.read.delete(id);
    else this.read.add(id);
    saveSet(STORAGE_KEYS.read, this.read);
    this.render();
  },

  onItemCopy(event) {
    this.copyLink(event.detail.url);
  },

  copyLink(url) {
    if (!url) return;
    wx.setClipboardData({ data: url });
  },
});

/** 进入阅读页（小程序内读正文，由 article 云函数提取） */
function openReader(url, title, source) {
  if (!url) return;
  const query = `url=${encodeURIComponent(url)}&title=${encodeURIComponent(title || '')}&source=${encodeURIComponent(source || '')}`;
  wx.navigateTo({ url: `/pages/reader/reader?${query}` });
}
