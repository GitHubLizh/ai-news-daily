/**
 * 归一化管线：原始 feed 条目 -> 站点数据。
 * 负责相关性过滤、分类、去重、按天分组、热度打分。
 */
import { canonicalUrl, detectLang, shortHash, stripHtml, titleKey, truncate } from './text.mjs';
import { parseDate } from './rss.mjs';

export const CATEGORIES = ['模型发布', '产品动态', '研究前沿', '行业动态', '开源工具', '观点方法'];

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** 分类关键词表：命中标题权重更高，命中摘要权重较低 */
const CATEGORY_RULES = [
  {
    name: '模型发布',
    keywords: [
      '新模型', '模型发布', '发布模型', '开源模型', '开源权重', '正式发布', '大模型', '参数', '上下文窗口',
      '多模态', '推理能力', '基准测试', 'benchmark', 'sota', '预览版', 'preview', 'gpt', 'claude', 'gemini',
      'llama', 'qwen', 'deepseek', 'kimi', 'glm', 'grok', 'mistral', 'moe', 'o3', 'o4', 'sora', '模型',
    ],
  },
  {
    name: '产品动态',
    keywords: [
      '上线', '推出', '开放', '内测', '公测', '新功能', '更新', '集成', '接入', 'app', '应用', '插件',
      '订阅', '付费', '免费', '界面', '体验', '助手', 'agent', '智能体', '客户端', '网页版', 'api', 'sdk',
      '编程', 'copilot', '搜索', '语音', '图像生成', '视频生成',
    ],
  },
  {
    name: '研究前沿',
    keywords: [
      '论文', '研究', '实验', '提出', '算法', 'arxiv', '数据集', '训练', '微调', '评测', '理论', '突破',
      '科学家', 'transformer', '可解释', '涌现', '基准', '复现', '学术',
    ],
  },
  {
    name: '行业动态',
    keywords: [
      '融资', '投资', '估值', '收购', '上市', '财报', '营收', '亏损', '合作', '战略', '裁员', '监管',
      '政策', '芯片', '算力', '数据中心', '出口管制', '禁令', '诉讼', '版权', '签订', '订单', '市场',
    ],
  },
  {
    name: '开源工具',
    keywords: [
      '开源', 'github', '仓库', 'star', '框架', '本地部署', '部署', '教程', '指南', 'cli', 'docker',
      '工具', '项目', '插件', '脚本', '自建',
    ],
  },
  {
    name: '观点方法',
    keywords: [
      '观点', '访谈', '评论', '思考', '反思', '复盘', '经验', '建议', '为什么', '如何', '科普', '讨论',
      '争议', '质疑', '回应', '真相', '创始人说',
    ],
  },
];

/**
 * “是否与 AI 相关”的判定，用于综合科技站（relevance=tech）的过滤。
 * 只按**标题**判断：实测正文里出现一次 “AI/NVIDIA” 就足以把整篇消费电子稿
 * 收进来（苹果 iPad、显示器、显卡销量榜），而标题是编辑给出的主题信号。
 * ASCII 关键词按词边界匹配，避免 ai 命中 said/email；中文关键词直接包含匹配。
 */
const AI_KEYWORDS = [
  // 模型 / 厂商 / 产品强信号
  'ai', 'agi', 'llm', 'aigc', 'gpt', 'chatgpt', 'claude', 'gemini', 'deepseek', 'qwen', 'llama', 'grok',
  'kimi', 'glm', 'mistral', 'copilot', 'midjourney', 'sora', 'openai', 'anthropic', 'nvidia',
  'hugging face', 'transformer', 'diffusion', 'agent', 'mcp',
  // 中文强信号
  '人工智能', '大模型', '大语言模型', '智能体', '生成式', '多模态', '机器学习', '深度学习', '神经网络',
  '具身智能', '自动驾驶', '语音识别', '计算机视觉',
  // 弱信号：只在标题出现时才算，仍属 AI 主题
  '模型', '算法', '芯片', '算力', '训练', '推理', '微调', '机器人', '英伟达', '智能驾驶', '对话系统',
];

const HOT_KEYWORDS = [
  '发布', '开源', '突破', '首个', '首次', '融资', '收购', '刷新', '登顶', '免费', '重磅', '全面',
  '超越', '暴涨', '上线', '禁用', '叫停', '争议', '泄露',
];

