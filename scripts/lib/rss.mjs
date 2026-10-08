/**
 * 极简 RSS 2.0 / Atom 解析器。
 * 只取聚合资讯需要的字段，用正则而非 DOM，保持零依赖且对
 * 各家不规范 feed 有容错能力（CDATA、命名空间、属性型 link 等）。
 */
import { canonicalUrl, stripHtml, unwrapCdata } from './text.mjs';

function firstTag(block, names) {
  for (const name of names) {
    const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
    const match = block.match(pattern);
    if (match && match[1] && match[1].trim()) return match[1];
  }
  return '';
}

function atomLink(block) {
  const links = block.match(/<link\b[^>]*\/?>/gi) || [];
  let fallback = '';
  for (const link of links) {
    const href = (link.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const rel = (link.match(/rel\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!rel || rel.toLowerCase() === 'alternate') return href;
    if (!fallback && rel.toLowerCase() === 'self') fallback = href;
  }
  return fallback;
}

/** 解析一篇 feed，返回未归一化的条目数组 */
export function parseFeed(xml, feedMeta = {}) {
  const text = unwrapCdata(String(xml ?? ''));
  const blocks = [];
  for (const re of [/<item\b[\s\S]*?<\/item>/gi, /<entry\b[\s\S]*?<\/entry>/gi]) {
    const found = text.match(re);
    if (found) blocks.push(...found);
  }

  const items = [];
  for (const block of blocks) {
    const title = stripHtml(firstTag(block, ['title']));
    const link = canonicalUrl(
      stripHtml(firstTag(block, ['link'])) || atomLink(block) || stripHtml(firstTag(block, ['guid', 'id'])),
    );
    const description = firstTag(block, ['description', 'summary']);
    const content = firstTag(block, ['content:encoded', 'content']);
    const summarySource = stripHtml(description).length >= 40 ? description : content || description;
    const summary = stripHtml(summarySource);
    const published =
      firstTag(block, ['pubDate', 'published', 'updated', 'dc:date', 'date']) ||
      firstTag(block, ['pubdate']);
    const author = stripHtml(firstTag(block, ['dc:creator', 'author', 'name']));

    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      summary,
      author,
      publishedRaw: published.trim(),
      sourceId: feedMeta.id ?? '',
      source: feedMeta.name ?? '',
      home: feedMeta.home ?? '',
      lang: feedMeta.lang ?? '',
      weight: Number(feedMeta.weight) || 1,
    });
  }
  return items;
}

/** 解析各站五花八门的日期写法，失败返回 null */
export function parseDate(input) {
  const raw = stripHtml(input);
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  // 形如 "2026-10-08 09:30:00 +0800" / "Thu, 08 Oct 2026 09:30:00 GMT"
  const normalized = raw
    .replace(/\s+/g, ' ')
    .replace(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/, '$1-$2-$3T')
    .replace(/\s(\d{2}:\d{2}(?::\d{2})?)\s*\+(\d{4})$/, ' $1+$2');
  const retry = new Date(normalized);
  if (!Number.isNaN(retry.getTime())) return retry;

  const epoch = raw.match(/^(\d{10}|\d{13})$/);
  if (epoch) {
    const value = Number(epoch[1]);
    const ms = epoch[1].length === 13 ? value : value * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}