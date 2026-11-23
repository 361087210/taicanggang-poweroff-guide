#!/usr/bin/env node
/**
 * ===========================================================
 * scripts/build_tailwind_css.js —— 预编译 Tailwind 产物
 * ===========================================================
 * 为什么要预编译: vendor/tailwind.js 是 Play CDN(运行时 JIT, 441KB), 官方明确不可用于生产;
 *   它要在浏览器里扫描 DOM 再生成 CSS —— 首屏白等 441KB + 运行时开销。
 *   V10.26.2 起改为静态 css/tailwind.build.css(约 25KB / gzip 5KB)。
 *
 * 扫描范围: demo.html + js/**.js —— **模板字符串里的类名也会被收集**
 *   (类名大量写在 JS 模板里, 只扫 html 会大面积缺样式)。
 * 用法: npm run build:tailwind
 *   依赖: 本机需能取到 tailwindcss@3.4.17(npx / pnpm dlx 任一)。
 * 注意: 新增模板类名后必须重跑, 否则 tests/test_v10261_tailwind_static.js 的
 *   "类名覆盖率"断言会红（这是刻意设计的门禁, 别绕过）。
 * =========================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'css', 'tailwind.build.css');
const VERSION = 'tailwindcss@3.4.17';

const header = `/* ===========================================================
 * css/tailwind.build.css — 预编译 Tailwind 产物（V10.26.2）
 * -----------------------------------------------------------
 * 为什么: 此前用 vendor/tailwind.js(441KB, Play CDN 运行时 JIT) —— 它要在浏览器里
 *   扫描 DOM 再生成 CSS, 首屏白等 441KB 且带来运行时开销; 官方也警告不可用于生产。
 * 怎么生成: npm run build:tailwind（scripts/build_tailwind_css.js，内部用 npx ${VERSION}
 *   扫描 demo.html + js/**\/*.js，即"所有模板字符串里的类名"都会被收集）
 * 校验: tests/test_v10261_tailwind_static.js 断言产物存在、体积上限、关键类齐全,
 *   并禁止 demo.html 再把运行时 tailwind 引回首屏。
 * 注意: 新增了模板里的类名后必须重新生成, 否则样式会缺失（测试会红）。
 * =========================================================== */
`;

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ cwd: ROOT, stdio: 'inherit' }, opts || {}));
  return r.status === 0;
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-build-'));
  const inCss = path.join(tmp, 'in.css');
  const cfg = path.join(tmp, 'tailwind.config.js');
  fs.writeFileSync(inCss, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
  fs.writeFileSync(cfg, `module.exports = {
  content: [${JSON.stringify(path.join(ROOT, 'demo.html'))}, ${JSON.stringify(path.join(ROOT, 'js/**/*.js'))}, ${JSON.stringify(path.join(ROOT, 'index.html'))}],
  theme: { extend: {} },
  plugins: []
};\n`);

  const args = ['-c', cfg, '-i', inCss, '-o', OUT, '--minify'];
  const local = path.join(ROOT, 'node_modules', '.bin', 'tailwindcss');
  let ok = false;
  if (fs.existsSync(local)) ok = run(local, args);
  if (!ok) ok = run('npx', ['--yes', VERSION].concat(args));
  if (!ok) ok = run('pnpm', ['dlx', VERSION].concat(args));
  if (!ok) {
    console.error('[build:tailwind] 无法运行 tailwindcss。请在能联网的环境执行: npx --yes ' + VERSION + ' -c <config> -i <in.css> -o css/tailwind.build.css --minify');
    process.exit(1);
  }
  const css = fs.readFileSync(OUT, 'utf8');
  fs.writeFileSync(OUT, header + css);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('[build:tailwind] 已生成 css/tailwind.build.css: ' + fs.statSync(OUT).size + ' bytes');
}

main();
