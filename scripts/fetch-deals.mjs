#!/usr/bin/env node
/**
 * 聚合「免费使用 / 优惠购买大模型」的渠道数据，写入 data/deals.json。
 * 用法：npm run fetch:deals
 * 参数：--dry 只打印统计不写文件
 *
 * 三路来源（详见 scripts/lib/deals.mjs）：
 *   1. 平台直连：OpenRouter 公开模型清单中的免费模型（每日快照 + 近 7 天新增）
 *   2. 定向资讯：Google News RSS 按关键词搜索，detectDealType 过滤
 *   3. 资讯流水线：data/news.json 中带 dealType 标记的条目
 *
 * 容错口径：OpenRouter 或搜索源失败只影响当次，资讯流水线来源离线可用；
 * 三路全空才视为失败（exit 1）。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFeed } from './lib/rss.mjs';
import {
  ALIYUN_BAILIAN_FREE_URL,
  ALIYUN_TOKENPLAN_URL,
  BIGMODEL_PROMOTION_URL,
  SEARCH_FEED_META,
  SEARCH_QUERIES,
  SILICONFLOW_PRICING_URL,
  VOLCENGINE_DISCOUNT_PAGES,
  VOLCENGINE_DOC_BASE,
  aliyunBailianFreeQuota,
  aliyunTokenPlanRaws,
  bigModelPromotionRaws,
  buildDealsDataset,
  dealsFromSearchItems,
  googleNewsUrl,
  newsItemsToDealRaws,
  openRouterFreeModels,
  siliconFlowFreeModels,
  volcEngineDiscountRaws,
} from './lib/deals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FEEDS_FILE = path.join(ROOT, 'data', 'feeds.json');
const NEWS_FILE = path.join(ROOT, 'data', 'news.json');
const OUTPUT_FILE = path.join(ROOT, 'data', 'deals.json');

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const TIMEOUT_MS = 25000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;
const CONCURRENCY = 3;

const dryRun = process.argv.slice(2).includes('--dry');

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestText(url, userAgent, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': userAgent, accept },
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 网络类错误最多重试 3 次，与 fetch-news 的口径一致 */
async function withRetry(label, worker) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);
    try {
      return await worker();
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable || error?.name === 'AbortError' || error?.name === 'TypeError';
      if (!retryable) break;
    }
  }
  console.log(`  ⚠️ ${label} 抓取失败：${lastError?.message || lastError}（跳过，不影响其它来源）`);
  return null;
}

async function fetchOpenRouter(userAgent) {
  const json = await withRetry('OpenRouter', async () => {
    const text = await requestText(OPENROUTER_MODELS_URL, userAgent, 'application/json');
    return JSON.parse(text);
  });
  if (!json) return null;
  const free = (json.data || []).filter((model) => String(model?.id || '').endsWith(':free'));
  console.log(`  ✅ OpenRouter：共 ${json.data?.length ?? 0} 个模型，其中免费 ${free.length} 个`);
  return json;
}

