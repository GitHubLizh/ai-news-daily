/**
 * 证书有效期探测：给「线路抽样」和「证书到期提醒」共用的底层能力。
 *
 * rejectUnauthorized 故意设为 false：证书过期/不受信时也要让握手完成，
 * 否则永远报不出「已过期」——本项目启用了强制 HTTPS，证书一过期整站就打不开，
 * 所以「还剩多少天」比「证书当下是否可信」更重要。
 */
import tls from 'node:tls';

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * 读取某域名 443 端口上的服务端证书信息
 * @param {string} host 域名
 * @param {{port?: number, timeoutMs?: number}} [options]
 * @returns {Promise<{authorized: boolean, expires: Date, expiresTs: number, commonName: string} | null>}
 */
export function certInfo(host, options = {}) {
  const { port = 443, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once('secureConnect', () => {
      const peer = socket.getPeerCertificate();
      const expires = peer?.valid_to ? new Date(peer.valid_to) : null;
      if (!expires || Number.isNaN(expires.getTime())) return done(null);
      done({
        authorized: socket.authorized === true,
        expires,
        expiresTs: expires.getTime(),
        commonName: peer.subject?.CN || '',
      });
    });
    socket.once('timeout', () => done(null));
    socket.once('error', () => done(null));
  });
}

/** 距到期还有几天（向下取整，已过期返回负数） */
export function daysUntil(expiresTs, now = Date.now()) {
  return Math.floor((expiresTs - now) / 86400000);
}

/** 快到期（默认 30 天）就该提醒——证书有效期可能只有约 3 个月，留足续期时间 */
export function needsRenewal(expiresTs, thresholdDays = 30, now = Date.now()) {
  return daysUntil(expiresTs, now) <= thresholdDays;
}