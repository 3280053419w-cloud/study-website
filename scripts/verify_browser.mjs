/* ==================================================================
   学习计划板 · 上线要件 & 加固验收（v4）
   ------------------------------------------------------------------
   2026-09-30 那一批「上线公网」改动（og/canonical/JSON-LD/CSP/skip link/
   焦点圈禁/导入加固/空模板引导）此前只有静态检查，从没在真实浏览器里跑过。
   本套件就是补这一层，回答四件事：

     ① 上线要件真的在位，而且真的取得到（og / canonical / JSON-LD / robots / sitemap / og.png）
     ② CSP 在真实浏览器里不误伤：全流程 0 条违规，blob:/data: 图能显示，内联 style 生效
     ③ 无障碍三件套真的能用：skip link / 焦点圈禁 / 关闭后焦点还原
     ④ 导入加固真挡坏文件，而且**没误伤好文件** —— 往返那条抓到过真缺陷
        （checks 净化条件写反，导入自己的导出文件会把打卡进度清零）

   跑法：node scripts/verify_browser.mjs        （端口 4203，无头浏览器）
        CI ：npm install --prefix scripts puppeteer-core && node scripts/verify_browser.mjs
   （puppeteer-core 的解析与浏览器可执行文件的探测都在 scripts/lib/browser.mjs，
     本机和 CI 都能跑 —— 这是方案文档 P1-8 留下的那个缺口：验收脚本原先写死
     「本机 Edge 绝对路径」，于是 CI 里跑不起来。）
   姊妹套件：_build/verify_v3.mjs（228 项深度功能验收，依赖本机绝对路径，只在本地跑）。
   本套件是**入库**的那一份，CI 每次推送都会跑。
   ================================================================== */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { loadPuppeteer, launchBrowser } from './lib/browser.mjs';

const puppeteer = loadPuppeteer();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4203;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, '_build', 'shots-v4b');
const TMP = path.join(os.tmpdir(), 'study-site-v4b');

fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

/* ---------------- 静态服务器 ----------------
   注意：Windows 上 path.join 返回反斜杠，拿字符串前缀比会恒假 —— 用 path.relative 判越界。
   （早先 _v4_bgcost.mjs / _v4_bg.mjs 就是栽在这一行，量到的是 Edge 的 403 页） */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.dxf': 'application/dxf', '.woff2': 'font/woff2', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, '.' + p);
  const rel = path.relative(ROOT, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); res.end('forbidden'); return; }
  let st;
  try { st = fs.statSync(file); } catch (e) { res.writeHead(404); res.end('not found'); return; }
  if (st.isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

/* ---------------- 断言器 ---------------- */
const results = [];
const check = (id, ok, detail) => results.push({ id, ok: !!ok, detail: detail == null ? '' : String(detail) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 夹具文件 ---------------- */
const bigFile = path.join(TMP, 'too-big.json');
fs.writeFileSync(bigFile, JSON.stringify({ app: 'study-website', pad: 'x'.repeat(6 * 1024 * 1024) }));
const badJson = path.join(TMP, 'bad.json');
fs.writeFileSync(badJson, '{ 这不是 json ');
const evilFile = path.join(TMP, 'evil.json');
fs.writeFileSync(evilFile, JSON.stringify({
  app: 'study-website', schema: 1,
  plan: {
    period: { start: '2026-01-01', end: '2026-01-31' },
    tracks: [{
      id: 't-evil', name: '验收用学习线', color: '#8b7cff',
      steps: [{ n: 1, phase: '验收阶段', title: '第一阶', desc: '', dxf: '' }],
    }],
  },
  links: [
    { title: '坏链 javascript', url: 'javascript:alert(1)' },
    { title: '坏链 data', url: 'data:text/html,<b>x</b>' },
    { title: '好链', url: 'https://docs.python.org/3/' },
  ],
  checks: {
    '2026-01-05:slots-0': true,          /* 合法：checkKey() 形态 + 值 true */
    '2026-01-05:slots-1': false,         /* 非法值 → 丢 */
    '__proto__': { polluted: true },     /* 原型污染尝试 → 丢 */
    'not-a-date:slots-0': true,          /* 键格式非法 → 丢 */
  },
  reviews: {
    '2026-01-05': { done: '看了课', stuck: '卡在标注', next: '画完 D03' },
    '__proto__': { done: 'x' },
    20260106: { done: '键不是日期串', stuck: '', next: '' },
  },
}));

/* ---------------- 颜色 / 亮度工具（校验热力图色阶用） ---------------- */
function parseColor(c) {
  let m = String(c).match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  m = String(c).match(/^#([0-9a-f]{6})$/i);
  if (m) { const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }; }
  return null;
}
function overBase(c, base) {
  const p = parseColor(c);
  if (!p) return null;
  return [p.r * p.a + base[0] * (1 - p.a), p.g * p.a + base[1] * (1 - p.a), p.b * p.a + base[2] * (1 - p.a)];
}
function relLum(rgb) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
const PAGE_BG = [7, 6, 13];   /* #07060d */

/* ---------------- 浏览器 ---------------- */
const browser = await launchBrowser(puppeteer, {
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio'],
});

const allConsoleErrors = [];
function wire(page, tag) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    allConsoleErrors.push(tag + ' | ' + t);
  });
  page.on('pageerror', (e) => allConsoleErrors.push(tag + ' | pageerror: ' + e.message));
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(ORIGIN)) allConsoleErrors.push(tag + ' | local-request-failed: ' + r.url());
  });
}
const CSP_HOOK = () => {
  window.__cspV = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspV.push(e.violatedDirective + ' ← ' + (e.blockedURI || '(inline)'));
  });
};
const cspOf = (page) => page.evaluate(() => window.__cspV || []);

/* ==================================================================
   A~D + F：主站（演示态 EMPTY_TEMPLATE = false）
   ================================================================== */
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
wire(page, 'main');
await page.evaluateOnNewDocument(CSP_HOOK);
await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle2' });
await wait(700);

/* ---------- A. 上线要件 ---------- */
const meta = await page.evaluate(() => {
  const c = (s) => { const n = document.querySelector(s); return n ? (n.getAttribute('content') || n.getAttribute('href')) : null; };
  let ld = null;
  try { ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent); } catch (e) { ld = null; }
  return {
    canonical: (document.querySelector('link[rel="canonical"]') || {}).href || null,
    canonicalCount: document.querySelectorAll('link[rel="canonical"]').length,
    cspCount: document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length,
    csp: c('meta[http-equiv="Content-Security-Policy"]'),
    og: {
      type: c('meta[property="og:type"]'), site: c('meta[property="og:site_name"]'),
      locale: c('meta[property="og:locale"]'), title: c('meta[property="og:title"]'),
      desc: c('meta[property="og:description"]'), url: c('meta[property="og:url"]'),
      image: c('meta[property="og:image"]'), w: c('meta[property="og:image:width"]'), h: c('meta[property="og:image:height"]'),
    },
    tw: {
      card: c('meta[name="twitter:card"]'), title: c('meta[name="twitter:title"]'),
      desc: c('meta[name="twitter:description"]'), image: c('meta[name="twitter:image"]'),
    },
    ld,
  };
});

check('A01 canonical 唯一且与 og:url 一致',
  meta.canonicalCount === 1 && !!meta.canonical && meta.canonical === meta.og.url,
  `canonical×${meta.canonicalCount} = ${meta.canonical} | og:url = ${meta.og.url}`);

const ogMissing = Object.keys(meta.og).filter((k) => !meta.og[k]);
check('A02 og 九项齐全（type/site/locale/title/desc/url/image/w/h）', ogMissing.length === 0, '缺：' + ogMissing.join(','));

