import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildRssXml, escapeXml } from '../scripts/lib/feed.mjs';

const dataset = {
  generatedAt: '2026-10-08T11:00:00.000Z',
  items: [
    {
      title: 'GPT-6 发布 & 开源 <重磅>',
      url: 'https://example.com/a?x=1&y=2',
      summary: '摘要文本',
      source: 'OpenAI',
      category: '模型发布',
      alsoIn: ['机器之心'],
      publishedTs: Date.parse('2026-10-08T10:00:00Z'),
    },
    {
      title: '第二条',
      url: 'https://example.com/b',
      summary: '',
      source: '量子位',
      category: '行业动态',
      alsoIn: [],
      publishedTs: Date.parse('2026-10-07T10:00:00Z'),
    },
  ],
};

describe('escapeXml', () => {
  it('转义 XML 特殊字符', () => {
    assert.equal(escapeXml('a & b < c > d " e \' f'), 'a &amp; b &lt; c &gt; d &quot; e &apos; f');
  });

  it('去掉 XML 不允许的控制字符', () => {
    assert.equal(escapeXml('a\u0000b\u0008c\u001fd'), 'abcd');
  });
});

describe('buildRssXml', () => {
  const xml = buildRssXml(dataset, { title: 'AI 资讯速递', url: 'https://example.github.io/news/' }, { limit: 10 });

  it('生成 RSS 2.0 骨架与命名空间', () => {
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">/);
    assert.match(xml, /<title>AI 资讯速递<\/title>/);
  });

  it('self 链接指向站点内的 feed.xml', () => {
    assert.match(xml, /<atom:link href="https:\/\/example\.github\.io\/news\/data\/feed\.xml" rel="self"/);
  });

  it('条目字段完整且已转义', () => {
    assert.match(xml, /<title>GPT-6 发布 &amp; 开源 &lt;重磅&gt;<\/title>/);
    assert.match(xml, /<link>https:\/\/example\.com\/a\?x=1&amp;y=2<\/link>/);
    assert.match(xml, /<guid isPermaLink="true">https:\/\/example\.com\/a\?x=1&amp;y=2<\/guid>/);
    assert.match(xml, /<pubDate>Thu, 08 Oct 2026 10:00:00 GMT<\/pubDate>/);
    assert.match(xml, /<category>模型发布<\/category>/);
    assert.match(xml, /<description>摘要文本（OpenAI · 模型发布 · 另见 机器之心）<\/description>/);
  });

  it('英文摘要与括号之间补空格，中文摘要不补', () => {
    const en = buildRssXml(
      { items: [{ ...dataset.items[0], title: 'GPT-6 released', summary: 'OpenAI ships GPT-6.' }] },
      {},
    );
    assert.match(en, /<description>OpenAI ships GPT-6\. （OpenAI/);
  });

  it('limit 生效', () => {
    assert.equal((xml.match(/<item>/g) || []).length, 2);
    const single = buildRssXml(dataset, {}, { limit: 1 });
    assert.equal((single.match(/<item>/g) || []).length, 1);
  });

  it('没有站点地址时 self 使用相对路径', () => {
    assert.match(buildRssXml(dataset, {}), /<atom:link href="data\/feed\.xml" rel="self"/);
  });

  it('空数据集也能生成合法文档', () => {
    const empty = buildRssXml({ items: [] }, { title: 't', url: 'https://x.dev' });
    assert.match(empty, /<\/channel>/);
    assert.equal((empty.match(/<item>/g) || []).length, 0);
  });
});