#!/usr/bin/env node
/**
 * 移动端布局检查（零依赖，仅用 Node 内置能力 + 本机已装的 Chrome/Edge）。
 *
 *   npm run check:mobile
 *
 * 做三件事：
 *   1. 用随机端口拉起 scripts/serve.mjs，等站点就绪；
 *   2. 用无头浏览器在各档宽度下量取真实布局（CDP 直连，不依赖任何 npm 包）；
 *   3. 断言「不横向溢出 / 顶栏不被挤破 / 首屏看得到资讯 / 触控目标够大 / iOS 不放大」，
 *      并顺带回归桌面端（两列布局、菜单跳转项隐藏、悬停态仍生效）。
 *
 * 环境变量：CHROME_PATH 指定浏览器；CHECK_PORT 指定预览端口（默认 5199）。
 * 找不到浏览器时打印提示并跳过（退出码 0，不误报成功）。
 * 需要 Node 22+（用到内置 WebSocket）。
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.CHECK_PORT) || 5199;
const BASE = `http://${HOST}:${PORT}/`;

/** 用例：mobile=true 走手机断言；宽屏用例回归桌面端 */
const CASES = [
  { width: 320, height: 844, mobile: true },
  { width: 360, height: 844, mobile: true },
  { width: 375, height: 667, mobile: true },
  { width: 390, height: 844, mobile: true, interact: true },
  { width: 414, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: true },
  { width: 1280, height: 900, mobile: false },
];

/** 触控目标：[选择器, 最小高度, 最小宽度] */
const TAP_TARGETS = [
  ['.item .act', 44, 44],
  ['.icon-btn', 44, 44],
  ['.seg button', 40, 0],
  ['.chip', 40, 0],
  ['.switch', 44, 0],
  ['.cal-day', 40, 0],
  ['.cal-nav button', 40, 40],
  ['.tabs button', 40, 0],
  ['.day-head .day-link', 40, 0],
  ['.hero-cta', 40, 0],
  ['.more-btn', 44, 0],
  ['.ghost-btn', 40, 0],
  ['.search', 44, 0],
  ['.stat', 40, 0],
];

/** 控件文字不应折行：[选择器, 高度上限]（超过说明标签被挤成两行） */
const WRAP_LIMITS = [
  ['.item .act', 52],
  ['.switch', 48],
  ['.ghost-btn', 48],
  ['.seg button', 48],
  ['.chip', 50],
  ['.tabs button', 48],
  ['.cal-day', 48],
  ['.day-head .day-link', 48],
  ['.more-btn', 52],
];

/* ------------------------------------------------------------- 浏览器定位 */

function findBrowser() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const caches = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'), home && path.join(home, '.cache', 'ms-playwright'), home && path.join(home, 'Library', 'Caches', 'ms-playwright')].filter(Boolean);
  const suffixes =
    process.platform === 'win32'
      ? ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe']
      : process.platform === 'darwin'
        ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium']
        : ['chrome-linux/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell'];
  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith('chromium')) continue;
      for (const suffix of suffixes) candidates.push(path.join(cache, entry, suffix));
    }
  }

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }

  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

/* --------------------------------------------------------------- 基础工具 */

async function waitFor(check, { timeoutMs = 12000, intervalMs = 150, label = '资源' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return true;
    } catch {
      /* 继续等 */
    }
    await sleep(intervalMs);
  }
  throw new Error(`等待${label}超时（${timeoutMs}ms）`);
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let seq = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true });
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      seq += 1;
      pending.set(seq, { resolve, reject });
      socket.send(JSON.stringify({ id: seq, method, params }));
    });
  return {
    ready,
    send,
    async evalJs(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return result.result.value;
    },
    close: () => socket.close(),
  };
}

/* ------------------------------------------------------------- 量取表达式 */

