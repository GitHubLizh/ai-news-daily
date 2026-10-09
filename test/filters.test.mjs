import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHashString,
  countByCategory,
  heroWindowDays,
  parseHashString,
  selectItems,
} from '../assets/filters.mjs';

const TODAY = '2026-10-09';

function item(overrides = {}) {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    title: '标题',
    summary: '摘要',
    source: '量子位',
    category: '模型发布',
    lang: 'zh',
    day: '2026-10-08',
    publishedTs: 0,
    hot: 0,
    bulk: false,
    alsoIn: [],
    ...overrides,
  };
}

/** 构造一份中英混合、跨两天、含多分类的样本 */
const SAMPLE = [
  item({ id: 'a', lang: 'zh', category: '模型发布', day: '2026-10-09', hot: 90, title: '国产大模型发布' }),
  item({ id: 'b', lang: 'zh', category: '模型发布', day: '2026-10-08', hot: 30, title: 'GPT 新版本' }),
  item({ id: 'c', lang: 'en', category: '模型发布', day: '2026-10-08', hot: 80, title: 'Claude ships' }),
  item({ id: 'd', lang: 'zh', category: '行业动态', day: '2026-10-08', hot: 50, title: '某公司融资' }),
  item({ id: 'e', lang: 'en', category: '行业动态', day: '2026-10-09', hot: 70, title: 'Funding round' }),
  item({ id: 'f', lang: 'zh', category: '研究前沿', day: '2026-10-08', hot: 10, title: '论文提出新算法', bulk: true }),
];

const base = { today: TODAY, bookmarkIds: new Set(), readIds: new Set() };

describe('parseHashString', () => {
  it('空哈希回落到默认状态', () => {
    assert.deepEqual(parseHashString(''), { view: 'all', day: null, category: 'all', lang: null });
  });

  it('解析日期视图', () => {
    assert.deepEqual(parseHashString('#/day/2026-10-08'), {
      view: 'day',
      day: '2026-10-08',
      category: 'all',
      lang: null,
    });
  });

  it('解析视图后的分类参数（曾经的 bug：偏移错误把 cat 当成值吃掉）', () => {
    assert.equal(parseHashString('#/all/cat/模型发布').category, '模型发布');
    assert.equal(parseHashString('#/bookmarks/cat/行业动态').category, '行业动态');
    assert.equal(parseHashString('#/day/2026-10-08/cat/研究前沿').category, '研究前沿');
    assert.equal(parseHashString('#/day/2026-10-08/cat/研究前沿').day, '2026-10-08');
  });

  it('解析语言参数并忽略非法值', () => {
    assert.equal(parseHashString('#/all/lang/en').lang, 'en');
    assert.equal(parseHashString('#/all/lang/全部').lang, null);
    assert.equal(parseHashString('#/all/lang/en/cat/模型发布').category, '模型发布');
  });

  it('分类名含中文时能正确解码', () => {
    assert.equal(parseHashString(`#/all/cat/${encodeURIComponent('研究前沿')}`).category, '研究前沿');
  });
});

describe('buildHashString', () => {
  it('默认状态保持简洁', () => {
    assert.equal(buildHashString({ view: 'all', lang: 'zh', category: 'all', day: null }), '#/all');
  });

  it('与 parseHashString 往返一致', () => {
    const state = { view: 'day', day: '2026-10-08', lang: 'en', category: '研究前沿' };
    const parsed = parseHashString(buildHashString(state));
    assert.equal(parsed.view, 'day');
    assert.equal(parsed.day, '2026-10-08');
    assert.equal(parsed.lang, 'en');
    assert.equal(parsed.category, '研究前沿');
  });

  it('收藏视图与语言跟随', () => {
    assert.equal(buildHashString({ view: 'bookmarks', lang: 'all', category: 'all' }), '#/bookmarks/lang/all');
  });
});

describe('selectItems 视图范围', () => {
  it('全部视图返回所有条目', () => {
    assert.equal(selectItems(SAMPLE, { ...base, view: 'all', lang: 'all' }).length, 6);
  });

  it('日期视图只保留当天', () => {
    const result = selectItems(SAMPLE, { ...base, view: 'day', day: '2026-10-09', lang: 'all' });
    assert.deepEqual(result.map((entry) => entry.id), ['a', 'e']);
  });

  it('今天视图按当前自然日过滤', () => {
    const result = selectItems(SAMPLE, { ...base, view: 'today', lang: 'all' });
    assert.deepEqual(result.map((entry) => entry.id).sort(), ['a', 'e']);
  });

  it('收藏视图只保留已收藏', () => {
    const result = selectItems(SAMPLE, { ...base, view: 'bookmarks', lang: 'all', bookmarkIds: new Set(['c']) });
    assert.deepEqual(result.map((entry) => entry.id), ['c']);
  });
});

