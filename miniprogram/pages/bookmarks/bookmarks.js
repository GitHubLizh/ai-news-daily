/* 收藏页：本地收藏的资讯列表（对照 web 版 bookmarks 视图） */

import { STORAGE_KEYS, decorate, loadSet, saveSet } from '../../utils/store.js';

const app = getApp();

Page({
  data: {
    ready: false,
    items: [],
    total: 0,
  },

  read: new Set(),
  bookmarks: new Set(),
  unsubscribe: null,

  onLoad() {
    this.unsubscribe = app.onDataset(({ data }) => {
      if (!data) return;
      this.setData({ ready: true });
      this.render();
    });
  },

  onShow() {
    // 其它页可能增删过收藏，回来自动同步
    this.read = loadSet(STORAGE_KEYS.read);
    this.bookmarks = loadSet(STORAGE_KEYS.bookmarks);
    if (app.globalData.data) this.render();
    app.refresh();
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  async render() {
    const data = app.globalData.data;
    if (!data) return;
    // 数据是分页加载的，收藏夹里可能有还没加载到的旧条目，按 id 向云函数补取
    const byId = new Map(data.items.map((item) => [item.id, item]));
    const missing = [...this.bookmarks].filter((id) => !byId.has(id));
    if (missing.length) {
      try {
        for (const item of await app.fetchMissing(missing)) byId.set(item.id, item);
      } catch {
        /* 网络失败时先显示已加载的部分 */
      }
    }
    const items = [...this.bookmarks]
      .map((id) => byId.get(id))
      .filter(Boolean)
      .sort((a, b) => b.publishedTs - a.publishedTs);
    const now = Date.now();
    this.setData({
      total: items.length,
      items: items.map((item) => ({
        ...decorate(item, now),
        isRead: this.read.has(item.id),
        isSaved: true,
      })),
    });
  },

  onItemOpen(event) {
    const { id, url, title, source } = event.detail;
    if (!this.read.has(id)) {
      this.read.add(id);
      saveSet(STORAGE_KEYS.read, this.read);
      this.render();
    }
    if (url) {
      const query = `url=${encodeURIComponent(url)}&title=${encodeURIComponent(title || '')}&source=${encodeURIComponent(source || '')}`;
      wx.navigateTo({ url: `/pages/reader/reader?${query}` });
    }
  },

  onItemSave(event) {
    const { id } = event.detail;
    this.bookmarks.delete(id);
    saveSet(STORAGE_KEYS.bookmarks, this.bookmarks);
    wx.showToast({ title: '已取消收藏', icon: 'none' });
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
    if (event.detail.url) wx.setClipboardData({ data: event.detail.url });
  },
});
