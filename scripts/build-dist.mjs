#!/usr/bin/env node
/* ==================================================================
   build-dist.mjs — 组装「发布产物」dist/（空白模板版）
   ------------------------------------------------------------------
   为什么要有这个脚本（而不是把命令写在 workflow 里）：
     发布这件事有两条会互相走偏的路径 —— 「我以为发了什么」和「线上真的收到什么」。
     把组装逻辑收进一个脚本，CI 与本地跑的是**同一条命令**，
     于是「发布前先在本机看一眼产物」才成立。

   它做三件事：
     ① 把源码的 EMPTY_TEMPLATE = false 切成 true（数据层全空：作息 / 模块 / 图纸）
     ② 只拷站点必需文件，**剔除演示资产**
          · assets/dxf/   —— 40 张图纸 + 40 张缩略图（2.8 MB），发布版不随站分发
          · assets/readme/ —— 只给 GitHub README 看的截图（500 KB），站点根本不引用
     ③ 静态门禁：产物缺件、开关没切、图纸混进来、工装目录泄漏 —— 任一命中即非零退出

   注意一个**有意保留的边界**：运行时是空的，但源码里仍留着种子模板的字面量
   （DEFAULT_SLOTS / DEFAULT_TRACKS / REPO_SHAPES）。原因是同一份 main.js 还要供
   本机演示态使用，靠压缩也去不掉。要连字面量一起清，就得拆两份源码 —— 那会牺牲
   「本地/线上只差一个开关」的可维护性。刷得干净不如改得省事，此处刻意不追求前者。

   跑法：node scripts/build-dist.mjs        （产物落在 dist/，已被 .gitignore 忽略）
   ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const no = (m) => { fail++; console.log('  FAIL  ' + m); };

/* 单文件：站点本体 */
const FILES = ['index.html', 'styles.css', 'robots.txt', 'sitemap.xml'];
/* 整目录：字体（本地 Inter + 点阵标题）与 assets（下面按白名单剔除演示资产） */
const DIRS = ['fonts', 'assets'];
/* assets 下不随站分发的子目录（演示内容） */
const DEMO_ASSET_DIRS = ['dxf', 'readme'];
/* 产物里必须存在的文件 —— 少一个就说明拷贝逻辑坏了 */
const REQUIRED = [
  'index.html', 'main.js', 'styles.css', 'robots.txt', 'sitemap.xml',
  'assets/og.png', 'assets/logo.webp', 'assets/icon/icon-256.png',
  'fonts/GeistPixel-Circle.woff2',
];

const walk = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
};
const sizeOf = (dir) => walk(dir).reduce((s, f) => s + fs.statSync(f).size, 0);
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

console.log('\n=== 组装发布产物 dist/ ===\n');

/* 0. 清掉上一次产物（避免「上一版的残留文件」被当成这一版发出去） */
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

/* 1. 切开关：只认源码里那一行，切不到就说明有人改了变量名 —— 直接失败，不要静默发出去 */
console.log('[1] 发布开关 EMPTY_TEMPLATE');
const srcMain = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const hits = srcMain.match(/var EMPTY_TEMPLATE = (true|false);/g) || [];
if (hits.length !== 1) {
  no('源码里 `var EMPTY_TEMPLATE = ...;` 命中 ' + hits.length + ' 处（应恰好 1 处）');
} else {
  ok('源码开关唯一：' + hits[0]);
}
fs.writeFileSync(
  path.join(DIST, 'main.js'),
  srcMain.replace('var EMPTY_TEMPLATE = false;', 'var EMPTY_TEMPLATE = true;'),
  'utf8'
);
const distMain = fs.readFileSync(path.join(DIST, 'main.js'), 'utf8');
distMain.includes('var EMPTY_TEMPLATE = true;') ? ok('产物开关 = true（空白模板）')
  : no('产物开关不是 true');
!distMain.includes('var EMPTY_TEMPLATE = false;') ? ok('产物里没有残留的 false 开关')
  : no('产物里仍有 EMPTY_TEMPLATE = false');

/* 2. 拷贝必需文件 */
console.log('\n[2] 必需文件');
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { no('源码缺文件 ' + f); continue; }
  fs.copyFileSync(src, path.join(DIST, f));
}
ok('已拷贝 ' + FILES.join(' / '));

