/**
 * ============================================================
 * test_v1028_export_photo.js — 单车导出照片内嵌(App 端 file:// 读取)测试
 * ============================================================
 * Bug: js/04-export.js fetchPhotoDataURL(path) 源①用 fetch(path) 读本地照片。
 *      Cordova App 的 www 是 file:///android_asset/www/, 浏览器 Fetch API 对
 *      file:// 协议被 CORS/安全策略拦截 → 源①必失败 → 只剩飞书源②(依赖 Secret/
 *      列目录/网络/20s 超时) → 任一环断即无图(用户报"单车导出未内嵌照片")。
 *
 * 期望: cordova 环境下源①改走 resolveLocalFileSystemURL + FileReader.readAsDataURL
 *       读取打包进 www/vehicle_images/ 的本地照片(返回 dataURL 供文档内嵌);
 *       网页端(非 cordova)仍走同源 fetch(不变); 现拍 data:image base64 直接内嵌不变。
 *
 * 运行: node tests/test_v1028_export_photo.js
 * 要求: 先红后绿——修复前 cordova 分支照片命中=0(红), 修复后走 FileReader 命中>0(绿)。
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

const exportJs = src('js/04-export.js');

/** 构造 cordova 沙箱: fetch(file://)被阻断, resolveLocalFileSystemURL+FileReader 可用 */
function makeCtx(){
  const calls = { fetch: 0, resolve: 0 };
  let resolveImpl;
  class MockFileReader {
    readAsDataURL(file){
      const self = this;
      setTimeout(() => { self.result = 'data:image/jpeg;base64,QUJD'; if (self.onloadend) self.onloadend(); }, 0);
    }
  }
  const sandbox = {
    console,
    fetch: async () => { calls.fetch++; throw new Error('file:// fetch blocked by CORS'); },
    fetchFeishuPhotoDataURL: async () => null,       // 云端兜底不可用(无 Secret)
    blobToDataURL: async () => 'data:image/jpeg;base64,QUJD',
    _exportPhotoCache: {},
    FileReader: MockFileReader,
    setTimeout, clearTimeout,
    window: {
      cordova: { platformId: 'android', file: { applicationDirectory: 'file:///android_asset/' } },
      resolveLocalFileSystemURL: (url, ok, fail) => {
        calls.resolve++;
        if (String(url).indexOf('/www/vehicle_images/') >= 0) {
          ok({ file: (cb, errcb) => cb({ name: 'image1.jpeg', size: 12345 }) });
        } else {
          fail && fail(new Error('not found'));
        }
      }
    },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(extractNamedBlock(exportJs, 'fetchPhotoDataURL'), ctx, { filename: 'fetchPhotoDataURL.js' });
  return { ctx, calls, sandbox };
}

(async () => {
  /* ---------- 动态: cordova 环境照片命中 ---------- */
  section('动态: cordova 环境源①走 FileReader(非 fetch)');
  {
    const { ctx, calls } = makeCtx();
    let dataUrl = null, err = null;
    try { dataUrl = await vm.runInContext('fetchPhotoDataURL("vehicle_images/image1.jpeg")', ctx); }
    catch (e) { err = e; }
    check('cordova 环境照片命中(data:image dataURL)', typeof dataUrl === 'string' && /^data:image/.test(dataUrl), String(dataUrl));
    check('走 resolveLocalFileSystemURL/FileReader 分支(非 fetch)', calls.resolve >= 1 && calls.fetch === 0, JSON.stringify(calls));
  }

  /* ---------- 动态: 网页端(非 cordova)仍走 fetch ---------- */
  section('动态: 网页端(非 cordova)仍走同源 fetch');
  {
    const exportJs2 = exportJs;
    let fetchCalls = 0;
    const sandbox = {
      console,
      fetch: async () => { fetchCalls++; return { ok: true, blob: async () => ({ size: 999 }) }; },
      fetchFeishuPhotoDataURL: async () => null,
      blobToDataURL: async () => 'data:image/jpeg;base64,QUJD',
      _exportPhotoCache: {},
      window: {},   // 无 cordova
    };
    sandbox.globalThis = sandbox;
    const ctx = vm.createContext(sandbox);
    vm.runInContext(extractNamedBlock(exportJs2, 'fetchPhotoDataURL'), ctx, { filename: 'fetchPhotoDataURL.js' });
    const dataUrl = await vm.runInContext('fetchPhotoDataURL("vehicle_images/image1.jpeg")', ctx);
    check('网页端照片命中(走 fetch)', /^data:image/.test(String(dataUrl)), String(dataUrl));
    check('网页端确实走了 fetch(未被改坏)', fetchCalls >= 1, fetchCalls);
  }

  /* ---------- 静态: 现拍 data:image 分支不变 + cordova 分支存在 ---------- */
  section('静态: data:image 分支 + cordova 分支');
  check('现拍 data:image base64 直接内嵌分支保留', exportJs.includes('data:image') && exportJs.includes('return path'));
  check('源①含 cordova resolveLocalFileSystemURL 分支', /resolveLocalFileSystemURL/.test(exportJs) && /readAsDataURL/.test(exportJs));

  console.log('\n==============================================================');
  console.log('导出照片内嵌测试汇总: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
  else console.log('全部通过 OK');
})();
