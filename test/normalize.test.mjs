import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDataset,
  CATEGORIES,
  classify,
  dayKey,
  dayLabel,
  dedupeItems,
  detectDealType,
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
  it('标题命中强信号即可', () => {
    assert.equal(isAiRelated('OpenAI 发布新东西'), true);
    assert.equal(isAiRelated('某公司发布 Agent 中间层'), true);
  });

  it('标题命中弱信号也算 AI 主题', () => {
    assert.equal(isAiRelated('人形机器人第一股'), true);
    assert.equal(isAiRelated('新一代智能驾驶方案落地'), true);
  });

  it('只看标题，正文提到 AI 不改变判定', () => {
    assert.equal(isAiRelated('赛力斯 9 月产销快报'), false);
    assert.equal(isAiRelated('苹果 iPad mini 8 本月发布'), false);
    assert.equal(isAiRelated('优派推出新款 27 寸显示器'), false);
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

describe('detectDealType（免费/优惠渠道识别）', () => {
  it('识别具体模型的免费使用信号', () => {
    assert.equal(detectDealType('OpenAI 向免费用户开放 GPT-6'), 'free');
    assert.equal(detectDealType('Kimi 赠送新用户百万 token'), 'free');
    assert.equal(detectDealType('Gemini 2.5 免费版扩容'), 'free');
    assert.equal(detectDealType('Anthropic makes Claude free for everyone'), 'free');
  });

  it('识别 API 降价与折扣信号', () => {
    assert.equal(detectDealType('DeepSeek API 宣布降价'), 'discount');
    assert.equal(detectDealType('OpenAI offers a discount on API'), 'discount');
    assert.equal(detectDealType('New price cut for Gemini API'), 'discount');
    assert.equal(detectDealType('OpenAI cuts the price of its API'), 'discount');
    assert.equal(detectDealType('Claude Haiku 5.5 arrives with price cuts'), 'discount');
  });

  it('识别订阅 / Coding Plan 优惠', () => {
    assert.equal(detectDealType('Claude 会员 5 折结算'), 'discount');
    assert.equal(detectDealType('Cursor Coding Plan 限时优惠 5 折'), 'discount');
    assert.equal(detectDealType('GitHub Copilot 学生免费认证开放'), 'free');
    assert.equal(detectDealType('免费领取 Claude API，叠加限时折扣'), 'free', '免费与优惠同时命中按免费归类');
  });

  it('识别国内 Agent 上的具体渠道信息', () => {
    assert.equal(detectDealType('DeepSeek V4.1 Flash 在 Qoder CN 限时免费使用'), 'free');
    assert.equal(detectDealType('智谱 Zcode 新用户每天可免费领取 token'), 'free');
    assert.equal(detectDealType('Trae Coding Plan 限时 5 折'), 'discount');
    assert.equal(detectDealType('腾讯 CodeBuddy 上线某模型免费额度'), 'free');
  });

  it('只认具体产品：泛指 AI / 模型的免费信息不算渠道', () => {
    assert.equal(detectDealType('被这个新出的免费国产 AI 接住了！'), null);
    assert.equal(detectDealType('奔驰 E 300 L 起售价下调 1.6 万元，首发 AI 座舱'), null);
    assert.equal(detectDealType('AI 公司免费上门修水电，只为录像训练机器人'), null);
    assert.equal(detectDealType('Epic 喜加二：游戏限时免费领取'), null);
    assert.equal(detectDealType('罗技又侮辱用户像狗，「一打折就凑上来」'), null);
    assert.equal(detectDealType('Meta may train AI on news sites for free'), null);
  });

  it('早报 / 合集类标题直接排除', () => {
    assert.equal(detectDealType('AI 早报 1023：GPT-6 限时免费开放'), null);
  });

  it('交易词指向的不是模型/订阅本身时排除', () => {
    assert.equal(detectDealType('消息称 OpenAI 融资磋商进入尾声，估值目标下调至 1.25 万亿美元'), null);
    assert.equal(detectDealType('Anthropic launches a free AI scanner for open-source projects'), null);
    assert.equal(detectDealType('AI 公司免费上门修水电，只为录像训练机器人'), null);
  });

  it('价格下调句式仍算折扣', () => {
    assert.equal(detectDealType('Claude API 价格下调 30%'), 'discount');
  });

  it('英文按词边界匹配，复合词不算信号', () => {
    assert.equal(detectDealType('Mistral discounting plans leak'), null);
    assert.equal(detectDealType('Nothing teases a screen-free AI device'), null);
    assert.equal(detectDealType('Nvidia makes robot labeling cheaper than GPT-6'), null);
  });

  it('没有渠道信号时返回 null', () => {
    assert.equal(detectDealType('OpenAI 发布 GPT-6 模型'), null);
    assert.equal(detectDealType('某某公司完成新一轮融资'), null);
    assert.equal(detectDealType(''), null);
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

  it('按标题打渠道标记，bulk 论文源不参与', () => {
    const deal = makeItem(raw({ title: '某大模型 API 宣布降价' }), { now });
    assert.equal(deal.dealType, 'discount');
    const paper = makeItem(raw({ title: 'No Free Lunch in Model Training', bulk: true }), { now });
    assert.equal(paper.dealType, null);
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