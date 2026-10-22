/* =============================================================================
 * 极简正文提取（零依赖）
 * 流程：HTML → 轻量树 → 按段落文本密度选最佳容器 → 输出内容块（段落/标题/引用/图片）。
 * 不是完整的 Readability 移植，对结构规整的资讯站够用；提取失败时小程序端回退到复制链接。
 * ========================================================================== */

/** 这些标签的内容一律忽略 */
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'iframe', 'svg', 'form', 'button', 'select', 'textarea',
  'template', 'nav', 'header', 'footer', 'aside',
]);

/** 自闭合标签（没有结束标签） */
const VOID_TAGS = new Set([
  'img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr',
]);

/** 内容块标签 → 输出类型 */
const CONTENT_TAGS = { p: 'p', h1: 'h', h2: 'h', h3: 'h', blockquote: 'quote', li: 'li' };

/** class/id 命中这些词的节点当作噪声跳过（导航、推荐、分享、版权条等） */
const NOISE_RE = /comment|nav|footer|header|sidebar|recommend|related|share|copyright|crumb|toolbar|advert|promo|social/i;

/** 广告容器：class/id 里作为独立词出现的 ad/ads（用边界判断，避免误伤 read/load 等词） */
const AD_CLASS_RE = /(^|[^a-z])ads?([^a-z]|$)/i;

/** 正文里的样板文字：面包屑、转载声明、权限提示等，直接丢弃 */
const TEXT_NOISE_RE =
  /当前位置[:：]|转载请注明|未经授权.{0,10}不得转载|(仅供|只提供给).{0,12}用户(访问|查看)|责任编辑[:：]|版权归原作者所有|免责声明/;

/** 占位图 / 追踪像素 / 加载图 / 站点图标（icon 开头的主机名或文件名），不值得渲染 */
const IMG_SKIP_RE = /spacer|blank\.|loading\.|1x1|transparent\.|placeholder|(^|\.)icons?\.|[\/_-]icons?[\/_.@-]/i;

const MAX_BLOCKS = 200;
const MAX_IMAGES = 15;

function decodeEntities(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([\w-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  while ((match = re.exec(raw))) {
    attrs[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? '';
  }
  return attrs;
}

/** 把 HTML 解析成轻量树：{ tag, attrs, children, skip }，文本为 { text } */
function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [], skip: false };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)/g;
  let match;
  while ((match = re.exec(html))) {
    if (match[4] !== undefined) {
      const text = match[4];
      if (text.trim()) stack[stack.length - 1].children.push({ text });
      continue;
    }
    if (!match[2]) continue;
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();

    if (closing) {
      // 容错：从栈顶往回找到同名开标签再闭合
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const attrs = parseAttrs(match[3] || '');
    const marker = `${attrs.class || ''} ${attrs.id || ''}`;
    const noisy = NOISE_RE.test(marker) || AD_CLASS_RE.test(marker);
    const node = {
      tag,
      attrs,
      children: [],
      skip: SKIP_TAGS.has(tag) || noisy,
    };
    // p/li 不能互相嵌套：遇到同名开标签视为上一个隐式闭合（HTML 规范行为，容错未闭合标签）
    const top = stack[stack.length - 1];
    if ((tag === 'p' || tag === 'li') && top.tag === tag) stack.pop();
    stack[stack.length - 1].children.push(node);
    if (!VOID_TAGS.has(tag)) stack.push(node);
  }
  return root;
}

/** 后代的纯文本（skip 子树忽略；skipLinks 时不计链接文本） */
function textOf(node, skipLinks = false) {
  if (node.text !== undefined) return node.text;
  if (!node.children || node.skip) return '';
  let out = '';
  for (const child of node.children) {
    if (skipLinks && child.tag === 'a') continue;
    out += textOf(child, skipLinks);
  }
  return out;
}

/** 统计子树的段落文本量与链接文本量，用于容器打分 */
function statsOf(node) {
  let pLen = 0;
  let linkLen = 0;
  (function walk(current, insideP, insideA) {
    if (current.text !== undefined) {
      const len = current.text.trim().length;
      if (insideA) linkLen += len;
      else if (insideP) pLen += len;
      return;
    }
    if (!current.children || current.skip) return;
    const nextP = insideP || current.tag === 'p';
    const nextA = insideA || current.tag === 'a';
    for (const child of current.children) walk(child, nextP, nextA);
  })(node, false, false);
  return { pLen, linkLen };
}

/** 选段落密度最高的容器（链接文本打五折，导航类列表就不容易赢） */
function bestContainer(root) {
  let best = null;
  let bestScore = 0;
  (function walk(node) {
    if (node.skip || !node.children) return;
    if (node.tag !== 'li' && node.tag !== 'a') {
      const { pLen, linkLen } = statsOf(node);
      const score = pLen - linkLen * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    for (const child of node.children) walk(child);
  })(root);
  return best;
}

function imgSrc(attrs) {
  const raw = attrs['data-src'] || attrs['data-original'] || attrs.src || (attrs.srcset || '').split(' ')[0];
  return raw || '';
}

/** 从最佳容器提取内容块 */
function collect(container, pageUrl) {
  const blocks = [];
  const seen = new Set();
  let images = 0;

  (function walk(node) {
    if (blocks.length >= MAX_BLOCKS) return;
    if (node.skip) return;
    if (node.text !== undefined) return;

    if (node.tag === 'img') {
      if (images >= MAX_IMAGES) return;
      const raw = imgSrc(node.attrs);
      if (!raw || raw.startsWith('data:') || IMG_SKIP_RE.test(raw)) return;
      let src;
      try {
        src = new URL(raw, pageUrl).href;
      } catch {
        return;
      }
      images += 1;
      blocks.push({ type: 'img', src, alt: decodeEntities(node.attrs.alt || '').trim() });
      return;
    }

    const blockType = CONTENT_TAGS[node.tag];
    if (blockType) {
      const text = decodeEntities(textOf(node)).replace(/\s+/g, ' ').trim();
      // 短段通常是图注、时间戳、导航碎屑，丢弃；样板文字（面包屑/转载声明等）同样丢弃
      if (text.length >= 15 && !seen.has(text) && !TEXT_NOISE_RE.test(text)) {
        seen.add(text);
        blocks.push({ type: blockType, text });
      }
      return; // 块内不再深入（li 里的 p 不重复收）
    }

    for (const child of node.children) walk(child);
  })(container);

  return blocks;
}

/** <title> 提取与清洗 */
function titleOf(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return decodeEntities(match[1]).replace(/\s+/g, ' ').trim();
}

/**
 * HTML -> 结构化正文。
 * @returns {{title: string, blocks: Array}} blocks 为空表示提取失败
 */
export function htmlToArticle(html, pageUrl) {
  const root = parse(html);
  const container = bestContainer(root) || root;
  const blocks = collect(container, pageUrl);
  const paragraphCount = blocks.filter((block) => block.type === 'p').length;
  if (paragraphCount < 2 && !blocks.some((block) => block.type === 'img')) {
    return { title: titleOf(html), blocks: [] };
  }
  return { title: titleOf(html), blocks };
}
