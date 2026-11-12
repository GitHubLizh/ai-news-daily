/**
 * 「免费 / 优惠渠道」数据管线（纯逻辑层，便于单测）。
 * 三路来源在此汇合成 data/deals.json：
 *   1. 平台直连（kind: 'platform'）：平台官方页面 / 公开接口，按日梳理各家的免费与优惠——
 *      - OpenRouter 公开模型清单里的 :free 模型（快照 + 近 N 天新增）；
 *      - 硅基流动定价页（当前免费开放的模型清单）；
 *      - 火山方舟 Agent / Coding Plan 折扣活动页（某模型 X 折 + 起止时间，只留进行中的）；
 *      - 智谱 BigModel「上新活动」页（在售的 Coding Plan / 资源包优惠）。
 *   2. 定向资讯搜索（kind: 'search'）：Google News RSS 按关键词搜索，
 *      复用 detectDealType 过滤出「具体产品免费 / 优惠」的条目；
 *   3. 资讯流水线（kind: 'news'）：data/news.json 中命中 dealType 的条目原样带入。
 * 抓取与落盘见 scripts/fetch-deals.mjs。
 */
import {
  DEFAULT_TIMEZONE,
  dayKey,
  dayLabel,
  dedupeItems,
  detectDealType,
  hotScore,
  makeItem,
} from './normalize.mjs';

const OPENROUTER_HOME = 'https://openrouter.ai';
const OPENROUTER_FREE_URL = `${OPENROUTER_HOME}/models?max_price=0`;
const GOOGLE_NEWS_HOME = 'https://news.google.com';

export const VOLCENGINE_DOC_BASE = 'https://ark.volcengine.com';
export const BIGMODEL_HOME = 'https://docs.bigmodel.cn';
export const SILICONFLOW_HOME = 'https://siliconflow.cn';
export const SILICONFLOW_PRICING_URL = `${SILICONFLOW_HOME}/pricing`;
export const ALIYUN_BAILIAN_FREE_URL = 'https://help.aliyun.com/zh/model-studio/new-free-quota';
export const ALIYUN_TOKENPLAN_URL = 'https://www.aliyun.com/benefit/scene/tokenplan';

/** 火山方舟两个折扣活动页（Agent Plan 与 Coding Plan 的指定模型抵扣折扣） */
export const VOLCENGINE_DISCOUNT_PAGES = [
  { planName: '火山方舟 Coding Plan', path: '/region:cn-beijing/docs/coding-plan-personal-model-discount' },
  { planName: '火山方舟 Agent Plan', path: '/region:cn-beijing/docs/agent-plan-personal-model-discount' },
];

export const BIGMODEL_PROMOTION_URL = `${BIGMODEL_HOME}/cn/update/promotion`;

/** 定向搜索的 feed 元信息（parseFeed 的 feedMeta 参数） */
export const SEARCH_FEED_META = {
  id: 'gnews-deals',
  name: 'Google 资讯',
  home: GOOGLE_NEWS_HOME,
  lang: 'zh',
  weight: 1.5,
};

/** 定向搜索词：先国内 Agent 场景（哪个模型在哪个 Agent 免费、Coding Plan 优惠、新用户福利），再覆盖海外动态 */
export const SEARCH_QUERIES = [
  'Qoder OR Trae OR Zcode OR CodeBuddy 免费 OR 优惠',
  'AI 编程 免费 领取 token OR 额度',
  'Coding Plan 优惠 OR 折扣 OR discount',
  '新用户 免费 大模型 OR AI 领取',
  '大模型 免费 API',
  'AI API 降价 OR 优惠',
  'Claude OR Gemini OR GPT 免费 OR 优惠 OR discount',
  'Cursor OR Copilot OR Windsurf 优惠 OR free OR discount',
];

