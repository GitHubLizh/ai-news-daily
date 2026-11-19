#!/usr/bin/env node
/**
 * 构建时把资讯静态化，让不执行 JS 的搜索引擎爬虫也能抓到内容：
 * 1. 把最新一天的条目以静态 HTML 注入 dist/index.html 的 #feed
 *    （assets/app.js 渲染时整体替换 #feed 内容，访客侧无感）；
 * 2. 生成 dist/day/index.html 归档索引，并为 data/news.json 里的每个日期生成
 *    dist/day/YYYY-MM-DD/index.html 独立静态归档页，让搜索引擎有可收录的真实 URL
 *    （线上 SPA 的 #/day/... hash 路由不会被当作独立页面）。
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
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(item.title)}</a>
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

export function buildArchivePage({ site, days }) {
  const canonical = `${site.url}/day/`;
  const list = days
    .map(
      (day) => `<li>
        <a href="/day/${encodeURIComponent(day.day)}/"><time datetime="${escapeHtml(day.day)}">${escapeHtml(day.label)}</time></a>
        <span>${day.count} 条</span>
      </li>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>每日AI新闻归档｜${escapeHtml(site.title)}</title>
    <meta name="description" content="按日期浏览每日 AI 新闻归档，查找国内外模型发布、产品动态、研究前沿与行业动态。" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="每日AI新闻归档｜${escapeHtml(site.title)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="apple-touch-icon" href="/assets/logo.png" />
    <link rel="stylesheet" href="../assets/styles.css" />
  </head>
  <body class="static-page">
    <header class="topbar">
      <div class="wrap topbar-inner">
        <a class="brand" href="/" aria-label="回到最新资讯">
          <span class="brand-mark" aria-hidden="true"><img src="/assets/logo.png" width="34" height="34" alt="" /></span>
          <span class="brand-text"><strong>${escapeHtml(site.title)}</strong><small>LATEST AI NEWS</small></span>
        </a>
        <nav class="nav" aria-label="站点导航">
          <a href="/">最新</a>
          <a href="/deals/">免费与优惠</a>
          <a href="/day/" class="is-active">每日 AI 新闻归档</a>
          <a href="/data/feed.xml" target="_blank" rel="noopener">RSS 订阅</a>
        </nav>
      </div>
    </header>
    <main class="wrap archive-page">
      <header class="archive-header">
        <h1>每日 AI 新闻归档</h1>
        <p>按日期浏览每日 AI 新闻聚合，查找国内外模型发布、产品动态、研究前沿与行业动态。</p>
      </header>
      <ol class="archive-list">${list}</ol>
    </main>
    <footer class="footer">
      <div class="wrap footer-inner">
        <p class="muted">${escapeHtml(site.title)} — 个人自建的 AI 资讯聚合站，内容来自公开 RSS 源，仅保留标题、摘要与原文链接，版权归原作者所有。</p>
      </div>
    </footer>
  </body>
</html>
`;
}

export function buildDayPage({ site, dayEntry, items, newerDay, olderDay, timezone }) {
  const canonical = `${site.url}/day/${dayEntry.day}/`;
  const nav = [
    newerDay ? `<a href="/day/${newerDay.day}/">← ${escapeHtml(newerDay.label)}</a>` : '',
    '<a href="/day/">全部归档</a>',
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
    <title>${escapeHtml(dayEntry.day)} 每日AI新闻（${items.length} 条）｜${escapeHtml(site.title)}</title>
    <meta
      name="description"
      content="${escapeHtml(`${dayEntry.day} 每日 AI 新闻聚合，共 ${items.length} 条：模型发布、产品动态、研究前沿、行业动态。`)}"
    />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(`${dayEntry.day} 每日AI新闻｜${site.title}`)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="apple-touch-icon" href="/assets/logo.png" />
    <link rel="stylesheet" href="../../assets/styles.css" />
  </head>
  <body class="static-page">
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
          <a href="/deals/">免费与优惠</a>
          <a href="/day/">每日 AI 新闻归档</a>
          <a href="/data/feed.xml" target="_blank" rel="noopener">RSS 订阅</a>
        </nav>
      </div>
    </header>
    <main class="wrap">
      <h1 class="archive-day-title">${escapeHtml(dayEntry.day)} 每日 AI 新闻</h1>
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

const DEAL_TYPE_LABELS = { free: '免费使用', discount: '优惠购买' };
const DEAL_KIND_LABELS = { platform: '平台直连', search: '定向搜索', news: '资讯识别' };

/**
 * 「免费与优惠」静态页：SPA 的 #/deals 是 hash 路由，搜索引擎看不到，
 * 这里把 data/deals.json 的条目按「免费使用 / 优惠购买」分组渲染成独立可收录 URL。
 */
