/**
 * 文本处理工具：HTML 清洗、实体解码、标题归一化、URL 规范化、语言识别。
 * 纯函数，无第三方依赖，便于单元测试。
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  times: '×',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  bull: '•',
  prime: '′',
  Prime: '″',
};

/** 解码常见 HTML 实体（含数字实体） */
export function decodeEntities(input) {
  if (!input) return '';
  return String(input).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return whole;
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

/** 去掉 CDATA 包裹 */
export function unwrapCdata(input) {
  if (!input) return '';
  return String(input)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim();
}

/** HTML 转纯文本：去脚本/样式/标签、解码实体、压缩空白 */
export function stripHtml(input) {
  if (!input) return '';
  let text = unwrapCdata(String(input));
  text = text.replace(/<(script|style|iframe|noscript)\b[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<br\s*\/?>/gi, ' ');
  text = text.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, ' ');
  text = text.replace(/<[^>]*>/g, '');
  text = decodeEntities(text);
  text = text.replace(/[\u200b\u200c\u200d\ufeff]/g, '');
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}

/** 按可见字符截断（中文按字计），不切断代理对 */
export function truncate(input, max = 160, suffix = '…') {
  const text = String(input ?? '').trim();
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, max).join('').replace(/[\s，。、,.;；:：]+$/, '') + suffix;
}

/** 标题归一化 key：忽略大小写、标点、空白、全半角差异，用于跨源去重 */
export function titleKey(input) {
  return String(input ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[!-/:-@[-`{-~！-／：-＠［-｀｛-～、。，；：？！“”‘’（）《》【】—…·|]/g, '')
    .trim();
}

const TRACKING_PARAMS = /^(utm_|spm|from|source|ref|share|weibo|wx_|_hs|hmsr|hmpl|hmcu|hmkw|hmci|gclid|fbclid|yclid|igshid)/i;

/** URL 规范化：去掉 hash、跟踪参数、默认端口与末尾斜杠 */
export function canonicalUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    let out = url.toString();
    if (out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return raw;
  }
}

/** 简单语言识别：中日韩字符占比超过阈值判为中文 */
export function detectLang(input) {
  const text = stripHtml(input);
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  if (cjk === 0) return 'en';
  const total = cjk + letters / 2;
  return cjk / Math.max(1, total) >= 0.3 ? 'zh' : 'en';
}

/** 稳定短 id（FNV-1a），避免引入依赖 */
export function shortHash(input) {
  let hash = 0x811c9dc5;
  const text = String(input ?? '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}