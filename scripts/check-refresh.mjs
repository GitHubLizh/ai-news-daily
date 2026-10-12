#!/usr/bin/env node
/**
 * 数据自动刷新检查（零依赖、纯本机：不联网、不写任何文件、不需要浏览器）。
 *
 *   npm run check:refresh
 *
 * 为什么需要它：站点是纯静态的，流水线跑完后页面只有自己再取一次 data/news.json 才看得到
 * 当天资讯 —— assets/refresh.mjs 判断「此刻该不该查、取回来要不要重绘」，assets/app.js 的
 * startAutoRefresh 负责轮询与重绘。这条链路平时要「挂着页面等 10 分钟」才能看到，而基于 CDP
 * 的无头浏览器方案在受限环境里未必可用，所以这里直接把真实的 assets/app.js 当模块导入，
 * 用最小 DOM 桩驱动它，把整条链路断言一遍：
 *
 *   1. 启动时注册了 10 分钟轮询，以及 visibilitychange / online 监听；
 *   2. 数据变新后：自动重新拉取 → 重绘 → 新条目排到最前 → 页脚时间更新 → 弹一句提示；
 *   3. 数据没变（generatedAt 相同）时不重绘、不重复提示；
 *   4. 最小间隔内不重复请求，超过最小间隔才会再校验；轮询到点同样会刷新。
 *
 * 注意：为了不真的等 10 分钟、也让「最小间隔」可测，本脚本会覆盖当前进程的 document /
 * window / fetch / setInterval / Date.now 等全局量，并把 app.js 注册的轮询回调截下来手动触发。
 * 它只适合作为独立进程运行，不要 import 进其它脚本或测试。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { REFRESH_INTERVAL_MS } from '../assets/refresh.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'data', 'news.json');
const APP_FILE = path.join(ROOT, 'assets', 'app.js');
const TIMEZONE = 'Asia/Shanghai';
/** 整体看门狗：任何等待都不该无限挂住（例如以后把断言条件改坏了），超时就明确失败而不是卡死 */
const CHECK_TIMEOUT_MS = 30_000;
const TITLE_VISIBILITY = '【check:refresh】切回标签页后的新条目';
const TITLE_INTERVAL = '【check:refresh】轮询到点后的新条目';

/* ------------------------------------------------ 造一份「站点已经变新了」的数据 */

/** 用与 assets/app.js 相同的口径取某天的键（YYYY-MM-DD） */
function dayKeyOf(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** 复制一份数据集，在最前面插入一条「今天」的新条目，并换掉 generatedAt（用显式偏移量保证两次造的数据互相不同） */
function withNewEntry(raw, id, title, offsetMinutes) {
  const stamp = new Date(Date.now() + offsetMinutes * 60_000).toISOString();
  const template = raw.items.find((item) => item.lang === 'zh') || raw.items[0];
  const day = dayKeyOf(new Date());
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', weekday: 'short' }).format(
    new Date(Date.UTC(year, month - 1, dayOfMonth)),
  );

  const next = structuredClone(raw);
  next.items.unshift({
    ...template,
    id,
    title,
    url: `https://example.com/${id}`,
    summary: '这条只存在于本检查在内存里造的数据中，不会写到磁盘。',
    day,
    publishedAt: stamp,
    publishedTs: Date.now(),
    hot: 99,
  });
  next.count += 1;
  next.generatedAt = stamp;
  next.days.unshift({ day, label: `${month}月${dayOfMonth}日 · ${weekday}`, count: 1 });
  return next;
}

/* ---------------------------------------------------------------------- DOM 桩 */

/**
 * 一个够用的假元素：app.js 会读写的属性都给了默认值，未覆盖到的方法一律吞掉。
 * 之所以用 Proxy 兜底，是为了在 app.js 增加新的 DOM 调用时（例如读取某个新属性）
 * 不至于让本检查崩掉 —— 检查的落点是下面的内容断言，不是 DOM 实现细节。
 */
function makeElement(key) {
  const base = {
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    checked: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    closest: () => null,
    querySelector: (selector) => elementFor(`${key} >> ${selector}`),
    querySelectorAll: () => [],
    focus() {},
    blur() {},
    showModal() {},
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {},
    scrollIntoView() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  };
  return new Proxy(base, {
    get: (target, prop) => (prop in target ? target[prop] : () => undefined),
    set: (target, prop, value) => {
      target[prop] = value;
      return true;
    },
  });
}

const ELEMENTS = new Map();
function elementFor(selector) {
  if (!ELEMENTS.has(selector)) ELEMENTS.set(selector, makeElement(selector));
  return ELEMENTS.get(selector);
}

const LISTENERS = { document: [], window: [] };
/** 触发某个作用域上注册过的某类事件，返回命中的监听器个数 */
function fire(scope, type) {
  const hits = LISTENERS[scope].filter(([name]) => name === type);
  hits.forEach(([, handler]) => handler({ type, preventDefault() {} }));
  return hits.length;
}

