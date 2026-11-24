/* ===========================================================
 * 模块: 17-error-report.js — 全局错误捕获与诊断上报 (V10.26.7)
 * ===========================================================
 * 行业标准缺口: 本项目此前**没有任何全局错误捕获**, 现场白屏时只能等用户反馈。
 *
 * 本模块做三件事:
 *   1) 实时捕获 window.onerror / unhandledrejection(含脚本地址/行列/堆栈)
 *   2) 落 localStorage 环形缓冲(最多 20 条, 去 PII: 手机号/邮箱掩码), 重启不丢
 *   3) 轻量上报: 每小时内最多自动提交 1 条到飞书反馈表(字段: 文本/平台/APP版本);
 *      失败/离线一律降级为"仅本地保留", 绝不影响主流程
 * 另外提供「复制诊断信息」给用户/现场, 便于人工反馈。
 *
 * 设计约束:
 *   - 零依赖: 只用 localStorage + 可选的全局帮助函数(getFeishuCfg/getFeishuToken/httpFetch)
 *   - 不阻塞: install() 只挂监听; 上报 fire-and-forget
 *   - 不上传 PII: 消息里的手机号/邮箱在**落盘前**就掩码
 * =========================================================== */
(function(){
'use strict';

const KEY = 'tcg_error_log';
const LAST_SUBMIT_KEY = 'tcg_error_last_submit';
const MAX = 20;
const SUBMIT_INTERVAL_MS = 60 * 60 * 1000;   // 每小时最多自动上报 1 条

/* ---------- 纯函数(供单测) ---------- */

/** 掩码 PII: 手机号 / 邮箱 / 身份证(粗略) */
function sanitize(s){
  /* 顺序很重要: 身份证(18 位)先于手机号(11 位) —— 否则 18 位串里的
   * 中间 11 位会先被手机号规则吃掉, 身份证就漏了(单测 E2c 抓到的真实顺序 bug)。 */
  return String(s == null ? '' : s)
    .replace(/\b\d{17}[\dXx]\b/g, '<id>')
    .replace(/1[3-9]\d{9}/g, '<phone>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .slice(0, 600);
}

/** 环形缓冲: 新的在前, 超长截断 */
function pushCapped(list, item, max){
  const out = Array.isArray(list) ? list.slice() : [];
  out.unshift(item);
  return out.slice(0, max || MAX);
}

/** 去重键: 同一条错误反复出现只算一次上报 */
function dedupeKey(p){
  return sanitize(p && p.msg) + '|' + sanitize(p && p.src) + '|' + (p && p.line || 0);
}

/** 构造待存/待上报的载荷(纯函数) */
function buildPayload(info){
  const i = info || {};
  const nav = (typeof navigator !== 'undefined' && navigator) || {};
  return {
    ts: new Date().toISOString(),
    msg: sanitize(i.msg || i.message || 'unknown'),
    src: sanitize(i.src || i.filename || ''),
    line: Number(i.line || i.lineno || 0) || 0,
    col: Number(i.col || i.colno || 0) || 0,
    stack: sanitize(i.stack || ''),
    appVersion: sanitize((typeof APP_VERSION !== 'undefined' && APP_VERSION) || ''),
    platform: sanitize(nav.userAgent || ''),
    screen: (typeof window !== 'undefined' && window.screen) ? (window.screen.width + 'x' + window.screen.height) : ''
  };
}

/* ---------- 存储与上报 ---------- */

function drain(){
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function clear(){ try { localStorage.removeItem(KEY); } catch (e) {} }

function capture(info){
  let p;
  try { p = buildPayload(info); } catch (e) { return; }
  try { localStorage.setItem(KEY, JSON.stringify(pushCapped(drain(), p, MAX))); } catch (e) { /* 配额满不影响主流程 */ }
  try { maybeSubmit(p); } catch (e) { /* 上报失败静默 */ }
}

/** 轻量自动上报: 1 小时内最多 1 条; 只在飞书配置可用时尝试 */
function maybeSubmit(p){
  const now = Date.now();
  let last = 0;
  try { last = Number(localStorage.getItem(LAST_SUBMIT_KEY) || 0); } catch (e) {}
  if (now - last < SUBMIT_INTERVAL_MS) return;
  if (typeof getFeishuCfg !== 'function' || typeof getFeishuToken !== 'function' || typeof httpFetch !== 'function') return;
  let cfg;
  try { cfg = getFeishuCfg(); } catch (e) { return; }
  if (!cfg || !cfg.appId || !cfg.appSecret) return;
  const appToken = (window.TCG_CONFIG || {}).FEEDBACK_APP_TOKEN || (window.TCG_CONFIG || {}).BASE_APP_TOKEN;
  const tableId = (window.TCG_CONFIG || {}).FEEDBACK_TABLE_ID;
  if (!appToken || !tableId) return;
  try { localStorage.setItem(LAST_SUBMIT_KEY, String(now)); } catch (e) {}
  Promise.resolve()
    .then(function(){ return getFeishuToken(cfg); })
    .then(function(token){
      return httpFetch('https://open.feishu.cn/open-apis/bitable/v1/apps/' + appToken + '/tables/' + tableId + '/records', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
          '文本': '[自动崩溃] ' + p.msg + (p.src ? (' @' + p.src + ':' + p.line) : ''),
          '平台': p.platform,
          'APP版本': p.appVersion
        } })
      });
    })
    .catch(function(){ /* 字段不匹配/离线/无权限: 只留本地 */ });
}

/** 复制诊断信息(给用户/现场人工反馈用) */
function copyDiagnostics(){
  const list = drain();
  const head = '版本=' + ((typeof APP_VERSION !== 'undefined' && APP_VERSION) || '?')
    + ' 平台=' + sanitize((typeof navigator !== 'undefined' && navigator.userAgent) || '');
  const body = list.map(function(x, i){
    return (i + 1) + ') ' + x.ts + ' ' + x.msg + ' @' + x.src + ':' + x.line + '\n   ' + x.stack;
  }).join('\n');
  const text = head + '\n--- 最近 ' + list.length + ' 条错误 ---\n' + body;
  const done = function(){ if (typeof showToast === 'function') showToast('诊断信息已复制（' + list.length + ' 条）'); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, done); return true; }
  } catch (e) { /* 落回下面 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta); done(); return true;
  } catch (e) { return false; }
}

/* ---------- 安装(幂等) ---------- */
function install(){
  if (typeof window === 'undefined' || window.__tcgErrInstalled) return false;
  window.__tcgErrInstalled = true;
  window.addEventListener('error', function(e){
    if (!e) return;
    capture({ msg: e.message || 'resource error', src: e.filename || '', line: e.lineno, col: e.colno,
      stack: (e.error && e.error.stack) || '' });
  });
  window.addEventListener('unhandledrejection', function(e){
    const r = e && e.reason;
    capture({ msg: 'unhandledrejection: ' + ((r && (r.message || r)) || 'unknown'),
      stack: (r && r.stack) || '', src: 'promise' });
  });
  return true;
}

window.TCGErrorReport = {
  install: install, capture: capture, drain: drain, clear: clear,
  copyDiagnostics: copyDiagnostics,
  /* 纯函数 */
  buildPayload: buildPayload, sanitize: sanitize, pushCapped: pushCapped, dedupeKey: dedupeKey,
  MAX: MAX, SUBMIT_INTERVAL_MS: SUBMIT_INTERVAL_MS
};
install();
})();