/* og:image 指向的文件真的存在、真的是 1200×630 */
const ogProbe = await page.evaluate(async () => {
  const src = document.querySelector('meta[property="og:image"]').content;
  /* 线上 og:image 带 GitHub Pages 的项目子路径（/study-website/…），而本地验收服务器
     挂在站点根 —— 不把这段基准路径剥掉就会一律 404（曾因此误判成 og.png 有问题）。 */
  const cpath = new URL(document.querySelector('link[rel="canonical"]').href).pathname.replace(/\/$/, '');
  const u = new URL(src, location.href);
  let local = u.pathname;
  if (cpath && local.indexOf(cpath) === 0) local = local.slice(cpath.length);
  const r = await new Promise((res) => {
    const i = new Image();
    i.onload = () => res({ ok: true, w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => res({ ok: false, w: 0, h: 0 });
    i.src = local;
  });
  return { local, ...r };
});
check('A03 og:image 真文件可解码且为 1200×630',
  ogProbe.ok && ogProbe.w === 1200 && ogProbe.h === 630 &&
  meta.og.w === '1200' && meta.og.h === '630' && /assets\/og\.png$/.test(meta.og.image),
  `${ogProbe.local} → ${ogProbe.w}×${ogProbe.h}；声明 ${meta.og.w}×${meta.og.h}`);

check('A04 twitter 卡片 = summary_large_image 且图与 og 同源',
  meta.tw.card === 'summary_large_image' && meta.tw.image === meta.og.image && !!meta.tw.title && !!meta.tw.desc,
  `${meta.tw.card} | ${meta.tw.image}`);

check('A05 JSON-LD 合法、@type=WebApplication、价格 0、url=canonical',
  !!meta.ld && meta.ld['@type'] === 'WebApplication' && !!meta.ld.offers && meta.ld.offers.price === '0' &&
  meta.ld.url === meta.canonical,
  meta.ld ? `${meta.ld['@type']} / price=${meta.ld.offers && meta.ld.offers.price} / url=${meta.ld.url}` : 'JSON-LD 不是合法 JSON');

/* robots / sitemap / og.png 真的取得到 */
const served = {};
for (const p of ['/robots.txt', '/sitemap.xml', '/assets/og.png']) {
  const r = await fetch(ORIGIN + p);
  served[p] = { status: r.status, body: await r.text() };
}
const robotsTxt = served['/robots.txt'].body;
const sitemapXml = served['/sitemap.xml'].body;
check('A06 robots.txt 200 且给出 Sitemap 行',
  served['/robots.txt'].status === 200 && /Sitemap:\s*https?:\/\//i.test(robotsTxt),
  `HTTP ${served['/robots.txt'].status} | ${robotsTxt.replace(/\s+/g, ' ').slice(0, 90)}`);
check('A07 sitemap.xml 200 且收录 canonical 地址',
  served['/sitemap.xml'].status === 200 && sitemapXml.includes('<urlset') &&
  sitemapXml.includes(meta.canonical.replace(/\/$/, '')),
  `HTTP ${served['/sitemap.xml'].status} | 含 canonical = ${sitemapXml.includes(meta.canonical.replace(/\/$/, ''))}`);
check('A08 CSP 只有一条，且 connect-src 仅放行 self + api.deepseek.com',
  meta.cspCount === 1 && /connect-src 'self' https:\/\/api\.deepseek\.com;/.test(meta.csp) &&
  /object-src 'none'/.test(meta.csp) && /base-uri 'none'/.test(meta.csp),
  `CSP×${meta.cspCount}`);
check('A09 上线要件资源全部 HTTP 200（robots / sitemap / og.png）',
  served['/robots.txt'].status === 200 && served['/sitemap.xml'].status === 200 && served['/assets/og.png'].status === 200,
  Object.keys(served).map((k) => `${k}=${served[k].status}`).join(' '));

/* ---------- B. CSP 在真实浏览器里不误伤 ---------- */
const cspAfterLoad = await cspOf(page);
check('B01 冷启动加载期间 0 条 CSP 违规', cspAfterLoad.length === 0, cspAfterLoad.join(' | '));

const dataImgOk = await page.evaluate(async () => {
  const img = new Image();
  return await new Promise((r) => {
    img.onload = () => r(true);
    img.onerror = () => r(false);
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  });
});
check('B02 img-src 放行 data:（噪点/占位图可用）', dataImgOk, String(dataImgOk));

const blobImgOk = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  c.getContext('2d').fillRect(0, 0, 2, 2);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const url = URL.createObjectURL(blob);
  const ok = await new Promise((r) => {
    const i = new Image();
    i.onload = () => r(true);
    i.onerror = () => r(false);
    i.src = url;
  });
  URL.revokeObjectURL(url);
  return ok;
});
check('B03 img-src 放行 blob:（本地预览与图纸缩略图可用）', blobImgOk, String(blobImgOk));

const inlineStyle = await page.evaluate(() => {
  const n = document.querySelector('.anim');
  if (!n) return { has: false, d: '' };
  return { has: /--d:/.test(n.getAttribute('style') || ''), d: getComputedStyle(n).getPropertyValue('--d').trim() };
});
check('B04 style-src 放行内联 style 属性（--d 变量真的生效）',
  inlineStyle.has && inlineStyle.d !== '', JSON.stringify(inlineStyle));

