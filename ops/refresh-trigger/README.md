# 外部定时触发器（让早上准点更新）

## 它解决的问题

GitHub Actions 的 `schedule` 是**尽力而为**：本仓库实测连续多天被排队推迟 2h44m–3h46m，
北京时间 06:00 的槽位常常 08:45–10:00 才开跑（数据也就跟着晚）。加槽位没用——所有槽位
排在同一条队里。想准点，只能由**外部**到点触发。

这里用一个 Cloudflare Worker + Cron Trigger：每天 **UTC 22:07（北京 06:07）** 调一次
GitHub 的 `workflow_dispatch` 接口，数据通常在 **06:09** 前后上线。GitHub 自带的两个槽位
（06:00 / 08:30）原样保留作兜底。

```
Cloudflare Cron (22:07 UTC) ──POST──> api.github.com/.../refresh-and-deploy.yml/dispatches
                                              └─> 抓取 → 提交数据 → 构建 → 同步 OSS / 发布 Pages
```

## 一次性设置

```bash
bash ops/refresh-trigger/wizard.sh
```

向导会一步步打开你要的页面、告诉你点哪里，并把值存到 `.env.local`（被 `.gitignore` 的
`.env.*` 覆盖，不会误提交）。只有三件事必须你本人做：

1. **创建细粒度令牌**：<https://github.com/settings/personal-access-tokens/new>
   —— 只选这一个仓库，`Permissions → Repository permissions → Actions: Read and write`，其余不给。
2. **Cloudflare 账号 + `npx wrangler login`**（免费账号即可，免费额度对每天 1 次调用绰绰有余）。
3. **粘贴 `deploy` 输出的 Worker 地址**（向导会记到 `.env.local`）。

手动做也可以：`cd ops/refresh-trigger && npx wrangler deploy`，然后写入两个密钥：

```bash
# wrangler 版本较老、没有 secret bulk 时，改成 npx wrangler secret put GH_TOKEN 逐条粘贴
npx wrangler secret bulk <含 GH_TOKEN 与 TRIGGER_KEY 的 json>
```

| 密钥 | 用途 | 内容 |
| --- | --- | --- |
| `GH_TOKEN` | Worker 调 GitHub API | 上面那个细粒度令牌（`github_pat_…`） |
| `TRIGGER_KEY` | 手动触发口令 | 随机 32 位十六进制；向导用 `crypto.randomBytes(16)` 生成 |

## 验证

**本机（不经过 Cloudflare，跑的就是 Worker 里那段代码）：**

```bash
GH_TOKEN=github_pat_xxx node ops/refresh-trigger/selftest.mjs   # 期望 HTTP 204 已派发
```

**线上：** 次日 06:07 之后

```bash
gh run list --workflow refresh-and-deploy.yml --limit 3   # 应当多出一条 06:07 左右的运行
```

**手动触发一次（可选）：**

```bash
curl -H "x-trigger-key: <TRIGGER_KEY>" https://<你的 Worker 地址>/
```

> ⚠️ `*.workers.dev` 在国内常被 DNS 污染，这个手动入口**在国内可能连不上**——不影响定时触发，
> 因为定时那条路是 Cloudflare 的边缘节点直接调 GitHub，不经过这个地址。
> 想在国内也能手动触发，就在 Cloudflare 面板给它绑一个自有域名的路由（可选）。

## 排查

| 现象 | 看哪里 |
| --- | --- |
| 本机 selftest 401 / 403 / 404 / 422 | 脚本会直接给出对应原因（令牌不全 / Actions 权限没给 / 仓库没选中 / 分支或文件名不对） |
| 部署了但明早没触发 | Cloudflare 面板 → Workers & Pages → `ai-news-refresh-trigger` → Settings → Triggers，确认 `schedule: 7 22 * * *` 在；再看 `npx wrangler tail` 有没有 `cron=... status=204` 日志 |
| 触发了但工作流失败 | 与定时无关，去 Actions 页面看那一次运行的报错 |
| 改了触发时间 | 改 `wrangler.toml` 里的 `crons`，重新 `npx wrangler deploy` |

**令牌 90 天过期**（向导默认选的时长）：重跑一次向导即可轮换。

## 不用 Cloudflare 也行

这个触发器的本质只有一句话：**在 22:07 UTC 发一个带 Bearer 令牌的 POST**。
换成 cron-job.org、阿里云函数计算的定时触发器、Vercel Cron 都可以，只要能发自定义请求头
（`Authorization` / `Accept: application/vnd.github+json`）和 JSON 请求体 `{"ref":"main"}`。
选 Cloudflare 的原因是：配置全在代码里（`worker.js` + `wrangler.toml`），可以本地自检、也能用
`wrangler tail` 看日志。