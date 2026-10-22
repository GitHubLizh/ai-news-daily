/* =============================================================================
 * 云函数 article：抓取原文网页并提取正文，供小程序阅读页渲染。
 * 入参 { url }；返回 { ok, title, blocks } 或 { ok: false, message }。
 * 内容块：{ type: 'p'|'h'|'quote'|'li', text } / { type: 'img', src, alt }
 * ========================================================================== */

const http = require('http');
const https = require('https');

const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const CACHE_LIMIT = 100;

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47';

/** 实例内缓存：同一云函数实例被复用时，重复打开同一篇不再抓取 */
const cache = new Map();

function fetchBuffer(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('链接不合法'));
      return;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      reject(new Error('仅支持 http/https 链接'));
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(
      parsed,
      {
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('重定向次数过多'));
            return;
          }
          const next = new URL(response.headers.location, parsed).href;
          resolve(fetchBuffer(next, redirectsLeft - 1));
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            request.destroy(new Error('页面过大'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({ buffer: Buffer.concat(chunks), contentType: response.headers['content-type'] || '' });
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('请求超时')));
    request.on('error', reject);
  });
}

/** 按 content-type 或 meta 声明解码（部分老站仍是 GBK 系编码） */
function decodeHtml(buffer, contentType) {
  let charset = /charset=([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = buffer.subarray(0, 4096).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  const normalized = (charset || 'utf-8').toLowerCase().replace('gb2312', 'gb18030').replace('gbk', 'gb18030');
  try {
    return new TextDecoder(normalized).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

exports.main = async (event) => {
  const url = String((event && event.url) || '');
  if (!url) return { ok: false, message: '缺少 url 参数' };

  const cached = cache.get(url);
  if (cached) return cached;

  let result;
  try {
    const { buffer, contentType } = await fetchBuffer(url, MAX_REDIRECTS);
    const html = decodeHtml(buffer, contentType);
    const { htmlToArticle } = await import('./extract.mjs');
    const article = htmlToArticle(html, url);
    result = article.blocks.length
      ? { ok: true, title: article.title, blocks: article.blocks }
      : { ok: false, message: '正文提取失败，可改用浏览器打开' };
  } catch (error) {
    result = { ok: false, message: `抓取失败：${error.message}` };
  }

  if (result.ok) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(url, result);
  }
  return result;
};
