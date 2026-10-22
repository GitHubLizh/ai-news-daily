import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { clockOf, dayKeyOf, dayLabelOf, fullDateTime, relativeTime, shortDateTime, todayKey } from '../miniprogram/utils/time.js';

// 2026-10-13 09:30:00 UTC+8 = 2026-10-13 01:30:00 UTC
const TS = Date.UTC(2026, 9, 13, 1, 30, 0);
// 2026-10-13 12:00:00 UTC+8（作为“现在”）
const NOW = Date.UTC(2026, 9, 13, 4, 0, 0);

describe('小程序时间工具（手写 UTC+8，不依赖 Intl）', () => {
  it('dayKeyOf 按 UTC+8 换算自然日', () => {
    assert.equal(dayKeyOf(TS), '2026-10-13');
    // UTC 还是 10-12 深夜、北京已是 10-13 凌晨
    assert.equal(dayKeyOf(Date.UTC(2026, 9, 12, 16, 30, 0)), '2026-10-13');
    // UTC 跨入 10-13 但北京还没过零点
    assert.equal(dayKeyOf(Date.UTC(2026, 9, 12, 15, 59, 59)), '2026-10-12');
  });

  it('todayKey 与 clockOf', () => {
    assert.equal(todayKey(NOW), '2026-10-13');
    assert.equal(clockOf(TS), '09:30');
    assert.equal(clockOf(Date.UTC(2026, 9, 12, 16, 5, 0)), '00:05');
  });

  it('relativeTime：今天显示时分', () => {
    assert.equal(relativeTime(TS, NOW), '今天 09:30');
  });

  it('relativeTime：昨天显示时分', () => {
    const yesterday = Date.UTC(2026, 9, 12, 10, 0, 0); // 北京 10-12 18:00
    assert.equal(relativeTime(yesterday, NOW), '昨天 18:00');
  });

  it('relativeTime：更早显示月日，跨年不报错', () => {
    const earlier = Date.UTC(2026, 9, 1, 2, 0, 0); // 北京 10-01 10:00
    assert.equal(relativeTime(earlier, NOW), '10月1日 10:00');
    const lastYear = Date.UTC(2025, 11, 31, 20, 0, 0); // 北京 2026-01-01 04:00
    assert.equal(relativeTime(lastYear, NOW), '1月1日 04:00');
  });

  it('dayLabelOf 优先取数据里的 label', () => {
    const days = [{ day: '2026-10-13', label: '10月13日 · 周二', count: 65 }];
    assert.equal(dayLabelOf('2026-10-13', days), '10月13日 · 周二');
  });

  it('dayLabelOf 兜底自算星期', () => {
    // 2026-10-13 是周二
    assert.equal(dayLabelOf('2026-10-13', []), '10月13日 · 周二');
    // 2026-01-01 是周四
    assert.equal(dayLabelOf('2026-01-01', undefined), '1月1日 · 周四');
  });

  it('shortDateTime / fullDateTime', () => {
    assert.equal(shortDateTime(TS), '10-13 09:30');
    assert.equal(fullDateTime(TS), '2026-10-13 09:30');
  });
});
