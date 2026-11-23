/**
 * ============================================================
 * test_v10260_lazy_export.js — 导出组件按需加载回归 (V10.26.0)
 * ============================================================
 * 背景: xlsx/jsPDF/autotable/html-docx/html2canvas 合计约 1.8MB, 此前写在
 *   demo.html <head> 且**没有 defer**, 首屏为"偶尔用到的导出"白等下载 ——
 *   模拟 4G 实测 FCP 6.9s。改为首次导出时由 ensureExportLibs() 注入后, FCP 3.6s。
 *
 * 本套件钉住:
 *   E1 首屏不再引这 5 个库(tailwind/cordova 必须仍在, 否则界面/原生桥失效)
 *   E2 装载器存在且覆盖 5 个路径, 幂等(重复调用不重复下载)
 *   E3 两个导出入口在"库判空"之前 await 装载器 —— 否则又会提示"库加载失败"
 *   E4 vendor 文件真实存在且非空; sw.js 仍预缓存(离线导出能力不退化)
 *
 * 运行: node tests/test_v10260_lazy_export.js
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
const exp = src('js/04-export.js');
const sw = src('sw.js');

const LAZY = ['vendor/xlsx.full.min.js', 'vendor/jspdf.umd.min.js',
  'vendor/jspdf.plugin.autotable.min.js', 'vendor/html-docx.js', 'vendor/html2canvas.min.js'];

section('E1 首屏不再引导出库, 但样式/原生桥仍在');
LAZY.forEach(f => {
  const tag = '<script src="' + f + '"></script>';
  check('E1 ' + f.split('/').pop() + ' 已移出 <head>', demo.indexOf(tag) < 0);
});
check('E1 tailwind 仍在 head(样式必需)', demo.indexOf('<script src="vendor/tailwind.js"></script>') > 0);
check('E1 cordova.js 仍在(Cordova 桥必需)', demo.indexOf('<script src="cordova.js"></script>') > 0);

section('E2 装载器: 覆盖 5 个路径 + 幂等');
check('E2a 定义 ensureExportLibs', /function ensureExportLibs\s*\(/.test(exp));
check('E2b 导出为全局(供 onclick 链路 await)', /window\.__exportLibsLoading|_exportLibsReady/.test(exp));
LAZY.forEach(f => check('E2 ' + f.split('/').pop() + ' 在 EXPORT_VENDORS 内', exp.indexOf("'" + f + "'") >= 0));
check('E2f 按 src 去重(不会重复注脚本)', /_vendorLoading\[src\]/.test(exp));
check('E2g 注入失败不抛给调用方(保留降级路径)', /catch\(e\)[\s\S]{0,200}return false/.test(exp) || /catch\{[\s\S]{0,200}return false/.test(exp));
check('E2h 使用 async 注入(不阻塞主线程)', /s\.async\s*=\s*true/.test(exp));

section('E3 两个导出入口必须先 await 装载器');
const e3 = [
  ['exportData', /async function exportData\(format\)\{/],
  ['exportSingle', /async function exportSingle\(format\)\{/]
];
e3.forEach(([name, re]) => {
  const m = exp.match(re);
  check('E3a ' + name + ' 仍为 async', !!m);
  if (!m) return;
  const body = exp.slice(m.index, m.index + 1400);
  const iLoad = body.indexOf('ensureExportLibs');
  const iCheck = body.indexOf('!window.XLSX');
  check('E3b ' + name + ' 内 await ensureExportLibs', iLoad >= 0);
  check('E3c ' + name + ' 装载在库判空之前(否则误报加载失败)', iLoad >= 0 && iCheck > iLoad, 'load@' + iLoad + ' check@' + iCheck);
});

section('E4 vendor 实体仍在 + 离线导出未被削弱');
LAZY.forEach(f => {
  const p = path.join(ROOT, f);
  const ok = fs.existsSync(p) && fs.statSync(p).size > 1024;
  check('E4 ' + f.split('/').pop() + ' 实体存在且非空', ok);
});
LAZY.forEach(f => check('E4 ' + f.split('/').pop() + ' 仍在 sw.js 预缓存(离线可用)', sw.indexOf("'./" + f + "'") >= 0));

console.log('\n==============================================================');
console.log('导出组件按需加载回归汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
