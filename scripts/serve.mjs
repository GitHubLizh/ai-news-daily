#!/usr/bin/env node
/**
 * 本地静态服务器：web/ 作为站点根目录，data/ 下的 JSON 以 /data/* 暴露。
 * 用法：npm run dev   （默认 http://127.0.0.1:5173，可用 PORT 覆盖）
 * 零依赖，仅用于本地预览；部署时把 web/ 与 data/ 一起发布到任意静态托管即可。
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_AGE = Number(process.env.CACHE_SECONDS ?? 0);

/** 预览时以仓库根目录作为站点根，与 GitHub Pages 发布目录保持一致；隐藏非站点文件 */
const DENY = [/^\./, /^node_modules\//, /^scripts\//, /^test\//, /^package(-lock)?\.json$/, /^data\/feeds\.json$/];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** 把请求路径映射到磁盘文件，并阻断路径穿越 */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const safe = path.normalize(decoded).replace(/^([/\\])+/, '').replace(/\\/g, '/');
  if (safe && DENY.some((pattern) => pattern.test(safe))) return null;
  const target = path.join(ROOT, safe === '' ? 'index.html' : safe);
  if (!target.startsWith(ROOT)) return null;
  return target;
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  let file = resolveFile(req.url || '/');

  try {
    if (!file) throw Object.assign(new Error('forbidden'), { status: 403 });
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = path.join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    if (!info) throw Object.assign(new Error('not found'), { status: 404 });

    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': MAX_AGE > 0 ? `public, max-age=${MAX_AGE}` : 'no-cache',
    });
    createReadStream(file).pipe(res);
    res.on('finish', () => {
      console.log(`${res.statusCode} ${req.method} ${req.url} (${Date.now() - started}ms)`);
    });
  } catch (error) {
    const status = error.status || 500;
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`${status} ${error.message}`);
    console.log(`${status} ${req.method} ${req.url}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AI 资讯站本地预览: http://${HOST}:${PORT}`);
  console.log(`站点根目录: ${ROOT}`);
  console.log('按 Ctrl+C 停止');
});