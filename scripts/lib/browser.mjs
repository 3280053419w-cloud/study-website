/* ==================================================================
   scripts/lib/browser.mjs —— 浏览器验收的公共入口
   ------------------------------------------------------------------
   为什么要这一层：验收脚本原先写死了本机路径
     · require('C:/Users/32800/.workbuddy/binaries/node/workspace/')
     · executablePath = 'C:/Program Files (x86)/.../msedge.exe'
   于是「真正的浏览器验收」只能在米线这一台机器上跑，CI 里跑不起来 ——
   这正是方案文档 P1-8 留下的缺口。

   这里把两件事都做成可移植的：
     ① puppeteer-core 先找工程内的 scripts/node_modules（CI 用），
        再退回本机 workbuddy 的 node 工作区（米线这台机器用）
     ② 浏览器按「环境变量 → 各平台常见安装路径」依次探测

   注意：项目本体（index.html / styles.css / main.js）依旧零依赖、零构建；
   这里的 puppeteer-core 是**工程侧**的开发依赖，不进发布产物。
   ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, '..');
const PROJECT = path.join(SCRIPTS, '..');

/* puppeteer-core 的候选解析根 */
const REQUIRE_BASES = [
  SCRIPTS,                                                     /* CI：npm i --prefix scripts puppeteer-core */
  PROJECT,
  'C:/Users/32800/.workbuddy/binaries/node/workspace',         /* 米线本机一直这么用 */
];

export function loadPuppeteer() {
  for (const base of REQUIRE_BASES) {
    try {
      const req = createRequire(path.join(base, '__resolve__.js'));
      return req('puppeteer-core');
    } catch (e) { /* 换下一个 */ }
  }
  console.error('\n✗ 找不到 puppeteer-core。');
  console.error('  本机：应已存在于 workbuddy 的 node 工作区；');
  console.error('  CI ：在仓库根跑 `npm install --prefix scripts puppeteer-core` 后再运行本脚本。');
  process.exit(2);
}

/* 浏览器可执行文件的候选路径 */
const BROWSER_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  process.env.EDGE_PATH,
  /* Windows */
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  /* Linux（GitHub Actions ubuntu-latest 自带 google-chrome / msedge） */
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/microsoft-edge',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  /* macOS */
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);

export function findBrowser() {
  for (const p of BROWSER_CANDIDATES) {
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* 换下一个 */ }
  }
  console.error('\n✗ 找不到浏览器可执行文件。已尝试：');
  for (const p of BROWSER_CANDIDATES) console.error('    ' + p);
  console.error('  可用 CHROME_PATH=/path/to/chrome 指定。');
  process.exit(2);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 无头启动的公共参数：CI 容器里要 --no-sandbox，字体/GPU 相关关掉更稳 */
export async function launchBrowser(puppeteer, extra = {}) {
  return puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio'],
    ...extra,
  });
}

export const PROJECT_ROOT = PROJECT;
export const SCRIPTS_DIR = SCRIPTS;