const METRICS = `(() => {
  const de = document.documentElement;
  const box = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect() : null;
  };
  const px = (value) => Math.round(parseFloat(value) * 10) / 10;

  const tapViolations = [];
  for (const [sel, minH, minW] of __TAP__) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height + 0.5 < minH) tapViolations.push(sel + ' 高度 ' + px(r.height) + ' < ' + minH);
      if (minW && r.width + 0.5 < minW) tapViolations.push(sel + ' 宽度 ' + px(r.width) + ' < ' + minW);
      break; // 同一选择器只看首个可见元素
    }
  }

  const wrapViolations = [];
  for (const [sel, maxH] of __WRAP__) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      if (r.height > maxH) wrapViolations.push(sel + ' 高度 ' + px(r.height) + ' > ' + maxH + '（标签可能被挤成两行）');
      break;
    }
  }

  let hoverScoped = 0;
  let hoverUnscoped = 0;
  for (const sheet of document.styleSheets) {
    let rules = [];
    try { rules = [...sheet.cssRules]; } catch { continue; }
    for (const rule of rules) {
      const selector = rule.selectorText || '';
      if (selector.includes(':hover')) hoverUnscoped += 1;
      if (!rule.conditionText || !rule.conditionText.includes('hover: hover')) continue;
      for (const inner of rule.cssRules || []) {
        if ((inner.selectorText || '').includes(':hover')) hoverScoped += 1;
      }
    }
  }

  const item = box('.item');
  const title = box('.item-title');
  const menu = box('.menu-btn');
  const theme = box('.icon-btn');
  const hero = box('#hero');
  const panel = box('.panel');
  const dayHead = box('.day-head');
  const inner = document.querySelector('.topbar-inner');
  return {
    clientWidth: de.clientWidth,
    clientHeight: de.clientHeight,
    scrollWidth: de.scrollWidth,
    overflow: Math.max(0, de.scrollWidth - de.clientWidth),
    topbarH: px(getComputedStyle(de).getPropertyValue('--topbar-h')),
    topbarInnerHeight: inner ? px(inner.getBoundingClientRect().height) : 0,
    topbarScrollWidth: inner ? inner.scrollWidth : 0,
    menuRight: menu ? px(menu.right) : 0,
    themeRight: theme ? px(theme.right) : 0,
    searchFont: px(getComputedStyle(document.querySelector('.search input')).fontSize),
    heroHeight: hero ? px(hero.height) : 0,
    panelHeight: panel ? px(panel.height) : 0,
    dayHeadHeight: dayHead ? px(dayHead.height) : 0,
    firstItemTop: item ? px(item.top) : -1,
    firstTitleTop: title ? px(title.top) : -1,
    tapViolations,
    wrapViolations,
    layoutColumnCount: getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length,
    navDisplay: getComputedStyle(document.querySelector('#nav')).display,
    jumpDisplay: getComputedStyle(document.querySelector('.jump-btn')).display,
    brandDisplay: getComputedStyle(document.querySelector('.brand-text')).display,
    hoverScoped,
    hoverUnscoped,
    hoverFine: matchMedia('(hover: hover) and (pointer: fine)').matches,
  };
})()`
  .replaceAll('__TAP__', JSON.stringify(TAP_TARGETS))
  .replaceAll('__WRAP__', JSON.stringify(WRAP_LIMITS));

/* ------------------------------------------------------------------ 断言 */

