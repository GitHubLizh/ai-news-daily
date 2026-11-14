/* 免费与优惠页：渠道数据集（平台直连 + 定向搜索 + 资讯识别）。
   对照 web 版 #/deals 视图：类型芯片替代分类芯片，卡片标签显示「免费使用 / 优惠购买」，
   按天分组；已读 / 收藏与资讯流共用存储（条目 id 由 URL 派生，同一篇文章天然同 id）。 */

import { dayLabelOf, todayKey } from '../../utils/time.js';
import { STORAGE_KEYS, decorate, fetchDeals, getCachedDeals, loadSet, saveSet } from '../../utils/store.js';

const PAGE_SIZE = 40;
const DEAL_TYPE_LABELS = { free: '免费使用', discount: '优惠购买' };

Page({
  data: {
    loading: true,
    error: '',
    chips: [],
    query: '',
    scopeText: '',
    totalText: '',
    metaText: '',
    groups: [],
    hasMore: false,
    moreText: '',
    emptyShow: false,
    emptyTitle: '',
    emptyDesc: '',
    backTopVisible: false,
  },

  dataset: null,
  state: { dealType: 'all', limit: PAGE_SIZE },
  read: new Set(),
  bookmarks: new Set(),
  searchTimer: null,

  onPageScroll({ scrollTop }) {
    const backTopVisible = scrollTop > 600;
    if (backTopVisible !== this.data.backTopVisible) this.setData({ backTopVisible });
  },

  onLoad() {
    this.read = loadSet(STORAGE_KEYS.read);
    this.bookmarks = loadSet(STORAGE_KEYS.bookmarks);
    const cached = getCachedDeals();
    if (cached) {
      this.dataset = cached;
      this.setData({ loading: false });
      this.render();
    }
    this.load();
  },

  onShow() {
    // 其它页可能改过收藏/已读，重新同步一次
    this.read = loadSet(STORAGE_KEYS.read);
    this.bookmarks = loadSet(STORAGE_KEYS.bookmarks);
    if (this.dataset) this.render();
  },

  onShareAppMessage() {
    return {
      title: '免费与优惠 · AI 资讯速递',
      path: '/pages/deals/deals',
    };
  },

  onShareTimeline() {
    return {
      title: '免费与优惠 · AI 资讯速递',
    };
  },

  load() {
    fetchDeals()
      .then((dataset) => {
        this.dataset = dataset;
        this.setData({ loading: false, error: '' });
        this.render();
      })
      .catch((error) => {
        // 有缓存兜底时保留已渲染内容，只在完全没数据时展示错误
        if (!this.dataset) {
          this.setData({ loading: false, error: (error && error.message) || '数据加载失败' });
        }
      });
  },

  onRetry() {
    this.setData({ loading: true, error: '' });
    this.load();
  },

  filteredItems() {
    if (!this.dataset) return [];
    let items = this.dataset.items;
    if (this.state.dealType !== 'all') {
      items = items.filter((item) => item.dealType === this.state.dealType);
    }
    const keyword = this.data.query.trim().toLowerCase();
    if (keyword) {
      items = items.filter((item) =>
        `${item.title} ${item.summary} ${item.source} ${(item.alsoIn || []).join(' ')}`.toLowerCase().includes(keyword),
      );
    }
    return items;
  },

  render() {
    if (!this.dataset) return;
    this.renderChips();
    this.renderFeed();
  },

  renderChips() {
    // 类型计数不受已选类型影响（与 web 版 ignoreDealType 口径一致）
    const pool = this.dataset.items;
    const chips = [
      { key: 'all', name: '全部', count: pool.length, active: this.state.dealType === 'all' },
      ...Object.entries(DEAL_TYPE_LABELS).map(([key, name]) => ({
        key,
        name,
        count: pool.filter((item) => item.dealType === key).length,
        active: this.state.dealType === key,
      })),
    ];
    this.setData({ chips });
  },

  renderFeed() {
    const items = this.filteredItems();
    const parts = [`共 ${items.length} 条`];
    if (this.data.query) parts.push(`关键词“${this.data.query}”`);
    if (this.state.dealType !== 'all') parts.push(DEAL_TYPE_LABELS[this.state.dealType]);

    // 数据概览（对照 web 版「渠道数据概览」）
    const kinds = Object.fromEntries(
      ((this.dataset.stats && this.dataset.stats.kinds) || []).map((entry) => [entry.name, entry.count]),
    );
    const metaText = `条目 ${this.dataset.count} 条 · 覆盖 ${this.dataset.days.length} 天 · 平台直连 ${kinds.platform || 0} · 定向搜索 ${kinds.search || 0} · 资讯识别 ${kinds.news || 0}`;

    if (!items.length) {
      this.setData({
        scopeText: '免费 / 优惠大模型渠道 · 按日归档',
        totalText: parts.join(' · '),
        metaText,
        groups: [],
        hasMore: false,
        emptyShow: true,
        emptyTitle: '没有符合条件的优惠',
        emptyDesc: '试试放宽筛选条件，或切换类型 / 关键词。',
      });
      return;
    }

    const visible = items.slice(0, this.state.limit);
    const today = todayKey();
    const map = new Map();
    for (const item of items) {
      if (!map.has(item.day)) map.set(item.day, []);
      map.get(item.day).push(item);
    }
    let remaining = this.state.limit;
    const groups = [];
    for (const [day, list] of map.entries()) {
      if (remaining <= 0) break;
      const taken = list.slice(0, remaining);
      remaining -= taken.length;
      groups.push({
        key: day,
        label: dayLabelOf(day, this.dataset.days),
        day,
        isToday: day === today,
        total: list.length,
        items: taken,
      });
    }

    const now = Date.now();
    for (const group of groups) {
      group.items = group.items.map((item) => ({
        ...decorate(item, now),
        category: DEAL_TYPE_LABELS[item.dealType] || item.category,
        isRead: this.read.has(item.id),
        isSaved: this.bookmarks.has(item.id),
      }));
      group.countText =
        group.items.length < group.total ? `显示 ${group.items.length} / 共 ${group.total} 条` : `${group.total} 条`;
    }

    this.setData({
      scopeText: '免费 / 优惠大模型渠道 · 按日归档',
      totalText: parts.join(' · '),
      metaText,
      groups,
      hasMore: items.length > this.state.limit,
      moreText: `加载更多（还有 ${items.length - this.state.limit} 条）`,
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
      this.render();
    }, 180);
  },

  onChipTap(event) {
    const key = event.currentTarget.dataset.type;
    this.state.dealType = this.state.dealType === key ? 'all' : key;
    this.state.limit = PAGE_SIZE;
    this.render();
  },

  onReachBottom() {
    if (this.filteredItems().length > this.state.limit) {
      this.state.limit += PAGE_SIZE;
      this.renderFeed();
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
    if (!event.detail.url) return;
    wx.setClipboardData({ data: event.detail.url });
  },
});

/** 进入阅读页（小程序内读正文，由 article 云函数提取） */
function openReader(url, title, source) {
  if (!url) return;
  const query = `url=${encodeURIComponent(url)}&title=${encodeURIComponent(title || '')}&source=${encodeURIComponent(source || '')}`;
  wx.navigateTo({ url: `/pages/reader/reader?${query}` });
}
