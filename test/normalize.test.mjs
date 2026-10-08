import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDataset,
  CATEGORIES,
  classify,
  dayKey,
  dayLabel,
  dedupeItems,
  hotKeywordHits,
  hotScore,
  isAiRelated,
  makeItem,
  matchesKeyword,
} from '../scripts/lib/normalize.mjs';

const HOUR = 3600000;

function raw(overrides = {}) {
  return {
    title: 'OpenAI 发布 GPT-6 模型',
    url: 'https://example.com/gpt6',
    summary: 'OpenAI 今日正式发布新一代模型，参数规模与推理能力均有显著提升。',
    publishedRaw: 'Thu, 08 Oct 2026 10:00:00 +0000',
    sourceId: 'openai',
    source: 'OpenAI',
    home: 'https://example.com',
    weight: 2.5,
    ...overrides,
  };
}

describe('matchesKeyword', () => {
  it('英文关键词按词边界匹配', () => {
    assert.equal(matchesKeyword('OpenAI said today', 'ai'), false);
    assert.equal(matchesKeyword('AI 正在改变世界', 'ai'), true);
    assert.equal(matchesKeyword('an email about ai', 'ai'), true);
  });

  it('中文关键词直接包含匹配', () => {
    assert.equal(matchesKeyword('大模型时代', '大模型'), true);
    assert.equal(matchesKeyword('无关内容', '大模型'), false);
  });
});

describe('isAiRelated', () => {
  it('强信号出现在标题即可', () => {
    assert.equal(isAiRelated('OpenAI 发布新东西', ''), true);
  });

  it('弱信号只在标题命中时才判定', () => {
    assert.equal(isAiRelated('人形机器人第一股', ''), true);
    assert.equal(isAiRelated('赛力斯 9 月产销快报', '该公司同时在推进芯片自研'), false);
  });

  it('摘要里的强信号也可以判定', () => {
    assert.equal(isAiRelated('某公司季度报告', '报告提到大模型带来的成本变化'), true);
  });

  it('完全无关的内容被排除', () => {
    assert.equal(isAiRelated('红魔 12 Pro+ 全新配色发布', '新机将于 10 月发售'), false);
  });
});

describe('classify', () => {
  it('识别模型发布', () => {
    assert.equal(classify('OpenAI 正式发布 GPT-6 模型', ''), '模型发布');
  });

  it('识别融资与商业新闻', () => {
    assert.equal(classify('某公司完成 5 亿美元融资，估值翻倍', ''), '行业动态');
  });

  it('识别论文与研究', () => {
    assert.equal(classify('团队提出新的训练算法', '论文已在 arXiv 公开'), '研究前沿');
  });

  it('无关键词时落到行业动态', () => {
    assert.equal(classify('一条普通消息', '没有明显特征词'), '行业动态');
  });

  it('分类结果始终属于预设分类', () => {
    for (const title of ['模型发布', '开源仓库', '访谈观点', '芯片算力']) {
      assert.ok(CATEGORIES.includes(classify(title, '')));
    }
  });
});

describe('dayKey / dayLabel', () => {
  it('按指定时区换算自然日', () => {
    const date = new Date('2026-10-08T16:30:00Z');
    assert.equal(dayKey(date, 'Asia/Shanghai'), '2026-10-09');
    assert.equal(dayKey(date, 'UTC'), '2026-10-08');
  });

  it('生成中文日期标签', () => {
    assert.equal(dayLabel('2026-10-08'), '10月8日 · 周四');
    assert.equal(dayLabel('2026-01-01'), '1月1日 · 周四');
  });
});

