# AI 资讯速递

一个自建的 AI 资讯聚合站：每天抓取国内外公开 RSS 源，去重、分类、按天归档后写入一份静态 JSON，
页面纯前端渲染。没有账号、没有广告，适合自己和朋友每天花几分钟扫一眼 AI 圈发生了什么。

参考效果：[ai.codefather.cn/news](https://ai.codefather.cn/news)（资讯流 + 日期查询 + 热度榜）。

![站点预览](docs/preview.png)

## 特性

- **按天归档的资讯流**：日期分组 + 粘性表头，跨源转载自动合并并标注「另见」
- **日期查询日历**：年 / 月 / 日三级切换，有数据的日期带标记，可一键跳到某天
- **分类筛选**：模型发布 / 产品动态 / 研究前沿 / 行业动态 / 开源工具 / 观点方法
- **搜索**：标题、摘要、来源、转载来源全文匹配，按 `/` 快速聚焦
- **中英文过滤**：自动识别语种，中英混排站点也能只看中文
- **热度榜与来源分布**：侧栏实时统计当前范围的分类、来源与 TOP 10
- **收藏与已读**：浏览器本地记录，支持「隐藏已读」和只看收藏
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
| `npm run fetch` | 抓取全部启用的源，归一化后写入 `data/news.json` |
| `npm run fetch -- --dry` | 只抓取与统计，不写文件 |
| `npm run fetch -- --only=qbitai,openai` | 只抓指定源，便于调试单个源 |
| `npm run dev` / `npm start` | 启动本地静态预览服务（`PORT`、`HOST`、`CACHE_SECONDS` 可覆盖） |
| `npm test` | 运行 `test/` 下的单元测试 |

## 目录结构

```
├─ index.html               # 站点入口（发布根目录即仓库根目录）
├─ assets/
│  ├─ styles.css            # 设计变量 + 布局/组件样式（含深色模式）
│  └─ app.js                # 前端逻辑：加载 JSON、筛选、日历、收藏、路由
├─ data/
│  ├─ feeds.json            # 资讯源配置（启停、权重、相关性、时区修正）
│  └─ news.json             # 聚合产物，由 npm run fetch 生成并提交进仓库
├─ scripts/
│  ├─ fetch-news.mjs        # 抓取 + 归一化 + 写盘
│  ├─ serve.mjs             # 零依赖本地静态服务器
│  └─ lib/
│     ├─ rss.mjs            # 极简 RSS/Atom 解析、日期解析
│     ├─ normalize.mjs      # 相关性判断、分类、去重、按天分组、热度
│     └─ text.mjs           # HTML 清洗、实体解码、URL 规范化、语种识别
├─ test/                    # node:test 单元测试
└─ .github/workflows/       # 定时刷新数据并发布到 GitHub Pages（可选）
```

## 数据管线

1. **抓取**：并发请求 `data/feeds.json` 中 `enabled` 的源，超时 25s，网络类错误最多重试 3 次。
2. **相关性过滤**：`relevance: "ai"` 的源照单全收；`relevance: "tech"` 的综合科技源只有
   命中 AI 强信号（标题或摘要）或弱信号（仅标题，如「机器人」「芯片」）才保留。
3. **归一化**：清洗 HTML 与实体、压缩空白、摘要截断到 220 字、按规范化 URL 计算稳定 id。
4. **去重**：先按规范化 URL，再按标题归一化 key 判重；跨源转载合并为一条并记录 `alsoIn`。
5. **分类**：关键词打分，标题命中记 3 分、摘要记 1 分，取最高分分类，无命中落到「行业动态」。
6. **归档**：按 `Asia/Shanghai` 换算自然日分组，保留 `retentionDays`（默认 45 天）内的条目，
   总量上限 `maxItems`（默认 2500），每次抓取都会与已有数据合并，因此历史不会被新抓取冲掉。
7. **热度**：`0.5 × 时效衰减（36 小时半衰期）+ 0.25 × 来源权重 + 0.25 × 热点关键词命中`，
   归一到 0~100；只作为排序辅助，不代表真实阅读量。

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

站点是纯静态产物：`index.html` + `assets/` + `data/news.json` 三个路径即可上线。

- **GitHub Pages**：仓库已带 `.github/workflows/refresh-and-deploy.yml`，每天北京时间 06:00
  自动抓取、提交 `data/news.json` 并发布站点。首次使用需在仓库
  `Settings → Pages → Build and deployment` 把 Source 选为 **GitHub Actions**。
- **Vercel / Netlify**：直接把仓库根目录当静态站点发布，构建命令留空（或填 `npm run fetch` 以在发布前刷新数据）。
- **本地自用**：`npm run fetch && npm run dev`，局域网内其他设备可通过 `HOST=0.0.0.0` 访问。

## 已知问题

- **部分源不可用**：`data/feeds.json` 中 `enabled: false` 的源是实测失败的（如机器之心 / 36氪
  已下线 RSS、Google AI 与 Hugging Face 在部分网络不可达），保留配置便于日后恢复。
- **时区标注错误**：少数源把北京时间标成 GMT（如 InfoQ 中文），已通过 `timeShiftHours` 修正；
  源未提供发布时间的条目会标记「时间待确认」。
- **分类误判**：分类基于关键词规则，个别稿件可能归错类，可在 `scripts/lib/normalize.mjs`
  的 `CATEGORY_RULES` 中调整。

## 免责声明

所有资讯的版权归原作者与原网站所有，本站只聚合标题、摘要与原文链接，点击标题即可跳转原文。