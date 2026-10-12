import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { REFRESH_MIN_GAP_MS, datasetChanged, shouldRecheck } from '../assets/refresh.mjs';

const DATASET = (generatedAt) => ({ generatedAt, items: [{ id: 'a' }] });

describe('shouldRecheck', () => {
  it('页面在后台时不校验', () => {
    assert.equal(shouldRecheck({ hidden: true, lastCheckedAt: 0, now: 10_000 }), false);
    assert.equal(shouldRecheck({ hidden: true, lastCheckedAt: 0, now: 10_000, minGapMs: 0 }), false);
  });

  it('本次会话还没查过时立刻校验', () => {
    assert.equal(shouldRecheck({ hidden: false, lastCheckedAt: 0, now: 1_000_000 }), true);
  });

  it('距上次校验太近时跳过（来回切标签页不重复打请求）', () => {
    const now = 1_000_000;
    assert.equal(shouldRecheck({ lastCheckedAt: now - 1_000, now }), false);
    assert.equal(shouldRecheck({ lastCheckedAt: now - REFRESH_MIN_GAP_MS + 1, now }), false);
  });

  it('超过最小间隔后校验，边界值算够', () => {
    const now = 1_000_000;
    assert.equal(shouldRecheck({ lastCheckedAt: now - REFRESH_MIN_GAP_MS, now }), true);
    assert.equal(shouldRecheck({ lastCheckedAt: now - REFRESH_MIN_GAP_MS * 3, now }), true);
  });

  it('minGapMs 可覆盖，0 表示不设最小间隔', () => {
    const now = 1_000_000;
    assert.equal(shouldRecheck({ lastCheckedAt: now, now, minGapMs: 0 }), true);
  });
});

describe('datasetChanged', () => {
  it('抓到空数据时不覆盖页面', () => {
    const current = DATASET('2026-10-12T01:06:51.000Z');
    assert.equal(datasetChanged(current, null), false);
    assert.equal(datasetChanged(current, {}), false);
    assert.equal(datasetChanged(current, { generatedAt: '2026-10-12T02:00:00.000Z', items: [] }), false);
  });

  it('页面还没有数据时算有变化', () => {
    assert.equal(datasetChanged(null, DATASET('2026-10-12T01:06:51.000Z')), true);
  });

  it('generatedAt 相同视为没变化（不重绘）', () => {
    const stamp = '2026-10-12T01:06:51.000Z';
    assert.equal(datasetChanged(DATASET(stamp), DATASET(stamp)), false);
  });

  it('generatedAt 变化即需要重绘', () => {
    assert.equal(
      datasetChanged(DATASET('2026-10-12T01:06:51.000Z'), DATASET('2026-10-12T03:00:00.000Z')),
      true,
    );
  });
});