const jsText = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const htmlText = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const evalHits = (jsText.match(/\beval\s*\(/g) || []).length;
const funcHits = (jsText.match(/new\s+Function\s*\(/g) || []).length;
const inlineHandlers = (htmlText.match(/\son(click|load|error|input|change|submit|keydown)\s*=/gi) || []).length;
check('B05 无 eval / new Function / 内联事件处理器（所以不必给 CSP 开 unsafe-eval）',
  evalHits === 0 && funcHits === 0 && inlineHandlers === 0,
  `eval=${evalHits} newFunction=${funcHits} 内联处理器=${inlineHandlers}`);

const fonts = await page.evaluate(async () => {
  await document.fonts.ready;
  const list = [];
  document.fonts.forEach((f) => list.push(f.family + '/' + f.weight + '/' + f.status));
  return list;
});
const interLoaded = fonts.filter((f) => /Inter/i.test(f) && /loaded/.test(f)).length;
const pixLoaded = fonts.filter((f) => /Geist/i.test(f) && /loaded/.test(f)).length;
check('B06 font-src 自足：Inter 四档 + 点阵标题字体均已 loaded（零外部请求）',
  interLoaded >= 4 && pixLoaded >= 1, `Inter loaded=${interLoaded} · Geist loaded=${pixLoaded} · 合计 ${fonts.length} 个 face`);

/* ---------- C. 无障碍三件套 ---------- */

/* 需要「这一页是前台可见页」才能量几何时用它：开焦点模拟 → 跑 → 关掉（不影响后面的断言）。
   为什么需要：无头环境里这一页可能是**后台标签页**，Chrome 会推迟样式重算，
   getComputedStyle / getBoundingClientRect 读回的是冻结的旧值 ——
   实测即使把显形类手动加上、再等 1.5 秒，transform 依旧是 -200%
   （对照实验见 scripts/focus_probe.mjs）。 */
async function withFocusEmulation(fn) {
  const cdp = page.createCDPSession ? await page.createCDPSession() : await page.target().createCDPSession();
  try {
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await wait(250);
    return await fn();
  } finally {
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
    await cdp.detach().catch(() => {});
  }
}

const firstFocusable = await page.evaluate(() => {
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const all = Array.from(document.querySelectorAll(sel)).filter((n) => n.offsetWidth > 0 || n.offsetHeight > 0);
  return all.length ? (all[0].className || all[0].tagName) : '(空)';
});
check('C01 skip link 是 DOM 里第一个可聚焦元素', /skip-link/.test(firstFocusable), firstFocusable);

/* C02：首次 Tab 落到 skip link，且它真的滑进视口。
   拆成「机制」与「几何」两条，各为自己那件事负责 —— 这条断言在 CI 上长期红，
   根因不是站点而是环境：`:focus` 要求文档持有焦点，且无头里这页可能是后台标签页
   （推迟样式重算 → 几何值冻结）。三轮外力修法（window.focus() / 焦点模拟 /
   强制伪类）全部实测无效，最终产品侧改成由 focus/blur 事件维护显形状态类
   （main.js 的 initSkipLink），机制从此与环境无关。全过程见 scripts/focus_probe.mjs。 */
await page.bringToFront();
await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
await page.keyboard.press('Tab');
await wait(300);
const skipMech = await page.evaluate(() => {
  const n = document.querySelector('.skip-link');
  return {
    focused: document.activeElement === n,
    engaged: n.classList.contains('is-focused'),
  };
});
check('C02a 首次 Tab 落到 skip link，且显形状态已挂上（机制，不依赖环境是否给焦点）',
  skipMech.focused && skipMech.engaged, JSON.stringify(skipMech));

const skipGeo = await withFocusEmulation(() =>
  page.evaluate(() => {
    const n = document.querySelector('.skip-link');
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return {
      onScreen: r.bottom > 0 && r.top < innerHeight && r.width > 0,
      opacity: cs.opacity, visibility: cs.visibility,
      rect: [Math.round(r.top), Math.round(r.bottom), Math.round(r.width)],
      transform: cs.transform,
    };
  }));
check('C02b 前台可见时它真的滑进视口（几何取证，不是只藏在屏幕外）',
  skipGeo.onScreen && skipGeo.opacity !== '0' && skipGeo.visibility !== 'hidden',
  JSON.stringify(skipGeo));

await page.keyboard.press('Enter');
await wait(250);
const afterSkip = await page.evaluate(() => ({
  id: document.activeElement ? document.activeElement.id : '',
  scrollY: Math.round(window.scrollY),
}));
check('C03 激活 skip link 后焦点落到 <main id="main">', afterSkip.id === 'main', JSON.stringify(afterSkip));
await page.evaluate(() => window.scrollTo(0, 0));
await wait(200);

/* 焦点圈禁：搜索浮层 */
await page.click('#tbSearch');
await wait(350);
let escaped = [];
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => {
    const w = document.getElementById('tbSearchWrap');
    return w.contains(document.activeElement);
  });
  if (!inside) escaped.push(i + 1);
}
check('C04 搜索浮层：连按 8 次 Tab 焦点不逃逸（焦点圈禁生效）',
  escaped.length === 0, escaped.length ? '第 ' + escaped.join('/') + ' 次 Tab 逃逸' : '8/8 留在浮层内');

await page.screenshot({ path: path.join(OUT, 'v4b-search-trap.png') });
await page.keyboard.press('Escape');
await wait(300);
const searchClosed = await page.evaluate(() => ({
  hidden: document.getElementById('tbSearchWrap').hidden,
  focused: document.activeElement ? document.activeElement.id : '',
}));
check('C05 Esc 关闭搜索浮层且焦点还原到触发按钮 #tbSearch',
  searchClosed.hidden && searchClosed.focused === 'tbSearch', JSON.stringify(searchClosed));

/* 通知浮层 */
await page.click('#tbBell');
await wait(350);
let escapedN = [];
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => document.getElementById('tbNoticeWrap').contains(document.activeElement));
  if (!inside) escapedN.push(i + 1);
}
await page.keyboard.press('Escape');
await wait(300);
const noticeClosed = await page.evaluate(() => ({
  hidden: document.getElementById('tbNoticeWrap').hidden,
  focused: document.activeElement ? document.activeElement.id : '',
}));
check('C06 通知浮层同样圈禁 + 关闭后焦点还原到 #tbBell',
  escapedN.length === 0 && noticeClosed.hidden && noticeClosed.focused === 'tbBell',
  `逃逸 ${escapedN.length} 次；${JSON.stringify(noticeClosed)}`);

/* 打开模态框：工具层是浮层，`page.click` 是按坐标点 —— 动画还没停或被别的层压着时会点空，
   于是「模态框压根没开」。以前这会以两种面目出现：C07a 假红，紧接着下一句取
   `document.getElementById('modal').contains` 撞 null，**整个套件崩掉、连报告都出不来**
   （这是最费时间的失败形态：看起来像环境抖动，其实是被测流程真没走到）。
   所以改成：点一次 → 等它真的开 → 没开就再点一次；下面所有读 `#modal` 的地方一律 null-safe。 */
async function openModalVia(sel) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate((s) => {
      const b = document.querySelector(s);
      if (b) b.scrollIntoView({ block: 'center' });
    }, sel);
    await wait(250);
    try {
      await page.click(sel);
    } catch (e) {
      /* 元素暂时不可点（浮层动画中）→ 落到下一轮重试，而不是把套件崩掉 */
      await wait(300);
      continue;
    }
    const opened = await page
      .waitForFunction(() => {
        const m = document.getElementById('modal');
        return !!m && !m.hidden;
      }, { timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (opened) return true;
  }
  return false;
}

/* 模态框（用「恢复默认」这种真实按钮打开，能真正验证焦点还原） */
await openModalVia('[data-tool="reset"]');
await wait(250);
const modalOpen = await page.evaluate(() => {
  const m = document.getElementById('modal');
  if (!m || m.hidden) return { open: false };
  return { open: true, title: (document.getElementById('modalTitle') || {}).textContent || '', inside: m.contains(document.activeElement) };
});
check('C07a 模态框打开后焦点进入框内（不是留在背景按钮上）',
  modalOpen.open && modalOpen.inside, JSON.stringify(modalOpen));

let escapedM = 0;
const focusInsideModal = async () => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.evaluate(() => {
        const m = document.getElementById('modal');
        if (!m) return false; /* 模态框不在 → 记作焦点逃逸，照实进报告，不崩 */
        return m.contains(document.activeElement);
      });
    } catch (e) {
      if (attempt >= 1) throw e;
      await wait(150);
    }
  }
};
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('Tab');
  await wait(80);
  const inside = await focusInsideModal();
  if (!inside) escapedM++;
}
check('C07b 模态框：连按 6 次 Tab 焦点不逃逸', escapedM === 0, escapedM ? `逃逸 ${escapedM} 次` : '6/6 留在框内');
await page.screenshot({ path: path.join(OUT, 'v4b-modal.png') });

await page.keyboard.press('Escape');
await wait(350);
const modalClosed = await page.evaluate(() => {
  const m = document.getElementById('modal');
  return {
    hidden: m ? m.hidden : null, /* null = 模态框压根没建起来，与「关不掉」区分开 */
    focusedTool: document.activeElement ? (document.activeElement.getAttribute('data-tool') || '') : '',
  };
});
check('C07c Esc 关闭模态框且焦点还原到「恢复默认」按钮',
  modalClosed.hidden && modalClosed.focusedTool === 'reset', JSON.stringify(modalClosed));

