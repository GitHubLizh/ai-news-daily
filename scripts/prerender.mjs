#!/usr/bin/env node
/**
 * 构建时把资讯静态化，让不执行 JS 的搜索引擎爬虫也能抓到内容：
 * 1. 把最新一天的条目以静态 HTML 注入 dist/index.html 的 #feed
 *    （assets/app.js 渲染时整体替换 #feed 内容，访客侧无感）；
 * 2. 为 data/news.json 里的每个日期生成 dist/day/YYYY-MM-DD/index.html 独立静态归档页，
 *    让搜索引擎有可收录的真实 URL（线上 SPA 的 #/day/... hash 路由不会被当作独立页面）。
 * 由 build.mjs 调用；纯函数单独导出供 test/prerender.test.mjs 使用。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FEED_PLACEHOLDER = '<div class="feed" id="feed"></div>';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function timeOf(item, timezone) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone || 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(item.publishedTs || item.publishedAt));
  } catch {
    return '';
  }
}

export function itemStaticHtml(item, timezone) {
  return `<article class="item">
      <div class="item-top">
        <span class="item-source">${escapeHtml(item.source)}</span>
        <span class="item-category">${escapeHtml(item.category)}</span>
        <span class="item-time">${escapeHtml(timeOf(item, timezone))}</span>
      </div>
      <h3 class="item-title">
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
      </h3>
      ${item.summary ? `<p class="item-summary">${escapeHtml(item.summary)}</p>` : ''}
    </article>`;
}

function dayGroupHtml(label, items, timezone) {
  return `<section class="day-group">
    <header class="day-head">
      <h2>${escapeHtml(label)}</h2>
      <span class="day-count">${items.length} 条</span>
    </header>
    <div class="items">${items.map((item) => itemStaticHtml(item, timezone)).join('\n')}</div>
  </section>`;
}

export function buildDayPage({ site, dayEntry, items, newerDay, olderDay, timezone }) {
  const canonical = `${site.url}/day/${dayEntry.day}/`;
  const nav = [
    newerDay ? `<a href="/day/${newerDay.day}/">← ${escapeHtml(newerDay.label)}</a>` : '',
    `<a href="/#/day/${encodeURIComponent(dayEntry.day)}">交互版</a>`,
    olderDay ? `<a href="/day/${olderDay.day}/">${escapeHtml(olderDay.label)} →</a>` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(site.title)} · ${escapeHtml(dayEntry.label)} AI 新闻（${items.length} 条）</title>
    <meta
      name="description"
      content="${escapeHtml(`${dayEntry.day} 每日 AI 新闻聚合，共 ${items.length} 条：模型发布、产品动态、研究前沿、行业动态。`)}"
    />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(`${site.title} · ${dayEntry.label}`)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="apple-touch-icon" href="/assets/logo.png" />
    <link rel="stylesheet" href="../../assets/styles.css" />
  </head>
  <body>
    <header class="topbar">
      <div class="wrap topbar-inner">
        <a class="brand" href="/" aria-label="回到最新资讯">
          <span class="brand-mark" aria-hidden="true">
            <img src="/assets/logo.png" width="34" height="34" alt="" />
          </span>
          <span class="brand-text">
            <strong>${escapeHtml(site.title)}</strong>
            <small>LATEST AI NEWS</small>
          </span>
        </a>
        <nav class="nav" aria-label="站点导航">
          <a href="/">最新</a>
          <a href="/data/feed.xml" target="_blank" rel="noopener">RSS 订阅</a>
        </nav>
      </div>
    </header>
    <main class="wrap">
      <h1 class="sr-only">${escapeHtml(site.title)} · ${escapeHtml(dayEntry.label)} AI 新闻</h1>
      ${dayGroupHtml(dayEntry.label, items, timezone)}
      <p class="muted" style="margin:16px 0">${nav}</p>
    </main>
    <footer class="footer">
      <div class="wrap footer-inner">
        <p class="muted">
          ${escapeHtml(site.title)} — 个人自建的 AI 资讯聚合站，内容来自公开 RSS 源，仅保留标题、摘要与原文链接，版权归原作者所有。
        </p>
      </div>
    </footer>
  </body>
</html>
`;
}

export function groupByDay(data) {
  const map = new Map();
  for (const item of data.items || []) {
    if (!map.has(item.day)) map.set(item.day, []);
    map.get(item.day).push(item);
  }
  return map;
}

/**
 * 读取 ROOT 下的 index.html / data/news.json / data/feeds.json，
 * 往 DIST 写入预渲染后的 index.html 与全部 day/ 静态页。
 */
export async function prerenderSite(root, dist) {
  const [indexHtml, newsRaw, feedsRaw] = await Promise.all([
    readFile(path.join(root, 'index.html'), 'utf8'),
    readFile(path.join(root, 'data/news.json'), 'utf8'),
    readFile(path.join(root, 'data/feeds.json'), 'utf8'),
  ]);
  const data = JSON.parse(newsRaw);
  const feeds = JSON.parse(feedsRaw);
  const site = {
    ...feeds.site,
    url: (process.env.SITE_URL || feeds.site.url || '').replace(/\/+$/, ''),
  };
  const timezone = data.timezone || feeds.timezone || 'Asia/Shanghai';
  const byDay = groupByDay(data);
  const days = data.days || [];

  // 1. 首页预渲染：最新一天的条目注入 #feed，爬虫不执行 JS 也能读到当日全部资讯
  const latest = days[0];
  if (!latest) throw new Error('data/news.json 里没有 days，先运行 npm run fetch');
  const latestItems = byDay.get(latest.day) || [];
  if (!indexHtml.includes(FEED_PLACEHOLDER)) {
    throw new Error(`index.html 里找不到占位符 ${FEED_PLACEHOLDER}，无法注入预渲染内容`);
  }
  const rendered = indexHtml.replace(
    FEED_PLACEHOLDER,
    `<div class="feed" id="feed">${dayGroupHtml(latest.label, latestItems, timezone)}</div>`,
  );
  await writeFile(path.join(dist, 'index.html'), rendered, 'utf8');

  // 2. 按日期静态页：每个日期一个可收录的独立 URL
  let pageCount = 0;
  for (let i = 0; i < days.length; i += 1) {
    const dayEntry = days[i];
    const items = byDay.get(dayEntry.day) || [];
    if (!items.length) continue;
    const html = buildDayPage({
      site,
      dayEntry,
      items,
      newerDay: days[i - 1] || null,
      olderDay: days[i + 1] || null,
      timezone,
    });
    const dir = path.join(dist, 'day', dayEntry.day);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), html, 'utf8');
    pageCount += 1;
  }

  return { homepageItems: latestItems.length, latestDay: latest.day, dayPages: pageCount };
}

// 独立运行：node scripts/prerender.mjs [dist 目录]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dist = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'dist');
  prerenderSite(root, dist)
    .then((r) => console.log(`🕸️  预渲染完成：首页注入 ${r.homepageItems} 条（${r.latestDay}），日期页 ${r.dayPages} 个`))
    .catch((error) => {
      console.error(`❌ 预渲染失败：${error.message}`);
      process.exitCode = 1;
    });
}
