import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALIYUN_BAILIAN_FREE_URL,
  DEEPSEEK_PRICING_URL,
  GLM_CODING_BUY_URL,
  MIMO_PRICING_DOC_URL,
  SILICONFLOW_PRICING_URL,
  TRAE_PRICING_URL,
  buildDealsDataset,
  dealsFromSearchItems,
  deepseekDiscountRaws,
  googleNewsUrl,
  mimoFreeRaws,
  mimoPromoRaws,
  newsItemsToDealRaws,
  openRouterFreeModels,
  qoderFreeTrialRaws,
  siliconFlowFreeModels,
  aliyunBailianFreeQuota,
  aliyunTokenPlanRaws,
  traeIntlFreeRaws,
  traePlanRaws,
  volcEngineDiscountRaws,
  zcodePlanRaws,
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

describe('zcodePlanRaws（ZCode 官网 GLM Coding 套餐）', () => {
  // 页面把套餐数据以转义 JSON 内嵌（与真实页面同构）：现价低于原价才有促销
  const HTML = [
    '<script>window.__DATA__="{\\"note\\":\\"价格和权益可能变化，最终信息以 BigModel 订阅页为准。\\",',
    '\\"href\\":\\"https://bigmodel.cn/glm-coding\\",\\"plans\\":[{\\"name\\":\\"Lite\\",\\"description\\":\\"适合小型 Repo 轻量级迭代\\",',
    '\\"price\\":\\"¥94.4\\",\\"originalPrice\\":\\"¥118\\",\\"period\\":\\"/ 月\\",\\"highlights\\":[\\"每周 10,000 积分\\"]},',
    '{\\"name\\":\\"Pro\\",\\"badge\\":\\"推荐\\",\\"description\\":\\"适合中型 Repo 日常开发\\",\\"price\\":\\"¥430.4\\",\\"originalPrice\\":\\"¥538\\",\\"period\\":\\"/ 月\\"},',
    '{\\"name\\":\\"Max\\",\\"description\\":\\"适合高阶用户\\",\\"price\\":\\"¥1078\\",\\"originalPrice\\":\\"¥1078\\",\\"period\\":\\"/ 月\\"}]}"</script>',
  ].join('');
  const NOW = Date.parse('2026-11-12T04:00:00Z');

  it('只给有促销价的套餐成条，折扣按现价/原价计算', () => {
    const raws = zcodePlanRaws(HTML, { now: NOW });
    // Lite 与 Pro 在促销（8 折）；Max 现价等于原价，不成条
    assert.equal(raws.length, 2);
    assert.match(raws[0].title, /ZCode：GLM Coding Lite 订阅 8 折（¥94\.4\/月，原价 ¥118）$/);
    assert.equal(raws[0].url, `${GLM_CODING_BUY_URL}?plan=Lite`);
    assert.match(raws[0].summary, /适合小型 Repo 轻量级迭代/);
    assert.match(raws[1].title, /GLM Coding Pro 订阅 8 折/);
    assert.equal(raws[0].dealType, 'discount');
    assert.equal(raws[0].kind, 'platform');
    assert.equal(raws[0].lang, 'zh');
    assert.notEqual(raws[0].url, raws[1].url);
  });

  it('促销结束（现价等于原价）或页面改版时 0 条', () => {
    const noPromo = HTML.replaceAll('¥94.4', '¥118').replaceAll('¥430.4', '¥538');
    assert.deepEqual(zcodePlanRaws(noPromo, { now: NOW }), []);
    assert.deepEqual(zcodePlanRaws('', { now: NOW }), []);
  });

  it('未转义引号的同构数据也能解析', () => {
    const plain = '{"plans":[{"name":"Lite","description":"轻量","price":"¥9.4","originalPrice":"¥10","period":"/ 月"}]}';
    const raws = zcodePlanRaws(plain, { now: NOW });
    assert.equal(raws.length, 1);
    assert.match(raws[0].title, /9\.4 折/);
  });
});

