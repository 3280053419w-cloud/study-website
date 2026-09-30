#!/usr/bin/env node
/* ==================================================================
   focus_probe.mjs — 「:focus 为什么在这个环境里不生效」的对照实验
   ------------------------------------------------------------------
   为什么留着它：C02（首次 Tab 落到 skip link 并进入视口）在本地一直过、
   在 CI 一直红。第一版按「窗口没焦点」的猜测加了 window.focus()，**实测无效** ——
   猜测浪费了一轮。于是把成因做成可重复的对照实验：

     每格开一个全新页面（这点很关键：第一轮 Tab 之后焦点已经走过 skip link，
     后续几轮再按 Tab 量到的是 logo / nav-link，会得出「修法无效」的假结论），
     首次 Tab 必然落到 skip link，然后量它的实际位置。

     ① 基线                    焦点在 skip link · 可见
     ② 焦点被第二页抢走          焦点在 skip link · 不可见   ← 与 CI 症状一致
     ③ 被抢 + window.focus()    焦点在 skip link · 不可见   ← 无效的那个修法
     ④ 被抢 + CDP 焦点模拟        焦点在 skip link · 可见     ← 正解

   结论：`:focus` 匹配要求「文档处于聚焦状态」，而 window.focus() 抢不回来；
   正解是 `Emulation.setFocusEmulationEnabled`（verify_browser.mjs 已在页面创建时开启）。

   跑法：node scripts/focus_probe.mjs      （4 格全对 exit 0；②③ 与预期不符 exit 1）
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
  const r = await p.evaluate(() => {
    const n = document.querySelector('.skip-link');
    const box = n.getBoundingClientRect();
    return {
      isSkip: document.activeElement === n,
      top: Math.round(box.top),
      visible: box.bottom > 0 && box.top < innerHeight && box.width > 0,
    };
  });
  console.log('  ' + label.padEnd(28) + JSON.stringify(r));
  await p.close();
  return r;
}

console.log('焦点与 :focus 的对照实验（每格都是全新页面）：');
const base = await scenario('① 基线（无人抢焦点）', {});
const stolen = await scenario('② 焦点被第二页抢走', { steal: true });
const wf = await scenario('③ 被抢 + window.focus()', { steal: true, windowFocus: true });
const em = await scenario('④ 被抢 + CDP 焦点模拟', { steal: true, emulate: true });

await browser.close();

const good = base.visible && stolen.isSkip && !stolen.visible && !wf.visible && em.visible;
console.log('\n预期：① 可见 · ②③ 不可见（复现失败条件）· ④ 可见（修法有效）');
console.log(good ? '✓ 四格全部与预期一致' : '✗ 有格子与预期不符 —— 环境变了，结论需要重测');
process.exit(good ? 0 : 1);