/* 键盘聚焦可见轮廓 */
await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
await wait(200);
const ring = await page.evaluate(() => {
  const n = document.activeElement;
  if (!n) return { tag: '', w: '0px', style: 'none' };
  const cs = getComputedStyle(n);
  return { tag: n.tagName + '.' + (n.className || ''), w: cs.outlineWidth, style: cs.outlineStyle };
});
check('C08 键盘聚焦时有可见轮廓（:focus-visible 生效）',
  ring.style !== 'none' && parseFloat(ring.w) > 0, JSON.stringify(ring));

/* 内联展开区（周期面板）不锁焦点 —— 验证「不是模态就不该锁焦点」这条处理是对的 */
await page.evaluate(() => { document.getElementById('periodToggle').scrollIntoView({ block: 'center' }); });
await wait(200);
await page.click('#periodToggle');
await wait(400);
let leftPanel = false;
/* 周期面板里控件很多，14 次 Tab 根本走不完（不是被锁）—— 放宽到 60 次找「走出去」 */
for (let i = 0; i < 60; i++) {
  await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => document.getElementById('periodPanel').contains(document.activeElement));
  if (!inside) { leftPanel = true; break; }
}
check('C09 周期面板是内联展开、不锁焦点（Tab 能走出去 —— 与模态框的行为区分正确）',
  leftPanel, leftPanel ? 'Tab 若干次后正常离开面板' : '60 次 Tab 都没走出去（被错误地锁住了）');
await page.keyboard.press('Escape');
await wait(200);

/* ---------- G. 打卡联动 + 跨零点（米线 2026-09-30 报的两个问题） ----------
   问题①：在「今日待办」勾一段，下面「学习日」时间轴的同一段不跟着变（反过来也不变）——
          根因是两条勾选路径各刷一半视图：待办只刷 renderToday+板子，时间轴压根不刷待办。
   问题②：日期不会自己翻页 —— 开着不动、或第二天重新打开，界面还停在前一天
          （根因：state.sel 存的是上次看的那天，renderDay 只在它「非法」时才回退到今天）。 */

/* G01：今日待办 → 学习日时间轴 */
await page.evaluate(() => { document.getElementById('todayTodo').scrollIntoView({ block: 'center' }); });
await wait(300);
const g1 = await page.evaluate(() => {
  const box = document.querySelector('#todayTodo .todo-check:not([checked])');
  if (!box) return { err: '今日待办里没有可勾的段' };
  const sid = box.getAttribute('data-sid');
  box.click();
  const tl = document.querySelector('#timeline .tl-item[data-sid="' + sid + '"]');
  const back = document.querySelector('#todayTodo .todo-check[data-sid="' + sid + '"]');
  return {
    sid,
    tlFound: !!tl,
    tlDone: tl ? tl.classList.contains('is-done') : null,
    tlChecked: tl ? tl.querySelector('.tl-check').checked : null,
    todoDone: back ? back.closest('.todo-item').classList.contains('is-done') : null,
  };
});
check('G01 勾「今日待办」→「学习日」时间轴同一段同步变成已完成（问题①）',
  !g1.err && g1.tlFound && g1.tlDone === true && g1.tlChecked === true, JSON.stringify(g1));

/* G02：反向 —— 在时间轴取消勾选，今日待办要跟着退回去 */
const g2 = await page.evaluate((sid) => {
  const row = document.querySelector('#timeline .tl-item[data-sid="' + sid + '"]');
  if (!row) return { err: '时间轴里找不到 ' + sid };
  const tl = row.querySelector('.tl-check');
  tl.click();
  const row2 = document.querySelector('#timeline .tl-item[data-sid="' + sid + '"]');
  const back = document.querySelector('#todayTodo .todo-check[data-sid="' + sid + '"]');
  return {
    tlDone: row2.classList.contains('is-done'),
    tlChecked: row2.querySelector('.tl-check').checked,
    todoChecked: back ? back.checked : null,
    todoDone: back ? back.closest('.todo-item').classList.contains('is-done') : null,
  };
}, g1.sid || '');
check('G02 反向：在「学习日」时间轴取消勾选 →「今日待办」同步退回未完成',
  !g2.err && g2.tlDone === false && g2.tlChecked === false &&
  g2.todoChecked === false && g2.todoDone === false, JSON.stringify(g2));
await page.screenshot({ path: path.join(OUT, 'v4b-check-sync.png') });

/* G03：昨天选着某一天关掉页面 → 第二天打开必须落回「今天」
   走真实路径：点一个「不是今天」的日历格，再把存档里的 sel 也改成那天，然后刷新。 */
const g3sel = await page.evaluate(() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const y = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  const key = y.getFullYear() + '-' + p(y.getMonth() + 1) + '-' + p(y.getDate());
  const cell = document.querySelector('.cal-cell[data-date="' + key + '"]');
  if (!cell) return { err: '日历里找不到昨天 ' + key };
  cell.click();
  const raw = JSON.parse(localStorage.getItem('study-plan-v2') || '{}');
  raw.sel = key;                       /* 模拟「那天也存过盘」 */
  localStorage.setItem('study-plan-v2', JSON.stringify(raw));
  return { key, savedSel: raw.sel, kickerAfterClick: (document.getElementById('dpKicker') || {}).textContent || '' };
});
await page.reload({ waitUntil: 'networkidle2' });
await wait(800);
const g3after = await page.evaluate(() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const today = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  const kicker = (document.getElementById('dpKicker') || {}).textContent || '';
  return { today, kicker, hasToday: kicker.indexOf('今天') >= 0, startsWithToday: kicker.indexOf(today.replace(/-/g, '.')) === 0 };
});
check('G03 打开就落在「今天」：存档里还留着昨天，面板也必须回到今天（问题②）',
  !g3sel.err && g3after.hasToday && g3after.startsWithToday,
  `存档 sel=${g3sel.savedSel}（点日历后=${g3sel.kickerAfterClick}）→ 刷新后面板=«${g3after.kicker}»`);

/* G04：跨零点自动翻页（页面一直开着，不刷新）
   做法：把浏览器时区挪到「一定跨了一天」的那一侧，再抛一次 visibilitychange。
   本地 19 点前往西挪 19 小时能落回前一天；19 点后往东挪 6 小时能落到后一天 ——
   两个方向验的是同一件事：日期一变，界面必须自己跟过去。 */
/* 选时区不能按「本机几点」拍 —— 那样只有 UTC+8 的机器成立。
   CI 跑在 UTC，下午 13 点往西挪 11 小时仍落在同一天，压根没跨天，断言只能假红。
   改成**算**出来：世界时区横跨 UTC-12 ~ UTC+14（26 小时 > 24），
   所以任意时刻总有一个时区「今天」与当前不同 —— 逐个用 Intl 试，取第一个真换天的。 */
const g4tz = await page.evaluate(() => {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const base = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate());
  const cands = ['Pacific/Kiritimati', 'Etc/GMT+12', 'Pacific/Pago_Pago', 'Etc/GMT-14'];
  for (const tz of cands) {
    let d;
    try {
      d = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(now);
    } catch (e) { continue; }
    if (d !== base) return tz;
  }
  return '';
});
const g4before = await page.evaluate(() => (document.getElementById('dpKicker') || {}).textContent || '');
if (g4tz) await page.emulateTimezone(g4tz);
await wait(250);
await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
await wait(700);
const g4after = await page.evaluate(() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    local: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
    kicker: (document.getElementById('dpKicker') || {}).textContent || '',
  };
});
try { await page.emulateTimezone(null); } catch (e) { /* 某些版本不接受 null，忽略 */ }
await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
await wait(400);
const g4new = g4after.local.replace(/-/g, '.');
check('G04 跨零点自动翻页：日期一变（页面没刷新）界面立刻跟到新的一天',
  g4after.local !== '' &&
  g4after.kicker.indexOf(g4new) >= 0 && g4after.kicker.indexOf('今天') >= 0 &&
  g4before.indexOf(g4new) < 0,
  `时区 ${g4tz}：面板 «${g4before}» → «${g4after.kicker}»`);

