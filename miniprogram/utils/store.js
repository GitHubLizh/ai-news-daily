/* =============================================================================
 * AI 资讯速递小程序 — 本地存储与数据加载（分页版）
 * 依赖 wx.* API，仅供小程序内使用；纯逻辑见 filters.js / time.js。
 *
 * 数据集分片加载：首包只取第 1 页（200 条），触底再翻页；meta 随每页返回。
 * 本地缓存的是「已加载的切片拼起来的数据集」，冷启动先渲染它再向云函数校验。
 * ========================================================================== */

import { relativeTime } from './time.js';

export const STORAGE_KEYS = {
  read: 'ainews.read',
  bookmarks: 'ainews.bookmarks',
  lang: 'ainews.lang',
  data: 'ainews.data',
};

/** 服务端分页粒度（与 cloudfunctions/news/paginate.mjs 的默认值一致） */
export const SERVER_PAGE_SIZE = 200;

export function loadSet(key) {
  try {
    const raw = wx.getStorageSync(key);
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

export function saveSet(key, set) {
  try {
    wx.setStorageSync(key, [...set]);
  } catch {
    /* 忽略 */
  }
}

export function loadLang() {
  try {
    const value = wx.getStorageSync(STORAGE_KEYS.lang);
    return ['zh', 'en', 'all'].includes(value) ? value : 'zh';
  } catch {
    return 'zh';
  }
}

export function saveLang(lang) {
  try {
    wx.setStorageSync(STORAGE_KEYS.lang, lang);
  } catch {
    /* 忽略 */
  }
}

/** 上次成功拉取的数据集缓存（兼容旧版全量缓存：补 pagesLoaded/hasMore 字段） */
export function getCachedData() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEYS.data);
    if (!raw || !Array.isArray(raw.items) || !raw.items.length) return null;
    if (!Number.isInteger(raw.pagesLoaded)) {
      raw.pagesLoaded = Math.max(1, Math.ceil(raw.items.length / SERVER_PAGE_SIZE));
      raw.hasMore = false; // 旧版缓存就是全量
      raw.total = raw.count || raw.items.length;
    }
    return raw;
  } catch {
    return null;
  }
}

async function callNews(payload) {
  const response = await wx.cloud.callFunction({ name: 'news', data: payload });
  const data = response && response.result;
  if (!data || !Array.isArray(data.items)) {
    throw new Error((data && data.message) || '数据格式不正确');
  }
  return data;
}

function persist(dataset) {
  try {
    wx.setStorageSync(STORAGE_KEYS.data, dataset);
  } catch {
    /* 缓存写不进去不致命 */
  }
}

/** 首包：第 1 页 + meta */
export async function fetchFirstPage() {
  const payload = await callNews({ page: 0, pageSize: SERVER_PAGE_SIZE });
  const dataset = {
    generatedAt: payload.generatedAt,
    timezone: payload.timezone,
    count: payload.count,
    days: payload.days,
    stats: payload.stats,
    total: payload.total,
    items: payload.items,
    pagesLoaded: 1,
    hasMore: Boolean(payload.hasMore),
  };
  persist(dataset);
  return dataset;
}

/** 翻页：把下一页追加进数据集（上游若已更新则抛错，由调用方走整体刷新） */
export async function fetchNextPage(dataset) {
  const payload = await callNews({ page: dataset.pagesLoaded, pageSize: SERVER_PAGE_SIZE });
  if (payload.generatedAt !== dataset.generatedAt) throw new Error('数据已更新');
  dataset.items = dataset.items.concat(payload.items);
  dataset.pagesLoaded += 1;
  dataset.hasMore = Boolean(payload.hasMore);
  persist(dataset);
  return dataset;
}

/** 按 id 补取（收藏页解析本地收藏 id → 条目） */
export async function fetchByIds(ids) {
  if (!ids.length) return [];
  const payload = await callNews({ ids });
  return payload.items;
}

/** 列表渲染前补展示字段（WXML 里不能调函数），与 app.js 的渲染口径一致 */
export function decorate(item, now = Date.now()) {
  return {
    ...item,
    timeText: relativeTime(item.publishedTs, now),
    alsoInText: item.alsoIn && item.alsoIn.length ? item.alsoIn.slice(0, 2).join('、') : '',
  };
}
