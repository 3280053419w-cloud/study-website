#!/usr/bin/env node
/* ==================================================================
   focus_probe.mjs — 「焦点到位却看不见 skip link」的成因与修法对照实验
   ------------------------------------------------------------------
   背景：C02 在本地一直过、在 CI 一直红，明细是「focused: true, onScreen: false,
   transform: -74」（= 还停在 translateY(-200%)）。为这个红做过三次猜测，
   前两次都白改，于是把成因做成可重复的对照实验，一格一种条件：

     ① 基线（无人抢焦点）                              可见
     ② 抢焦点（抹掉事件类，模拟未修）                    不可见  ← 复现 CI 症状
     ③ 抢焦点 + window.focus()                        不可见  ← 无效修法 ①（第一版猜的）
     ④ 抢焦点 + CDP 焦点模拟                            本机可见 / CI 不可见 → 不可依赖
     ⑤ 抢焦点 + 强制 :focus 伪类                        不可见  ← 无效修法 ③
     ⑥ 抢焦点 + 事件类（只加类）                        不可见  ← 关键发现：不是类无效，
                                                              而是后台标签页的样式重算被冻结
     ⑦ 抢焦点 + 事件类 + 焦点模拟（= C02b 的取证条件）      可见 ✓

   结论分两层：
     ① 机制层：`:focus` 的匹配要求「元素是活动元素、**且它所在的文档有焦点**」。
        文档有没有焦点，无头容器给不了；三种「从外面抢焦点」的外力（③④⑤）都盖不过这个前提。
        → 产品侧把显形改成由元素自己的 focus/blur 事件维护状态类（main.js 的 initSkipLink）。
     ② 取证层：无头里这一页可能是**后台标签页**，Chrome 会推迟样式重算 ——
        即使类已挂上、CSS 规则也已匹配，getComputedStyle / getBoundingClientRect
        读回的仍是被冻结的旧值（⑥ 实测等 1.5 秒不变）。
        → 量几何前必须先造一个「前台可见」的条件（⑦），这就是 C02b 用焦点模拟的原因。

   做法上的一个坑：**每格必须开全新页面**。第一轮 Tab 之后焦点已经走过 skip link，
   后续几轮再按 Tab 落到的是 logo / nav-link，量的根本不是同一件事 —— 会得出「修法无效」的假结论。

   跑法：node scripts/focus_probe.mjs   （①⑥ 可见、②③⑤ 不可见 → exit 0）
   ================================================================== */
import path from 'node:path';

import { loadPuppeteer, launchBrowser, PROJECT_ROOT, sleep as wait } from './lib/browser.mjs';

const URL = 'file:///' + path.join(PROJECT_ROOT, 'index.html').replace(/\\/g, '/');
const puppeteer = loadPuppeteer();
const browser = await launchBrowser(puppeteer);

async function scenario(label, opt) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  if (opt.emulate) {
    const cdp = p.createCDPSession ? await p.createCDPSession() : await p.target().createCDPSession();
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }
  await p.goto(URL, { waitUntil: 'load' });
  await wait(1500);
  if (opt.steal) {
    const t = await browser.newPage();
    await t.goto(URL, { waitUntil: 'load' });
    await t.bringToFront();
    await t.mouse.click(400, 300); /* 真点一下，确保焦点确实落在另一个页面上 */
    await wait(500);
  }
  if (opt.windowFocus) { await p.evaluate(() => { window.focus(); }); await wait(300); }

  await p.keyboard.press('Tab'); /* 全新文档 → 首次 Tab 必然落到 skip link */
  await wait(600);

  const read = () => p.evaluate(() => {
    const n = document.querySelector('.skip-link');
    const box = n.getBoundingClientRect();
    return {
      isSkip: document.activeElement === n,
      engaged: n.classList.contains('is-focused'),
      top: Math.round(box.top),
      visible: box.bottom > 0 && box.top < innerHeight && box.width > 0,
    };
  });
  let r = await read();

  /* ③④⑤：先抹掉事件类，量到的才是「只靠 :focus 伪类」那条路的真实表现 */
  if (opt.stripClass && r.engaged) {
    await p.evaluate(() => document.querySelector('.skip-link').classList.remove('is-focused'));
    await wait(500);
    r = await read();
  }
  if (opt.force) {
    const cdp = p.createCDPSession ? await p.createCDPSession() : await p.target().createCDPSession();
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.skip-link' });
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus'] });
    await wait(500);
    r = await read();
  }
  /* ⑦：量几何之前开焦点模拟 —— 这是 C02b 的取证条件：把页面恢复成「前台可见」，
     被推迟的样式重算才会真正跑，读回的几何才不是冻结值。 */
  if (opt.emulateLate) {
    const cdp = p.createCDPSession ? await p.createCDPSession() : await p.target().createCDPSession();
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await wait(500);
    r = await read();
  }

  console.log('  ' + label.padEnd(30) + JSON.stringify(r));
  await p.close();
  return r;
}

console.log('对照实验（每格都是全新页面，首次 Tab 必落 skip link）：');
const base = await scenario('① 基线（无人抢焦点）', {});
const broken = await scenario('② 抢焦点（抹掉事件类）', { steal: true, stripClass: true });
const wf = await scenario('③ 抢焦点 + window.focus()', { steal: true, stripClass: true, windowFocus: true });
const em = await scenario('④ 抢焦点 + CDP 焦点模拟', { steal: true, stripClass: true, emulate: true });
const forced = await scenario('⑤ 抢焦点 + 强制 :focus 伪类', { steal: true, stripClass: true, force: true });
const onlyClass = await scenario('⑥ 抢焦点 + 事件类（只加类）', { steal: true });
const classEmul = await scenario('⑦ 抢焦点 + 事件类 + 焦点模拟', { steal: true, emulateLate: true });

await browser.close();

const good = base.visible && !broken.visible && !wf.visible && !forced.visible && classEmul.visible;
console.log('\n预期：① 可见 · ②③⑤ 不可见（现象 + 两种外力无效）· ⑦ 可见（C02b 的取证条件）');
console.log('      ④ 本机 Edge 可见、CI 的 Chrome 实测不可见 —— 因此没有拿它当保障。');
console.log('      ⑥ 是这一轮的关键发现：类已挂上（engaged=true）、CSS 规则也匹配，');
console.log('         但值仍是被推迟的旧值 —— 无头里这页是后台标签页，样式重算被冻结，');
console.log('         所以「量几何」这一步必须先要一个前台可见的条件。');
console.log(good
  ? '✓ 与预期一致：显形机制不依赖环境焦点；几何取证需要前台条件'
  : '✗ 有格子与预期不符 —— 环境变了，先重测再下结论');
console.log('  本轮记录：④ = ' + (em.visible ? '可见' : '不可见') + ' · ⑥ = ' + (onlyClass.visible ? '可见' : '不可见（值冻结）'));
process.exit(good ? 0 : 1);
