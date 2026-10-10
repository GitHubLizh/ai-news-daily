#!/usr/bin/env node
/**
 * 多线路可达性抽样：回答「换到某条线路后，国内是否还会像访问 GitHub 那样时好时坏」。
 *
 * 用法：
 *   npm run check:lines                        # 抽样默认几条线路
 *   npm run check:lines -- --n=8               # 每条抽样 8 次
 *   npm run check:lines -- https://news.example.com/
 *
 * 对每条线路做三件事：
 *   1. 解析域名——分别用系统 DNS 与 8.8.8.8，两边不一致说明本机 DNS 被污染（GitHub 的典型症状）；
 *   2. TCP 连 443 端口——测的是纯链路，绕过 HTTP；
 *   3. 完整 HTTPS 请求——测总耗时与失败率。
 *
 * 零依赖，只用 Node 内置能力。建议在不同时段各跑一次，尤其是晚高峰 20:00–23:00。
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { performance } from 'node:perf_hooks';

const TCP_TIMEOUT_MS = 8000;
const HTTPS_TIMEOUT_MS = 15000;
const PUBLIC_DNS = ['8.8.8.8', '1.1.1.1'];

const DEFAULT_TARGETS = [
  ['线上站点（GitHub Pages）', 'https://githublizh.github.io/ai-news-daily/'],
  ['阿里云 OSS 香港（本项目选用）', 'https://oss-cn-hongkong.aliyuncs.com/'],
  ['阿里云 OSS 杭州（需备案）', 'https://oss-cn-hangzhou.aliyuncs.com/'],
  ['Cloudflare 对照', 'https://docs.pages.dev/'],
];

const args = process.argv.slice(2);
const nArg = args.find((arg) => arg.startsWith('--n='));
const SAMPLES = nArg ? Math.max(1, Math.min(50, Number(nArg.slice(4)) || 1)) : 5;
const urls = args.filter((arg) => !arg.startsWith('--'));
const targets = urls.length ? urls.map((url) => [url, url]) : DEFAULT_TARGETS;

/** 取分位数（p 为 0~1），输入已排序 */
function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

const ms = (value) => (Number.isFinite(value) ? `${Math.round(value)}ms` : '—');

/** 对比系统 DNS 与公共 DNS 的解析结果，不一致即本机存在 DNS 污染 */
async function resolveBoth(host) {
  const system = await dns
    .lookup(host, { all: true })
    .then((rows) => rows.map((row) => row.address).sort())
    .catch(() => []);
  const resolver = new dns.Resolver();
  resolver.setServers(PUBLIC_DNS);
  const viaPublic = await resolver
    .resolve4(host)
    .then((rows) => [...rows].sort())
    .catch(() => []);
  const same = system.length > 0 && viaPublic.length > 0 && system.join() === viaPublic.join();
  return { system, viaPublic, same };
}

/** 纯 TCP 建连耗时，不涉及 HTTP */
function tcpConnect(host, port = 443) {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, ms: performance.now() - started });
    };
    socket.setTimeout(TCP_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** 完整 HTTPS 请求耗时；任何 HTTP 状态码都算链路通（如 OSS 未指定 Bucket 会返回 403） */
async function httpsTiming(url) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTPS_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    await response.arrayBuffer().catch(() => {});
    return { ok: true, status: response.status, ms: performance.now() - started };
  } catch (error) {
    return { ok: false, status: 0, ms: performance.now() - started, error: error?.name || 'Error' };
  } finally {
    clearTimeout(timer);
  }
}

async function checkLine(label, url) {
  const host = new URL(url).hostname;
  console.log(`\n■ ${label}`);
  console.log(`  ${url}`);

  const { system, viaPublic, same } = await resolveBoth(host);
  const verdict = system.length === 0 ? '系统解析失败' : same ? '一致（未见污染）' : '⚠️ 不一致，疑似 DNS 污染';
  console.log(`  DNS  系统: ${system.join(', ') || '—'}`);
  console.log(`       8.8.8.8: ${viaPublic.join(', ') || '—'}   → ${verdict}`);

  const connects = [];
  let tcpFail = 0;
  for (let i = 0; i < SAMPLES; i += 1) {
    const result = await tcpConnect(host);
    if (result.ok) connects.push(result.ms);
    else tcpFail += 1;
  }
  connects.sort((a, b) => a - b);
  console.log(
    `  TCP  失败 ${tcpFail}/${SAMPLES}   p50 ${ms(quantile(connects, 0.5))}   p95 ${ms(quantile(connects, 0.95))}`,
  );

  const totals = [];
  let httpsFail = 0;
  const statuses = new Set();
  for (let i = 0; i < SAMPLES; i += 1) {
    const result = await httpsTiming(url);
    if (result.ok) {
      totals.push(result.ms);
      statuses.add(result.status);
    } else {
      httpsFail += 1;
    }
  }
  totals.sort((a, b) => a - b);
  console.log(
    `  HTTPS 失败 ${httpsFail}/${SAMPLES}   p50 ${ms(quantile(totals, 0.5))}   p95 ${ms(quantile(totals, 0.95))}` +
      `   状态码 ${[...statuses].join(',') || '—'}`,
  );

  return { label, url, dnsPolluted: system.length > 0 && !same, tcpFail, httpsFail, samples: SAMPLES };
}

async function main() {
  console.log(`多线路抽样：每条 ${SAMPLES} 次（OSS endpoint 返回 403 属正常，说明链路通）`);
  const results = [];
  for (const [label, url] of targets) {
    try {
      results.push(await checkLine(label, url));
    } catch (error) {
      console.log(`\n■ ${label}\n  ❌ 无法检测：${error.message}`);
    }
  }

  console.log('\n──── 汇总 ────');
  for (const row of results) {
    const dnsNote = row.dnsPolluted ? 'DNS 疑似污染' : 'DNS 正常';
    const netNote =
      row.httpsFail === 0 && row.tcpFail === 0
        ? '全程无失败'
        : `失败 TCP ${row.tcpFail}/${row.samples}、HTTPS ${row.httpsFail}/${row.samples}`;
    console.log(`  ${row.label}：${dnsNote}；${netNote}`);
  }
  console.log('\n提示：单一时段的抽样只代表当时情况，建议晚高峰（20:00–23:00）再跑一次。');
}

main().catch((error) => {
  console.error(`❌ 检查失败：${error.message}`);
  process.exitCode = 1;
});