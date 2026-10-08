/**
 * 把聚合结果导出为站点自己的 RSS 订阅源（data/feed.xml），
 * 方便用阅读器订阅，也为将来做邮件/推送留出入口。
 */

/** XML 文本转义（含属性场景下的引号） */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // 去掉 XML 1.0 不允许的控制字符
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/**
 * 生成 RSS 2.0 文档
 * @param {{items: Array}} dataset 归一化后的数据集
 * @param {{title: string, url: string, description?: string, language?: string}} site 站点信息
 * @param {{limit?: number}} options
 */
export function buildRssXml(dataset, site, options = {}) {
  const { limit = 100 } = options;
  const title = site?.title || 'AI 资讯速递';
  const home = (site?.url || '').replace(/\/+$/, '');
  const self = home ? `${home}/data/feed.xml` : 'data/feed.xml';
  const items = (dataset?.items || []).slice(0, limit);

  const entries = items
    .map((item) => {
      const meta = [item.source, item.category, item.alsoIn?.length ? `另见 ${item.alsoIn.join('、')}` : '']
        .filter(Boolean)
        .join(' · ');
      // 中文摘要后直接接括号，英文（含英文句点结尾）摘要后补一个空格更自然
      const separator = /[A-Za-z0-9).\]"']$/.test(item.summary || '') ? ' ' : '';
      const description = `${item.summary}${separator}（${meta}）`;
      return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.url)}</link>
      <guid isPermaLink="true">${escapeXml(item.url)}</guid>
      <pubDate>${new Date(item.publishedTs).toUTCString()}</pubDate>
      <category>${escapeXml(item.category)}</category>
      <description>${escapeXml(description)}</description>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(home || self)}</link>
    <description>${escapeXml(site?.description || '聚合国内外 AI 资讯：模型发布、产品动态、研究前沿、行业动态。')}</description>
    <language>${escapeXml(site?.language || 'zh-CN')}</language>
    <lastBuildDate>${new Date(dataset?.generatedAt || Date.now()).toUTCString()}</lastBuildDate>
    <generator>ai-news-daily</generator>
    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml" />
${entries}
  </channel>
</rss>
`;
}