export function googleNewsUrl(query) {
  return `${GOOGLE_NEWS_HOME}/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
}

/**
 * OpenRouter 模型清单 -> 渠道条目。
 * 免费模型以 id 的 `:free` 后缀标识。产出两类条目：
 *   - snapshot：当日免费模型总览（URL 带日期参数，保证每天一条、互不去重）
 *   - fresh：近 newWithinDays 天上架的免费模型，逐个成条（URL 为模型页）
 */
export function openRouterFreeModels(apiJson, options = {}) {
  const {
    now = Date.now(),
    timezone = DEFAULT_TIMEZONE,
    newWithinDays = 7,
    snapshotExamples = 4,
  } = options;

  const models = Array.isArray(apiJson?.data) ? apiJson.data : [];
  const free = models.filter((model) => String(model?.id || '').endsWith(':free'));
  const cleanName = (model) => String(model?.name || model?.id || '').replace(/\s*\(free\)\s*$/i, '');
  const day = dayKey(new Date(now), timezone);

  const examples = free
    .slice()
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .slice(0, snapshotExamples)
    .map(cleanName);
  const snapshot = {
    title: `OpenRouter 免费模型日报：当前 ${free.length} 个模型可零成本调用`,
    url: `${OPENROUTER_FREE_URL}&day=${day}`,
    summary: free.length
      ? `当前可直接免费调用的模型 ${free.length} 个，例如：${examples.join('、')}。登录 OpenRouter 即可调用，免费模型有速率限制，页面为英文、可配合浏览器翻译使用。`
      : 'OpenRouter 当前没有标记为免费的模型。',
    publishedRaw: new Date(now).toISOString(),
    source: 'OpenRouter',
    sourceId: 'openrouter',
    home: OPENROUTER_HOME,
    lang: 'zh',
    weight: 2.0,
    dealType: 'free',
    kind: 'platform',
  };

  const cutoff = now - newWithinDays * 86400000;
  const fresh = free
    .filter((model) => Number(model?.created) * 1000 >= cutoff)
    .map((model) => ({
      title: `OpenRouter 新增免费模型：${cleanName(model)}`,
      url: model?.canonical_slug ? `${OPENROUTER_HOME}/${model.canonical_slug}` : OPENROUTER_FREE_URL,
      summary: String(model?.description || '').slice(0, 200),
      publishedRaw: new Date(Number(model?.created) * 1000 || now).toISOString(),
      source: 'OpenRouter',
      sourceId: 'openrouter',
      home: OPENROUTER_HOME,
      lang: 'zh',
      weight: 2.0,
      dealType: 'free',
      kind: 'platform',
    }));

  return { snapshot, fresh };
}

/** 定向搜索结果 -> 渠道条目：只保留 detectDealType 能识别的标题 */
export function dealsFromSearchItems(items) {
  const raws = [];
  for (const item of items || []) {
    const dealType = detectDealType(item?.title);
    if (!dealType) continue;
    raws.push({ ...item, dealType, kind: 'search' });
  }
  return raws;
}

/**
 * 硅基流动定价页 -> 渠道条目。页面是 SSR：免费模型在价格表里带「免费」徽章，
 * 模型 id（如 `Qwen/Qwen3-8B`）出现在徽章前的同一行块里，向后回溯最近一个
 * 形如 `org/model` 的 id 即可配对；窗口收紧到 1200 字符避免跨行误配。
 */
export function siliconFlowFreeModels(html, options = {}) {
  const { now = Date.now(), timezone = DEFAULT_TIMEZONE } = options;
  const text = String(html || '');
  const idPattern = />([A-Za-z][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+)</g;
  const seen = new Set();
  let cursor = 0;
  while ((cursor = text.indexOf('>免费<', cursor)) > 0) {
    const back = text.slice(Math.max(0, cursor - 1200), cursor);
    const ids = [...back.matchAll(idPattern)].map((match) => match[1]);
    if (ids.length) seen.add(ids[ids.length - 1]);
    cursor += 4;
  }
  const models = [...seen];
  const day = dayKey(new Date(now), timezone);
  return {
    models,
    snapshot: models.length
      ? {
          title: `硅基流动免费模型日报：当前 ${models.length} 个模型可零成本调用`,
          url: `${SILICONFLOW_PRICING_URL}?day=${day}`,
          summary: `国内平台硅基流动当前免费开放的模型 ${models.length} 个，例如：${models.slice(0, 4).join('、')}。注册即可调用，免费模型有速率限制，详见定价页。`,
          publishedRaw: new Date(now).toISOString(),
          source: '硅基流动',
          sourceId: 'siliconflow',
          home: SILICONFLOW_HOME,
          lang: 'zh',
          weight: 2.5,
          dealType: 'free',
          kind: 'platform',
        }
      : null,
  };
}

/**
 * 阿里云百炼「新人免费额度」页 -> 渠道快照条目。
 * 这是长期政策页（非营销活动）：首次开通百炼自动发放各模型新人免费额度、90 天有效。
 * 页面文案可能随时改版，所以用「存在性验证」——三个关键标记都在才产出条目，
 * 标记消失即页面改版或政策下线，条目自动停止出现，不会拿旧文案误导读者。
 */
export function aliyunBailianFreeQuota(html, options = {}) {
  const { now = Date.now() } = options;
  const text = String(html || '');
  const markers = ['新人', '免费额度', '90 天'];
  if (!markers.every((marker) => text.includes(marker))) return [];
  return [
    {
      title: '阿里云百炼：新用户开通即领各模型新人免费额度（90 天有效）',
      url: ALIYUN_BAILIAN_FREE_URL,
      summary: '首次开通阿里云百炼即自动发放各模型的新人专属免费额度，有效期 90 天；额度规则与用完即停开关详见官方文档。',
      publishedRaw: new Date(now).toISOString(),
      source: '阿里云百炼',
      sourceId: 'aliyun-bailian',
      home: 'https://help.aliyun.com/zh/model-studio/',
      lang: 'zh',
      weight: 2.5,
      dealType: 'free',
      kind: 'platform',
    },
  ];
}

/**
 * 阿里云 Token Plan 活动页 -> 渠道条目。
 * 官方营销页（SSR），促销句形如「Qwen4-Max 首发 Token Plan 低至 5 折」。
 * 提取含「低至 / 限时 X 折」的句子去重成条目；页面改版或活动结束解析不到即 0 条。
 */
export function aliyunTokenPlanRaws(html, options = {}) {
  const { now = Date.now(), maxItems = 3 } = options;
  const text = String(html || '');
  const raws = [];
  const seen = new Set();
  const pattern = /([^><]{0,40}(?:低至|限时)\s*[0-9.]+\s*折[^><]{0,40})/g;
  for (const match of text.matchAll(pattern)) {
    const sentence = decodeBasicEntities(match[1]).replace(/\s+/g, ' ').trim();
    // 句子里要有模型或产品名，避免拿到「个人版-低至5折」这类纯按钮文案
    if (!/qwen|通义|千问|harness|token plan/i.test(sentence)) continue;
    // 同一活动常有多版文案：按「模型 + 折扣」去重，只保留一条
    const product = (sentence.match(/qwen[^\s,，]*/i)?.[0] || sentence.match(/通义[^\s,，]*/)?.[0] || '').toLowerCase();
    const discount = sentence.match(/[0-9.]+\s*折/)?.[0]?.replace(/\s+/g, '') || '';
    const key = `${product}|${discount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // 标题只保留折扣短句（含「折」的逗号段，截到折扣值为止），避免整段营销文案进标题
    const segments = sentence.split(/[,，;；]/).filter((part) => /[0-9.]+\s*折/.test(part));
    const headlineSource = segments[segments.length - 1] || sentence;
    const headline = headlineSource.replace(/^(.*?[0-9.]+\s*折(?:起)?).*$/, '$1');
    raws.push({
      title: `阿里云 Token Plan 在售优惠：${headline}`,
      url: `${ALIYUN_TOKENPLAN_URL}?promo=${encodeURIComponent(headline.slice(0, 30))}`,
      summary: `${sentence}。详情以阿里云官方页面为准。`,
      publishedRaw: new Date(now).toISOString(),
      source: '阿里云 Token Plan',
      sourceId: 'aliyun-tokenplan',
      home: ALIYUN_TOKENPLAN_URL,
      lang: 'zh',
      weight: 2.5,
      dealType: 'discount',
      kind: 'platform',
    });
    if (raws.length >= maxItems) break;
  }
  return raws;
}