const asciiOnly = /^[a-z0-9 .\-+]+$/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 关键词匹配：英文/数字按词边界，中文直接包含 */
export function matchesKeyword(haystack, keyword) {
  if (!haystack || !keyword) return false;
  if (asciiOnly.test(keyword)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`, 'i').test(haystack);
  }
  return haystack.includes(keyword);
}

/** 判断条目标题是否属于 AI 主题（只看标题，避免正文噪声） */
export function isAiRelated(title) {
  const head = String(title ?? '');
  return AI_KEYWORDS.some((keyword) => matchesKeyword(head, keyword));
}

/** 基于关键词的分类器：标题命中 3 分，摘要命中 1 分 */
export function classify(title, summary = '') {
  const head = String(title ?? '');
  const body = String(summary ?? '');
  let best = { name: '行业动态', score: 0 };
  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const keyword of rule.keywords) {
      if (matchesKeyword(head, keyword)) score += 3;
      else if (matchesKeyword(body, keyword)) score += 1;
    }
    if (score > best.score) best = { name: rule.name, score };
  }
  return best.name;
}

/** 取某时刻在指定时区下的 YYYY-MM-DD */
export function dayKey(date, timezone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/** "2026-10-08" -> "10月8日 · 周四" */
export function dayLabel(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  if (!year || !month || !day) return String(key);
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', weekday: 'short' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
  return `${month}月${day}日 · ${weekday}`;
}

/** 统计热点关键词命中数，用于热度打分与批量源的择优 */
export function hotKeywordHits(text) {
  const haystack = String(text ?? '');
  return HOT_KEYWORDS.reduce((acc, keyword) => acc + (matchesKeyword(haystack, keyword) ? 1 : 0), 0);
}

/** 综合热度：时效衰减 + 来源权重 + 热点关键词，0~100，口径见 README */
export function hotScore(item, now) {
  const hours = Math.max(0, (now - item.publishedTs) / 3600000);
  const recency = Math.exp(-hours / 36);
  const source = Math.min(1, (Number(item.weight) || 1) / 2.5);
  const hits = hotKeywordHits(`${item.title} ${item.summary}`);
  const keywords = Math.min(1, hits * 0.25);
  return Math.round((recency * 0.5 + source * 0.25 + keywords * 0.25) * 100);
}

/** 单条原始记录 -> 站点条目（对已归一化的条目再次执行是幂等的） */
export function makeItem(raw, { now = Date.now(), timezone = DEFAULT_TIMEZONE } = {}) {
  const url = canonicalUrl(raw.url);
  const title = stripHtml(raw.title);
  const summary = truncate(stripHtml(raw.summary), 220, '…');
  // 首次归一化用源里的原始时间；对历史数据二次处理时回落到已保存的 publishedAt
  const parsed = parseDate(raw.publishedRaw) ?? (raw.publishedAt ? parseDate(String(raw.publishedAt)) : null);
  const shiftHours = Number(raw.timeShiftHours) || 0;
  let estimate = parsed ? Boolean(raw.estimate) : true;
  let publishedTs = (parsed ? parsed.getTime() : now) + shiftHours * 3600000;
  // 少数源会给出未来时间（时区标注错误或预排程），统一收敛到当前时刻并标记为估算
  if (publishedTs > now + 2 * 3600000) {
    publishedTs = now;
    estimate = true;
  }
  const publishedAt = new Date(publishedTs);
  const detected = detectLang(`${title}${summary}`);
  const text = `${title} ${summary}`;
  return {
    id: shortHash(url || titleKey(title)),
    title,
    url,
    summary,
    author: raw.author || '',
    source: raw.source || '',
    sourceId: raw.sourceId || '',
    home: raw.home || '',
    weight: Number(raw.weight) || 1,
    lang: detected || raw.lang || 'en',
    category: classify(title, summary),
    publishedAt: publishedAt.toISOString(),
    publishedTs,
    day: dayKey(publishedAt, timezone),
    estimate,
    bulk: Boolean(raw.bulk),
    alsoIn: [],
    hot: 0,
    _text: text,
  };
}

/** 去重：URL 完全相同，或标题归一化后相同（跨源转载合并，保留权重更高的一条） */
export function dedupeItems(items) {
  const ordered = [...items].sort(
    (a, b) =>
      (b.weight || 1) - (a.weight || 1) ||
      Number(a.estimate) - Number(b.estimate) ||
      (b.summary?.length || 0) - (a.summary?.length || 0),
  );
  const byUrl = new Map();
  const byTitle = new Map();
  const kept = [];

  for (const item of ordered) {
    const tKey = titleKey(item.title);
    const existing = byUrl.get(item.url) || (tKey ? byTitle.get(tKey) : null);
    if (existing) {
      if (item.source && item.source !== existing.source && !existing.alsoIn.includes(item.source)) {
        existing.alsoIn.push(item.source);
      }
      continue;
    }
    byUrl.set(item.url, item);
    if (tKey) byTitle.set(tKey, item);
    kept.push(item);
  }
  return kept;
}

/** 组装最终数据集 */
export function buildDataset(rawItems, options = {}) {
  const {
    now = Date.now(),
    timezone = DEFAULT_TIMEZONE,
    retentionDays = 60,
    maxItems = 4000,
    generatedAt = new Date(now).toISOString(),
  } = options;

  const cutoff = now - retentionDays * 86400000;
  const mapped = rawItems
    .filter((raw) => raw && raw.title && raw.url && /^https?:/i.test(raw.url))
    .map((raw) => makeItem(raw, { now, timezone }))
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
  const categoryMap = new Map();
  const sourceMap = new Map();
  for (const item of items) {
    dayMap.set(item.day, (dayMap.get(item.day) || 0) + 1);
    categoryMap.set(item.category, (categoryMap.get(item.category) || 0) + 1);
    sourceMap.set(item.source, (sourceMap.get(item.source) || 0) + 1);
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
      categories: [...categoryMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      sources: [...sourceMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      languages: {
        zh: items.filter((item) => item.lang === 'zh').length,
        en: items.filter((item) => item.lang === 'en').length,
      },
      estimatedTime: items.filter((item) => item.estimate).length,
    },
    items,
  };
}