/* ---------- D. 导入加固（挡坏文件 + 不误伤好文件） ---------- */
async function importFile(file) {
  const input = await page.$('#planFile');
  await input.uploadFile(file);
  await wait(700);
}
const modalState = () => page.evaluate(() => {
  const m = document.getElementById('modal');
  const open = !!(m && !m.hidden);
  return {
    open,
    title: open ? (document.getElementById('modalTitle') || {}).textContent : '',
    msg: open ? ((document.getElementById('modalBody') || {}).textContent || '') : '',
    ok: open ? (document.getElementById('modalOk') || {}).textContent : '',
  };
});
const readState = () => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('study-plan-v2') || 'null'); } catch (e) { return null; }
});

await importFile(bigFile);
let ms = await modalState();
check('D01 超过 5MB 的文件被挡下并给人话原因',
  ms.open && ms.title === '导入失败' && /上限 5MB/.test(ms.msg), `title=${ms.title} msg=${ms.msg.slice(0, 60)}`);
await page.keyboard.press('Escape');
await wait(300);

await importFile(badJson);
ms = await modalState();
check('D02 非法 JSON 被挡下且说明原因',
  ms.open && ms.title === '导入失败' && /不是有效的 JSON/.test(ms.msg), `title=${ms.title} msg=${ms.msg.slice(0, 60)}`);
await page.keyboard.press('Escape');
await wait(300);

/* ★ 往返：先造真实进度 → 导出 → 再导入同一份 → 进度必须一条不少
   （修好前 checks 净化条件写反，这一步会把进度清零） */
await page.evaluate(() => { document.getElementById('todayTodo').scrollIntoView({ block: 'center' }); });
await wait(300);
const ticked = await page.evaluate(() => {
  const boxes = Array.from(document.querySelectorAll('#todayTodo .todo-check'));
  if (!boxes.length) return { n: 0, total: 0 };
  boxes[0].click();
  return { n: 1, total: boxes.length };
});
await wait(500);
const stateBefore = await readState();
const checksBefore = stateBefore && stateBefore.checks ? Object.keys(stateBefore.checks) : [];
const trueBefore = checksBefore.filter((k) => stateBefore.checks[k] === true);
check('D03a 前置：真的制造出一段打卡进度', trueBefore.length > 0,
  `勾选项 ${ticked.n}/${ticked.total}，checks 键 ${checksBefore.length} 条`);

/* 截住导出内容（不真下载，只取 Blob 文本） */
await page.evaluate(() => {
  window.__exported = null;
  const orig = URL.createObjectURL;
  URL.createObjectURL = function (blob) {
    if (blob instanceof Blob && blob.type && /json/.test(blob.type)) {
      blob.text().then((t) => { window.__exported = t; });
    }
    return orig.call(URL, blob);
  };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) return;          /* 站内导出：只截内容，不落盘 */
    return origClick.apply(this, arguments);
  };
});
await page.evaluate(() => document.querySelector('[data-tool="export"]').click());
let exported = null;
for (let i = 0; i < 40 && !exported; i++) { await wait(150); exported = await page.evaluate(() => window.__exported); }
const rtFile = path.join(TMP, 'roundtrip.json');
if (exported) fs.writeFileSync(rtFile, exported);
check('D03b 前置：导出拿到 JSON 文本', !!exported && exported.length > 50, exported ? exported.length + ' 字节' : '没截到');

let checksAfter = [];
if (exported) {
  await importFile(rtFile);
  ms = await modalState();
  if (ms.open && ms.ok === '确认') { await page.click('#modalOk'); await wait(700); }
  const stateAfter = await readState();
  const cks = stateAfter && stateAfter.checks ? stateAfter.checks : {};
  checksAfter = Object.keys(cks).filter((k) => cks[k] === true);
}
check('D03c★ 导出→导入往返：打卡进度一条不少（回归门禁）',
  exported && trueBefore.length > 0 && checksAfter.length === trueBefore.length,
  `导入前 ${trueBefore.length} 条 true → 导入后 ${checksAfter.length} 条`);

/* 坏文件：坏链被洗、坏键被挡 */
await importFile(evilFile);
ms = await modalState();
if (ms.open && ms.ok === '确认') { await page.click('#modalOk'); await wait(700); }
const stateEvil = await readState();
const links = (stateEvil && stateEvil.links) || [];
const cks2 = (stateEvil && stateEvil.checks) || {};
const ckKeys = Object.keys(cks2);
check('D04 导入的链接过协议白名单：javascript: / data: 被丢，只留 https',
  links.length === 1 && /^https:\/\//.test(links[0].url),
  `${links.length} 条：` + links.map((l) => l.url).join(' , '));
check('D05 checks 只收合法键：__proto__ / not-a-date 被挡，值非法被丢',
  !ckKeys.includes('__proto__') && !ckKeys.includes('not-a-date:slots-0') &&
  ckKeys.indexOf('2026-01-05:slots-0') >= 0 && ckKeys.indexOf('2026-01-05:slots-1') < 0,
  '保留下来的键：' + JSON.stringify(ckKeys));
check('D06 reviews 按 {done,stuck,next} 重建且值全部字符串化',
  !!stateEvil && !!stateEvil.reviews &&
  !!stateEvil.reviews['2026-01-05'] &&
  stateEvil.reviews['2026-01-05'].done === '看了课' &&
  Object.keys(stateEvil.reviews).indexOf('__proto__') < 0,
  stateEvil ? JSON.stringify(Object.keys(stateEvil.reviews || {})) : '读不到 state');
const protoClean = await page.evaluate(() => ({
  objProto: Object.prototype.done === undefined && Object.prototype.polluted === undefined,
  checkInherits: ({}).polluted === undefined,
}));
check('D07 导入不污染原型（Object.prototype 干净）',
  protoClean.objProto && protoClean.checkInherits, JSON.stringify(protoClean));

/* ---------- F. 视觉与触控 ---------- */
const colors = await page.evaluate(() => {
  const g = (s) => { const n = document.querySelector(s); return n ? getComputedStyle(n).backgroundColor : null; };
  return { l0: g('.hm-lv.l0'), l1: g('.hm-lv.l1'), l2: g('.hm-lv.l2'), l3: g('.hm-lv.l3'), l4: g('.hm-lv.l4') };
});
/* l0 是「无活动」档（rgba(255,255,255,0.06)），本就不属于色阶 ——
   色阶只有 l1..l4 四档，线性只算这四档之间的三段间距（把 l0 算进去是我的错）。 */
const lumOf = (c) => { const o = overBase(c || '', PAGE_BG); return o ? relLum(o) : null; };
const lums = ['l1', 'l2', 'l3', 'l4'].map((k) => lumOf(colors[k]));
const lumL0 = lumOf(colors.l0);
const monotonic = lums[0] != null && lums.every((v, i) => (i === 0 ? v != null : v != null && lums[i - 1] != null && v > lums[i - 1]));
const gaps = [];
for (let i = 1; i < lums.length; i++) if (lums[i] != null && lums[i - 1] != null) gaps.push(lums[i] - lums[i - 1]);
const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
const spread = Math.max(...gaps.map((g) => Math.abs(g - meanGap))) / meanGap;
check('F01 热力图色阶 4 档按相对亮度单调递增且间距近似线性（P2-5）',
  monotonic && gaps.length === 3 && spread <= 0.35 && (lumL0 == null || lumL0 < lums[0]),
  '空档 l0=' + (lumL0 == null ? 'n/a' : lumL0.toFixed(4)) + '；色阶 ' + lums.map((v) => (v == null ? 'n/a' : v.toFixed(4))).join(' → ') +
  `；三段间距 ${gaps.map((g) => g.toFixed(4)).join('/')}，最大偏离均值 ${(spread * 100).toFixed(1)}%`);