function checkCase(m, mobile) {
  const bad = [];
  const add = (ok, message) => {
    if (!ok) bad.push(message);
  };

  add(m.overflow <= 1, `整页横向溢出 ${m.overflow}px（scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}）`);

  if (mobile) {
    add(m.topbarInnerHeight <= m.topbarH + 2, `顶栏高度 ${m.topbarInnerHeight}px 超过 --topbar-h 的 ${m.topbarH}px（换行了）`);
    add(m.topbarScrollWidth <= m.clientWidth + 1, `顶栏内容宽 ${m.topbarScrollWidth}px 溢出容器 ${m.clientWidth}px`);
    add(m.menuRight <= m.clientWidth, `菜单按钮右边缘 ${m.menuRight}px 超出视口 ${m.clientWidth}px`);
    add(m.themeRight <= m.clientWidth, `深浅色按钮右边缘 ${m.themeRight}px 超出视口 ${m.clientWidth}px`);
    add(m.searchFont >= 16, `搜索框字号 ${m.searchFont}px < 16px（iOS 聚焦时会放大整页）`);
    add(m.firstItemTop <= m.clientHeight - 80, `首条资讯顶部 ${m.firstItemTop}px 超出首屏阈值 ${m.clientHeight - 80}px`);
    add(m.firstTitleTop <= m.clientHeight - 20, `首条标题顶部 ${m.firstTitleTop}px，首屏看不到标题（阈值 ${m.clientHeight - 20}px）`);
    bad.push(...m.tapViolations);
    bad.push(...m.wrapViolations);
  } else {
    add(m.layoutColumnCount === 2, `桌面端布局列数 ${m.layoutColumnCount} ≠ 2（双列布局被破坏）`);
    add(m.navDisplay === 'flex', `桌面端导航 display=${m.navDisplay}（应为 flex）`);
    add(m.jumpDisplay === 'none', `桌面端菜单跳转项 display=${m.jumpDisplay}（应为 none）`);
    add(m.brandDisplay !== 'none', `桌面端品牌文字被隐藏（display=${m.brandDisplay}）`);
    add(m.hoverFine === true, '桌面端 (hover: hover) and (pointer: fine) 未匹配，悬停样式不会生效');
    add(m.hoverScoped >= 15, `收进媒体查询的悬停规则只有 ${m.hoverScoped} 条（应 ≥15）`);
    add(m.hoverUnscoped === 0, `有 ${m.hoverUnscoped} 条悬停规则没有收进 (hover: hover) 媒体查询`);
  }
  return bad;
}

/* ------------------------------------------------------- 移动端菜单交互 */

const INTERACT = `(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nav = document.querySelector('#nav');
  const menu = document.querySelector('.menu-btn');
  const card = document.querySelector('#calendar').closest('.card');
  const out = {};

  menu.click();
  out.opened = nav.classList.contains('is-open');
  out.ariaOpen = menu.getAttribute('aria-expanded');

  // 菜单里的「日期查询」应滚到日历卡片，并收起菜单
  document.querySelector('#nav [data-jump="calendar"]').click();
  let top = Infinity;
  for (let i = 0; i < 40; i += 1) {
    await sleep(100);
    top = card.getBoundingClientRect().top;
    if (top >= 0 && top < innerHeight / 2) break;
  }
  out.closedAfterJump = !nav.classList.contains('is-open');
  out.cardTop = Math.round(top);
  out.cardVisible = top >= 0 && top < innerHeight;

  // 点导航链接后应收起；「最新」在 hash 不变时也要收起
  menu.click();
  document.querySelector('#nav a[data-nav="bookmarks"]').click();
  await sleep(80);
  out.closedAfterNavLink = !nav.classList.contains('is-open');

  // 点菜单以外的地方应收起
  menu.click();
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await sleep(80);
  out.closedAfterOutside = !nav.classList.contains('is-open');
  return out;
})()`;

function checkInteraction(result) {
  const bad = [];
  const add = (ok, message) => {
    if (!ok) bad.push(message);
  };
  add(result.opened === true, '点汉堡按钮后菜单没有展开');
  add(result.ariaOpen === 'true', `菜单展开后 aria-expanded=${result.ariaOpen}（应为 true）`);
  add(result.closedAfterJump === true, '点「日期查询」后菜单没有收起');
  add(result.cardVisible === true, `点「日期查询」后日历卡片不在视口内（top=${result.cardTop}）`);
  add(result.cardTop >= 50, `日历卡片顶部 ${result.cardTop}px，被粘性顶栏盖住`);
  add(result.closedAfterNavLink === true, '点导航链接后菜单没有收起');
  add(result.closedAfterOutside === true, '点菜单外的地方后菜单没有收起');
  return bad;
}

/* -------------------------------------------------------------------- 主流程 */

