/* =============================================================================
 * 云函数 news：小程序数据中转（分页版）
 *
 * 正式版小程序的 request 合法域名必须 ICP 备案，而 latestainews.cn 是刻意的
 * 香港免备案域名；云函数访问外网不受域名白名单限制，所以由它代为拉取。
 *
 * 拉取后裁掉页面用不到的字段并整体缓存在实例内存里（TTL 5 分钟）——
 * 翻页请求打的是缓存切片，不会每次都去上游重抓 1.7MB。
 *
 * 入参：{ page?, pageSize? } 分页（默认 0 / 200）；{ ids: [] } 按 id 补取。
 * 返回：{ generatedAt, timezone, count, days, stats, total, items, hasMore, page?, pageSize? }
 * ========================================================================== */

const https = require('https');

const SOURCE_URL = 'https://latestainews.cn/data/news.json';
const TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** 页面用不到的字段（author / sourceId / weight / publishedAt），约省 20~30% 体积 */
const DROP_FIELDS = new Set(['author', 'sourceId', 'weight', 'publishedAt']);

/** 实例内缓存：{ at, data }，同一实例在 TTL 内复用上游抓取结果 */
let cache = { at: 0, data: null };

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { 'User-Agent': 'ai-news-miniprogram/1.0' }, timeout: TIMEOUT_MS },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('数据格式不正确'));
          }
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('请求超时')));
    request.on('error', reject);
  });
}

async function getDataset() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_TTL_MS) return cache.data;

  const raw = await fetchJson(SOURCE_URL);
  if (!Array.isArray(raw.items)) throw new Error('数据格式不正确');
  const data = {
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
  cache = { at: now, data };
  return data;
}

exports.main = async (event) => {
  const dataset = await getDataset();
  const { respond } = await import('./paginate.mjs');
  return respond(dataset, event || {});
};
