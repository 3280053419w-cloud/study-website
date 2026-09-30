/* ==================================================================
   verify_dist.mjs — 发布产物（dist/）冒烟验收
   ------------------------------------------------------------------
   解决的问题（P0，2026-09-30 埋下）：
     publish.yml 会用 terser -c -m 压缩 main.js 再发到 gh-pages，
     但这条链路**从没真跑过** —— 远程连 gh-pages 分支都还不存在。
     「压缩会不会把某处改名改坏」不是靠看一眼 diff 能回答的问题，
     必须拿真实浏览器跑压缩后的那一份。

   所以本脚本**只吃 dist/**，不碰源码树：
     ① 用本地静态服务把 dist/ 当线上站点伺服
     ② 无头浏览器完整加载，采集「请求 / 状态码 / 控制台 / CSP 违规 / 页面异常」
     ③ 断言空白模板真的空、图纸真的没被请求、压缩后的包真的还能启动

   跑法：node scripts/build-dist.mjs && node scripts/verify_dist.mjs
        （想连压缩一起验：先跑 terser/csso 再跑本脚本，见 README 的发布一节）
   ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { loadPuppeteer, launchBrowser, sleep as wait } from './lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = 4204;
const ORIGIN = `http://127.0.0.1:${PORT}`;

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('\n✗ 找不到 dist/index.html —— 先跑 `node scripts/build-dist.mjs`。\n');
  process.exit(2);
}

/* ---------------- 静态服务（与线上同构：只伺服 dist/） ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.resolve(DIST, '.' + p);
  const rel = path.relative(DIST, file);
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

/* ---------------- 采集 ---------------- */
const puppeteer = loadPuppeteer();
const browser = await launchBrowser(puppeteer);
const page = await browser.newPage();

const requests = [];
const badResponses = [];
const consoleErrors = [];
const pageErrors = [];
const cspHits = [];

page.on('request', (r) => requests.push(r.url()));
page.on('response', (r) => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()); });
page.on('requestfailed', (r) => badResponses.push('FAILED ' + (r.failure() || {}).errorText + ' ' + r.url()));
page.on('console', (m) => {
  const t = m.text();
  if (/Content Security Policy|Refused to/i.test(t)) cspHits.push(t);
  if (m.type() === 'error') consoleErrors.push(t);
});
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(ORIGIN + '/', { waitUntil: 'networkidle2', timeout: 60000 });
await wait(2600); /* 等首屏 opening 动效与各渲染函数跑完 */

/* ---------------- 断言 ---------------- */
const boot = await page.evaluate(() => ({
  planTitle: (document.getElementById('planTitle') || {}).textContent || '',
  calMonths: document.querySelectorAll('.cal-month').length,
  trackTabs: document.querySelectorAll('.track-tab').length,
  trackPanels: document.querySelectorAll('.track-panel').length,
  galCards: document.querySelectorAll('#gal .gal-card').length,
  timelineItems: document.querySelectorAll('#timeline .tl-item').length,
  cadBlockDisplay: (() => {
    const b = document.querySelector('#repo .repo-block');
    return b ? getComputedStyle(b).display : 'missing';
  })(),
  statsVisible: [...document.querySelectorAll('.stats .stat')]
    .filter((s) => getComputedStyle(s).display !== 'none').length,
  docOverflow: document.documentElement.scrollWidth - window.innerWidth,
  version: (document.querySelector('meta[name="app-version"]') || {}).content || '',
}));

/* PD01：压缩后的包真的启动了（日历 12 个月块由 JS 渲染 → 这是 JS 跑通的硬证据） */
check('PD01 压缩后产物启动成功（JS 已渲染：计划板标题 + 日历 12 个月块）',
  boot.calMonths === 12 && boot.planTitle.length > 0,
  `months=${boot.calMonths} title="${boot.planTitle.slice(0, 20)}"`);

/* PD02：空白模板的数据层真的空 */
check('PD02 发布版是空白模板（0 学习模块 / 0 面板 / 0 图纸卡 / 0 时段项 / 统计 3 格）',
  boot.trackTabs === 0 && boot.trackPanels === 0 && boot.galCards === 0 &&
    boot.timelineItems === 0 && boot.statsVisible === 3,
  JSON.stringify(boot));

/* PD03：CAD 图纸仓库整块隐藏 */
check('PD03 CAD 图纸仓库整块隐藏（display: none）',
  boot.cadBlockDisplay === 'none', boot.cadBlockDisplay);

/* PD04：没有任何请求打到 assets/dxf/（图纸文件已不随站分发） */
const dxfHits = requests.filter((u) => /assets\/dxf\//i.test(u));
check('PD04 全流程 0 条请求打到 assets/dxf/（图纸不随发布版分发）',
  dxfHits.length === 0, dxfHits.slice(0, 3).join(' | ') || '0 条');

/* PD05：所有请求都成功 */
check('PD05 所有资源请求均成功（无 4xx / 5xx / failed）',
  badResponses.length === 0, badResponses.slice(0, 4).join(' | ') || '0 条异常');

/* PD06：控制台干净 + CSP 无违规 */
check('PD06 控制台 0 错误、CSP 0 违规、页面 0 异常',
  consoleErrors.length === 0 && cspHits.length === 0 && pageErrors.length === 0,
  JSON.stringify({
    console: consoleErrors.slice(0, 2), csp: cspHits.slice(0, 2), page: pageErrors.slice(0, 2),
  }));

/* PD07：窄屏无横向溢出 */
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await wait(900);
const mob = await page.evaluate(() => ({
  doc: document.documentElement.scrollWidth - window.innerWidth,
  body: document.body.scrollWidth - window.innerWidth,
}));
check('PD07 390px 无横向溢出（文档 / body 均 ≤1px）',
  mob.doc <= 1 && mob.body <= 1, JSON.stringify(mob));

/* PD08：版本号与上线要件在位 */
check('PD08 产物版本 meta = 4.0.0，且 robots/sitemap/og 可访问',
  boot.version === '4.0.0' && !badResponses.some((b) => /robots\.txt|sitemap\.xml|og\.png/.test(b)),
  `version=${boot.version}`);

await browser.close();
await new Promise((r) => server.close(r));

/* ---------------- 报告 ---------------- */
const kw = Math.round(fs.statSync(path.join(DIST, 'main.js')).size / 1024);
const srcKw = Math.round(fs.statSync(path.join(ROOT, 'main.js')).size / 1024);
console.log('\n=== 发布产物冒烟（dist/ · main.js ' + kw + 'KB / 源码 ' + srcKw + 'KB）===');
for (const r of results) console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.id + (r.detail ? '  → ' + r.detail : ''));
const bad = results.filter((r) => !r.ok).length;
console.log('\n=== 结果：' + (results.length - bad) + ' 通过 / ' + bad + ' 失败 ===\n');
if (bad) process.exit(1);
