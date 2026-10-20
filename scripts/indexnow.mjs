#!/usr/bin/env node
/**
 * IndexNow 推送：把 dist/sitemap.xml 里的全部 URL 提交给必应等支持 IndexNow 的搜索引擎，
 * 内容更新后秒级通知（与百度普通收录不同，没有每日配额限制）。
 * 所有权验证依赖站点根目录的 <key>.txt 文件（仓库根目录存放，build.mjs 拷入 dist/）。
 * 由 workflow 在部署后调用；推送失败只告警，不影响发布。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = '351251db2aeb48e5b0eae7538c56d5fa';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

export function parseSitemapUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const xml = await readFile(path.join(root, 'dist/sitemap.xml'), 'utf8');
  const urls = parseSitemapUrls(xml);
  if (!urls.length) throw new Error('dist/sitemap.xml 里没有 URL，先运行 npm run build');
  const host = new URL(urls[0]).host;
  const payload = {
    host,
    key: KEY,
    keyLocation: `https://${host}/${KEY}.txt`,
    urlList: urls,
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  console.log(`IndexNow 推送 ${urls.length} 条 URL，HTTP ${res.status}`);
  if (!res.ok) {
    // 200=已处理，202=已接收待验证 key；其他状态码只告警，不让 workflow 变红
    console.warn(`⚠️ IndexNow 返回 ${res.status}（${await res.text().catch(() => '')}），不影响发布`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.warn(`⚠️ IndexNow 推送失败：${error.message}（不影响发布）`);
  });
}