async function main() {
  if (typeof WebSocket === 'undefined') {
    console.log('⚠️  当前 Node 没有内置 WebSocket（需要 22+），已跳过移动端检查。');
    return;
  }

  const browser = findBrowser();
  if (!browser) {
    console.log('⚠️  未找到 Chrome / Edge，已跳过移动端检查。可用 CHROME_PATH 指定浏览器路径后重试。');
    return;
  }
  console.log(`🌐 浏览器：${browser}`);
  console.log(`📐 用例：${CASES.map((c) => `${c.width}×${c.height}`).join('、')}\n`);

  const server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs')], {
    env: { ...process.env, PORT: String(PORT), HOST },
    stdio: 'ignore',
  });

  let interactionNote = null;
  const rows = [];
  const failures = [];
  try {
    await waitFor(async () => (await fetch(BASE, { method: 'HEAD' })).ok, { label: '本地预览服务器' });

    for (const testCase of CASES) {
      const port = 9600 + testCase.width;
      const child = spawn(
        browser,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--hide-scrollbars',
          `--remote-debugging-port=${port}`,
          `--window-size=${testCase.width},${testCase.height}`,
          `--user-data-dir=${path.join(process.env.TEMP || '/tmp', `dsh-mobile-check-${testCase.width}`)}`,
          'about:blank',
        ],
        { stdio: 'ignore' },
      );

      try {
        let target = null;
        await waitFor(
          async () => {
            const list = await (await fetch(`http://${HOST}:${port}/json/list`)).json();
            target = list.find((entry) => entry.type === 'page');
            return Boolean(target);
          },
          { label: `浏览器 ${testCase.width}px` },
        );

        const cdp = connect(target.webSocketDebuggerUrl);
        await cdp.ready;
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        // 用 CDP 精确指定视口：部分 Chrome 的 --window-size 会被窗口边框/信息栏吃掉高度
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: testCase.width,
          height: testCase.height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await cdp.send('Page.navigate', { url: BASE });
        await waitFor(async () => cdp.evalJs('!!document.querySelector(".item")'), { label: '资讯渲染', timeoutMs: 15000 });
        await sleep(300); // 让布局稳定（字体、图片占位）

        const label = `${testCase.width}×${testCase.height}`;
        const metrics = await cdp.evalJs(METRICS);

        let interactionFailures = [];
        if (testCase.interact) {
          interactionFailures = checkInteraction(await cdp.evalJs(INTERACT)).map((message) => `${label}｜${message}`);
          interactionNote = interactionFailures.length === 0;
        }
        cdp.close();

        const bad = checkCase(metrics, testCase.mobile);
        rows.push({
          label,
          overflow: metrics.overflow,
          topbar: metrics.topbarInnerHeight,
          hero: metrics.heroHeight,
          panel: metrics.panelHeight,
          item: metrics.firstItemTop,
          title: metrics.firstTitleTop,
          tap: testCase.mobile ? metrics.tapViolations.length + metrics.wrapViolations.length : '—',
          ok: bad.length === 0,
        });
        for (const message of bad) failures.push(`${label}｜${message}`);
        failures.push(...interactionFailures);
      } finally {
        child.kill();
      }
    }
  } finally {
    server.kill();
  }

  console.log('宽度      溢出  顶栏高    Hero    面板  首条资讯  首条标题  控件问题  结果');
  for (const row of rows) {
    console.log(
      `${row.label.padEnd(9)} ${String(row.overflow).padStart(4)}  ${String(row.topbar).padStart(5)}  ${String(row.hero).padStart(6)}  ${String(row.panel).padStart(6)}  ${String(row.item).padStart(7)}  ${String(row.title).padStart(7)}  ${String(row.tap).padStart(7)}  ${row.ok ? '✅' : '❌'}`,
    );
  }

  if (interactionNote !== null) {
    console.log(`\n🧭 移动端菜单：展开 / 「日期查询」跳转 / 链接与外部点击自动收起 → ${interactionNote ? '✅' : '❌'}`);
  }

  if (failures.length) {
    console.log(`\n❌ ${failures.length} 项未通过：`);
    for (const message of failures) console.log(`   - ${message}`);
    process.exitCode = 1;
  } else {
    console.log('\n✅ 移动端与桌面端布局检查全部通过。');
  }
}

main().catch((error) => {
  console.error(`❌ 检查失败：${error.message}`);
  process.exitCode = 1;
});