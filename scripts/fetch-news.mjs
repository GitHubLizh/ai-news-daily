#!/usr/bin/env node
/**
 * 抓取所有启用的 RSS 源，归一化后写入 data/news.json。
 * 用法：npm run fetch
 * 参数：--dry 只打印统计不写文件；--only=<feedId,feedId> 只抓指定源
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFeed } from './lib/rss.mjs';
import { buildDataset, hotKeywordHits, isAiRelated } from './lib/normalize.mjs';
import { buildRssXml } from './lib/feed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FEEDS_FILE = path.join(ROOT, 'data', 'feeds.json');
const OUTPUT_FILE = path.join(ROOT, 'data', 'news.json');
const FEED_FILE = path.join(ROOT, 'data', 'feed.xml');
const CONCURRENCY = 6;
const TIMEOUT_MS = 25000;
const MAX_ATTEMPTS = 3;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const onlyArg = args.find((arg) => arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const RETRY_DELAY_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestFeed(feed, userAgent) {
  const timeout = Number(feed.timeoutMs) || TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': userAgent,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
      },
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    const xml = await response.text();
    const parsed = parseFeed(xml, feed);
    if (!parsed.length) throw new Error('解析到 0 条（可能不是有效 feed）');
    return parsed.map((item) => ({
      ...item,
      timeShiftHours: Number(feed.timeShiftHours) || 0,
      bulk: feed.bulk === true,
    }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeed(feed, userAgent) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);
    try {
      return { feed, items: await requestFeed(feed, userAgent) };
    } catch (error) {
      lastError = error;
      // 非重试类错误（如 404、feed 格式非法）不必再试
      const retryable = error?.retryable || error?.name === 'AbortError' || error?.name === 'TypeError';
      if (!retryable) break;
    }
  }
  const timeout = Number(feed.timeoutMs) || TIMEOUT_MS;
  const reason =
    lastError?.name === 'AbortError'
      ? `超时 ${timeout}ms`
      : lastError?.cause?.code || lastError?.message || String(lastError);
  return { feed, items: [], error: reason };
}

/** 高频源（如 arXiv）按“新闻性”择优，避免淹没时间线 */
function limitBulkItems(items, limit) {
  if (!limit || items.length <= limit) return items;
  return [...items]
    .sort(
      (a, b) =>
        hotKeywordHits(`${b.title} ${b.summary || ''}`) - hotKeywordHits(`${a.title} ${a.summary || ''}`) ||
        (b.summary?.length || 0) - (a.summary?.length || 0),
    )
    .slice(0, limit);
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
  if (!config?.feeds?.length) throw new Error(`未找到源配置：${FEEDS_FILE}`);

  const feeds = config.feeds.filter((feed) => feed.enabled !== false && (!only || only.has(feed.id)));
  const existing = (await readJson(OUTPUT_FILE, { items: [] }))?.items ?? [];

  console.log(`▶ 开始抓取 ${feeds.length} 个源（并发 ${CONCURRENCY}，超时 ${TIMEOUT_MS}ms）`);
  const started = Date.now();
  const results = await mapLimit(feeds, CONCURRENCY, (feed) => fetchFeed(feed, config.userAgent));

  const collected = [];
  const report = [];
  for (const result of results) {
    const { feed, items, error } = result;
    let accepted = items;
    let filtered = 0;
    let limited = 0;
    if (feed.relevance === 'tech') {
      const kept = items.filter((item) => isAiRelated(item.title, item.summary));
      filtered = items.length - kept.length;
      accepted = kept;
    }
    if (feed.bulkLimit) {
      const capped = limitBulkItems(accepted, Number(feed.bulkLimit));
      limited = accepted.length - capped.length;
      accepted = capped;
    }
    collected.push(...accepted);
    report.push({
      id: feed.id,
      name: feed.name,
      ok: !error,
      total: items.length,
      kept: accepted.length,
      filtered,
      limited,
      error: error || '',
    });
  }

  const now = Date.now();
  // 本次抓取结果排在前面：去重时优先采用刚拿到的新鲜条目
  const dataset = buildDataset([...collected, ...existing], {
    now,
    timezone: config.timezone,
    retentionDays: config.retentionDays,
    maxItems: config.maxItems,
  });

  console.log('\n源              状态   抓取  入库  非AI  择优截断');
  for (const row of report) {
    const status = row.ok ? '✅' : '❌';
    console.log(
      `${row.name.padEnd(14, '　')} ${status}  ${String(row.total).padStart(4)}  ${String(row.kept).padStart(4)}  ${String(row.filtered).padStart(4)}  ${String(row.limited).padStart(6)}   ${row.error}`,
    );
  }

  const okCount = report.filter((row) => row.ok).length;
  console.log(
    `\n✅ 源可用 ${okCount}/${report.length}｜新增抓取 ${collected.length} 条｜去重后保留 ${dataset.count} 条｜耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  console.log(`   最新日期：${dataset.days[0]?.label ?? '—'}｜语言：中文 ${dataset.stats.languages.zh} / 英文 ${dataset.stats.languages.en}`);

  if (dryRun) {
    console.log('（--dry 模式，未写入文件）');
    return;
  }
  await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  console.log(`💾 已写入 ${path.relative(ROOT, OUTPUT_FILE)}（${(JSON.stringify(dataset).length / 1024).toFixed(1)} KB）`);

  // 顺带导出站点自己的订阅源，方便用阅读器订阅
  const feedXml = buildRssXml(dataset, config.site, { limit: 120 });
  await writeFile(FEED_FILE, feedXml, 'utf8');
  console.log(`📡 已写入 ${path.relative(ROOT, FEED_FILE)}（最多 120 条，可用阅读器订阅）`);

  const failed = report.filter((row) => !row.ok);
  if (failed.length) process.exitCode = failed.length === report.length ? 1 : 0;
}

main().catch((error) => {
  console.error(`❌ 抓取失败：${error.message}`);
  process.exitCode = 1;
});