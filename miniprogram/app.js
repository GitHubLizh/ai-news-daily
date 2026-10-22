/* =============================================================================
 * AI 资讯速递小程序 — 全局逻辑（分页版）
 * 数据集在 App 层按页加载，四个页面通过 onDataset 订阅；
 * onShow 时校验更新（最小间隔 2 分钟，对照 web 版 refresh.mjs 的语义）。
 * ========================================================================== */

import { fetchByIds, fetchFirstPage, fetchNextPage, getCachedData } from './utils/store.js';

const MIN_GAP_MS = 2 * 60 * 1000;

App({
  globalData: {
    data: null,
    pendingDay: null, // 归档页点某天 → 最新页切到「这天」
  },
  listeners: new Set(),
  lastCheckedAt: 0,
  loadError: '',
  loadingMore: false,

  onLaunch() {
    if (wx.cloud) {
      // 保持占位符时使用「默认环境」（云开发控制台里的第一个环境）；
      // 有多个环境时，把下面的值换成目标环境 ID（云开发控制台 → 环境 → 环境 ID）
      const env = 'YOUR_CLOUD_ENV_ID';
      wx.cloud.init({
        ...(env === 'YOUR_CLOUD_ENV_ID' ? {} : { env }),
        traceUser: false,
      });
    }
    this.refresh(true);
  },

  /** 订阅数据集：fn({ data, error })，返回取消函数 */
  onDataset(fn) {
    this.listeners.add(fn);
    if (this.globalData.data) fn({ data: this.globalData.data, error: '' });
    else if (this.loadError) fn({ data: null, error: this.loadError });
    return () => this.listeners.delete(fn);
  },

  refresh(force = false) {
    const now = Date.now();
    if (!force && now - this.lastCheckedAt < MIN_GAP_MS) return;
    this.lastCheckedAt = now;

    const cached = getCachedData();
    if (cached && !this.globalData.data) this.publish(cached);

    fetchFirstPage()
      .then((fresh) => {
        if (!fresh.items.length) return; // 空数据一律不覆盖
        this.loadError = '';
        if (!this.globalData.data || fresh.generatedAt !== this.globalData.data.generatedAt) {
          this.publish(fresh);
        }
      })
      .catch((error) => {
        if (!this.globalData.data) {
          this.loadError = (error && error.message) || '数据加载失败';
          this.emit({ data: null, error: this.loadError });
        }
      });
  },

  /** 最新页触底：拉下一页并广播（数据在途中被更新时返回 false，由 refresh 兜底） */
  async loadMore() {
    const data = this.globalData.data;
    if (!data || !data.hasMore || this.loadingMore) return false;
    this.loadingMore = true;
    try {
      await fetchNextPage(data);
      this.publish(data);
      return true;
    } catch {
      return false;
    } finally {
      this.loadingMore = false;
    }
  },

  /** 统计页需要全量分布：循环拉到没有下一页（每次 publish 都会触发订阅方重渲染） */
  async loadAll() {
    while (this.globalData.data && this.globalData.data.hasMore) {
      const ok = await this.loadMore();
      if (!ok) break;
    }
  },

  /** 收藏页：按 id 补取未加载的条目 */
  fetchMissing(ids) {
    return fetchByIds(ids);
  },

  publish(data) {
    this.globalData.data = data;
    this.emit({ data, error: '' });
  },

  emit(payload) {
    this.listeners.forEach((fn) => fn(payload));
  },
});