/** 资讯流水线条目 -> 渠道条目：news.json 里带 dealType 的直接带入 */
export function newsItemsToDealRaws(items) {
  return (items || [])
    .filter((item) => item && item.dealType && item.title && item.url)
    .map((item) => ({ ...item, kind: 'news' }));
}

/** "2026年11月7日00:00:00"（时间可省略）-> Date，解析失败返回 null */
function parseChineseDate(input) {
  const match = String(input || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0) - 8 * 3600000); // 页面标注为北京时间
}

function decodeBasicEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 火山方舟折扣活动页 -> 渠道条目。
 * 页面是 SSR，活动时间表形如 `<li>deepseek-v4.1-flash 模型：2026年11月7日00:00:00至2026年12月30日23:59:59</li>`，
 * 只保留「当前进行中」的活动（页面同时挂着已结束的历史活动，必须按时间过滤，
 * 否则会把 kimi-k3 这种早已过期的折扣当成在售渠道展示）。
 */
export function volcEngineDiscountRaws(html, options = {}) {
  const { now = Date.now(), planName = '火山方舟 Coding Plan', pageUrl = VOLCENGINE_DOC_BASE + VOLCENGINE_DISCOUNT_PAGES[0].path } = options;
  const text = String(html || '');
  const discountMatch = text.match(/最低\s*([\d.]+)\s*折/);
  const discount = discountMatch ? discountMatch[0] : '限时折扣';
  const raws = [];
  const pattern = /<li>\s*([^<>]{2,50}?)\s*模型[：:]\s*(\d{4}年\d{1,2}月\d{1,2}日[^<>]*?)\s*至\s*(\d{4}年\d{1,2}月\d{1,2}日[^<>]*?)\s*<\/li>/g;
  for (const match of text.matchAll(pattern)) {
    const [, model, startRaw, endRaw] = match;
    const end = parseChineseDate(endRaw);
    const start = parseChineseDate(startRaw);
    if (!end || !start) continue;
    if (now < start.getTime() || now > end.getTime()) continue;
    raws.push({
      title: `${planName}：${model.trim()} 模型抵扣系数${discount}`,
      url: `${pageUrl}?model=${encodeURIComponent(model.trim())}`,
      summary: `${model.trim()} 在 ${planName} 的指定模型折扣活动中，${startRaw.trim()} 至 ${endRaw.trim()} 有效；活动到点自动生效，无需申请，详情以官方页面为准。`,
      // 进行中的活动按抓取时刻归档（落到「今天」），避免活动开始日早于保留期时被误丢
      publishedRaw: new Date(now).toISOString(),
      source: planName,
      sourceId: 'volcengine',
      home: VOLCENGINE_DOC_BASE,
      lang: 'zh',
      weight: 2.5,
      dealType: 'discount',
      kind: 'platform',
    });
  }
  return raws;
}

