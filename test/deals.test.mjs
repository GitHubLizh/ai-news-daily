import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALIYUN_BAILIAN_FREE_URL,
  SILICONFLOW_PRICING_URL,
  buildDealsDataset,
  dealsFromSearchItems,
  googleNewsUrl,
  newsItemsToDealRaws,
  openRouterFreeModels,
  siliconFlowFreeModels,
  aliyunBailianFreeQuota,
  aliyunTokenPlanRaws,
  volcEngineDiscountRaws,
  SEARCH_QUERIES,
} from '../scripts/lib/deals.mjs';

const NOW = Date.parse('2026-11-12T04:00:00Z'); // 北京时间 12:00
const DAY = 86400000;

describe('openRouterFreeModels', () => {
  const api = {
    data: [
      { id: 'acme/paid', name: 'Acme Paid', created: (NOW - 3 * DAY) / 1000 },
      { id: 'acme/fresh:free', name: 'Acme Fresh (free)', created: (NOW - 2 * DAY) / 1000, canonical_slug: 'acme/fresh-20261110', description: 'A great model.' },
      { id: 'acme/old-free:free', name: 'Acme Old Free (free)', created: (NOW - 30 * DAY) / 1000, canonical_slug: 'acme/old' },
    ],
  };

  it('快照条目按日生成且计入免费模型总数', () => {
    const { snapshot } = openRouterFreeModels(api, { now: NOW });
    assert.equal(snapshot.kind, 'platform');
    assert.equal(snapshot.dealType, 'free');
    assert.match(snapshot.title, /2 个模型/);
    assert.ok(snapshot.url.endsWith('day=2026-11-12'), snapshot.url);
    assert.equal(snapshot.source, 'OpenRouter');
  });

  it('只把近 7 天上架的免费模型逐个成条', () => {
    const { fresh } = openRouterFreeModels(api, { now: NOW });
    assert.equal(fresh.length, 1);
    assert.match(fresh[0].title, /Acme Fresh/);
    assert.equal(fresh[0].url, 'https://openrouter.ai/acme/fresh-20261110');
    assert.equal(fresh[0].kind, 'platform');
  });

  it('空清单不崩溃', () => {
    const { snapshot, fresh } = openRouterFreeModels({ data: [] }, { now: NOW });
    assert.match(snapshot.title, /0 个模型/);
    assert.equal(fresh.length, 0);
  });
});

describe('dealsFromSearchItems / newsItemsToDealRaws', () => {
  it('搜索结果只保留可识别渠道，标记 kind=search', () => {
    const raws = dealsFromSearchItems([
      { title: 'DeepSeek API 宣布降价', url: 'https://example.com/a', source: 'Google 资讯' },
      { title: '某某公司完成融资', url: 'https://example.com/b', source: 'Google 资讯' },
    ]);
    assert.equal(raws.length, 1);
    assert.equal(raws[0].dealType, 'discount');
    assert.equal(raws[0].kind, 'search');
  });

  it('资讯条目按 dealType 带入，保留 alsoIn 供跨源合并', () => {
    const raws = newsItemsToDealRaws([
      { title: 'GPT-6今起免费用！', url: 'https://example.com/gpt6', dealType: 'free', alsoIn: ['量子位'] },
      { title: '普通资讯', url: 'https://example.com/x', dealType: null },
    ]);
    assert.equal(raws.length, 1);
    assert.equal(raws[0].kind, 'news');
    assert.deepEqual(raws[0].alsoIn, ['量子位']);
  });
});