/* 3. 拷贝目录，并剔除演示资产 */
console.log('\n[3] 目录拷贝 + 剔除演示资产');
const excluded = [];
for (const d of DIRS) {
  const srcDir = path.join(ROOT, d);
  if (!fs.existsSync(srcDir)) { no('源码缺目录 ' + d); continue; }
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (d === 'assets' && DEMO_ASSET_DIRS.includes(e.name)) {
      const size = e.isDirectory()
        ? sizeOf(path.join(srcDir, e.name))
        : fs.statSync(path.join(srcDir, e.name)).size;
      excluded.push({ name: 'assets/' + e.name, size });
      continue;
    }
    fs.cpSync(path.join(srcDir, e.name), path.join(DIST, d, e.name), { recursive: true });
  }
}
for (const e of excluded) ok('已剔除演示资产 ' + e.name + '（' + mb(e.size) + '）');
excluded.length ? null : no('没有剔除任何演示资产 —— 白名单是否失效？');

/* 4. 门禁：产物完整性 */
console.log('\n[4] 门禁 · 产物完整性');
for (const f of REQUIRED) {
  fs.existsSync(path.join(DIST, f)) ? ok('产物含 ' + f) : no('产物缺 ' + f);
}

/* 产物顶层只能出现白名单里的东西 —— 抓「不小心把整个仓库拷进去」这类事故 */
const ALLOWED_TOP = new Set(['index.html', 'main.js', 'styles.css', 'robots.txt', 'sitemap.xml', 'assets', 'fonts']);
const topEntries = fs.readdirSync(DIST);
const stray = topEntries.filter((n) => !ALLOWED_TOP.has(n));
stray.length === 0
  ? ok('产物顶层只有白名单条目（' + topEntries.sort().join(' / ') + '）')
  : no('产物顶层出现多余条目：' + stray.join(' / '));

/* 5. 门禁：演示内容真的没进去 */
console.log('\n[5] 门禁 · 演示内容');
const all = walk(DIST);
const dxfFiles = all.filter((f) => /\.dxf$/i.test(f));
dxfFiles.length === 0 ? ok('产物内 0 个 .dxf 文件') : no('产物内仍有 ' + dxfFiles.length + ' 个 .dxf');

fs.existsSync(path.join(DIST, 'assets', 'dxf'))
  ? no('产物内仍有 assets/dxf 目录') : ok('产物内无 assets/dxf 目录');
fs.existsSync(path.join(DIST, 'assets', 'readme'))
  ? no('产物内仍有 assets/readme 目录') : ok('产物内无 assets/readme 目录');

/* 图纸缩略图的命名规则（D01-LIN.webp 之类）：按文件名模式兜底再查一遍 */
const sheetThumbs = all.filter((f) => /[\\/]D\d{2}-[A-Z]+\.(webp|png)$/i.test(f));
sheetThumbs.length === 0
  ? ok('产物内 0 张图纸缩略图（D??-XXXX.webp）')
  : no('产物内仍有 ' + sheetThumbs.length + ' 张图纸缩略图，例：' + sheetThumbs[0]);

const leaked = all.filter((f) => /[\\/](_build|scripts|outputs|\.github|\.workbuddy)[\\/]/.test(f));
leaked.length === 0 ? ok('产物内无工装 / 记忆 / 交付物目录泄漏') : no('产物泄漏：' + leaked.slice(0, 3).join('，'));

/* 6. 体积报告 */
console.log('\n[6] 体积');
for (const d of fs.readdirSync(DIST)) {
  const p = path.join(DIST, d);
  const size = fs.statSync(p).isDirectory() ? sizeOf(p) : fs.statSync(p).size;
  if (size > 1024) console.log('        ' + d.padEnd(14) + mb(size));
}
console.log('        ' + '合计'.padEnd(12) + mb(sizeOf(DIST)) + '   （' + all.length + ' 个文件）');

console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===');
if (fail) {
  console.error('\n✗ 发布产物未通过门禁，已中断（dist/ 保留供排查）。');
  process.exit(1);
}
console.log('✓ dist/ 就绪，可以压缩与发布。\n');
