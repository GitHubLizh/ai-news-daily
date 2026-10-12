#!/usr/bin/env node
/**
 * 打印某域名证书的到期时间与剩余天数，供 CI 判断是否需要提醒。
 *
 * 用法：
 *   node scripts/cert-days.mjs                # 默认检查主站
 *   node scripts/cert-days.mjs 你的域名
 *   node scripts/cert-days.mjs --threshold=45 你的域名
 *
 * 输出：人类可读一行 + 供 GitHub Actions 读取的 `key=value`（days / expires / need_renew / authorized）。
 * 退出码：探测失败为 1，其余为 0（到期与否由 CI 决定要不要提醒）。
 */
import { certInfo, daysUntil, needsRenewal } from './lib/cert.mjs';

const args = process.argv.slice(2);
const thresholdArg = args.find((arg) => arg.startsWith('--threshold='));
const THRESHOLD_DAYS = thresholdArg ? Number(thresholdArg.slice('--threshold='.length)) : 30;
const host = args.find((arg) => !arg.startsWith('--')) || 'latestainews.cn';

const info = await certInfo(host);
if (!info) {
  console.error(`❌ 无法获取 ${host} 的证书信息（域名不可达或未启用 HTTPS）`);
  process.exitCode = 1;
} else {
  const days = daysUntil(info.expiresTs);
  const expires = info.expires.toISOString().slice(0, 10);
  const renew = needsRenewal(info.expiresTs, THRESHOLD_DAYS);
  const flag = days <= 0 ? '❌ 已过期' : renew ? `⚠️ 剩余不足 ${THRESHOLD_DAYS} 天，尽快续期` : '✅ 充足';
  console.log(`${host}：证书到期 ${expires}，剩余 ${days} 天 ${flag}`);
  console.log(`expires=${expires}`);
  console.log(`days=${days}`);
  console.log(`authorized=${info.authorized}`);
  console.log(`need_renew=${renew}`);
}