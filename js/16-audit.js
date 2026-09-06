/* ===========================================================
 * 模块: 16-audit.js  审计与操作留痕 V1.0 (V11.3)
 * 依赖: feishu-api.js -> window.FeishuAPI (懒加载, 仅在需要上报/通知时触达)
 * 加载位置: demo.html 在 00-bootstrap.js 之后、01-state.js 之前
 *           (State API 的 C/U/D 埋点依赖 window.Audit 已就绪)
 * 用途:
 *   1. C/U/D 操作本地留痕: audit_log 写入 localStorage(有界环形缓冲)
 *   2. 删除类操作 飞书机器人告警: 管理端可追溯"谁删了车/删了人"
 *   3. 可选上报 Bitable 审计表: 达标后云端留档
 * 设计约束:
 *   - 零侵入: 仅通过 window.Audit 暴露, State/03-vehicles 用 `if(window.Audit)` 防御调用
 *   - 弱网/未配置飞书 一律静默降级, 不阻断主流程
 *   - 本地上限 MAX_LOCAL 条, 超量裁剪保留最新
 * =========================================================== */
(function(){
'use strict';

var MAX_LOCAL = 500;              // 本地审计环形缓冲上限
var KEY = 'audit_log';            // localStorage 键
var AUDIT_TABLE_ID = 'tblAudit';  // 审计表占位 ID (仅在配置 bitableAppToken 且含审计表时上报)
var NOTIFY_THROTTLE_MS = 5000;    // 删除告警节流: 防批量同步触发消息刷屏

var _initialized = false;
var _lastNotifyTs = 0;

function nowISO(){ return new Date().toISOString(); }

/** 读取本地审计日志数组 */
function _readLocal(){
  try {
    var arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch(e){ return []; }
}

/** 当前操作人(取全局 state.currentUser, 未登录/游客兜底) */
function _who(){
  try {
    if (typeof state !== 'undefined' && state && state.currentUser) {
      return { actor: state.currentUser.phone || 'unknown', role: state.currentUser.role || 'member' };
    }
  } catch(e){ /* 未加载 state 时的匿名兜底 */ }
  return { actor: 'anonymous', role: 'guest' };
}

/**
 * 写入一条审计
 * @param {string} action     如 vehicle.create / vehicle.update / vehicle.delete / user.create / user.delete
 * @param {string} entityType vehicle | user
 * @param {string|number} entityId 车辆id / 用户手机号
 * @param {object} detail     摘要(不整包dump大字段, 传递方自行精简)
 * @returns {object} entry
 */
function track(action, entityType, entityId, detail){
  var who = _who();
  var entry = {
    ts: nowISO(),
    actor: who.actor,
    role: who.role,
    action: action,
    entityType: entityType || 'vehicle',
    entityId: (entityId == null) ? '' : String(entityId),
    detail: (detail && typeof detail === 'object') ? detail : (detail || {}),
    appVersion: (typeof APP_VERSION !== 'undefined') ? String(APP_VERSION) : '',
  };
  // 1. 本地留痕(有界环形)
  try {
    var arr = _readLocal();
    arr.push(entry);
    localStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX_LOCAL)));
  } catch(e){ /* localStorage 满/隐私模式 忽略 */ }
  // 2. 删除类 -> 机器人告警(异步, 带节流)
  if (action === 'vehicle.delete' || action === 'user.delete') {
    _notifyDelete(entry);
  }
  // 3. 上报 Bitable 审计表(异步, 弱网不阻断)
  _pushBitable(entry);
  return entry;
}

/** 删除操作机器人告警(5s 全局节流) */
function _notifyDelete(entry){
  var now = Date.now();
  if (now - _lastNotifyTs < NOTIFY_THROTTLE_MS) return;
  var api = (typeof window !== 'undefined') ? window.FeishuAPI : null;
  if (!api || typeof api.isConfigReady !== 'function' || !api.isConfigReady()) return;
  var cfg = (typeof api.getConfig === 'function') ? api.getConfig() : {};
  var chatId = cfg.chatId;
  if (!chatId || typeof api.sendGroupMessage !== 'function') return;
  _lastNotifyTs = now;
  var label = entry.entityType === 'user' ? '成员' : '车辆';
  var ts;
  try { ts = new Date(entry.ts).toLocaleString('zh-CN'); } catch(e){ ts = entry.ts; }
  var text = '⚠️【操作告警】删除' + label + '\n'
    + '时间: ' + ts + '\n'
    + '操作人: ' + entry.actor + ' (' + entry.role + ')\n'
    + '对象: #' + entry.entityId + '\n'
    + '版本: v' + entry.appVersion;
  try {
    api.sendGroupMessage(chatId, text).catch(function(){ /* 通知失败不阻断 */ });
  } catch(e){ /* 同步异常忽略 */ }
}

/** 上报 Bitable 审计表(未配置则跳过) */
function _pushBitable(entry){
  var api = (typeof window !== 'undefined') ? window.FeishuAPI : null;
  if (!api || typeof api.isConfigReady !== 'function' || !api.isConfigReady()) return;
  var cfg = (typeof api.getConfig === 'function') ? api.getConfig() : {};
  if (!cfg.bitableAppToken || typeof api.bitableCreateRecord !== 'function') return;
  var tableId = cfg.auditTableId || AUDIT_TABLE_ID;
  var detailStr = (typeof entry.detail === 'string') ? entry.detail : JSON.stringify(entry.detail).slice(0, 500);
  var fields = {
    '时间': entry.ts,
    '操作': entry.action,
    '对象类型': entry.entityType,
    '对象ID': entry.entityId,
    '操作人': entry.actor,
    '角色': entry.role,
    '详情': detailStr,
    '版本': entry.appVersion,
  };
  try {
    api.bitableCreateRecord(cfg.bitableAppToken, tableId, fields).catch(function(){ /* 上报失败忽略 */ });
  } catch(e){ /* 同步异常忽略 */ }
}

/** 初始化: 幂等(预留: 可绑定全局错误上报等) */
function initAudit(){
  if (_initialized) return;
  _initialized = true;
}

// 仅暴露最小面, 供 State/03-vehicles 埋点 + 设置页查看审计
window.Audit = {
  track: track,
  init: initAudit,
  readLocal: _readLocal,
  clearLocal: function(){ try { localStorage.removeItem(KEY); } catch(e){} },
};
})();
