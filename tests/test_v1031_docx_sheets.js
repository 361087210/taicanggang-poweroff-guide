/**
 * ============================================================
 * test_v1031_docx_sheets.js — 列目录 docx/sheet 类型漏列测试(P1#1)
 * ============================================================
 * Bug: scripts/sync_web_data.js 的 feishuListFiles 列飞书目录时 URL 写死
 *      `types=folder,file`, 会漏掉飞书原生 `sheet`/`docx`/`bitable` 等类型文件。
 *
 * 期望: 修复后列目录拿全类型(不传 types), docx/sheet 类型文件被正确列出;
 *       下游 feishuFindFile 按 name 精确匹配 + 仅递归 folder, 对新类型安全跳过。
 *
 * 运行: node tests/test_v1031_docx_sheets.js
 * 要求: 先红后绿——修复前漏列(红), 修复后列出 docx/sheet(绿)。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { extractNamedBlock } = require('./e2e_harness');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){ if(cond){ pass++; console.log('  [PASS] ' + name); } else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

const syncJs = src('scripts/sync_web_data.js');

section('静态');
check('sync_web_data.js 列目录 URL 不再传 &types= 过滤', !syncJs.includes('&types='));

section('动态: feishuListFiles 列目录(模拟飞书 types 过滤语义)');
try {
  let capturedUrl = '';
  // 模拟飞书: URL 带 types=folder,file 时只返回 folder+file(漏掉 docx/sheet);
  // 不带 types 时返回全类型。
  async function mockReq(method, url){
    capturedUrl = url;
    if (String(url).includes('types=folder,file')) {
      return { code: 0, data: { files: [
        { name: 'vehicle_sync_data.json', type: 'file' },
        { name: '子目录', type: 'folder' }
      ], next_page_token: '' } };
    }
    return { code: 0, data: { files: [
      { name: 'vehicle_sync_data.json', type: 'file' },
      { name: '子目录', type: 'folder' },
      { name: '说明书.docx', type: 'docx' },
      { name: '清单.sheet', type: 'sheet' }
    ], next_page_token: '' } };
  }
  const sandbox = {
    console, JSON, encodeURIComponent,
    FEISHU_HOST: 'https://open.feishu.cn',
    _req: mockReq,
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(extractNamedBlock(syncJs, 'feishuListFiles'), ctx, { filename: 'feishuListFiles.js' });

  (async () => {
    const files = await vm.runInContext("feishuListFiles('tok', 'fld')", ctx);
    check('列目录 URL 不再带 types=folder,file', !capturedUrl.includes('types=folder,file'), capturedUrl);
    check('docx 类型文件被列出', files.some(f => f.type === 'docx'), JSON.stringify(files.map(f => f.type)));
    check('sheet 类型文件被列出', files.some(f => f.type === 'sheet'), JSON.stringify(files.map(f => f.type)));
    finish();
  })();
} catch (e) {
  check('动态执行异常: ' + e.message, false);
  finish();
}

function finish(){
  console.log('\n==============================================================');
  console.log('docx/sheets 漏列测试汇总: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
  else console.log('全部通过 OK');
}