/**
 * 智谱 BigModel「上新活动」页 -> 渠道条目。
 * 页面是 SSR，活动形如 `<strong>活动一：GLM Coding Plan 编码畅享计划</strong>` +
 * 紧随其后的 `<li>活动内容：…</li>`。只保留渠道类活动（Coding Plan / 资源包优惠），
 * 拼好模、推荐有礼这类拉新营销不算「模型免费 / 优惠购买」。
 */
export function bigModelPromotionRaws(html, options = {}) {
  const { now = Date.now() } = options;
  const text = String(html || '');
  const raws = [];
  const pattern = /<strong>(活动[一二三四五六七八九十]+：[^<]{2,60})<\/strong>/g;
  for (const match of text.matchAll(pattern)) {
    const [, fullTitle] = match;
    const name = decodeBasicEntities(fullTitle.replace(/^活动[一二三四五六七八九十]+[：:]/, '').trim());
    if (!/Coding Plan|资源包/.test(name)) continue;
    // 活动内容 li 在标题之后的邻近窗口内；窗口内可能出现嵌套结构，取第一个「活动内容：」
    const window = text.slice(match.index, match.index + 2000);
    const contentMatch = window.match(/活动内容[：:]\s*([^<]{10,300})</);
    const content = contentMatch ? decodeBasicEntities(contentMatch[1]).trim() : '';
    if (!content) continue;
    raws.push({
      title: `智谱 BigModel 在售活动：${name}`,
      url: `${BIGMODEL_PROMOTION_URL}?act=${encodeURIComponent(name)}`,
      summary: `${content} 详情以官方页面为准。`,
      publishedRaw: new Date(now).toISOString(),
      source: '智谱 BigModel',
      sourceId: 'bigmodel',
      home: BIGMODEL_HOME,
      lang: 'zh',
      weight: 2.5,
      dealType: 'discount',
      kind: 'platform',
    });
  }
  return raws;
}