describe('deepseekDiscountRaws（DeepSeek API 定价文档页）', () => {
  // 与真实页面同构：带「限时折扣价」表头的表格 + 无折扣表头的普通表格
  const HTML = `
    <h2 id="speech-pricing">语音价格​</h2>
    <table><thead><tr><th>API</th><th>计费单位</th><th>刊例价</th><th>限时折扣价（5 折）</th></tr></thead><tbody>
    <tr><td><a href="/zh-cn/guides/tts">语音合成（TTS）</a></td><td>每 10,000 字符</td><td>3元</td><td>1.5元</td></tr>
    <tr><td><a href="/zh-cn/guides/asr">语音识别（ASR）</a></td><td>每小时音频</td><td>0.78元</td><td>0.39元</td></tr>
    </tbody></table>
    <table><thead><tr><th>模型</th><th>计费单位</th><th>价格</th></tr></thead><tbody>
    <tr><td>deepseek-chat</td><td>百万 tokens</td><td>2元</td></tr>
    </tbody></table>`;
  const NOW = Date.parse('2026-11-12T04:00:00Z');

  it('一张折扣表合并成一条，含产品名与刊例价→折扣价', () => {
    const raws = deepseekDiscountRaws(HTML, { now: NOW });
    assert.equal(raws.length, 1);
    assert.match(raws[0].title, /DeepSeek API 限时折扣：语音合成（TTS）、语音识别（ASR） 5 折$/);
    assert.match(raws[0].summary, /语音合成（TTS） 3元 → 1\.5元（每 10,000 字符）/);
    assert.ok(raws[0].url.startsWith(DEEPSEEK_PRICING_URL));
    assert.equal(raws[0].dealType, 'discount');
    assert.equal(raws[0].kind, 'platform');
    assert.equal(raws[0].lang, 'zh');
  });

  it('没有折扣表头（活动下线 / 页面改版）时 0 条', () => {
    assert.deepEqual(deepseekDiscountRaws('<table><tr><td>普通表格</td></tr></table>', { now: NOW }), []);
    assert.deepEqual(deepseekDiscountRaws('', { now: NOW }), []);
  });
});

describe('qoderFreeTrialRaws（Qoder 官网新人权益）', () => {
  // 与真实首页 FAQ 同构的文案片段
  const HTML = `
    <p>Qoder offers flexible pricing to suit a variety of needs. New users are eligible for
    a free 2-week Pro Trial, giving them full access to all Pro-exclusive features.</p>
    <p>· Do nothing and be automatically downgraded to our Free plan.</p>`;
  const NOW = Date.parse('2026-11-12T04:00:00Z');

  it('标记齐全时产出新人免费试用条目', () => {
    const raws = qoderFreeTrialRaws(HTML, { now: NOW });
    assert.equal(raws.length, 1);
    assert.match(raws[0].title, /Qoder：新用户免费试用 Pro 两周/);
    assert.match(raws[0].summary, /自动降级为 Free 版/);
    assert.equal(raws[0].dealType, 'free');
    assert.equal(raws[0].kind, 'platform');
    assert.equal(raws[0].lang, 'zh');
  });

  it('关键标记缺失（页面改版 / 权益下线）时不产出', () => {
    assert.deepEqual(qoderFreeTrialRaws('New users are eligible for a paid trial', { now: NOW }), []);
    assert.deepEqual(qoderFreeTrialRaws('', { now: NOW }), []);
  });
});

