/**
 * ============================================================
 * test_v10261_tailwind_static.js — Tailwind 预编译（静态 CSS）回归
 * ============================================================
 * 背景: 此前用 vendor/tailwind.js（Play CDN 运行时 JIT，441KB，官方明确不可用于生产），
 *   它要在浏览器里扫描 DOM 再生成 CSS。V10.26.2 改为 css/tailwind.build.css（约 25KB）：
 *   首屏少下载 441KB JS，也去掉运行时扫描开销。
 *
 * 风险与防线（本套件就是防线）:
 *   类名大量写在 js/ 的模板字符串里 —— 预编译必须扫 js/**\/*.js；一旦有人加了新类却
 *   忘了重新生成 CSS，页面上就会"局部没样式"，而这种缺失肉眼极难发现。
 *   因此这里做**类名覆盖率**断言：从所有 class="…" / className='…' 里抽出候选类名，
 *   逐个检查是否出现在产物中（自定义类除外，它们定义在 css/app.css）。
 *
 *   T1 首屏不再有运行时 tailwind（script），改为本地 <link> 且存在
 *   T2 产物体积在合理区间（防止误提交未压缩/全量版本）
 *   T3 关键类齐全（抽查核心布局/颜色/字号工具类）
 *   T4 类名覆盖率：模板里用到的工具类必须 100% 出现在产物中（缺一个就红）
 *   T5 SW 预缓存产物（离线首屏样式不丢）
 *   T6 发版工作流不再要求 vendor/tailwind.js（否则打包会缺文件硬拦截）
 *
 * 运行: node tests/test_v10261_tailwind_static.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

const demo = src('demo.html');
const sw = src('sw.js');
const cssPath = path.join(ROOT, 'css/tailwind.build.css');
const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';

section('T1 首屏样式来源');
check('T1a 已用预编译 CSS 的 <link>', demo.indexOf('<link rel="stylesheet" href="css/tailwind.build.css">') > 0);
check('T1b 不再加载运行时 tailwind.js', demo.indexOf('vendor/tailwind.js') < 0);
check('T1c 产物文件存在且非空', css.length > 5000, css.length + ' bytes');

section('T2 产物体积');
const kb = Math.round(css.length / 1024);
check('T2a 体积在 15–120KB（预编译量级）', kb >= 15 && kb <= 120, kb + ' KB');
check('T2b 是压缩产物（无大量换行）', css.split('\n').length < 400, css.split('\n').length + ' 行');

section('T3 关键类抽查');
['.flex', '.hidden', '.rounded-2xl', '.bg-white', '.text-gray-400', '.text-xs', '.shadow-sm', '.truncate', '.sticky']
  .forEach(sel => check('T3 产物含 ' + sel, css.indexOf(sel + '{') >= 0 || css.indexOf(sel + ',') >= 0 || css.indexOf(sel + ' ') >= 0 || css.indexOf(sel + ':') >= 0));

/* ---------------- T4 类名覆盖率 ---------------- */
section('T4 类名覆盖率（模板里用到的工具类必须全部在产物中）');

/* 从 class="..." / className='...' / classList.add('...') 抽取候选 token */
function extractTokens(text) {
  const out = new Set();
  const re = /(?:class\s*=\s*["'`]|className\s*=\s*["'`]|classList\.(?:add|remove|toggle)\(\s*["'`])([^"'`]*)/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1];
    if (raw.indexOf('${') >= 0) continue;              // 动态拼接跳过（其取值文本本身会被扫到）
    raw.split(/\s+/).forEach(tok => {
      tok = tok.trim();
      if (!tok) return;
      if (/^[a-z0-9-]+$/i.test(tok) || /^[a-z0-9-]+:[a-z0-9-]+$/i.test(tok) || /^[a-z0-9-]+\/[0-9]+$/.test(tok)) out.add(tok);
    });
  }
  return out;
}

const files = ['demo.html'].concat(fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f));
const allTokens = new Set();
files.forEach(f => { if (fs.existsSync(path.join(ROOT, f))) extractTokens(src(f)).forEach(t => allTokens.add(t)); });

/* 自定义类（非 Tailwind 产物）: 定义在 css/app.css 里, 不算缺失 */
const appCss = fs.existsSync(path.join(ROOT, 'css/app.css')) ? fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8') : '';
const isCustom = (tok) => appCss.indexOf('.' + tok.replace(/[:/]/g, '\\$&')) >= 0 || new RegExp('\\.' + tok.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + '\\b').test(appCss);

/* 只检查看起来像 Tailwind 工具类的 token（避免把 bs-item/nav-tab 之类误判） */
const UTIL = /^(?:-?(?:m|p)[trblxy]?-|w-|h-|max-w-|min-h-|max-h-|min-w-|bg-|text-|border|rounded|flex|grid|gap-|items-|justify-|self-|place-|space-|overflow|z-|top-|bottom-|left-|right-|inset|shadow|opacity-|font-|leading-|tracking-|whitespace-|truncate|absolute|relative|fixed|sticky|inline|block|hidden|visible|ring-|divide-|col-|row-|order-|aspect-|object-|cursor-|select-|transition|duration-|ease-|animate-|rotate-|scale-|translate-|pointer-events-|resize|align-|break-|list-|underline|line-clamp-|decoration-|shrink|grow|basis-|sr-only|backdrop-|content-|appearance-|outline-)/;
const utilTokens = Array.from(allTokens).filter(t => UTIL.test(t) && !isCustom(t));
const missing = utilTokens.filter(t => {
  const sel = '.' + t.replace(/([:/])/g, '\\$1');
  return css.indexOf(sel) < 0;
});
check('T4a 共扫描到工具类 token ≥ 150 个', utilTokens.length >= 150, utilTokens.length + ' 个');
check('T4b 覆盖率 100%（缺类即红，需重跑 npm run build:tailwind）', missing.length === 0,
  '缺失 ' + missing.length + ' 个: ' + missing.slice(0, 15).join(', '));

section('T5 离线可用');
check('T5 sw.js 预缓存 css/tailwind.build.css', sw.indexOf("'./css/tailwind.build.css'") >= 0);
check('T5b sw.js 不再预缓存 vendor/tailwind.js', sw.indexOf("'./vendor/tailwind.js'") < 0);

section('T6 发版工作流不再依赖 vendor/tailwind.js');
['.github/workflows/android-release.yml', '.github/workflows/ios-release.yml'].forEach(wf => {
  const t = src(wf);
  check('T6 ' + path.basename(wf) + ' 的 vendor 校验不含 tailwind.js',
    t.indexOf('for f in tailwind.js') < 0);
});

console.log('\n==============================================================');
console.log('Tailwind 预编译回归汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
