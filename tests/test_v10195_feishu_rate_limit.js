/**
 * ============================================================
 * test_v10195_feishu_rate_limit.js — 飞书API限流(99991400)治理专项测试
 * ============================================================
 * 背景: App 从飞书云端加载图片/视频触发限流错误 99991400
 *       "request trigger frequency limit"。根因:
 *       ① 06-media.js 图片/视频下载走裸 sendRequest/fetch, 完全绕过
 *          httpFetch 的门控与退避, 突发并发直接撞飞书QPS限流;
 *       ② feishuListFiles 无缓存, 图片加载反复列目录放大QPS;
 *       ③ httpFetch 对限流响应无重试。
 *
 * V10.19.5 治理:
 *  ① feishuDownloadFile 统一门控下载(150ms最小间隔+并发上限3+指数退避重试3次)
 *  ② feishuListFiles 目录列表 30s 缓存
 *  ③ httpFetch 对限流码 99991400~99991404 退避重试(仅幂等 GET/HEAD)
 *
 * 设计原则(避免"纸上通过"):
 *  1. 动态用例从 demo.html+js/*.js 提取**真实函数**注入 vm 沙箱(与 e2e_harness
 *     同源), 桩掉 _httpSendOnce/fetch 模拟限流响应, 断言重试次数/并发上限/间隔。
 *  2. 静态用例断言"图片/视频下载路径确实改走 feishuDownloadFile",
 *     防未来回退成裸请求(那是本次限流根因)。
 *
 * 运行: node tests/test_v10195_feishu_rate_limit.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { loadCombinedSource, extractNamedBlock } = require('./e2e_harness');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){ if(cond){ pass++; console.log('  [PASS] ' + name); } else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

/* ---------------- 静态断言(源码级) ---------------- */
section('S 静态: 频控层与下载路径接线');
const boot = src('js/00-bootstrap.js');
const media = src('js/06-media.js');

check('S1 限流码表覆盖 99991400~99991404', /_FEISHU_RATE_LIMIT_CODES\s*=\s*\{99991400:1,99991401:1,99991402:1,99991403:1,99991404:1\}/.test(boot));
check('S2 门控函数齐备(feishuGateEnter/Exit/_feishuBackoff)',
  boot.includes('async function feishuGateEnter') && boot.includes('function feishuGateExit') && boot.includes('function _feishuBackoff'));
check('S3 httpFetch 声明重试预算(仅幂等GET/HEAD重试)',
  boot.includes('const maxAttempts=retryable?3:1') && boot.includes('99991400') && boot.includes('retryable'));
check('S4 feishuDownloadFile 统一下载入口存在', boot.includes('async function feishuDownloadFile'));
check('S5 图片下载改走 feishuDownloadFile(_fetchFeishuImageBlobUrl)',
  media.includes("feishuDownloadFile(`https://open.feishu.cn/open-apis/drive/v1/files/${target.token}/download`,token,'image/jpeg',60)"));
check('S6 视频下载改走 feishuDownloadFile(downloadBlob)',
  media.includes("feishuDownloadFile(`https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}/download`,token,'video/mp4',120)"));
