#!/usr/bin/env node
/**
 * 生成 dist/sitemap.xml：首页 + 全部按日期静态归档页。
 * 站点地址取 data/feeds.json 的 site.url，可用 SITE_URL 环境变量覆盖（与 fetch-news.mjs 一致）。
 * 由 build.mjs 调用；buildSitemapXml 为纯函数，供测试使用。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildSitemapXml(siteUrl, days, homepageLastmod) {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const entries = [
    `  <url>
    <loc>${base}/</loc>
    <lastmod>${homepageLastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`,
  ];
  for (const day of days) {
    entries.push(`  <url>
    <loc>${base}/day/${day.day}/</loc>
    <lastmod>${day.day}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}

export async function writeSitemap(root, dist) {
  const [newsRaw, feedsRaw] = await Promise.all([
    readFile(path.join(root, 'data/news.json'), 'utf8'),
    readFile(path.join(root, 'data/feeds.json'), 'utf8'),
  ]);
  const data = JSON.parse(newsRaw);
  const feeds = JSON.parse(feedsRaw);
  const siteUrl = (process.env.SITE_URL || feeds.site.url || '').replace(/\/+$/, '');
  const days = (data.days || []).filter((d) => d.count > 0);
  const homepageLastmod = String(data.generatedAt || '').slice(0, 10);
  const xml = buildSitemapXml(siteUrl, days, homepageLastmod);
  await writeFile(path.join(dist, 'sitemap.xml'), xml, 'utf8');
  return { urls: days.length + 1 };
}

// 独立运行：node scripts/sitemap.mjs [dist 目录]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dist = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'dist');
  writeSitemap(root, dist)
    .then((r) => console.log(`🗺️  sitemap.xml 已生成，共 ${r.urls} 个 URL`))
    .catch((error) => {
      console.error(`❌ sitemap 生成失败：${error.message}`);
      process.exitCode = 1;
    });
}