/**
 * 组装渠道数据集（口径对齐 buildDataset：按天分组、去重、热度、统计）。
 * 差异：渠道类型与来源种类（kind）以 raw 标注为准——平台直连条目的标题
 * 未必命中关键词规则，不能让 makeItem 重新裁决把它们丢掉。
 */
export function buildDealsDataset(rawItems, options = {}) {
  const {
    now = Date.now(),
    timezone = DEFAULT_TIMEZONE,
    retentionDays = 45,
    maxItems = 800,
    generatedAt = new Date(now).toISOString(),
  } = options;

  const cutoff = now - retentionDays * 86400000;
  const mapped = rawItems
    .filter((raw) => raw && raw.title && raw.url && /^https?:/i.test(raw.url) && raw.dealType)
    .map((raw) => {
      const item = makeItem(raw, { now, timezone });
      item.dealType = raw.dealType;
      item.kind = raw.kind || 'news';
      // 平台直连条目由本管线生成（标题与描述语言不总是一致），detectLang
      // 按字符占比会把它们误判成英文、在中文筛选下被藏起来——以生成时标注的 lang 为准
      if (raw.kind === 'platform' && raw.lang) item.lang = raw.lang;
      item.alsoIn = Array.isArray(raw.alsoIn) ? raw.alsoIn : [];
      return item;
    })
    .filter((item) => item.title.length >= 4)
    .filter((item) => item.publishedTs >= cutoff)
    .sort((a, b) => b.publishedTs - a.publishedTs);

  const items = dedupeItems(mapped)
    .slice(0, maxItems)
    .map((item) => {
      const { _text, ...rest } = item;
      return { ...rest, hot: hotScore(item, now) };
    })
    .sort((a, b) => b.publishedTs - a.publishedTs);

  const dayMap = new Map();
  const sourceMap = new Map();
  const kindMap = new Map();
  for (const item of items) {
    dayMap.set(item.day, (dayMap.get(item.day) || 0) + 1);
    sourceMap.set(item.source, (sourceMap.get(item.source) || 0) + 1);
    kindMap.set(item.kind, (kindMap.get(item.kind) || 0) + 1);
  }

  const days = [...dayMap.entries()]
    .map(([day, count]) => ({ day, label: dayLabel(day), count }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));

  return {
    generatedAt,
    timezone,
    count: items.length,
    days,
    stats: {
      sources: [...sourceMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      languages: {
        zh: items.filter((item) => item.lang === 'zh').length,
        en: items.filter((item) => item.lang === 'en').length,
      },
      kinds: [...kindMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      estimatedTime: items.filter((item) => item.estimate).length,
    },
    items,
  };
}
