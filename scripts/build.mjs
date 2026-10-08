#!/usr/bin/env node
/**
 * 组装可发布的静态目录 dist/（index.html + assets/ + data/ + .nojekyll）。
 * 用法：npm run build   （部署时把 dist/ 作为站点根目录发布即可）
 */
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const FILES = ['index.html', '.nojekyll', 'assets', 'data/news.json', 'data/feed.xml'];

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