/* =============================================================================
 * 外部定时触发器：每天定点派发 GitHub Actions 的「刷新资讯并发布」工作流。
 *
 * 为什么需要它：GitHub 的 `schedule` 是尽力而为，本仓库实测连续多天被排队推迟
 * 2h44m–3h46m（06:00 的槽位常常 08:45–10:00 才开跑）。Cloudflare 的 Cron Trigger
 * 到点即触发，于是数据能在北京时间 06:07 前后就位；GitHub 自带的槽位保留作兜底。
 *
 * 部署与密钥见同目录 README.md；本机自检见 selftest.mjs（同一段代码，不经过 Cloudflare）。
 * ========================================================================== */

const OWNER = 'GitHubLizh';
const REPO = 'ai-news-daily';
const WORKFLOW = 'refresh-and-deploy.yml';
const REF = 'main';

/**
 * 派发一次工作流。
 * @param {{GH_TOKEN?: string}} env Worker 环境变量（GH_TOKEN 为细粒度 PAT，只需该仓库 Actions: Read and write）
 * @param {typeof fetch} [fetchImpl] 便于本机自检时替换
 * @returns {Promise<{ok: boolean, status: number, detail: string}>}
 */
export async function dispatchRefresh(env, fetchImpl = fetch) {
  const token = env?.GH_TOKEN;
  if (!token) return { ok: false, status: 0, detail: '缺少 GH_TOKEN（部署后用 wrangler secret bulk 写入）' };

  const response = await fetchImpl(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'ai-news-refresh-trigger',
      },
      body: JSON.stringify({ ref: REF }),
    },
  );

  // 成功是 204 No Content；其余状态把响应体截下来，便于看 GitHub 给的原因
  const detail = response.status === 204 ? '已派发' : (await response.text().catch(() => '')).slice(0, 300);
  return { ok: response.status === 204, status: response.status, detail };
}

export default {
  /** Cloudflare Cron Trigger 到点调用 */
  async scheduled(event, env) {
    const result = await dispatchRefresh(env);
    console.log(`cron=${event.cron} status=${result.status} ${result.detail}`);
  },

  /**
   * 手动触发入口：GET / 带上口令（x-trigger-key 头或 ?key=）才会派发，
   * 免得 Worker 地址被人随手刷；其余一律 404，不暴露这个端点存在。
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = request.headers.get('x-trigger-key') || url.searchParams.get('key');
    if (url.pathname !== '/' || !env.TRIGGER_KEY || key !== env.TRIGGER_KEY) {
      return new Response('not found', { status: 404 });
    }
    const result = await dispatchRefresh(env);
    return new Response(`${result.status} ${result.detail}\n`, {
      status: result.ok ? 200 : 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};