describe('buildDealsDataset', () => {
  const platformRaw = {
    title: 'OpenRouter 免费模型日报：当前 2 个模型可零成本调用',
    url: 'https://openrouter.ai/models?max_price=0&day=2026-11-12',
    summary: '当前可直接免费调用的模型 2 个。',
    publishedRaw: new Date(NOW).toISOString(),
    source: 'OpenRouter',
    sourceId: 'openrouter',
    home: 'https://openrouter.ai',
    lang: 'zh',
    weight: 2.5,
    dealType: 'free',
    kind: 'platform',
  };
  const searchRaw = (url) => ({
    title: 'DeepSeek API 宣布降价',
    url,
    summary: '输入输出价格全面下调',
    publishedRaw: 'Wed, 11 Nov 2026 10:00:00 +0000',
    source: 'Google 资讯',
    sourceId: 'gnews-deals',
    home: 'https://news.google.com',
    lang: 'zh',
    weight: 1.5,
    dealType: 'discount',
    kind: 'search',
  });

  it('三路来源合并、跨源同题去重、按日分组倒序', () => {
    const dataset = buildDealsDataset(
      [
        platformRaw,
        searchRaw('https://example.com/a'),
        { ...searchRaw('https://example.com/b'), source: '量子位', kind: 'news' },
        { ...searchRaw('https://example.com/old'), publishedRaw: 'Sun, 20 Sep 2026 10:00:00 +0000' },
      ],
      { now: NOW, timezone: 'Asia/Shanghai', retentionDays: 45 },
    );
    assert.equal(dataset.count, 2);
    assert.equal(dataset.items[0].day, '2026-11-12');
    assert.equal(dataset.items[0].dealType, 'free');
    assert.equal(dataset.items[0].kind, 'platform');
    // 「日报」不在关键词规则里，渠道类型必须以来源标注为准而不能被重判为 null
    assert.equal(dataset.items[1].dealType, 'discount');
    assert.equal(dataset.days[0].day, '2026-11-12');
    const kinds = Object.fromEntries(dataset.stats.kinds.map((entry) => [entry.name, entry.count]));
    assert.equal(kinds.platform, 1);
    assert.equal(kinds.search, 1);
  });

  it('平台直连条目的中文标题不被语种检测误判成英文', () => {
    const fresh = {
      title: 'OpenRouter 新增免费模型：Baidu: ERNIE-5.5-Flash-Preview',
      url: 'https://openrouter.ai/baidu/ernie-5.5-flash-preview-20261110',
      summary: 'ERNIE 5.5 Flash Preview is the latest foundation model from Baidu.',
      publishedRaw: new Date(NOW).toISOString(),
      source: 'OpenRouter',
      sourceId: 'openrouter',
      home: 'https://openrouter.ai',
      lang: 'zh',
      weight: 2.5,
      dealType: 'free',
      kind: 'platform',
    };
    const dataset = buildDealsDataset([fresh], { now: NOW, timezone: 'Asia/Shanghai' });
    assert.equal(dataset.count, 1);
    assert.equal(dataset.items[0].lang, 'zh');
  });

  it('缺 dealType 或缺链接的 raw 直接丢弃', () => {
    const dataset = buildDealsDataset(
      [
        { title: '没有渠道标记', url: 'https://example.com/x' },
        { title: '缺少链接', url: '', dealType: 'free' },
      ],
      { now: NOW },
    );
    assert.equal(dataset.count, 0);
  });
});

describe('volcEngineDiscountRaws（火山方舟官方折扣页）', () => {
  // 页面结构的最小片段：同时挂着进行中与已结束的活动
  const HTML = `
    <p>活动期间，模型抵扣系数在现有抵扣系数基础上享最低 2.5 折优惠。</p>
    <ul>
      <li>Auto 模式：2026年6月10日18:00:00至2026年11月8日23:59:59</li>
      <li>deepseek-v4.1-flash 模型：2026年11月7日00:00:00至2026年12月30日23:59:59</li>
      <li>kimi-k3 模型：2026年10月12日00:00:00至2026年10月25日23:59:59</li>
      <li>格式异常条目 模型：某个无效时间至2026年12月31日23:59:59</li>
    </ul>`;
  const NOW = Date.parse('2026-11-12T04:00:00Z'); // 北京时间 11月12日 12:00

  it('只保留当前进行中的模型折扣，并带起止时间', () => {
    const raws = volcEngineDiscountRaws(HTML, { now: NOW });
    assert.equal(raws.length, 1);
    const raw = raws[0];
    assert.match(raw.title, /deepseek-v4\.1-flash 模型抵扣系数最低 2\.5 折/);
    assert.equal(raw.dealType, 'discount');
    assert.equal(raw.kind, 'platform');
    assert.equal(raw.lang, 'zh');
    assert.match(raw.summary, /11月7日.*至.*12月30日/);
  });

  it('进行中的活动按抓取时刻归档，开始日早于保留期也不会被误丢', () => {
    const raws = volcEngineDiscountRaws(HTML, { now: NOW });
    const dataset = buildDealsDataset(raws, { now: NOW, timezone: 'Asia/Shanghai', retentionDays: 45 });
    assert.equal(dataset.count, 1);
    assert.equal(dataset.items[0].day, '2026-11-12');
  });

  it('活动结束后条目自动消失', () => {
    const later = Date.parse('2026-12-31T12:00:00Z'); // 北京时间 12月31日，所有活动已结束
    assert.equal(volcEngineDiscountRaws(HTML, { now: later }).length, 0);
  });

  it('空页面与未匹配格式不崩溃', () => {
    assert.deepEqual(volcEngineDiscountRaws('', { now: NOW }), []);
    assert.deepEqual(volcEngineDiscountRaws('<li>deepseek 模型：没有时间</li>', { now: NOW }), []);
  });
});