/* F02：图例与格子必须同色。当前数据下格子可能全是 l0（DOM 里根本没有 .hm-cell.l1 节点），
   所以直接比对 styles.css 里的声明，不依赖数据状态。 */
const cssText = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const declOf = (sel) => {
  const m = cssText.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*background(?:-color)?:\\s*([^;}]+)'));
  return m ? m[1].trim() : null;
};
const rampPairs = ['l1', 'l2', 'l3', 'l4'].map((lv) => {
  const grid = declOf('.hm-cell.' + lv);
  const legend = declOf('.hm-lv.' + lv);
  return { lv, grid, legend, same: !!grid && grid === legend };
});
check('F02 图例色阶与格子色阶同色（不会出现「图例对不上」）',
  rampPairs.every((p) => p.same),
  rampPairs.map((p) => `${p.lv}: 格=${p.grid} / 例=${p.legend}`).join(' | '));
await page.evaluate(() => { const n = document.querySelector('.hm-legend'); if (n) n.scrollIntoView({ block: 'center' }); });
await wait(300);
await page.screenshot({ path: path.join(OUT, 'v4b-heatmap.png') });

const copyBtn = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button, a')).find((n) => /复制本站链接/.test(n.textContent || ''));
  return btn ? { found: true, tag: btn.tagName, dis: btn.disabled === true } : { found: false };
});
check('F03 「复制本站链接」入口存在且可用（P2-8）',
  copyBtn.found && !copyBtn.dis, JSON.stringify(copyBtn));

/* F06：图纸预览从 PNG 换成了无损 WebP（P2-1）。
   光断言 src 字符串带 .webp 不够 —— 后缀对了但文件坏了照样"通过"。
   这里要求浏览器真的把图解码出来（naturalWidth > 0），且列表里不能残留 .png。
   缩略图是 loading="lazy"，得先把它滚进视口。 */
await page.evaluate(() => { const g = document.getElementById('gal'); if (g) g.scrollIntoView({ block: 'start' }); });
await wait(1200);
const thumbs = await page.evaluate(async () => {
  const list = Array.from(document.querySelectorAll('#gal .gal-thumb'));
  if (!list.length) return { n: 0, srcs: [], decoded: [], png: 0 };
  const pick = list.slice(0, 4);
  await Promise.all(pick.map((i) => i.complete ? null : new Promise((res) => {
    i.onload = res; i.onerror = res; setTimeout(res, 2500);
  })));
  return {
    n: list.length,
    srcs: pick.map((i) => i.getAttribute('src')),
    decoded: pick.filter((i) => i.naturalWidth > 0).map((i) => i.naturalWidth + '×' + i.naturalHeight),
    png: list.filter((i) => /\.png$/i.test(i.getAttribute('src') || '')).length,
  };
});
check('F06 图纸预览是 WebP 且真的解码成功（不是只换个后缀）',
  thumbs.n > 0 && thumbs.png === 0 && thumbs.decoded.length === Math.min(4, thumbs.n) &&
  thumbs.srcs.every((s) => /\.webp$/.test(s || '')),
  `共 ${thumbs.n} 张 · 抽 4 张解码 = ${thumbs.decoded.join(', ') || '（都没解出来）'} · 残留 png ${thumbs.png}`);

const overflow = await page.evaluate(() => {
  window.scrollTo(300, 0);
  const x = window.scrollX;
  window.scrollTo(0, 0);
  return { scrollX: x, doc: document.documentElement.scrollWidth, win: window.innerWidth };
});
check('F04 桌面 1440 无横向可滚（内容不越界）',
  overflow.scrollX === 0 && overflow.doc <= overflow.win + 1, JSON.stringify(overflow));

/* 移动端触控目标 */
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await wait(500);
await page.click('#tbSearch');
await wait(350);
const touch = await page.evaluate(() => {
  const w = document.getElementById('tbSearchWrap');
  const btn = w.querySelector('[data-tb-close]');
  if (!btn) return { found: false };
  const r = btn.getBoundingClientRect();
  return { found: true, w: Math.round(r.width), h: Math.round(r.height), cls: btn.className };
});
check('F05 移动端孤立关闭按钮触控目标 ≥44×44（P2-6）',
  touch.found && touch.w >= 44 && touch.h >= 44, JSON.stringify(touch));
await page.screenshot({ path: path.join(OUT, 'v4b-mobile-search.png') });
await page.keyboard.press('Escape');
await wait(200);

/* ---------- B07：全流程操作后仍然 0 条 CSP 违规 ---------- */
const cspAfterAll = await cspOf(page);
check('B07 全流程操作（浮层/模态/导入/滚动/移动端）后依然 0 条 CSP 违规',
  cspAfterAll.length === 0, cspAfterAll.join(' | '));
const cspErrors = allConsoleErrors.filter((t) => /Content Security Policy|Refused to/i.test(t));
check('B08 控制台里没有任何 CSP 报错', cspErrors.length === 0, cspErrors.slice(0, 2).join(' | '));

/* ==================================================================
   E：空模板发布态（EMPTY_TEMPLATE = true）—— 线上跑的就是这一份
   ================================================================== */
const epage = await browser.newPage();
await epage.setViewport({ width: 1440, height: 900 });
wire(epage, 'empty');
await epage.evaluateOnNewDocument(CSP_HOOK);
/* 空模板分页与主页面同源 → 共享 localStorage，前面 D04 的恶意导入会把
   tracks 写成 1 条带过来（曾误判成「空模板藏着出厂数据」）。首访就该是干净的。 */
