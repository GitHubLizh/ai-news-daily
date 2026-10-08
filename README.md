# AI 资讯速递

**线上地址：<https://githublizh.github.io/ai-news-daily/>**（每天北京时间 06:00 自动更新）

一个自建的 AI 资讯聚合站：每天抓取国内外公开 RSS 源，去重、分类、按天归档后写入一份静态 JSON，
页面纯前端渲染。没有账号、没有广告，适合自己和朋友每天花几分钟扫一眼 AI 圈发生了什么。

参考效果：[ai.codefather.cn/news](https://ai.codefather.cn/news)（资讯流 + 日期查询 + 热度榜）。

![站点预览](docs/preview.png)

## 特性

- **按天归档的资讯流**：默认「最新」视图把全部归档按天从新到旧铺开，日期分组 + 粘性表头，
  跨源转载自动合并并标注「另见」（凌晨时段最新一天可能只有零星几条，头条与统计会自动带上前一天）
- **日期查询日历**：年 / 月 / 日三级切换，有数据的日期带标记，可一键跳到某天
- **分类筛选**：模型发布 / 产品动态 / 研究前沿 / 行业动态 / 开源工具 / 观点方法
- **搜索**：标题、摘要、来源、转载来源全文匹配，按 `/` 快速聚焦
- **默认只看中文**：打开就是中文资讯流，想看的英文用「英文 / 全部语言」一键切换，选择会记在本地
- **热度榜与来源分布**：侧栏实时统计当前范围的分类、来源与 TOP 10
- **收藏与已读**：浏览器本地记录，支持「隐藏已读」和只看收藏
- **站点自带订阅源**：每次抓取同步导出 `data/feed.xml`，可直接加进 RSS 阅读器
- **一条命令打包**：`npm run build` 生成 `dist/`，丢到任意静态托管即可发布
- **深色模式 / 响应式 / 可分享 URL**：`#/day/2026-10-08`、`#/all/cat/研究前沿` 等状态直接进地址栏
- **零运行时依赖**：只用 Node 内置能力，无 `node_modules` 也能跑

## 快速开始

需要 Node.js 20 及以上版本（依赖内置 `fetch`、`node:test`）。

```bash
# 1. 抓取资讯，生成 data/news.json
npm run fetch

# 2. 本地预览
npm run dev          # http://127.0.0.1:5173

# 3. 运行单元测试
npm test
```

> 直接双击 `index.html` 会因为浏览器安全策略无法读取 `data/news.json`，请用 `npm run dev` 打开。

## 命令

| 命令 | 说明 |
| --- | --- |
| `npm run fetch` | 抓取全部启用的源，写入 `data/news.json` 与 `data/feed.xml` |
| `npm run fetch -- --dry` | 只抓取与统计，不写文件 |
| `npm run fetch -- --only=qbitai,openai` | 只抓指定源，便于调试单个源 |
| `npm run build` | 生成可发布的 `dist/` 目录 |
| `npm run dev` / `npm start` | 启动本地静态预览服务（`PORT`、`HOST`、`CACHE_SECONDS` 可覆盖） |
| `npm test` | 运行 `test/` 下的单元测试 |

## 目录结构

```
├─ index.html               # 站点入口（发布根目录即仓库根目录）
├─ assets/
│  ├─ styles.css            # 设计变量 + 布局/组件样式（含深色模式）
│  └─ app.js                # 前端逻辑：加载 JSON、筛选、日历、收藏、路由
├─ data/
│  ├─ feeds.json            # 资讯源配置（启停、权重、相关性、时区修正）+ 站点信息
│  ├─ news.json             # 聚合产物，由 npm run fetch 生成并提交进仓库
│  └─ feed.xml              # 站点自身的 RSS 订阅源，随每次抓取更新
├─ scripts/
│  ├─ fetch-news.mjs        # 抓取 + 归一化 + 写盘
│  ├─ build.mjs             # 组装可发布的 dist/
│  ├─ serve.mjs             # 零依赖本地静态服务器
│  └─ lib/
│     ├─ rss.mjs            # 极简 RSS/Atom 解析、日期解析
│     ├─ normalize.mjs      # 相关性判断、分类、去重、按天分组、热度
│     ├─ feed.mjs           # 导出站点 RSS
│     └─ text.mjs           # HTML 清洗、实体解码、URL 规范化、语种识别
├─ test/                    # node:test 单元测试
├─ dist/                    # npm run build 产物（已 gitignore）
└─ .github/workflows/       # 定时刷新数据并发布到 GitHub Pages（可选）
```

## 数据管线

1. **抓取**：并发请求 `data/feeds.json` 中 `enabled` 的源，超时 25s，网络类错误最多重试 3 次。
2. **相关性过滤**：`relevance: "ai"` 的源照单全收（它们本身就是 AI 垂类媒体）；
   `relevance: "tech"` 的综合科技源**只按标题**判断——标题命中 AI 关键词才保留。
   实测发现按正文判断会把「苹果 iPad 发布」「显示器上市」这类稿件一并收进来，
   因为正文里出现一次 “AI / NVIDIA” 就够了，所以改成只看标题这一条更稳定的信号。
   每次抓取还会用当前规则重新裁决历史数据，规则调整后不需要手动清库。
3. **归一化**：清洗 HTML 与实体、压缩空白、摘要截断到 220 字、按规范化 URL 计算稳定 id。
4. **去重**：先按规范化 URL，再按标题归一化 key 判重；跨源转载合并为一条并记录 `alsoIn`。
5. **分类**：关键词打分，标题命中记 3 分、摘要记 1 分，取最高分分类，无命中落到「行业动态」。
6. **归档**：按 `Asia/Shanghai` 换算自然日分组，保留 `retentionDays`（默认 45 天）内的条目，
   总量上限 `maxItems`（默认 2500），每次抓取都会与已有数据合并，因此历史不会被新抓取冲掉。
7. **热度**：`0.5 × 时效衰减（36 小时半衰期）+ 0.25 × 来源权重 + 0.25 × 热点关键词命中`，
   归一到 0~100；只作为排序辅助，不代表真实阅读量。
8. **导出**：同时写出 `data/feed.xml`（最近 120 条），便于用 RSS 阅读器订阅。

### 源配置字段

```jsonc
{
  "id": "qbitai",
  "name": "量子位",
  "url": "https://www.qbitai.com/feed",
  "home": "https://www.qbitai.com",
  "lang": "zh",
  "weight": 2.2,            // 1~3，影响热度
  "relevance": "ai",        // ai=整站 AI；tech=综合科技站，需关键词过滤
  "timeShiftHours": -8,     // 可选：源站时区标错时做小时级修正
  "bulk": true,             // 可选：高频源（如 arXiv）
  "bulkLimit": 20,          // 可选：每日按新闻性择优保留条数
  "timeoutMs": 45000,       // 可选：单源超时覆盖
  "enabled": true
}
```

## 部署

```bash
npm run fetch && npm run build     # 生成 dist/
```

站点是纯静态产物，把 `dist/` 作为站点根目录发布即可（也可以直接发布仓库根目录）。

- **GitHub Pages**：仓库已带 `.github/workflows/refresh-and-deploy.yml`，每天北京时间 06:00
  自动抓取、提交 `data/news.json` 与 `data/feed.xml`、构建 `dist/` 并发布站点。
  本项目已按此方式部署在 <https://githublizh.github.io/ai-news-daily/>；换仓库时需在
  `Settings → Pages → Build and deployment` 把 Source 选为 **GitHub Actions**。
- **Vercel / Netlify**：构建命令填 `npm run fetch && npm run build`，发布目录填 `dist`。
- **本地自用**：`npm run fetch && npm run dev`，局域网内其他设备可通过 `HOST=0.0.0.0` 访问。

### 当前源（27 个抓取中）

| 中文 | 说明 | 英文 | 说明 |
| --- | --- | --- | --- |
| 量子位、雷锋网、开源中国、IT之家、钛媒体、InfoQ 中文、爱范儿、少数派、Solidot、极客公园、新浪科技、快科技、界面新闻 | 前 8 个为 `ai` 全量收录，其余 5 个为综合科技站、按 AI 关键词过滤 | OpenAI、Google DeepMind、NVIDIA、TechCrunch AI、The Decoder、The Verge AI、MarkTechPost、AWS 机器学习、Hacker News、Interconnects、arXiv cs.AI、MIT 科技评论、Ars Technica、Simon Willison | arXiv 为 `bulk` 源，每天择优保留 20 条 |

实测不可用而暂时关闭的源（配置保留在 `data/feeds.json`）：机器之心、36氪（RSS 已下线）、
Google AI、Hugging Face、Google Research、Meta AI（本机网络不可达）、VentureBeat（有反爬拦截）、
虎嗅、IEEE Spectrum（超时）。

## 已知问题

- **中文条量取决于源**：中文 AI 垂类源（机器之心、36氪、新智元）的 RSS 大多已下线或只做公众号，
  目前中文条目主要来自开源中国、极客公园、量子位、雷锋网等；英文条目仍占较大比例，页面默认只显示中文，
  想看英文可切到「英文 / 全部语言」。归档会随每日抓取逐步变厚，历史早期的中文条目较少属于正常现象。
- **部分源不稳定**：个别站点会偶发超时或被拦截（如 The Verge、Simon Willison），管线对网络类错误
  会重试 3 次，失败只影响当次抓取，不影响已有数据。
- **时区标注错误**：少数源把北京时间标成 GMT（如 InfoQ 中文），已通过 `timeShiftHours` 修正；
  源未提供发布时间的条目会标记「时间待确认」。
- **分类误判**：分类基于关键词规则，个别稿件可能归错类，可在 `scripts/lib/normalize.mjs`
  的 `CATEGORY_RULES` 中调整。

## 免责声明

所有资讯的版权归原作者与原网站所有，本站只聚合标题、摘要与原文链接，点击标题即可跳转原文。