describe('traePlanRaws（Trae 定价页）', () => {
  // 与真实页面同构：内嵌 JSON 套餐（free 无原价；lite/pro/pro-plus 首月优惠）+ 套餐卡里的模型折扣说明
  const HTML = [
    '<li> 所有功能均可免费使用 </li>',
    '<script>window.__PLAN__="{\\"plans\\":[{\\"id\\":\\"free\\",\\"title\\":\\"免费 Free\\",\\"price\\":\\"¥0\\"},',
    '{\\"id\\":\\"lite\\",\\"title\\":\\"会员 Lite\\",\\"tag\\":\\"首月优惠\\",\\"price\\":\\"¥34\\",\\"originalPrice\\":\\"¥49\\",\\"pricePrefix\\":\\"低至\\",\\"priceSuffix\\":\\"\\\\u002F月\\"},',
    '{\\"id\\":\\"pro\\",\\"title\\":\\"会员 Pro\\",\\"tag\\":\\"首月优惠\\",\\"price\\":\\"¥69\\",\\"originalPrice\\":\\"¥99\\"},',
    '{\\"id\\":\\"pro-plus\\",\\"title\\":\\"会员 Pro+\\",\\"price\\":\\"¥167\\",\\"originalPrice\\":\\"¥239\\"}]}"</script>',
    '<span> 模型折扣：Seed 2.1模型 2.5 折，GLM5.3、Deepseek-V4.1-Flash模型 7.5折 </span>',
    '<span> 模型折扣：Seed 2.1模型 2.5 折，GLM5.3、Deepseek-V4.1-Flash模型 7.5折 </span>',
  ].join('');
  const NOW = Date.parse('2026-11-12T04:00:00Z');

  it('免费版成免费条目，有促销价的会员逐个成折扣条目', () => {
    const raws = traePlanRaws(HTML, { now: NOW });
    // lite / pro / pro-plus 三张卡都有促销价，加上免费版与模型折扣 = 5 条
    assert.equal(raws.length, 5);
    const free = raws.find((raw) => raw.dealType === 'free');
    assert.match(free.title, /Trae：免费版所有功能均可免费使用/);
    const lite = raws.find((raw) => raw.url.endsWith('plan=lite'));
    assert.match(lite.title, /Trae：会员 Lite 首月优惠 ¥34\/月（原价 ¥49，6\.9 折）$/);
    assert.match(lite.summary, /首月优惠价 ¥34\/月、原价 ¥49（约 6\.9 折）/);
    const proPlus = raws.find((raw) => raw.url.endsWith('plan=pro-plus'));
    assert.match(proPlus.title, /¥167\/月（原价 ¥239，7 折）$/);
    for (const raw of raws) {
      assert.equal(raw.kind, 'platform');
      assert.equal(raw.lang, 'zh');
    }
  });

  it('会员卡里重复的模型折扣说明只成一条', () => {
    const raws = traePlanRaws(HTML, { now: NOW });
    const model = raws.find((raw) => raw.url.endsWith('discount=model'));
    assert.match(model.title, /Trae：会员模型折扣（Seed 2\.1模型 2\.5 折，GLM5\.3、Deepseek-V4\.1-Flash模型 7\.5折）$/);
    assert.equal(raws.filter((raw) => raw.url.endsWith('discount=model')).length, 1);
  });

  it('促销结束或免费版标记缺失时不成条', () => {
    const noPromo = HTML.replaceAll('¥34', '¥49').replaceAll('¥69', '¥99').replaceAll('¥167', '¥239');
    const raws = traePlanRaws(noPromo, { now: NOW });
    assert.ok(!raws.some((raw) => raw.dealType === 'discount' && raw.url.includes('plan=')));
    assert.deepEqual(traePlanRaws(HTML.replaceAll('所有功能均可免费使用', 'x'), { now: NOW }).filter((raw) => raw.dealType === 'free'), []);
    assert.deepEqual(traePlanRaws('', { now: NOW }), []);
  });
});

describe('mimoPromoRaws / mimoFreeRaws（小米 MiMo）', () => {
  const HOME_HTML = `
    <div class="Updates_updatesSmallCardInfo"><h4>MiMo Claw 搭载 V2.6 旗舰模型</h4>
    <p class="Updates_updatesDesc">限时特惠 ¥14.9 / 月，搭载最新旗舰模型 mimo-v2.6-pro，联合金山一站式办公，Token Plan 一键叠加，免费时长 3h /天。</p></div>
    <h4>普通动态没有活动</h4><p>模型常规更新说明</p>`;
  const DOCS_HTML = `
    <li><p class="mdx-p">缓存写入： 限时免费</p></li>
    <li><p class="mdx-p"><strong class="mdx-strong">TTS 系列</strong></p>
    <p class="mdx-p">限时免费：<code class="mdx-code-inline">mimo-v2.5-tts</code>、<code class="mdx-code-inline">mimo-v2.5-tts-voiceclone</code>、<code class="mdx-code-inline">mimo-v2.5-tts-voicedesign</code></p></li>
    <h3>模型海外定价</h3>
    <li><p class="mdx-p"><strong class="mdx-strong">TTS 系列</strong></p>
    <p class="mdx-p">限时免费：<code class="mdx-code-inline">mimo-v2.5-tts</code>、<code class="mdx-code-inline">mimo-v2.5-tts-voiceclone</code>、<code class="mdx-code-inline">mimo-v2.5-tts-voicedesign</code></p></li>`;
  const NOW = Date.parse('2026-11-12T04:00:00Z');

  it('首页限时特惠卡成折扣条目，普通动态跳过', () => {
    const raws = mimoPromoRaws(HOME_HTML, { now: NOW });
    assert.equal(raws.length, 1);
    assert.match(raws[0].title, /^MiMo：MiMo Claw 搭载 V2\.6 旗舰模型 限时特惠 ¥14\.9\/月$/);
    assert.match(raws[0].summary, /免费时长 3h \/天/);
    assert.equal(raws[0].dealType, 'discount');
    assert.equal(raws[0].kind, 'platform');
    assert.equal(raws[0].lang, 'zh');
  });

  it('定价文档「限时免费」按组去重成条，带分类与模型清单', () => {
    const raws = mimoFreeRaws(DOCS_HTML, { now: NOW });
    // 缓存写入（无清单）+ TTS 系列（国内 / 海外重复，去重成一条）
    assert.equal(raws.length, 2);
    assert.match(raws[0].title, /MiMo API 限时免费：缓存写入$/);
    const tts = raws.find((raw) => raw.title.includes('TTS'));
    assert.match(tts.title, /TTS 系列：mimo-v2\.5-tts、mimo-v2\.5-tts-voiceclone、mimo-v2\.5-tts-voicedesign$/);
    assert.ok(tts.url.startsWith(MIMO_PRICING_DOC_URL));
    assert.equal(tts.dealType, 'free');
    assert.equal(tts.kind, 'platform');
  });

  it('标记消失时 0 条', () => {
    assert.deepEqual(mimoPromoRaws('<h4>常规动态</h4><p>限时特惠已结束</p>', { now: NOW }), []);
    assert.deepEqual(mimoFreeRaws('缓存写入：按刊例价计费', { now: NOW }), []);
  });
});