/** 把 app.js 需要的浏览器全局量装上（必须在导入它之前完成） */
function installGlobals() {
  globalThis.document = {
    hidden: false,
    visibilityState: 'visible',
    documentElement: { dataset: {} },
    activeElement: null,
    body: makeElement('body'),
    querySelector: (selector) => elementFor(selector),
    querySelectorAll: () => [],
    createElement: (tag) => makeElement(`<${tag}>`),
    addEventListener: (type, handler) => LISTENERS.document.push([type, handler]),
    removeEventListener() {},
  };
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 900,
    scrollY: 0,
    addEventListener: (type, handler) => LISTENERS.window.push([type, handler]),
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  };
  globalThis.location = { hash: '', protocol: 'http:', href: 'http://127.0.0.1/', hostname: '127.0.0.1' };
  globalThis.history = { replaceState() {}, pushState() {} };
  globalThis.localStorage = {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null;
    },
    setItem(key, value) {
      this.store.set(key, String(value));
    },
    removeItem(key) {
      this.store.delete(key);
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
}

/* --------------------------------------------------------------- 断言与输出 */

const failures = [];
let assertions = 0;
function check(ok, label, detail = '') {
  assertions += 1;
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
  if (!ok) failures.push(label);
}

/** 与 assets/app.js 的 renderFooter 口径一致；两处文案真不一致时下面的断言会失败 */
function footerText(data) {
  const generated = new Intl.DateTimeFormat('zh-CN', {
    timeZone: data.timezone || TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(data.generatedAt));
  return `数据更新于 ${generated}（${data.timezone || TIMEZONE}）· 共 ${data.count} 条 · 覆盖 ${data.stats.sources.length} 个来源`;
}

/**
 * 轮询等待某个条件成立。
 * 超时用 performance.now() 而不是 Date.now()：本脚本为了让「最小间隔」可测，把 Date.now
 * 换成了可控时钟，用它算 deadline 会永远等不到超时。条件要用完整文案 / 具体内容判断，
 * 别用前缀，否则旧数据也可能满足。
 */
async function waitFor(probe, label, timeoutMs = 3000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (probe()) return true;
    await sleep(20);
  }
  console.log(`   （等待「${label}」超过 ${timeoutMs}ms）`);
  return false;
}

/* ---------------------------------------------------------------------- 跑起来 */

