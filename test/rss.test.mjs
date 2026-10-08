import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseDate, parseFeed } from '../scripts/lib/rss.mjs';

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>示例源</title>
  <item>
    <title><![CDATA[GPT-6 正式发布]]></title>
    <link>https://example.com/a?utm_source=rss</link>
    <description><![CDATA[<p>这是摘要，包含 <b>HTML</b> 标签，用来验证清洗逻辑是否工作正常。</p>]]></description>
    <pubDate>Thu, 08 Oct 2026 10:23:53 +0000</pubDate>
    <dc:creator>作者甲</dc:creator>
  </item>
  <item>
    <title>没有链接的条目</title>
    <description>应被丢弃</description>
  </item>
  <item>
    <title>第二条</title>
    <link>https://example.com/b</link>
    <description>短摘要</description>
    <content:encoded><![CDATA[<p>较长的正文内容用来作为摘要来源，长度超过四十个字符的限制，因此会被优先采用。</p>]]></content:encoded>
    <pubDate>2026-10-07T08:00:00Z</pubDate>
  </item>
</channel></rss>`;

const ATOM_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom 示例</title>
  <entry>
    <title>Claude 新版上线</title>
    <link rel="alternate" type="text/html" href="https://example.org/posts/1"/>
    <link rel="self" href="https://example.org/feed/1"/>
    <summary>摘要文本</summary>
    <published>2026-10-08T09:00:00Z</published>
    <author><name>作者乙</name></author>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('解析 RSS，清洗标题摘要并丢弃无链接条目', () => {
    const items = parseFeed(RSS_SAMPLE, { id: 'demo', name: '示例源' });
    assert.equal(items.length, 2);
    assert.equal(items[0].title, 'GPT-6 正式发布');
    assert.equal(items[0].url, 'https://example.com/a');
    assert.match(items[0].summary, /这是摘要，包含 HTML 标签/);
    assert.equal(items[0].publishedRaw, 'Thu, 08 Oct 2026 10:23:53 +0000');
    assert.equal(items[0].source, '示例源');
  });

  it('描述过短时回退到 content:encoded', () => {
    const items = parseFeed(RSS_SAMPLE, { id: 'demo', name: '示例源' });
    assert.match(items[1].summary, /较长的正文内容/);
  });

  it('解析 Atom 的 link 属性与 published', () => {
    const items = parseFeed(ATOM_SAMPLE, { id: 'atom', name: 'Atom 示例' });
    assert.equal(items.length, 1);
    assert.equal(items[0].url, 'https://example.org/posts/1');
    assert.equal(items[0].publishedRaw, '2026-10-08T09:00:00Z');
    assert.equal(items[0].author, '作者乙');
  });

  it('空文档返回空数组', () => {
    assert.deepEqual(parseFeed('', {}), []);
  });
});

describe('parseDate', () => {
  it('解析 RFC822 与 ISO', () => {
    assert.equal(parseDate('Thu, 08 Oct 2026 10:23:53 +0000').toISOString(), '2026-10-08T10:23:53.000Z');
    assert.equal(parseDate('2026-10-08T09:00:00Z').toISOString(), '2026-10-08T09:00:00.000Z');
  });

  it('解析常见中文写法与时间戳', () => {
    assert.equal(parseDate('2026-10-08 09:30:00').getFullYear(), 2026);
    assert.equal(parseDate('1760000000').getTime(), 1760000000000);
    assert.equal(parseDate('1760000000000').getTime(), 1760000000000);
  });

  it('无法解析时返回 null', () => {
    assert.equal(parseDate(''), null);
    assert.equal(parseDate('刚刚'), null);
  });
});