describe('traeIntlFreeRaws（Trae 国际站回退源）', () => {
  // 与 trae.ai/pricing 同构的 HTML 套餐卡：Free $0 + Pro $20（无促销原价）
  const HTML = `
    <h2 class="cardTitle-uCLU09"><span class="">Free</span></h2>
    <div class="priceBox-q2chUZ"><div class="price-ohflUE"><span>$0</span></div></div>
    <ul class="description-iNQROA">
      <li class="descriptionItem-OzMXZ2"><svg .../>Auto mode only</li>
      <li class="descriptionItem-OzMXZ2"><svg .../>Limited usage</li>
    </ul>
    <h2 class="cardTitle-uCLU09"><span class="brand-RBOjkl">Pro</span></h2>
    <div class="priceBox-q2chUZ"><div class="price-ohflUE"><span>$20</span></div></div>`;
  const NOW = Date.parse('2026-11-12T04:00:00Z');

  it('解析 Free 套餐卡成免费条目，带功能说明', () => {
    const raws = traeIntlFreeRaws(HTML, { now: NOW });
    assert.equal(raws.length, 1);
    assert.match(raws[0].title, /Trae：Free 套餐 \$0/);
    assert.match(raws[0].summary, /Auto mode only；Limited usage/);
    assert.equal(raws[0].dealType, 'free');
    assert.equal(raws[0].kind, 'platform');
    assert.equal(raws[0].lang, 'zh');
  });

  it('免费卡缺失或价格非 0 时不产出', () => {
    assert.deepEqual(traeIntlFreeRaws(HTML.replaceAll('$0', '$3'), { now: NOW }), []);
    assert.deepEqual(traeIntlFreeRaws('<h2>Enterprise</h2>', { now: NOW }), []);
    assert.deepEqual(traeIntlFreeRaws('', { now: NOW }), []);
  });
});

describe('搜索配置', () => {
  it('查询词覆盖国内 Agent、新用户福利与海外订阅三类信号', () => {
    assert.ok(SEARCH_QUERIES.length >= 8);
    assert.ok(SEARCH_QUERIES.some((query) => query.includes('Qoder')));
    assert.ok(SEARCH_QUERIES.some((query) => query.includes('WorkBuddy')));
    assert.ok(SEARCH_QUERIES.some((query) => query.includes('新用户')));
    assert.ok(SEARCH_QUERIES.some((query) => query.includes('Coding Plan')));
  });

  it('生成的 Google News URL 已编码并指向中文区', () => {
    const url = googleNewsUrl('大模型 免费 API');
    assert.ok(url.includes(encodeURIComponent('大模型 免费 API')));
    assert.ok(url.includes('hl=zh-CN'));
  });
});
