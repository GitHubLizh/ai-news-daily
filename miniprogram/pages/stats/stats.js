/* 统计页：分类分布 / 来源分布 / 热度榜 / 数据概览 / 关于（对照 web 版 renderSidebar + renderAbout） */

import { countByCategory } from '../../utils/filters.js';
import { shortDateTime } from '../../utils/time.js';

const app = getApp();

Page({
  data: {
    ready: false,
    catStats: [],
    srcStats: [],
    hotList: [],
    meta: null,
    sources: [],
  },

  sourceHome: new Map(),
  unsubscribe: null,

  onLoad() {
    this.unsubscribe = app.onDataset(({ data }) => {
      if (!data) return;
      this.sourceHome = new Map(
        data.items.filter((item) => item.source && item.home).map((item) => [item.source, item.home]),
      );
      this.setData({ ready: true });
      this.render(data);
      // 分布统计需要全量：数据是分页加载的，打开本页时后台补齐，补齐过程会自动重渲染
      if (data.hasMore && !this.loadingAll) {
        this.loadingAll = true;
        app.loadAll().finally(() => {
          this.loadingAll = false;
        });
      }
    });
  },

  onShow() {
    app.refresh();
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  render(data) {
    const items = data.items;

    // 分类分布
    const catCounts = countByCategory(items);
    const catMax = Math.max(1, ...catCounts.values());
    const catStats = [...catCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, width: Math.round((count / catMax) * 100) }));

    // 来源分布 TOP 8
    const srcCounts = new Map();
    for (const item of items) srcCounts.set(item.source, (srcCounts.get(item.source) || 0) + 1);
    const srcMax = Math.max(1, ...srcCounts.values());
    const srcStats = [...srcCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count, width: Math.round((count / srcMax) * 100) }));

    // 热度榜 TOP 10
    const hotList = [...items]
      .sort((a, b) => b.hot - a.hot || b.publishedTs - a.publishedTs)
      .slice(0, 10)
      .map((item, index) => ({
        rank: index + 1,
        title: item.title,
        meta: `${item.source} · 热度 ${item.hot}`,
        url: item.url,
        source: item.source,
      }));

    // 数据概览
    const estimated = (data.stats && data.stats.estimatedTime) || 0;
    const meta = {
      count: data.count,
      days: (data.days || []).length,
      zh: data.stats && data.stats.languages ? data.stats.languages.zh : 0,
      en: data.stats && data.stats.languages ? data.stats.languages.en : 0,
      generatedAt: shortDateTime(new Date(data.generatedAt).getTime()),
      estimated,
      partial: data.hasMore ? `统计基于已加载 ${data.items.length} / ${data.total} 条，正在补齐…` : '',
    };

    // 来源清单（关于区块）
    const sources = ((data.stats && data.stats.sources) || [])
      .slice(0, 40)
      .map((entry) => ({ name: entry.name, count: entry.count }));

    this.setData({ catStats, srcStats, hotList, meta, sources });
  },

  copy(url) {
    if (url) wx.setClipboardData({ data: url });
  },

  onHotTap(event) {
    const { url, title, source } = event.currentTarget.dataset;
    if (!url) return;
    const query = `url=${encodeURIComponent(url)}&title=${encodeURIComponent(title || '')}&source=${encodeURIComponent(source || '')}`;
    wx.navigateTo({ url: `/pages/reader/reader?${query}` });
  },

  onSourceTap(event) {
    const name = event.currentTarget.dataset.name;
    this.copy(this.sourceHome.get(name) || '');
    if (!this.sourceHome.get(name)) wx.showToast({ title: '该来源没有主页链接', icon: 'none' });
  },

  onAboutSourceTap(event) {
    const name = event.currentTarget.dataset.name;
    const home = this.sourceHome.get(name);
    if (home) this.copy(home);
    else wx.showToast({ title: '该来源没有主页链接', icon: 'none' });
  },

  onCopyRss() {
    wx.setClipboardData({ data: 'https://latestainews.cn/data/feed.xml' });
  },

  onCopySite() {
    wx.setClipboardData({ data: 'https://latestainews.cn/' });
  },
});