check('S7 06-media.js 无残留裸下载(sendRequest/裸fetch download 端点)', !/plugin\.http\.sendRequest/.test(media) && !/await fetch\(`https:\/\/open\.feishu\.cn\/open-apis\/drive\/v1\/files\/\$\{/.test(media));
check('S8 feishuListFiles 接入 30s 列表缓存', boot.includes('_feishuListCache[cacheKey]') && boot.includes('Date.now()-cached.at<30000'));

/* ---------------- 动态断言(vm 沙箱, 真实函数) ----------------
 * 注: 全部动态用例放入 async main() —— 顶层 await 会被 Node 22 的模块语法
 *     检测误判为 ESM(require 不可用直接崩), 故统一在函数体内 await。 */
(async function main(){
section('D 动态: 门控/退避/缓存(桩掉网络层)');
const combined = loadCombinedSource();
const sandbox = {
  console: { log(){}, warn(){}, error(){} },
  setTimeout, clearTimeout, AbortController, Date, Math, JSON, Promise
};
sandbox.window = {};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
/** 在沙箱中定义全局标识(供后续提取的函数引用) */
function defGlobal(name, code){ vm.runInContext('globalThis.' + name + '=' + code + ';', ctx); }

try {
  // 提取真实常量与门控函数(与生产同源, 不手写拷贝)
  for (const n of ['_FEISHU_RATE_LIMIT_CODES', '_feishuGate', '_feishuListCache', 'feishuGateEnter', 'feishuGateExit', '_feishuBackoff', 'asBlob']) {
    vm.runInContext(extractNamedBlock(combined, n), ctx, { filename: n + '.js' });
  }
} catch (e) {
  check('常量/门控函数提取', false, e.message);
}

/** 提取并注入指定函数 */
function inject(n){ vm.runInContext(extractNamedBlock(combined, n), ctx, { filename: n + '.js' }); }
/** 同步返回的沙箱表达式求值 */
function evalSync(expr){ return vm.runInContext(expr, ctx); }
/** 异步求值: 沙箱内 await 表达式(外层包 async IIFE) */
async function evalAsync(expr){
  return vm.runInContext('(async function(){ return ' + expr + '; })()', ctx);
}

/* ---- D1 并发上限: 6 个并行飞书GET, 实际并发必须 ≤3 ---- */
section('D1 门控并发上限(≤3)');
try {
  let inflight = 0, maxInflight = 0, calls = 0;
  sandbox._httpSendOnce = async function(){
    calls++; inflight++; maxInflight = Math.max(maxInflight, inflight);
    await new Promise(r => setTimeout(r, 30));
    inflight--;
    return { code: 0, data: { files: [] } };
  };
  inject('httpFetch');
  await Promise.all(Array.from({ length: 6 }, () => evalAsync(
    "httpFetch('https://open.feishu.cn/open-apis/drive/v1/files?folder_token=x&page_size=200',{headers:{Authorization:'Bearer t'}})")));
  check('D1a 最大并发 ≤ 3', maxInflight <= 3, 'max=' + maxInflight);
  check('D1b 6 个请求全部完成', calls === 6, 'calls=' + calls);
} catch (e) { check('D1 动态执行异常', false, e.message); }

/* ---- D2 最小间隔: 5 次顺序请求总耗时 ≥ 4×150ms ---- */
section('D2 门控最小间隔(≥150ms)');
try {
  sandbox._httpSendOnce = async () => ({ code: 0, data: {} });
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) {
    await evalAsync("httpFetch('https://open.feishu.cn/open-apis/drive/v1/files?folder_token=x&page_size=200',{headers:{Authorization:'Bearer t'}})");
  }
  const elapsed = Date.now() - t0;
  check('D2a 5 次顺序请求总间隔 ≥ 600ms(容差-80)', elapsed >= 600 - 80, 'elapsed=' + elapsed + 'ms');
} catch (e) { check('D2 动态执行异常', false, e.message); }

/* ---- D3 限流码退避重试: 前2次99991400, 第3次成功 ---- */
section('D3 限流码退避重试(99991400 → 成功)');
try {
  let calls = 0;
  sandbox._httpSendOnce = async () => {
    calls++;
    if (calls < 3) return { code: 99991400, msg: 'request trigger frequency limit' };
    return { code: 0, data: { files: [] } };
  };
  const r = await evalAsync("httpFetch('https://open.feishu.cn/open-apis/drive/v1/files?folder_token=x&page_size=200',{headers:{Authorization:'Bearer t'}})");
  check('D3a 限流后退避重试成功(恰3次调用)', calls === 3 && r && r.code === 0, 'calls=' + calls);
} catch (e) { check('D3 动态执行异常', false, e.message); }

/* ---- D4 重试预算耗尽: 恒限流 → 返回限流响应不抛错(调用方优雅降级) ---- */
section('D4 重试预算耗尽(恒限流不崩溃)');
try {
  let calls = 0;
  sandbox._httpSendOnce = async () => { calls++; return { code: 99991400, msg: 'limit' }; };
  const r = await evalAsync("httpFetch('https://open.feishu.cn/open-apis/drive/v1/files?folder_token=x&page_size=200',{headers:{Authorization:'Bearer t'}})");
  check('D4a 预算耗尽返回限流响应(不抛错)', r && r.code === 99991400, JSON.stringify(r));
  check('D4b 恰好 3 次调用', calls === 3, 'calls=' + calls);
} catch (e) { check('D4 动态执行异常', false, e.message); }

/* ---- D5 非飞书URL: 不重试(避免对第三方放大负载) ---- */
section('D5 非飞书URL不重试');
try {
  let calls = 0;
  sandbox._httpSendOnce = async () => { calls++; return { code: 99991400, msg: 'x' }; };
  await evalAsync("httpFetch('https://example.com/api',{})");
  check('D5a 非飞书URL遇限流码只调1次', calls === 1, 'calls=' + calls);
} catch (e) { check('D5 动态执行异常', false, e.message); }

/* ---- D6 非幂等POST: 不重试(避免放大写负载) ---- */
section('D6 POST不重试');
try {
  let calls = 0;
  sandbox._httpSendOnce = async () => { calls++; return { code: 99991400, msg: 'x' }; };
  await evalAsync("httpFetch('https://open.feishu.cn/open-apis/drive/v1/files/create_folder',{method:'POST',body:{}})" );
  check('D6a POST遇限流码只调1次', calls === 1, 'calls=' + calls);
} catch (e) { check('D6 动态执行异常', false, e.message); }

/* ---- D7 网络错误退避重试 ---- */
section('D7 网络错误退避重试');
try {
  let calls = 0;
  sandbox._httpSendOnce = async () => {
    calls++;
    if (calls < 3) throw new Error('boom');
    return { code: 0, data: {} };
  };
  const r = await evalAsync("httpFetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'GET'})");
  check('D7a 网络错误退避后成功(3次调用)', calls === 3 && r && r.code === 0, 'calls=' + calls);
} catch (e) { check('D7 动态执行异常', false, e.message); }

/* ---- D8 feishuDownloadFile: 限流JSON体退避后返回Blob ---- */
section('D8 下载入口限流退避(fetch路径)');
try {
  let calls = 0;
  sandbox.fetch = async () => {
    calls++;
    if (calls < 3) {
      return { ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ code: 99991400, msg: 'request trigger frequency limit' }) };
    }
    return { ok: true, headers: { get: () => 'image/jpeg' }, blob: async () => ({ size: 2048 }) };
  };
  inject('feishuDownloadFile');
  const b = await evalAsync("feishuDownloadFile('https://open.feishu.cn/open-apis/drive/v1/files/f1/download','tok','image/jpeg',60)");
  check('D8a 下载限流退避后成功返回Blob', calls === 3 && b && b.size === 2048, 'calls=' + calls);
  check('D8b 下载超预算后抛错(调用方try/catch降级)', (async () => {
    sandbox.fetch = async () => ({ ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ code: 99991400, msg: 'limit' }) });
    try { await evalAsync("feishuDownloadFile('https://open.feishu.cn/open-apis/drive/v1/files/f1/download','tok','image/jpeg',60)"); return false; }
    catch (e) { return true; }
  })(), '');
} catch (e) { check('D8 动态执行异常', false, e.message); }

/* ---- D9 退避函数严格递增 ---- */
section('D9 指数退避区间递增');
try {
  const b0 = evalSync('_feishuBackoff(0)');
  const b1 = evalSync('_feishuBackoff(1)');
  const b2 = evalSync('_feishuBackoff(2)');
  // 区间不重叠: [400,600) < [800,1200) < [1600,2400)
  check('D9a backoff(0)<backoff(1)<backoff(2)', b0 < b1 && b1 < b2, b0 + '/' + b1 + '/' + b2);
} catch (e) { check('D9 动态执行异常', false, e.message); }

/* ---- D10 feishuListFiles 30s缓存: 同目录二次列取只发1次HTTP ---- */
section('D10 目录列表缓存(30s)');
try {
  let calls = 0;
  sandbox._httpSendOnce = async () => { calls++; return { code: 0, data: { files: [{ name: 'x.png', type: 'file', token: 'f1' }] } }; };
  inject('httpFetch');
  inject('feishuListFiles');
  const r1 = await evalAsync("feishuListFiles('tok','fld')");
  const r2 = await evalAsync("feishuListFiles('tok','fld')");
  check('D10a 同目录30s内二次列取命中缓存(1次HTTP)', calls === 1 && r1.length === 1 && r2.length === 1, 'calls=' + calls);
  check('D10b 不同目录独立缓存', (async () => {
    const before = calls;
    await evalAsync("feishuListFiles('tok','fld2')");
    return calls === before + 1;
  })(), '');
} catch (e) { check('D10 动态执行异常', false, e.message); }

console.log('\n==============================================================');
console.log('飞书限流治理测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
})();
