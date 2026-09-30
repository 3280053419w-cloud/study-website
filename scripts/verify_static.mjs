#!/usr/bin/env node
/* ==================================================================
   verify_static.mjs — 静态不变量校验（无需浏览器，几秒跑完）
   守住这个项目「不该坏」的几条底线：
     1. 站点必需文件存在
     2. index.html 不加载任何外部资源（零外部请求是第一卖点）
     3. styles.css 不 @import / url() 外部资源
     4. main.js 里的每个 http(s) URL 都在白名单内
     5. 发布开关 EMPTY_TEMPLATE 存在且唯一
     6. JSON-LD 是合法 JSON 且类型为 WebApplication
     7. CSP、skip-link、canonical 等上线要件在位
   跑法：node scripts/verify_static.mjs   （CI 里也跑这一条）
   ================================================================== */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const no = (m) => { fail++; console.log('  FAIL  ' + m); };
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* 1. 必需文件 */
console.log('\n[1] 必需文件');
for (const f of ['index.html', 'main.js', 'styles.css', 'robots.txt', 'sitemap.xml', 'assets/og.png']) {
  existsSync(join(ROOT, f)) ? ok(f) : no('缺文件 ' + f);
}

const html = read('index.html');
const css = read('styles.css');
const js = read('main.js');

/* 2. index.html 不加载外部资源（canonical 的 href 不算资源加载） */
console.log('\n[2] index.html 外部资源');
const htmlNoCanon = html.replace(/<link[^>]*rel="canonical"[^>]*>/gi, '');
const extSrc = htmlNoCanon.match(/(?:src|href)\s*=\s*"https?:\/\//gi) || [];
extSrc.length === 0 ? ok('无任何 src/href 指向外部域名') : no('发现 ' + extSrc.length + ' 处外部资源引用：' + extSrc.join(', '));

/* 3. styles.css 无外部 @import / url(http) */
console.log('\n[3] styles.css 外部资源');
const cssExt = css.match(/@import[^;]*https?:|url\(\s*['"]?https?:/gi) || [];
cssExt.length === 0 ? ok('无 @import / url(http) 外部引用') : no('发现外部样式引用：' + cssExt.join(', '));

/* 4. main.js 里的 http(s) URL 必须在白名单内
      —— 白名单＝「内容外链」（学习者资源）＋「BYOK 直连的官方 API」＋ SVG 命名空间（非网络请求） */
console.log('\n[4] main.js 外部 URL 白名单');
const ALLOWED_HOSTS = new Set([
  'api.deepseek.com',                                   // AI 助手：仅用户填 Key 并主动发问时才连
  'liaoxuefeng.com', 'docs.python.org', 'zh.d2l.ai',    // 学习资源纯文本外链（不随页面加载）
  'www.kaggle.com', 'kaggle.com',
  'www.w3.org'                                          // SVG/XML 命名空间，不是网络请求
]);
const urls = js.match(/https?:\/\/[^\s'"`)<>]+/gi) || [];
const offenders = [];
for (const u of urls) {
  let host;
  try { host = new URL(u).hostname; } catch { continue; }   // 形如 https://... 的占位串跳过
  if (host && host !== '...' && !ALLOWED_HOSTS.has(host)) offenders.push(host + '  ← ' + u);
}
offenders.length === 0 ? ok('全部 URL 在白名单内（' + urls.length + ' 处扫描）')
                       : no('白名单外的外部域名：\n        ' + offenders.join('\n        '));

/* 5. EMPTY_TEMPLATE 发布开关 */
console.log('\n[5] 发布开关 EMPTY_TEMPLATE');
const flag = js.match(/var EMPTY_TEMPLATE = (true|false);/g) || [];
flag.length === 1 ? ok('存在且唯一：' + flag[0]) : no('出现 ' + flag.length + ' 次（应为 1 次）：' + flag.join(' | '));

/* 6. JSON-LD */
console.log('\n[6] JSON-LD 结构化数据');
const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
if (!ld) no('找不到 JSON-LD 块');
else {
  try {
    const o = JSON.parse(ld[1]);
    o['@type'] === 'WebApplication' ? ok('合法 JSON，类型 = ' + o['@type'] + '，名称 = ' + o.name)
                                    : no('@type 不是 WebApplication：' + o['@type']);
  } catch (e) { no('JSON-LD 不是合法 JSON：' + e.message); }
}

/* 7. 上线要件在位 */
console.log('\n[7] 上线要件');
const checks = [
  ['CSP 已声明', /http-equiv="Content-Security-Policy"/.test(html)],
  ['canonical 已声明', /rel="canonical"/.test(html)],
  ['og:image 已声明', /property="og:image"/.test(html)],
  ['twitter:card 已声明', /name="twitter:card"/.test(html)],
  ['skip-link 已添加', /class="skip-link"/.test(html)],
  ['<main> 可聚焦锚点', /id="main" tabindex="-1"/.test(html)],
  ['lang=zh-CN', /<html lang="zh-CN"/.test(html)],
  ['viewport-fit=cover', /viewport-fit=cover/.test(html)]
];
for (const [name, cond] of checks) cond ? ok(name) : no(name);

/* 8. 图纸预览格式（P2-1）
      预览图从 PNG 换成了**无损** WebP：40 张从 924.1 KB 降到 356.7 KB（省 61.4%，
      逐像素比对可见差异 0 px）。旧的 .png 若被加回来，发布体积会白撑一倍，这里守住。 */
console.log('\n[8] 图纸预览格式');
const dxfDir = join(ROOT, 'assets', 'dxf');
const dxfFiles = existsSync(dxfDir) ? readdirSync(dxfDir) : [];
const webpN = dxfFiles.filter((f) => /\.webp$/i.test(f)).length;
const pngN = dxfFiles.filter((f) => /\.png$/i.test(f)).length;
if (webpN + pngN === 0) {
  console.log('  SKIP  没有预览图（空白模板分支）');
} else {
  webpN > 0 && pngN === 0
    ? ok('预览图全部是无损 WebP（' + webpN + ' 张，0 张 PNG）')
    : no('预览格式混杂：webp ' + webpN + ' 张 / png ' + pngN + ' 张');
  const pngRefs = js.match(/assets\/dxf\/[^'"`\s]*\.png/g) || [];
  pngRefs.length === 0
    ? ok('main.js 里没有指向 .png 预览的引用')
    : no('main.js 仍有 .png 预览引用：' + pngRefs.join(', '));
}

console.log('\n========================================');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log('========================================');
process.exit(fail ? 1 : 0);