await epage.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) { /* 忽略 */ } });
await epage.setRequestInterception(true);
epage.on('request', (req) => {
  if (req.url().endsWith('/main.js')) {
    const body = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8')
      .replace('var EMPTY_TEMPLATE = false;', 'var EMPTY_TEMPLATE = true;');
    req.respond({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
  } else req.continue();
});
await epage.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle2' });
await wait(900);

const emptyState = await epage.evaluate(() => {
  const fs0 = document.getElementById('firstStep');
  const repoBlocks = Array.from(document.querySelectorAll('#repo .repo-block'));
  const stats = document.querySelector('.stats');
  const stat2 = document.querySelector('.stats .stat:nth-child(2)');
  return {
    flag: 'loaded',
    firstStepShown: !!fs0 && !fs0.hidden && getComputedStyle(fs0).display !== 'none',
    periodHidden: document.getElementById('periodPanel').hidden,
    cadBlockDisplay: repoBlocks.length ? getComputedStyle(repoBlocks[0]).display : '(无)',
    repoBlockCount: repoBlocks.length,
    stats3: !!stats && stats.classList.contains('stats-3'),
    stat2Display: stat2 ? getComputedStyle(stat2).display : '(无)',
    dxfLinks: document.querySelectorAll('a[href^="assets/dxf/"]').length,
    trackCount: document.querySelectorAll('.track-tab').length,
    csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
    skip: !!document.querySelector('.skip-link'),
    emptyText: (document.querySelector('#tracks .block-sub') || {}).textContent || '',
  };
});
check('E01 空模板下首访引导可见（不是让人对着空日历发懵）', emptyState.firstStepShown, JSON.stringify({ firstStepShown: emptyState.firstStepShown }));
check('E02 空模板下没有出厂学习线（真空白，不是「假装空白」）',
  emptyState.trackCount === 0, `学习模块数 ${emptyState.trackCount}`);
check('E03 空模板下 CAD 图纸仓库整块隐藏、图纸链接为 0',
  emptyState.cadBlockDisplay === 'none' && emptyState.dxfLinks === 0,
  `display=${emptyState.cadBlockDisplay} 链接=${emptyState.dxfLinks}`);
check('E04 空模板下「40 张图纸」统计格隐藏，四格变三格',
  emptyState.stat2Display === 'none' && emptyState.stats3,
  `stat2=${emptyState.stat2Display} stats-3=${emptyState.stats3}`);
check('E05 空模板下的文案是「这里是空的 —— …」引导，不是出厂模板话术',
  /这里是空的/.test(emptyState.emptyText), emptyState.emptyText.slice(0, 50));

await epage.click('#fsGo');
await wait(900);
const afterGo = await epage.evaluate(() => {
  const p = document.getElementById('periodPanel');
  const r = p.getBoundingClientRect();
  const nav = document.querySelector('.site-header');
  const navH = nav ? nav.getBoundingClientRect().height : 0;
  return {
    periodHidden: p.hidden,
    expanded: document.getElementById('periodToggle').getAttribute('aria-expanded'),
    scrollY: Math.round(window.scrollY),
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    navH: Math.round(navH),
    vh: window.innerHeight,
    focus: document.activeElement ? document.activeElement.id : null,
  };
});
check('E06 点首访引导「去设置周期」能真的把周期面板打开',
  !afterGo.periodHidden && afterGo.expanded === 'true', JSON.stringify(afterGo));
/* 这条是米线 2026-09-30 报的「点了并没有跳转」变成的常驻门禁：
   面板打开 ≠ 用户看得见 —— 它长在页面下方一屏以外，不滚过去就等于没反应。 */
check('E06b★ 打开还不够 —— 面板必须真的滚到眼前（不压在顶上导航底下、焦点落在起始日期）',
  afterGo.scrollY > 200 && afterGo.top >= afterGo.navH - 2 && afterGo.top < afterGo.vh * 0.7
  && afterGo.bottom > 0 && afterGo.focus === 'pdStart',
  JSON.stringify(afterGo));
await epage.screenshot({ path: path.join(OUT, 'v4b-empty-template.png') });

const cspEmpty = await cspOf(epage);
check('E07 空模板态同样 0 条 CSP 违规（线上跑的就是这一份）', cspEmpty.length === 0, cspEmpty.join(' | '));

/* ==================================================================
   G~I：v4.2（米线 2026-09-30 第二次报缺陷 + 两条新要求）
     G 首屏四步必须真能点 —— 他连报两回「点了没反应」的就是第 1 步
     H CAD 图纸仓库要能删减，且能一键恢复
     I 资料库「加链接 / 加文件 / 拖文件」不该被编辑态挡着
   另开一个全新 page 并先清存储：既避开前面 D 段（导入白名单 / 原型污染）
   留下的数据，也保证这套断言自己可重入、可单独重跑。
   ================================================================== */
const v42 = await browser.newPage();
await v42.setViewport({ width: 1440, height: 900 });
/* 只清一次：evaluateOnNewDocument 在**每次导航**都会跑，直接写 localStorage.clear()
   会把 H04 的 reload 也清掉 —— 那就是「测了个干净开局」，不是「测了存得住」。
   用 sessionStorage 上的哨兵把「首次」钉住（同一个标签页 reload 时它还在）。 */
await v42.evaluateOnNewDocument(() => {
  if (!sessionStorage.getItem('__v42_cleared')) {
    localStorage.clear();
    sessionStorage.setItem('__v42_cleared', '1');
  }
});
wire(v42, 'v42');
await v42.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle2' });
await wait(600);

/* 把某块滚到导航底下再拍 —— 顶部导航是 fixed，不躲开就会盖住标题行。
   注意页面带 scroll-behavior: smooth，滚动是动画：必须轮询到停稳再截，
   否则拍到的是半路上（这一条踩过：CAD 那张拍成了 #tracks 的中间）。 */
const shotAt = async (sel, file) => {
  await v42.evaluate((s) => {
    const n = document.querySelector(s);
    const nav = document.querySelector('.site-header');
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    window.scrollTo(0, n.getBoundingClientRect().top + window.pageYOffset - navH - 40);
  }, sel);
  /* 等它真的停下来：要连续三次读数一致才算稳。
     只看「后两次一样」会提前退出 —— 平滑滚动刚被触发时会连续两次读到同一位置。 */
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 40; i++) {
    await wait(120);
    const y = await v42.evaluate(() => Math.round(window.scrollY));
    stable = y === last ? stable + 1 : 0;
    last = y;
    if (stable >= 2) break;
  }
  await wait(200);
  await v42.screenshot({ path: path.join(OUT, file) });
};
await v42.evaluate(() => window.scrollTo(0, 0));
await wait(400);
await v42.screenshot({ path: path.join(OUT, 'v4b-hero-steps.png') });

/* --- G：首屏四步 --- */
const stepBtns = await v42.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.hero-steps [data-hs-to]'));
  return { n: b.length, to: b.map((x) => x.getAttribute('data-hs-to')) };
});
check('G01 首屏四步是四个真按钮，不是纯文本 <li>',
  stepBtns.n === 4 && stepBtns.to.join(',') === 'period,slots,tracks,check', JSON.stringify(stepBtns));

const clickStep = async (to) => {
  /* 用程序化 click：puppeteer 的 page.click 自带 scrollIntoViewIfNeeded，
     会把页面先滚到按钮那儿，跳动量就不是被测功能的功劳了 */
  await v42.evaluate((v) => document.querySelector(`.hero-steps [data-hs-to="${v}"]`).click(), to);
  await wait(1100);
};
const readJump = (sel) => v42.evaluate((s) => {
  const n = document.querySelector(s);
  const r = n.getBoundingClientRect();
  const nav = document.querySelector('.site-header');
  return {
    hidden: n.hidden === true || getComputedStyle(n).display === 'none',
    scrollY: Math.round(window.scrollY),
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    navH: Math.round(nav ? nav.getBoundingClientRect().height : 0),
    vh: window.innerHeight,
    focus: document.activeElement ? document.activeElement.id : null,
  };
}, sel);

await v42.evaluate(() => window.scrollTo(0, 0));
await wait(300);
await clickStep('period');
const gPeriod = await readJump('#periodPanel');
check('G02★ 点「1 设置周期」→ 面板打开并滚到眼前（不压导航下、焦点落在起始日期）',
  !gPeriod.hidden && gPeriod.scrollY > 200 && gPeriod.top >= gPeriod.navH - 2
  && gPeriod.top < gPeriod.vh * 0.7 && gPeriod.bottom > 0 && gPeriod.focus === 'pdStart',
  JSON.stringify(gPeriod));
await shotAt('#periodPanel', 'v4b-period-jump.png');

await clickStep('slots');
const gSlots = await v42.evaluate(() => {
  const t = document.getElementById('dayEditToggle');
  const r = document.getElementById('dayPanel').getBoundingClientRect();
  return {
    pressed: t ? t.getAttribute('aria-pressed') : null,
    tools: document.querySelectorAll('#dayPanel .slot-tools').length,
    top: Math.round(r.top),
    vh: window.innerHeight,
  };
});
check('G03 点「2 安排时段」→ 自动打开学习日编辑态（时段工具露出来）并滚到当天时间轴',
  gSlots.pressed === 'true' && gSlots.tools > 0 && gSlots.top >= 0 && gSlots.top < gSlots.vh * 0.7,
  JSON.stringify(gSlots));

