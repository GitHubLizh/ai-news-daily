#!/usr/bin/env node
/**
 * 本机自检：不经过 Cloudflare，直接用 Node 调 worker.js 里那段完全相同的代码，
 * 验证「令牌 + 请求写法」能不能真的派发工作流（会真的触发一次刷新，约 1 分钟）。
 *
 *   GH_TOKEN=github_pat_xxx node ops/refresh-trigger/selftest.mjs
 *
 * 也用于令牌到期后的轮换检查。
 */
import { dispatchRefresh } from './worker.js';

const token = process.env.GH_TOKEN;
if (!token) {
  console.error('❌ 缺少 GH_TOKEN 环境变量。用法：GH_TOKEN=github_pat_xxx node ops/refresh-trigger/selftest.mjs');
  process.exitCode = 1;
  process.exit(1);
}

const result = await dispatchRefresh({ GH_TOKEN: token });
console.log(`HTTP ${result.status} ${result.detail}`);

if (result.ok) {
  console.log('✅ 已派发：令牌与请求写法都没问题。到 Actions 页面能看到一次新的「刷新资讯并发布」运行。');
  process.exitCode = 0;
} else {
  const hints = {
    401: '令牌没被识别：多半是复制不全，或令牌已过期/被撤销。',
    403: '权限不够：细粒度令牌需要把 Repository permissions → Actions 设为 Read and write。',
    404: '找不到目标：确认令牌的 Repository access 里选中了 GitHubLizh/ai-news-daily。',
    422: '请求本身不合法：分支名或 workflow 文件名对不上（当前写死为 main / refresh-and-deploy.yml）。',
  };
  console.error(`❌ 派发失败。${hints[result.status] || '看上面的响应体内容判断原因。'}`);
  process.exitCode = 1;
}