describe('selectItems 筛选组合', () => {
  it('语言筛选生效', () => {
    assert.deepEqual(
      selectItems(SAMPLE, { ...base, lang: 'zh' }).map((entry) => entry.id),
      ['a', 'b', 'd', 'f'],
    );
    assert.deepEqual(
      selectItems(SAMPLE, { ...base, lang: 'en' }).map((entry) => entry.id),
      ['c', 'e'],
    );
  });

  it('分类 + 语言叠加', () => {
    assert.deepEqual(
      selectItems(SAMPLE, { ...base, category: '模型发布', lang: 'zh' }).map((entry) => entry.id),
      ['a', 'b'],
    );
  });

  it('ignoreCategory 时分类筛选被跳过（用于统计口径）', () => {
    const result = selectItems(SAMPLE, { ...base, category: '模型发布', lang: 'zh', ignoreCategory: true });
    assert.equal(result.length, 4);
  });

  it('只看论文与隐藏已读', () => {
    assert.deepEqual(
      selectItems(SAMPLE, { ...base, onlyPapers: true, lang: 'all' }).map((entry) => entry.id),
      ['f'],
    );
    assert.deepEqual(
      selectItems(SAMPLE, { ...base, hideRead: true, lang: 'all', readIds: new Set(['a', 'c']) }).map(
        (entry) => entry.id,
      ),
      ['b', 'd', 'e', 'f'],
    );
  });

  it('关键词匹配标题、摘要、来源与转载来源', () => {
    const withAlso = [...SAMPLE, item({ id: 'g', title: '无关标题', summary: '无关', alsoIn: ['机器之心'], lang: 'zh' })];
    assert.deepEqual(
      selectItems(withAlso, { ...base, query: '机器之心', lang: 'all' }).map((entry) => entry.id),
      ['g'],
    );
    assert.equal(selectItems(SAMPLE, { ...base, query: 'claude', lang: 'all' }).length, 1);
    assert.equal(selectItems(SAMPLE, { ...base, query: '', lang: 'all' }).length, 6);
  });

  it('按热度排序', () => {
    const ids = selectItems(SAMPLE, { ...base, lang: 'all', sort: 'hot' }).map((entry) => entry.id);
    assert.deepEqual(ids, ['a', 'c', 'e', 'd', 'b', 'f']);
  });
});

describe('countByCategory（分类计数口径）', () => {
  it('计数随语言筛选变化', () => {
    const all = countByCategory(selectItems(SAMPLE, { ...base, lang: 'all', ignoreCategory: true }));
    const zh = countByCategory(selectItems(SAMPLE, { ...base, lang: 'zh', ignoreCategory: true }));
    assert.equal(all.get('模型发布'), 3);
    assert.equal(zh.get('模型发布'), 2);
    assert.equal(all.get('行业动态'), 2);
    assert.equal(zh.get('行业动态'), 1);
    assert.notDeepEqual([...all.values()].sort(), [...zh.values()].sort());
  });

  it('选中某个分类后，其它分类的计数仍然保留', () => {
    const counts = countByCategory(
      selectItems(SAMPLE, { ...base, lang: 'zh', category: '模型发布', ignoreCategory: true }),
    );
    assert.equal(counts.get('模型发布'), 2);
    assert.equal(counts.get('行业动态'), 1);
    assert.equal(counts.get('研究前沿'), 1);
  });

  it('「全部」计数等于各分类之和，也等于列表长度', () => {
    const scoped = selectItems(SAMPLE, { ...base, lang: 'zh', ignoreCategory: true });
    const counts = countByCategory(scoped);
    const sum = [...counts.values()].reduce((acc, value) => acc + value, 0);
    assert.equal(sum, scoped.length);
    assert.equal(sum, selectItems(SAMPLE, { ...base, lang: 'zh' }).length);
  });
});

describe('heroWindowDays', () => {
  it('最新一天条目充足时只用一天', () => {
    assert.deepEqual(heroWindowDays([{ day: '2026-10-09', count: 40 }, { day: '2026-10-08', count: 100 }]), ['2026-10-09']);
  });

  it('最新一天太少时并入前一天', () => {
    assert.deepEqual(heroWindowDays([{ day: '2026-10-09', count: 2 }, { day: '2026-10-08', count: 100 }]), [
      '2026-10-09',
      '2026-10-08',
    ]);
  });

  it('只有一天或没有数据时不报错', () => {
    assert.deepEqual(heroWindowDays([{ day: '2026-10-09', count: 1 }]), ['2026-10-09']);
    assert.deepEqual(heroWindowDays([]), []);
    assert.deepEqual(heroWindowDays(undefined), []);
  });
});