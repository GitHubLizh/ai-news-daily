import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalUrl,
  decodeEntities,
  detectLang,
  shortHash,
  stripHtml,
  titleKey,
  truncate,
  unwrapCdata,
} from '../scripts/lib/text.mjs';

describe('decodeEntities', () => {
  it('解码命名实体与数字实体', () => {
    assert.equal(decodeEntities('A&amp;B'), 'A&B');
    assert.equal(decodeEntities('&#39;quote&#39;'), "'quote'");
    assert.equal(decodeEntities('&#x27;x&#x27;'), "'x'");
    assert.equal(decodeEntities('a&nbsp;b'), 'a b');
    assert.equal(decodeEntities('“引号”&hellip;'), '“引号”…');
  });

  it('保留无法识别的实体原样', () => {
    assert.equal(decodeEntities('&notarealentity;'), '&notarealentity;');
  });
});

describe('stripHtml', () => {
  it('去掉标签、脚本与多余空白', () => {
    const html = '<p>Hello <b>AI</b></p><script>alert(1)</script><style>a{}</style>\n\n  世界  ';
    assert.equal(stripHtml(html), 'Hello AI 世界');
  });

  it('保留段落之间的空格而不是粘连', () => {
    assert.equal(stripHtml('<div>一</div><div>二</div>'), '一 二');
  });

  it('处理 CDATA 包裹', () => {
    assert.equal(stripHtml('<![CDATA[<p>正文</p>]]>'), '正文');
  });
});

describe('unwrapCdata', () => {
  it('剥离 CDATA 标记', () => {
    assert.equal(unwrapCdata('<![CDATA[abc]]>'), 'abc');
  });
});

describe('truncate', () => {
  it('中文按字符截断并追加省略号', () => {
    assert.equal(truncate('一二三四五', 3), '一二三…');
  });

  it('短文本原样返回', () => {
    assert.equal(truncate('短', 10), '短');
  });

  it('不会截断 emoji 代理对', () => {
    assert.equal(truncate('🚀🚀🚀', 2), '🚀🚀…');
  });
});

describe('titleKey', () => {
  it('忽略大小写、空白与标点', () => {
    assert.equal(titleKey('OpenAI 发布 GPT-5！'), titleKey('openai发布 gpt5'));
  });
});

describe('canonicalUrl', () => {
  it('去掉 hash、跟踪参数与末尾斜杠', () => {
    assert.equal(
      canonicalUrl('https://Example.com/news/1/?utm_source=x&from=weibo#top'),
      'https://example.com/news/1',
    );
  });

  it('保留业务参数并排序', () => {
    assert.equal(canonicalUrl('https://a.com/p?b=2&a=1'), 'https://a.com/p?a=1&b=2');
  });

  it('非法 URL 原样返回', () => {
    assert.equal(canonicalUrl('not a url'), 'not a url');
  });
});

describe('detectLang', () => {
  it('识别中文与英文', () => {
    assert.equal(detectLang('人工智能正在改变世界'), 'zh');
    assert.equal(detectLang('Artificial intelligence is changing the world'), 'en');
  });
});

describe('shortHash', () => {
  it('稳定且定长', () => {
    assert.equal(shortHash('https://a.com/1'), shortHash('https://a.com/1'));
    assert.notEqual(shortHash('https://a.com/1'), shortHash('https://a.com/2'));
    assert.match(shortHash('x'), /^[0-9a-z]{7}$/);
  });
});