await clickStep('tracks');
const gTracks = await readJump('#tracks');
check('G04 点「3 添加模块」→ 滚到学习模块区，顶端不被导航挡住',
  gTracks.top >= gTracks.navH - 2 && gTracks.top < gTracks.vh * 0.7, JSON.stringify(gTracks));

await clickStep('check');
const gCheck = await readJump('#todayTodo');
check('G05 点「4 每日打卡」→ 滚到今日待办，顶端不被导航挡住',
  gCheck.top >= gCheck.navH - 2 && gCheck.top < gCheck.vh * 0.7, JSON.stringify(gCheck));

/* --- H：CAD 图纸仓库能删减 --- */
const h1 = await v42.evaluate(() => ({
  pressed: document.getElementById('cadEditToggle').getAttribute('aria-pressed'),
  x: document.querySelectorAll('.gal-x').length,
  cards: document.querySelectorAll('#gal .gal-card').length,
  restoreHidden: document.getElementById('cadRestore').hidden,
  count: document.getElementById('galCount').textContent.trim(),
}));
check('H01 CAD 图纸仓库默认不在编辑态：40 张、没有 ×、没有「恢复全部」',
  h1.pressed === 'false' && h1.x === 0 && h1.cards === 40 && h1.restoreHidden && !/已删减/.test(h1.count),
  JSON.stringify(h1));

await v42.evaluate(() => document.getElementById('cadEditToggle').click());
await wait(400);
const h2 = await v42.evaluate(() => ({
  pressed: document.getElementById('cadEditToggle').getAttribute('aria-pressed'),
  label: document.getElementById('cadEditToggle').textContent.trim(),
  x: document.querySelectorAll('.gal-x').length,
  cards: document.querySelectorAll('#gal .gal-card').length,
  editing: document.getElementById('cadBlock').classList.contains('is-editing'),
}));
check('H02 开编辑：每张图纸左上角都长出 ×，按钮变「✓ 完成」',
  h2.pressed === 'true' && h2.editing && h2.x === 40 && h2.cards === 40 && /完成/.test(h2.label),
  JSON.stringify(h2));
await shotAt('#cadBlock', 'v4b-cad-edit.png');

await v42.evaluate(() => document.querySelector('.gal-x').click());
await wait(400);
const h3 = await v42.evaluate(() => ({
  cards: document.querySelectorAll('#gal .gal-card').length,
  x: document.querySelectorAll('.gal-x').length,
  count: document.getElementById('galCount').textContent.trim(),
  restoreHidden: document.getElementById('cadRestore').hidden,
  stored: (JSON.parse(localStorage.getItem('study-plan-v2') || '{}').hideSheets || []).length,
}));
check('H03 点 × 收起一张：少一张、计数写「已删减 1 张」、「恢复全部」现形、并已落盘',
  h3.cards === 39 && h3.x === 39 && /已删减 1 张/.test(h3.count) && !h3.restoreHidden && h3.stored === 1,
  JSON.stringify(h3));

await v42.reload({ waitUntil: 'networkidle2' });
await wait(700);
const h4 = await v42.evaluate(() => ({
  cards: document.querySelectorAll('#gal .gal-card').length,
  x: document.querySelectorAll('.gal-x').length,
  count: document.getElementById('galCount').textContent.trim(),
  restoreHidden: document.getElementById('cadRestore').hidden,
  editing: document.getElementById('cadBlock').classList.contains('is-editing'),
}));
check('H04 刷新之后删减还在，且默认退回非编辑态（不会一打开就冒出一排 ×）',
  h4.cards === 39 && h4.x === 0 && !h4.editing && /已删减 1 张/.test(h4.count) && !h4.restoreHidden,
  JSON.stringify(h4));

await v42.evaluate(() => document.getElementById('cadRestore').click());
await wait(400);
const h5 = await v42.evaluate(() => ({
  cards: document.querySelectorAll('#gal .gal-card').length,
  count: document.getElementById('galCount').textContent.trim(),
  restoreHidden: document.getElementById('cadRestore').hidden,
  stored: (JSON.parse(localStorage.getItem('study-plan-v2') || '{}').hideSheets || []).length,
}));
check('H05 点「↺ 恢复全部」：40 张全回来、「已删减」字样消失、按钮自己收走、存储清空',
  h5.cards === 40 && !/已删减/.test(h5.count) && h5.restoreHidden && h5.stored === 0,
  JSON.stringify(h5));

/* --- I：资料库「加 / 改 / 删」全常显 ---
   v4.3：米线要求删掉「我的资料仓库」左上角那颗「✎ 编辑」按钮 ——
   按钮没了，改/删就必须常显（否则用户再也删不掉自己的资料）。
   先加一条链接，才有卡片可查「改 / 删」是否常显。 */
await v42.evaluate(() => {
  const b = Array.from(document.querySelectorAll('#repo [data-lib]')).find((x) => x.getAttribute('data-lib') === 'link');
  b.click();
});
await wait(400);
await v42.evaluate(() => {
  document.getElementById('mf-title').value = 'I·临时资料';
  document.getElementById('mf-url').value = 'example.com/i';
});
await v42.evaluate(() => document.getElementById('modalOk').click());
await wait(500);
const i1 = await v42.evaluate(() => {
  const vis = (n) => {
    if (!n) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden';
  };
  const card = document.querySelector('#repo .lib-card[data-link]');
  return {
    toggleCount: document.querySelectorAll('#repoEditToggle').length,
    addLink: vis(document.querySelector('#repo [data-lib="link"]')),
    addFile: vis(document.querySelector('#repo [data-lib="pick"]')),
    drop: vis(document.getElementById('libDrop')),
    xVisible: vis(card ? card.querySelector('.lib-x') : null),
    editVisible: vis(card ? card.querySelector('.lib-do [data-act="edit-link"]') : null),
  };
});
check('I01 资源库已无「✎ 编辑」按钮，且「＋ 加链接 / ＋ 加文件 / 拖放区」随时可用',
  i1.toggleCount === 0 && i1.addLink && i1.addFile && i1.drop, JSON.stringify(i1));
check('I02 资料卡「改 / 删」常显（不再收在编辑态里）',
  i1.xVisible && i1.editVisible, JSON.stringify({ x: i1.xVisible, edit: i1.editVisible }));
await shotAt('#repo', 'v4b-repo-add.png');

await v42.close();

/* ==================================================================
   收尾
   ================================================================== */
const emptyErrors = allConsoleErrors.filter((t) => t.startsWith('empty'));
check('Z01 两个页面全程 0 控制台错误 / 0 本地请求失败',
  allConsoleErrors.length === 0, allConsoleErrors.slice(0, 3).join(' | ') || '干净');
check('Z02 空模板页也无控制台错误', emptyErrors.length === 0, emptyErrors.slice(0, 2).join(' | ') || '干净');

await browser.close();
server.close();

const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log('\n================ 上线要件 & 加固验收（v4） ================');
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}`);
  if (!r.ok) console.log(`         ↳ ${r.detail}`);
}
console.log('===========================================================');
console.log(`结果：${pass} 通过 / ${fail} 失败      截图：_build/shots-v4b/`);
console.log('===========================================================');
fs.writeFileSync(path.join(ROOT, '_build', '_v4b_report.json'), JSON.stringify({ pass, fail, results }, null, 2));
process.exit(fail ? 1 : 0);
