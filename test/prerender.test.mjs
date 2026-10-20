import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildDayPage, escapeHtml, groupByDay, itemStaticHtml } from '../scripts/prerender.mjs';
import { buildSitemapXml } from '../scripts/sitemap.mjs';

const ITEM = {
  id: 'a1',
  title: '某模型发布 <新版本> & 亮点',
  url: 'https://example.com/news/1',
  summary: '摘要里有 "引号" 与 <tag>',
  source: '量子位',
  category: '模型发布',
  day: '2026-10-19',
  publishedTs: Date.UTC(2026, 9, 19, 1, 30),
};

const SITE = { title: 'AI 资讯速递', url: 'https://latestainews.cn' };
const DAY = { day: '2026-10-19', label: '10月19日 · 周一', count: 1 };

describe('escapeHtml', () => {
  it('转义 HTML 特殊字符', () => {
    assert.equal(escapeHtml('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('空值兜底为空串', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });
});

describe('itemStaticHtml', () => {
  it('标题与摘要经过转义，原文链接保留', () => {
    const html = itemStaticHtml(ITEM, 'Asia/Shanghai');
    assert.ok(!html.includes('<新版本>'));
    assert.ok(html.includes('&lt;新版本&gt;'));
    assert.ok(!html.includes('<tag>'));
    assert.ok(html.includes('href="https://example.com/news/1"'));
    assert.ok(html.includes('量子位'));
  });

  it('没有摘要时不输出摘要段落', () => {
    const html = itemStaticHtml({ ...ITEM, summary: '' }, 'Asia/Shanghai');
    assert.ok(!html.includes('item-summary'));
  });
});

describe('groupByDay', () => {
  it('按 day 字段分组', () => {
    const map = groupByDay({ items: [ITEM, { ...ITEM, id: 'b', day: '2026-10-18' }, { ...ITEM, id: 'c' }] });
    assert.equal(map.get('2026-10-19').length, 2);
    assert.equal(map.get('2026-10-18').length, 1);
  });
});

describe('buildDayPage', () => {
  it('包含独立 title、description 与 canonical', () => {
    const html = buildDayPage({
      site: SITE,
      dayEntry: DAY,
      items: [ITEM],
      newerDay: { day: '2026-10-20', label: '10月20日 · 周二' },
      olderDay: { day: '2026-10-18', label: '10月18日 · 周日' },
      timezone: 'Asia/Shanghai',
    });
    assert.ok(html.includes('<title>AI 资讯速递 · 10月19日 · 周一 AI 新闻（1 条）</title>'));
    assert.ok(html.includes('<link rel="canonical" href="https://latestainews.cn/day/2026-10-19/"'));
    assert.ok(html.includes('href="/day/2026-10-20/"'));
    assert.ok(html.includes('href="/day/2026-10-18/"'));
  });

  it('没有前后日期时不输出对应链接', () => {
    const html = buildDayPage({
      site: SITE,
      dayEntry: DAY,
      items: [ITEM],
      newerDay: null,
      olderDay: null,
      timezone: 'Asia/Shanghai',
    });
    assert.ok(!html.includes('href="/day/2026-10-20/"'));
    assert.ok(html.includes('交互版'));
  });
});

describe('buildSitemapXml', () => {
  it('首页在前，日期页在后', () => {
    const xml = buildSitemapXml('https://latestainews.cn/', [DAY, { day: '2026-10-18' }], '2026-10-19');
    assert.ok(xml.indexOf('<loc>https://latestainews.cn/</loc>') < xml.indexOf('<loc>https://latestainews.cn/day/2026-10-19/</loc>'));
    assert.ok(xml.includes('<lastmod>2026-10-18</lastmod>'));
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  });

  it('site.url 末尾斜杠会被去掉', () => {
    const xml = buildSitemapXml('https://latestainews.cn///', [DAY], '2026-10-19');
    assert.ok(!xml.includes('latestainews.cn///'));
    assert.ok(xml.includes('<loc>https://latestainews.cn/day/2026-10-19/</loc>'));
  });
});
