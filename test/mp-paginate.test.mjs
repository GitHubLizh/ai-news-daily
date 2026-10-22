import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PAGE_SIZE, MAX_IDS, MAX_PAGE_SIZE, respond } from '../cloudfunctions/news/paginate.mjs';

const DATASET = {
  generatedAt: '2026-10-21T01:00:00.000Z',
  timezone: 'Asia/Shanghai',
  count: 5,
  days: [{ day: '2026-10-21', label: '10月21日 · 周三', count: 5 }],
  stats: { languages: { zh: 3, en: 2 }, sources: [], estimatedTime: 0 },
  items: [
    { id: 'a', title: '甲' },
    { id: 'b', title: '乙' },
    { id: 'c', title: '丙' },
    { id: 'd', title: '丁' },
    { id: 'e', title: '戊' },
  ],
};

const ids = (result) => result.items.map((item) => item.id);

describe('news 云函数分页逻辑', () => {
  it('默认参数返回第一页（pageSize 默认 200，小数据集一次拿完）', () => {
    const result = respond(DATASET, {});
    assert.deepEqual(ids(result), ['a', 'b', 'c', 'd', 'e']);
    assert.equal(result.hasMore, false);
    assert.equal(result.page, 0);
    assert.equal(result.pageSize, DEFAULT_PAGE_SIZE);
  });

  it('meta 随每页返回（total / days / stats / generatedAt）', () => {
    const result = respond(DATASET, { page: 1, pageSize: 2 });
    assert.equal(result.total, 5);
    assert.equal(result.generatedAt, DATASET.generatedAt);
    assert.equal(result.days, DATASET.days);
    assert.equal(result.stats, DATASET.stats);
  });

  it('按页切片与 hasMore 边界', () => {
    assert.deepEqual(ids(respond(DATASET, { page: 0, pageSize: 2 })), ['a', 'b']);
    assert.equal(respond(DATASET, { page: 0, pageSize: 2 }).hasMore, true);
    assert.deepEqual(ids(respond(DATASET, { page: 2, pageSize: 2 })), ['e']);
    assert.equal(respond(DATASET, { page: 2, pageSize: 2 }).hasMore, false);
    // 越过末页：空列表且 hasMore=false
    assert.deepEqual(respond(DATASET, { page: 3, pageSize: 2 }).items, []);
    assert.equal(respond(DATASET, { page: 3, pageSize: 2 }).hasMore, false);
  });

  it('pageSize 与 page 的非法值被钳制', () => {
    assert.equal(respond(DATASET, { pageSize: 9999 }).pageSize, MAX_PAGE_SIZE);
    assert.equal(respond(DATASET, { pageSize: 0 }).pageSize, 1); // 越界钳到下限
    assert.equal(respond(DATASET, { pageSize: 'abc' }).pageSize, DEFAULT_PAGE_SIZE); // 非数字回退默认
    assert.equal(respond(DATASET, { page: -3, pageSize: 2 }).page, 0);
  });

  it('ids 模式按 id 返回条目', () => {
    const result = respond(DATASET, { ids: ['d', 'b'] });
    assert.deepEqual(ids(result), ['b', 'd']); // 保持数据集原有顺序
    assert.equal(result.hasMore, false);
  });

  it('ids 模式截断超长列表', () => {
    const many = Array.from({ length: MAX_IDS + 50 }, (_, index) => `id-${index}`);
    const result = respond({ ...DATASET, items: [] }, { ids: many });
    assert.equal(result.items.length, 0);
    assert.equal(result.total, 0);
  });

  it('空 ids 数组走分页分支', () => {
    const result = respond(DATASET, { ids: [], pageSize: 2 });
    assert.deepEqual(ids(result), ['a', 'b']);
  });
});