describe('makeItem', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');

  it('生成稳定 id 与分类', () => {
    const item = makeItem(raw(), { now });
    assert.equal(item.category, '模型发布');
    assert.equal(item.day, '2026-10-08');
    assert.equal(item.estimate, false);
    assert.match(item.id, /^[0-9a-z]{7}$/);
  });

  it('缺少发布时间时标记为估算并使用当前时间', () => {
    const item = makeItem(raw({ publishedRaw: '' }), { now });
    assert.equal(item.estimate, true);
    assert.equal(item.publishedTs, now);
  });

  it('未来时间收敛到当前时刻', () => {
    const item = makeItem(raw({ publishedRaw: 'Fri, 09 Oct 2026 10:00:00 +0000' }), { now });
    assert.equal(item.publishedTs, now);
    assert.equal(item.estimate, true);
  });

  it('按源配置修正错误时区', () => {
    const item = makeItem(raw({ publishedRaw: 'Thu, 08 Oct 2026 19:12:04 GMT', timeShiftHours: -8 }), { now });
    assert.equal(item.publishedAt, '2026-10-08T11:12:04.000Z');
  });

  it('对已归一化条目再处理是幂等的（保留原时间）', () => {
    const first = makeItem(raw(), { now });
    const second = makeItem({ ...first, publishedRaw: undefined }, { now: now + 5 * HOUR });
    assert.equal(second.publishedAt, first.publishedAt);
    assert.equal(second.estimate, false);
  });

  it('汇总源标注 lang 与 bulk', () => {
    const item = makeItem(raw({ bulk: true }), { now });
    assert.equal(item.bulk, true);
  });
});

describe('dedupeItems', () => {
  it('同一 URL 只保留一条', () => {
    const items = dedupeItems([makeItem(raw(), { now: 0 }), makeItem(raw({ title: '重复标题' }), { now: 0 })]);
    assert.equal(items.length, 1);
  });

  it('跨源转载合并并记录 alsoIn', () => {
    const a = makeItem(raw(), { now: 0 });
    const b = makeItem(raw({ url: 'https://other.com/gpt6', source: '机器之心', weight: 1.5 }), { now: 0 });
    const items = dedupeItems([a, b]);
    assert.equal(items.length, 1);
    assert.equal(items[0].source, 'OpenAI');
    assert.deepEqual(items[0].alsoIn, ['机器之心']);
  });
});

describe('hotScore / hotKeywordHits', () => {
  it('越新越热', () => {
    const now = Date.parse('2026-10-08T12:00:00Z');
    const fresh = makeItem(raw(), { now });
    const old = makeItem(raw({ url: 'https://example.com/old', publishedRaw: 'Mon, 05 Oct 2026 10:00:00 +0000' }), { now });
    assert.ok(hotScore(fresh, now) > hotScore(old, now));
  });

  it('关键词命中数可统计', () => {
    assert.equal(hotKeywordHits('正式发布并开源，突破纪录'), 3);
    assert.equal(hotKeywordHits('普通标题'), 0);
  });
});

describe('buildDataset', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');

  it('按天分组、统计并倒序排列', () => {
    const dataset = buildDataset(
      [
        raw(),
        raw({ url: 'https://example.com/old', title: '旧闻一则', publishedRaw: 'Mon, 05 Oct 2026 10:00:00 +0000' }),
      ],
      { now, timezone: 'Asia/Shanghai', retentionDays: 45 },
    );
    assert.equal(dataset.count, 2);
    assert.deepEqual(
      dataset.days.map((entry) => entry.day),
      ['2026-10-08', '2026-10-05'],
    );
    assert.equal(dataset.items[0].day, '2026-10-08');
    assert.equal(dataset.stats.languages.zh, 2);
    assert.equal(dataset.stats.sources.length, 1);
    assert.equal(dataset.items[0]._text, undefined);
  });

  it('超出保留期的条目被丢弃', () => {
    const dataset = buildDataset([raw({ publishedRaw: 'Mon, 01 Jun 2026 10:00:00 +0000' })], {
      now,
      retentionDays: 45,
    });
    assert.equal(dataset.count, 0);
  });

  it('丢弃缺少标题或链接的条目', () => {
    const dataset = buildDataset([raw({ title: '' }), raw({ url: '' }), raw({ url: 'ftp://x/y' })], { now });
    assert.equal(dataset.count, 0);
  });

  it('maxItems 生效', () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      raw({ url: `https://example.com/${index}`, title: `标题 ${index} 关于大模型` }),
    );
    assert.equal(buildDataset(many, { now, maxItems: 3 }).count, 3);
  });
});