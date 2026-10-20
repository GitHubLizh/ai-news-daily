#!/usr/bin/env node
/**
 * 组装可发布的静态目录 dist/（index.html + favicon.ico + assets/ + data/ + .nojekyll）。
 * 用法：npm run build   （部署时把 dist/ 作为站点根目录发布即可）
 */
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prerenderSite } from './prerender.mjs';
import { writeSitemap } from './sitemap.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const FILES = ['index.html', 'favicon.ico', '.nojekyll', 'robots.txt', 'assets', 'data/news.json', 'data/feed.xml'];

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const copied = [];
  const missing = [];
  for (const relative of FILES) {
    const source = path.join(ROOT, relative);
    if (!(await exists(source))) {
      missing.push(relative);
      continue;
    }
    const target = path.join(DIST, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
    copied.push(relative);
  }

  await writeFile(path.join(DIST, '.nojekyll'), '', 'utf8');

  // SEO：把最新一天资讯静态注入 dist/index.html、生成按日期归档页与 sitemap.xml，
  // 让不执行 JS 的搜索引擎爬虫也能抓到内容（详见 scripts/prerender.mjs）
  if (copied.includes('data/news.json')) {
    const pre = await prerenderSite(ROOT, DIST);
    console.log(`🕸️  预渲染完成：首页注入 ${pre.homepageItems} 条（${pre.latestDay}），日期页 ${pre.dayPages} 个`);
    const map = await writeSitemap(ROOT, DIST);
    console.log(`🗺️  sitemap.xml 已生成，共 ${map.urls} 个 URL`);
  } else {
    console.log('⚠️  缺少 data/news.json，跳过预渲染与 sitemap 生成');
  }

  console.log(`📦 dist/ 已生成，共 ${copied.length} 项：`);
  for (const item of copied) console.log(`   - ${item}`);
  if (missing.length) {
    console.log(`⚠️  跳过缺失项（先运行 npm run fetch）：${missing.join('、')}`);
  }
  console.log('   发布时把 dist/ 作为站点根目录即可。');
}

main().catch((error) => {
  console.error(`❌ 构建失败：${error.message}`);
  process.exitCode = 1;
});