export function buildDealsPage({ site, data }) {
  const canonical = `${site.url}/deals/`;
  const timezone = data.timezone || 'Asia/Shanghai';
  const items = [...(data.items || [])].sort((a, b) => (b.publishedTs || 0) - (a.publishedTs || 0));
  const sections = Object.entries(DEAL_TYPE_LABELS)
    .map(([type, label]) => ({ label, items: items.filter((item) => item.dealType === type) }))
    .filter((group) => group.items.length)
    .map((group) =>
      dayGroupHtml(
        group.label,
        group.items.map((item) => ({ ...item, category: DEAL_KIND_LABELS[item.kind] || item.category })),
        timezone,
      ),
    )
    .join('\n');
  const updated = String(data.generatedAt || '').slice(0, 10);
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>AI大模型免费与优惠（每日更新）｜${escapeHtml(site.title)}</title>
    <meta
      name="description"
      content="汇总各大平台 AI 大模型免费额度与限时折扣：OpenRouter、硅基流动免费模型清单，火山方舟、智谱 GLM、阿里云百炼新人额度与特价套餐，每日更新，含具体模型与官方入口。"
    />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="AI大模型免费与优惠（每日更新）｜${escapeHtml(site.title)}" />
    <meta
      property="og:description"
      content="OpenRouter、硅基流动免费模型，火山方舟、智谱、阿里云限时折扣，每日更新，含具体模型与官方入口。"
    />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="apple-touch-icon" href="/assets/logo.png" />
    <link rel="stylesheet" href="../assets/styles.css" />
  </head>
  <body class="static-page">
    <header class="topbar">
      <div class="wrap topbar-inner">
        <a class="brand" href="/" aria-label="回到最新资讯">
          <span class="brand-mark" aria-hidden="true"><img src="/assets/logo.png" width="34" height="34" alt="" /></span>
          <span class="brand-text"><strong>${escapeHtml(site.title)}</strong><small>LATEST AI NEWS</small></span>
        </a>
        <nav class="nav" aria-label="站点导航">
          <a href="/">最新</a>
          <a href="/deals/" class="is-active">免费与优惠</a>
          <a href="/day/">每日 AI 新闻归档</a>
          <a href="/data/feed.xml" target="_blank" rel="noopener">RSS 订阅</a>
        </nav>
      </div>
    </header>
    <main class="wrap archive-page">
      <header class="archive-header">
        <h1>AI 大模型免费与优惠</h1>
        <p>
          汇集各大平台免费可用的 AI 大模型与优惠购买渠道：OpenRouter / 硅基流动免费模型清单，
          火山方舟、智谱、阿里云百炼的限时折扣与新人额度，含具体模型、免费额度与官方入口。
          价格与额度以各平台官方页面为准。
        </p>
        <p class="muted">数据更新于 ${escapeHtml(updated)} · 共 ${items.length} 条 · <a href="/#/deals">交互版（可按日期 / 类型筛选）→</a></p>
      </header>
      ${sections}
    </main>
    <footer class="footer">
      <div class="wrap footer-inner">
        <p class="muted">${escapeHtml(site.title)} — 个人自建的 AI 资讯聚合站，内容来自公开 RSS 源与平台官方页面，仅保留标题、摘要与原文链接，版权归原作者所有。</p>
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
  const [indexHtml, newsRaw, feedsRaw, dealsRaw] = await Promise.all([
    readFile(path.join(root, 'index.html'), 'utf8'),
    readFile(path.join(root, 'data/news.json'), 'utf8'),
    readFile(path.join(root, 'data/feeds.json'), 'utf8'),
    readFile(path.join(root, 'data/deals.json'), 'utf8').catch(() => null),
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

  // 2. 按日期静态页：归档索引 + 每个日期一个可收录的独立 URL
  const archiveDays = days
    .map((dayEntry) => ({ ...dayEntry, count: (byDay.get(dayEntry.day) || []).length }))
    .filter((dayEntry) => dayEntry.count > 0);
  await mkdir(path.join(dist, 'day'), { recursive: true });
  await writeFile(path.join(dist, 'day', 'index.html'), buildArchivePage({ site, days: archiveDays }), 'utf8');

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

  // 3. 「免费与优惠」静态页：hash 路由 #/deals 不可收录，这里生成独立 URL
  let dealsItems = 0;
  if (dealsRaw) {
    const dealsData = JSON.parse(dealsRaw);
    dealsItems = (dealsData.items || []).length;
    if (dealsItems) {
      await mkdir(path.join(dist, 'deals'), { recursive: true });
      await writeFile(path.join(dist, 'deals', 'index.html'), buildDealsPage({ site, data: dealsData }), 'utf8');
    }
  }

  return { homepageItems: latestItems.length, latestDay: latest.day, dayPages: pageCount, dealsItems };
}

// 独立运行：node scripts/prerender.mjs [dist 目录]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dist = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'dist');
  prerenderSite(root, dist)
    .then((r) => console.log(`🕸️  预渲染完成：首页注入 ${r.homepageItems} 条（${r.latestDay}），日期页 ${r.dayPages} 个，优惠页 ${r.dealsItems} 条`))
    .catch((error) => {
      console.error(`❌ 预渲染失败：${error.message}`);
      process.exitCode = 1;
    });
}