/** 抓取火山方舟两个折扣活动页（SSR HTML），解析出当前进行中的模型折扣 */
async function fetchVolcEngine(userAgent) {
  const raws = [];
  for (const page of VOLCENGINE_DISCOUNT_PAGES) {
    const html = await withRetry(page.planName, async () =>
      requestText(VOLCENGINE_DOC_BASE + page.path, userAgent, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'),
    );
    if (!html) continue;
    const items = volcEngineDiscountRaws(html, {
      now: Date.now(),
      planName: page.planName,
      pageUrl: VOLCENGINE_DOC_BASE + page.path,
    });
    console.log(`  ${items.length ? '✅' : '⚠️'} ${page.planName}：当前进行中的模型折扣 ${items.length} 个`);
    raws.push(...items);
  }
  return raws;
}

/** 抓取智谱「上新活动」页，解析出在售的 Coding Plan / 资源包优惠 */
async function fetchBigModel(userAgent) {
  const html = await withRetry('智谱 BigModel', async () =>
    requestText(BIGMODEL_PROMOTION_URL, userAgent, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'),
  );
  if (!html) return [];
  const items = bigModelPromotionRaws(html, { now: Date.now() });
  console.log(`  ${items.length ? '✅' : '⚠️'} 智谱 BigModel：在售渠道活动 ${items.length} 个`);
  return items;
}

/** 抓取硅基流动定价页，解析出当前免费开放的模型 */
async function fetchSiliconFlow(userAgent) {
  const html = await withRetry('硅基流动', async () =>
    requestText(SILICONFLOW_PRICING_URL, userAgent, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'),
  );
  if (!html) return [];
  const { models, snapshot } = siliconFlowFreeModels(html, { now: Date.now() });
  console.log(`  ${models.length ? '✅' : '⚠️'} 硅基流动：免费模型 ${models.length} 个`);
  return snapshot ? [snapshot] : [];
}

/** 阿里云两路：百炼新人免费额度（政策页）+ Token Plan 活动页 */
async function fetchAliyun(userAgent) {
  const raws = [];
  const bailianHtml = await withRetry('阿里云百炼', async () =>
    requestText(ALIYUN_BAILIAN_FREE_URL, userAgent, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'),
  );
  if (bailianHtml) {
    const items = aliyunBailianFreeQuota(bailianHtml, { now: Date.now() });
    console.log(`  ${items.length ? '✅' : '⚠️'} 阿里云百炼：新人免费额度政策 ${items.length ? '在线' : '标记缺失（页面可能改版）'}`);
    raws.push(...items);
  }
  const tokenPlanHtml = await withRetry('阿里云 Token Plan', async () =>
    requestText(ALIYUN_TOKENPLAN_URL, userAgent, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'),
  );
  if (tokenPlanHtml) {
    const items = aliyunTokenPlanRaws(tokenPlanHtml, { now: Date.now() });
    console.log(`  ${items.length ? '✅' : '⚠️'} 阿里云 Token Plan：在售优惠 ${items.length} 条`);
    raws.push(...items);
  }
  return raws;
}

async function fetchSearchFeed(query, userAgent) {
  return withRetry(`搜索「${query}」`, async () => {
    const xml = await requestText(
      googleNewsUrl(query),
      userAgent,
      'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
    );
    const parsed = parseFeed(xml, SEARCH_FEED_META);
    if (!parsed.length) throw new Error('解析到 0 条（可能不是有效 feed）');
    return parsed;
  });
}

async function mapLimit(list, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(list[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const config = await readJson(FEEDS_FILE);
  if (!config?.timezone) throw new Error(`未找到源配置：${FEEDS_FILE}`);
  const userAgent = config.userAgent;
  const news = await readJson(NEWS_FILE, { items: [] });
  const existing = await readJson(OUTPUT_FILE, { items: [] });

  const now = Date.now();
  console.log('▶ 开始聚合渠道数据（平台直连 + 定向搜索 + 资讯流水线）');

  // 1. 平台直连：官方活动页 / 公开接口
  const platformRaws = [];
  const openRouter = await fetchOpenRouter(userAgent);
  if (openRouter) {
    const { snapshot, fresh } = openRouterFreeModels(openRouter, { now, timezone: config.timezone });
    platformRaws.push(snapshot, ...fresh);
    console.log(`  · OpenRouter：每日快照 1 条；近 7 天新增免费模型 ${fresh.length} 条`);
  }
  platformRaws.push(...(await fetchVolcEngine(userAgent)));
  platformRaws.push(...(await fetchBigModel(userAgent)));
  platformRaws.push(...(await fetchSiliconFlow(userAgent)));
  platformRaws.push(...(await fetchAliyun(userAgent)));

  // 2. 定向资讯搜索（每路独立容错）
  const searchResults = await mapLimit(SEARCH_QUERIES, CONCURRENCY, (query) => fetchSearchFeed(query, userAgent));
  const searchRaws = [];
  for (const parsed of searchResults) {
    if (!parsed) continue;
    const deals = dealsFromSearchItems(parsed);
    searchRaws.push(...deals);
  }
  const searchFetched = searchResults.filter(Boolean).reduce((acc, list) => acc + list.length, 0);
  console.log(
    `  · 定向搜索：可用 ${searchResults.filter(Boolean).length}/${SEARCH_QUERIES.length} 路，抓取 ${searchFetched} 条，命中渠道 ${searchRaws.length} 条`,
  );

  // 3. 资讯流水线（离线数据源，不依赖外网）
  const newsRaws = newsItemsToDealRaws(news.items);
  console.log(`  · 资讯流水线：命中渠道条目 ${newsRaws.length} 条`);

  const raws = [...platformRaws, ...searchRaws, ...newsRaws];
  const dataset = buildDealsDataset(raws, {
    now,
    timezone: config.timezone,
    retentionDays: config.retentionDays || 45,
    maxItems: 800,
  });

  const kinds = Object.fromEntries(dataset.stats.kinds.map((entry) => [entry.name, entry.count]));
  console.log(
    `\n✅ 渠道条目共 ${dataset.count} 条（平台直连 ${kinds.platform || 0} · 定向搜索 ${kinds.search || 0} · 资讯 ${kinds.news || 0}）｜覆盖 ${dataset.days.length} 天｜最新：${dataset.days[0]?.label ?? '—'}`,
  );

  if (dryRun) {
    console.log('（--dry 模式，未写入文件）');
  } else {
    await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    await writeFile(OUTPUT_FILE, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    console.log(`💾 已写入 ${path.relative(ROOT, OUTPUT_FILE)}（${(JSON.stringify(dataset).length / 1024).toFixed(1)} KB）`);
  }

  if (!dataset.count) {
    console.error('❌ 三路来源均无渠道条目（先运行 npm run fetch 生成 news.json）');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`❌ 渠道聚合失败：${error.message}`);
  process.exitCode = 1;
});