describe('siliconFlowFreeModels（硅基流动定价页）', () => {
  const HTML = `
    <div>tencent/Hunyuan-MT-7B</div><span>免费</span>
    <div>收费模型A/price</div><span>每千 Tokens</span>
    <div>BAAI/bge-m3</div><span>免费</span>
    <div>展开更多</div><span>免费</span>
    <div>Qwen/Qwen-Image</div><span>每图片</span>`;
  const NOW = Date.parse('2026-11-12T04:00:00Z');

  it('把「免费」徽章与前面的模型 id 配对并去重', () => {
    const { models, snapshot } = siliconFlowFreeModels(HTML, { now: NOW });
    // Hunyuan 与 bge-m3 是免费徽章；Qwen-Image 的徽章是「每图片」，不算免费
    assert.deepEqual(models, ['tencent/Hunyuan-MT-7B', 'BAAI/bge-m3']);
    assert.match(snapshot.title, /当前 2 个模型可零成本调用/);
    assert.match(snapshot.summary, /Hunyuan-MT-7B/);
    assert.equal(snapshot.dealType, 'free');
    assert.equal(snapshot.kind, 'platform');
    assert.equal(snapshot.lang, 'zh');
    assert.ok(snapshot.url.startsWith(SILICONFLOW_PRICING_URL));
  });

  it('没有免费模型时不产快照', () => {
    const { models, snapshot } = siliconFlowFreeModels('<div>a/b</div><span>每图片</span>', { now: NOW });
    assert.deepEqual(models, []);
    assert.equal(snapshot, null);
  });
});

describe('aliyunBailianFreeQuota（百炼新人免费额度）', () => {
  const HTML = '当您首次开通阿里云百炼时，平台会自动为您发放各模型的新人专属免费额度，有效期 90 天。';
  const NOW = Date.parse('2026-11-12T04:00:00Z');

  it('页面标记齐全时产出政策快照条目', () => {
    const raws = aliyunBailianFreeQuota(HTML, { now: NOW });
    assert.equal(raws.length, 1);
    assert.equal(raws[0].dealType, 'free');
    assert.equal(raws[0].kind, 'platform');
    assert.equal(raws[0].lang, 'zh');
    assert.equal(raws[0].url, ALIYUN_BAILIAN_FREE_URL);
    assert.match(raws[0].title, /新用户开通即领/);
  });

  it('关键标记缺失（页面改版 / 政策下线）时不产出，避免旧文案误导', () => {
    assert.deepEqual(aliyunBailianFreeQuota('新人免费额度规则已调整，有效期改为 30 天', { now: NOW }), []);
    assert.deepEqual(aliyunBailianFreeQuota('', { now: NOW }), []);
  });
});

describe('aliyunTokenPlanRaws（阿里云 Token Plan 活动页）', () => {
  const HTML = `
    <span>Qwen4-Max 首发 Token Plan 低至 5 折</span>
    <span>调用 Qwen4-Max 预览版限时 2 折，Harness 权益每月免费送</span>
    <span>Qwen4-Max 预览版首发体验限时 2 折，个人版额度大幅提升 78%</span>
    <span>个人版-低至5折</span>
    <span>普通横幅，没有折扣信息</span>`;
  const NOW = Date.parse('2026-11-12T04:00:00Z');

  it('提取带模型名的折扣句，按「模型+折扣」去重，标题截到折扣值', () => {
    const raws = aliyunTokenPlanRaws(HTML, { now: NOW });
    // 预览版两句是同一活动（Qwen4-Max + 2 折），只留一条；5 折那条独立保留
    assert.equal(raws.length, 2);
    assert.match(raws[0].title, /阿里云 Token Plan 在售优惠：Qwen4-Max 首发 Token Plan 低至 5 折$/);
    assert.match(raws[1].title, /阿里云 Token Plan 在售优惠：调用 Qwen4-Max 预览版限时 2 折$/);
    assert.match(raws[1].summary, /Harness 权益每月免费送/);
    assert.equal(raws[0].dealType, 'discount');
    assert.equal(raws[0].kind, 'platform');
    assert.notEqual(raws[0].url, raws[1].url);
  });

  it('活动结束 / 页面改版时解析不到即 0 条', () => {
    assert.deepEqual(aliyunTokenPlanRaws('<span>活动已结束</span>', { now: NOW }), []);
    assert.deepEqual(aliyunTokenPlanRaws('', { now: NOW }), []);
  });
});

describe('搜索配置', () => {
  it('查询词覆盖国内 Agent、新用户福利与海外订阅三类信号', () => {
    assert.ok(SEARCH_QUERIES.length >= 8);
    assert.ok(SEARCH_QUERIES.some((query) => query.includes('Qoder')));
    assert.ok(SEARCH_QUERIES.some((query) => query.includes('新用户')));
    assert.ok(SEARCH_QUERIES.some((query) => query.includes('Coding Plan')));
  });

  it('生成的 Google News URL 已编码并指向中文区', () => {
    const url = googleNewsUrl('大模型 免费 API');
    assert.ok(url.includes(encodeURIComponent('大模型 免费 API')));
    assert.ok(url.includes('hl=zh-CN'));
  });
});
