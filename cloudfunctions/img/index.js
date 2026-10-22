/* =============================================================================
 * 云函数 img：图片代理
 *
 * 不少资讯站对内容图做了防盗链（校验 Referer），小程序的 <image> 直连会被拒。
 * 这里带上原文页面的 Referer 代为取图，base64 回传，阅读页把失败的图片换成
 * data URI 渲染。只接受 http/https 且响应必须是 image/*。
 * ========================================================================== */

const http = require('http');
const https = require('https');

const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 3 * 1024 * 1024; // 单图上限 3MB（base64 后约 4MB，在云函数返回限额内）

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47';

function fetchBinary(url, referer, redirectsLeft) {
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
    const headers = {
      'User-Agent': UA,
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
    };
    if (referer) headers.Referer = referer;
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(parsed, { timeout: TIMEOUT_MS, headers }, (response) => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error('重定向次数过多'));
          return;
        }
        // 重定向后把 Referer 换成跳转后的站点，部分 CDN 以此校验
        const next = new URL(response.headers.location, parsed);
        resolve(fetchBinary(next.href, `${next.origin}/`, redirectsLeft - 1));
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
          request.destroy(new Error('图片过大'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: (response.headers['content-type'] || 'image/jpeg').split(';')[0].trim(),
        });
      });
    });
    request.on('timeout', () => request.destroy(new Error('请求超时')));
    request.on('error', reject);
  });
}

exports.main = async (event) => {
  const url = String((event && event.url) || '');
  if (!/^https?:\/\//.test(url)) return { ok: false, message: '链接不合法' };

  // 防盗链校验通常认「同站 Referer」，用原文页/图片页的站点首页充当
  let referer = String((event && event.referer) || '');
  if (!/^https?:\/\//.test(referer)) {
    try {
      referer = `${new URL(url).origin}/`;
    } catch {
      referer = '';
    }
  }

  try {
    const { buffer, contentType } = await fetchBinary(url, referer, MAX_REDIRECTS);
    if (!contentType.startsWith('image/')) return { ok: false, message: '响应不是图片' };
    return { ok: true, contentType, base64: buffer.toString('base64') };
  } catch (error) {
    return { ok: false, message: error.message };
  }
};