async function main() {
  let originalText;
  try {
    originalText = await readFile(DATA_FILE, 'utf8');
  } catch {
    console.error(`❌ 找不到 ${path.relative(ROOT, DATA_FILE)}，先运行 npm run fetch（或在仓库里 git pull 拿到线上数据）`);
    process.exitCode = 1;
    return;
  }

  const original = JSON.parse(originalText);
  if (!Array.isArray(original?.items) || !original.items.length || !original.stats?.sources) {
    console.error(`❌ ${path.relative(ROOT, DATA_FILE)} 结构不对：需要 items / days / stats / generatedAt`);
    process.exitCode = 1;
    return;
  }

  const byVisibility = withNewEntry(original, 'check-refresh-visibility', TITLE_VISIBILITY, 1);
  const byInterval = withNewEntry(byVisibility, 'check-refresh-interval', TITLE_INTERVAL, 2);

  console.log('▶ 数据自动刷新检查（真实 assets/app.js + 最小 DOM 桩，不联网、不写文件）');
  console.log(`  当前数据：${original.count} 条 · 生成于 ${original.generatedAt} · 轮询间隔 ${REFRESH_INTERVAL_MS / 60000} 分钟\n`);

  installGlobals();

  // 可控时钟：跨过「最小间隔」时不用真等 2 分钟
  let fakeNow = Date.now();
  Date.now = () => fakeNow;

  // 截住轮询定时器，需要时自己触发
  let intervalCallback = null;
  let intervalMs = 0;
  globalThis.setInterval = (callback, ms) => {
    intervalCallback = callback;
    intervalMs = ms;
    return 1;
  };

  // fetch 桩：按 phase 返回不同版本的数据
  let phase = 'original';
  let fetchCalls = 0;
  let served = originalText;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    const body = phase === 'original' ? originalText : JSON.stringify(served);
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  };

  await import(pathToFileURL(APP_FILE).href);

  const watchdog = setTimeout(() => {
    console.error(`❌ 检查超时（${CHECK_TIMEOUT_MS / 1000}s）：有断言在等一个始终没发生的状态，请检查上面的输出`);
    process.exit(1);
  }, CHECK_TIMEOUT_MS);

  const booted = await waitFor(() => elementFor('#footerMeta').textContent === footerText(original), '首次渲染完成');
  check(booted, 'app.js 启动并完成首次渲染', elementFor('#footerMeta').textContent || '(页脚为空)');
  if (!booted) {
    console.log(`   空状态提示：${elementFor('#empty').innerHTML}`);
    console.log(`   document 上的监听：${LISTENERS.document.map(([type]) => type).join('、') || '(无)'}`);
    clearTimeout(watchdog);
    process.exitCode = 1;
    return;
  }
  check(elementFor('#footerMeta').textContent === footerText(original), '页脚显示的是当前数据集的时间');
  check(intervalMs === REFRESH_INTERVAL_MS, '注册了与 assets/refresh.mjs 一致的轮询间隔', `${intervalMs}ms`);
  check(typeof intervalCallback === 'function', '轮询回调已挂上');
  check(LISTENERS.document.some(([type]) => type === 'visibilitychange'), '监听了 visibilitychange（切回标签页就校验）');
  check(LISTENERS.window.some(([type]) => type === 'online'), '监听了 online（断网恢复就校验）');
  check(fetchCalls === 1, '首次加载只请求一次 news.json', `${fetchCalls} 次`);

  // —— 站点数据变新：从别的标签页切回来 ——
  phase = 'updated';
  served = byVisibility;
  fire('document', 'visibilitychange');
  const refreshed = await waitFor(
    () =>
      elementFor('#footerMeta').textContent === footerText(byVisibility) &&
      elementFor('#feed').innerHTML.includes(TITLE_VISIBILITY),
    '切回标签页后的自动刷新',
  );
  check(refreshed, '数据变化后自动重新拉取并重绘', elementFor('#footerMeta').textContent);
  check(elementFor('#footerMeta').textContent === footerText(byVisibility), '页脚已换成新数据集的时间');
  const feedHtml = elementFor('#feed').innerHTML;
  check(feedHtml.includes(TITLE_VISIBILITY), '新条目已渲染进资讯流');
  check(
    /<h3 class="item-title">\s*<a[^>]*>([^<]*)<\/a>/.exec(feedHtml)?.[1] === TITLE_VISIBILITY,
    '新条目排在列表最前',
    String(/<h3 class="item-title">\s*<a[^>]*>([^<]*)<\/a>/.exec(feedHtml)?.[1]),
  );
  check(elementFor('#toast').textContent.includes('新增 1 条'), '弹出提示「新增 1 条」', elementFor('#toast').textContent);
  check(fetchCalls === 2, '这次刷新只多打一次请求', `${fetchCalls} 次`);

  // —— 最小间隔内：立刻再切一次、再断网恢复一次，都不该请求 ——
  fire('document', 'visibilitychange');
  fire('window', 'online');
  await sleep(80);
  check(fetchCalls === 2, '最小间隔内不重复请求', `${fetchCalls} 次`);

  // —— 超过最小间隔、但数据没变：不重绘、不重复提示 ——
  fakeNow += 3 * 60 * 1000;
  const feedBefore = elementFor('#feed').innerHTML;
  const toastBefore = elementFor('#toast').textContent;
  fire('document', 'visibilitychange');
  await sleep(80);
  check(fetchCalls === 3, '超过最小间隔后会去校验一次', `${fetchCalls} 次`);
  check(elementFor('#feed').innerHTML === feedBefore, 'generatedAt 没变时不重绘列表');
  check(elementFor('#toast').textContent === toastBefore, 'generatedAt 没变时不重复弹提示');

  // —— 轮询到点这条路：数据再变一次 ——
  served = byInterval;
  fakeNow += 11 * 60 * 1000;
  const canPoll = typeof intervalCallback === 'function';
  if (canPoll) {
    await intervalCallback();
  } else {
    console.log('   （没有注册轮询回调，无法手动触发，下面的断言会据此失败）');
  }
  const polled = canPoll
    ? await waitFor(
        () =>
          elementFor('#footerMeta').textContent === footerText(byInterval) &&
          elementFor('#feed').innerHTML.includes(TITLE_INTERVAL),
        '轮询到点的自动刷新',
      )
    : false;
  check(polled, '轮询到点后也会自动刷新', elementFor('#footerMeta').textContent);
  check(elementFor('#feed').innerHTML.includes(TITLE_INTERVAL), '轮询刷新后的新条目已渲染');
  check(fetchCalls === 4, '总计 4 次请求（首次 + 切回 + 校验 + 轮询）', `${fetchCalls} 次`);

  console.log('');
  clearTimeout(watchdog);
  if (failures.length) {
    console.log(`❌ 失败 ${failures.length} / ${assertions} 项：${failures.join('、')}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${assertions} 项断言全部通过：数据变新后页面会自己跟上，且不会重复打扰服务端。`);
    process.exitCode = 0;
  }
  // 页面里的 toast 还挂着两个短定时器，自然退出会多等约 2 秒；这里把输出刷完就结束。
  await new Promise((resolve) => process.stdout.write('', resolve));
  process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(`❌ 检查脚本自身出错：${error.stack || error.message}`);
  process.exitCode = 1;
  process.exit(1);
});