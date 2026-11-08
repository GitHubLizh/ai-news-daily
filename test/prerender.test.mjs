import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildArchivePage, buildDayPage, escapeHtml, groupByDay, itemStaticHtml } from '../scripts/prerender.mjs';
import { buildSitemapXml } from '../scripts/sitemap.mjs';
import { parseSitemapUrls } from '../scripts/indexnow.mjs';

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

describe('首页静态 SEO', () => {
  it('包含通用关键词标题、静态介绍和真实归档链接', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    assert.ok(html.includes('<title>每日AI新闻聚合｜AI资讯速递</title>'));
    assert.ok(html.includes('class="site-intro"'));
    assert.ok(html.includes('<a class="calendar-archive-link" href="/day/">查看全部日期归档</a>'));
    assert.ok(!html.includes('<a href="/day/">每日 AI 新闻归档</a>'));
  });
});

describe('buildArchivePage', () => {
  it('包含独立元信息、可见 H1 和全部日期链接', () => {
    const html = buildArchivePage({
      site: SITE,
      days: [DAY, { day: '2026-10-18', label: '10月18日 <周日>', count: 2 }],
    });
    assert.ok(html.includes('<title>每日AI新闻归档｜AI 资讯速递</title>'));
    assert.ok(html.includes('<link rel="canonical" href="https://latestainews.cn/day/"'));
    assert.ok(html.includes('<h1>每日 AI 新闻归档</h1>'));
    assert.ok(html.includes('href="/day/2026-10-19/"'));
    assert.ok(html.includes('href="/day/2026-10-18/"'));
    assert.ok(html.includes('<span>1 条</span>'));
    assert.ok(html.includes('<span>2 条</span>'));
    assert.ok(html.includes('10月18日 &lt;周日&gt;'));
  });
});

describe('buildDayPage', () => {
  it('包含独立 title、description、canonical 与归档链接', () => {
    const html = buildDayPage({
      site: SITE,
      dayEntry: DAY,
      items: [ITEM],
      newerDay: { day: '2026-10-20', label: '10月20日 · 周二' },
      olderDay: { day: '2026-10-18', label: '10月18日 · 周日' },
      timezone: 'Asia/Shanghai',
    });
    assert.ok(html.includes('<title>2026-10-19 每日AI新闻（1 条）｜AI 资讯速递</title>'));
    assert.ok(html.includes('<link rel="canonical" href="https://latestainews.cn/day/2026-10-19/"'));
    assert.ok(html.includes('<h1 class="archive-day-title">2026-10-19 每日 AI 新闻</h1>'));
    assert.ok(html.includes('href="/day/"'));
    assert.ok(html.includes('href="/day/2026-10-20/"'));
    assert.ok(html.includes('href="/day/2026-10-18/"'));
    assert.ok(html.includes('<link rel="icon" href="/favicon.ico" sizes="any" />'));
    assert.ok(html.includes('<img src="/assets/logo.png" width="34" height="34" alt="" />'));
  });

  it('没有前后日期时仍保留归档和交互版链接', () => {
    const html = buildDayPage({
      site: SITE,
      dayEntry: DAY,
      items: [ITEM],
      newerDay: null,
      olderDay: null,
      timezone: 'Asia/Shanghai',
    });
    assert.ok(!html.includes('href="/day/2026-10-20/"'));
    assert.ok(html.includes('全部归档'));
    assert.ok(html.includes('交互版'));
  });
});

describe('buildSitemapXml', () => {
  it('首页和归档索引在前，日期页在后', () => {
    const xml = buildSitemapXml('https://latestainews.cn/', [DAY, { day: '2026-10-18' }], '2026-10-19');
    const homepageIndex = xml.indexOf('<loc>https://latestainews.cn/</loc>');
    const archiveIndex = xml.indexOf('<loc>https://latestainews.cn/day/</loc>');
    const dayIndex = xml.indexOf('<loc>https://latestainews.cn/day/2026-10-19/</loc>');
    assert.ok(homepageIndex >= 0 && homepageIndex < archiveIndex);
    assert.ok(archiveIndex < dayIndex);
    assert.ok(xml.includes('<lastmod>2026-10-18</lastmod>'));
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  });

  it('site.url 末尾斜杠会被去掉', () => {
    const xml = buildSitemapXml('https://latestainews.cn///', [DAY], '2026-10-19');
    assert.ok(!xml.includes('latestainews.cn///'));
    assert.ok(xml.includes('<loc>https://latestainews.cn/day/</loc>'));
    assert.ok(xml.includes('<loc>https://latestainews.cn/day/2026-10-19/</loc>'));
  });
});

describe('parseSitemapUrls', () => {
  it('从 sitemap.xml 提取全部 URL', () => {
    const xml = buildSitemapXml('https://latestainews.cn', [DAY], '2026-10-19');
    assert.deepEqual(parseSitemapUrls(xml), [
      'https://latestainews.cn/',
      'https://latestainews.cn/day/',
      'https://latestainews.cn/day/2026-10-19/',
    ]);
  });

  it('空 sitemap 返回空数组', () => {
    assert.deepEqual(parseSitemapUrls('<urlset></urlset>'), []);
  });
});
