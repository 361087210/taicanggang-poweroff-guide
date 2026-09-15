/**
 * ============================================================
 * test_v1024_web_account.js — 网页端账号层 4 项修复测试(需求4)
 * ============================================================
 * 覆盖矩阵(静态文本断言, 与 09-web-sync.js IIFE 探测式激活的既有测试同构):
 *  W1 采纳安卓改密后的新密码: linkKey 命中即密码验真 → 本地 password 用明文重哈希
 *  W2 封堵 doForgotPassword(与 changePassword 一致, 引导去安卓)
 *  W3 rejected 状态合并 + 复用 pushRegistrationRejectionNotice(网页降级 Toast)
 *  W4 legacy 状态归一: 空/approved/normal/verified → active
 *  W5 仅组员只读: 删除 _appendCloudOnlyMembers 死代码, 强制 role=user
 *
 * 运行: node tests/test_v1024_web_account.js
 * 要求: 先红后绿——修复前全红, 修复后全绿。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond){ if(cond){ pass++; console.log('  [PASS] ' + name); } else { fail++; failures.push(name); console.log('  [FAIL] ' + name); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

const webSyncJs = src('js/09-web-sync.js');

/* ---------- W1 采纳安卓改密后的新密码 ---------- */
section('W1 采纳安卓改密后的新密码(linkKey 命中重哈希)');
check('W1a 引入 matchedByLinkKey 标记(区分 id 命中与 linkKey 命中)', webSyncJs.includes('matchedByLinkKey'));
check('W1b linkKey 命中即密码验真: 明文密码重哈希本地 password', /matchedByLinkKey[\s\S]{0,200}hashPassword/.test(webSyncJs));
check('W1c 不再保留旧 password(镜像无密码, 本地以明文为准)', !webSyncJs.includes('password:cu.password'));

/* ---------- W2 封堵 doForgotPassword ---------- */
section('W2 封堵 doForgotPassword');
check('W2a 网页端覆盖 doForgotPassword 引导去安卓', /window\.doForgotPassword=async function/.test(webSyncJs));
check('W2b 文案引导至安卓端修改', webSyncJs.includes('请在安卓APP'));

/* ---------- W3 rejected 状态合并 + 拒绝通知 ---------- */
section('W3 rejected 状态合并 + 拒绝通知');
check('W3a 合并 rejected 状态(norm==="rejected")', webSyncJs.includes("norm==='rejected'"));
check('W3b 复用 pushRegistrationRejectionNotice(网页降级 Toast)', webSyncJs.includes('pushRegistrationRejectionNotice'));

/* ---------- W4 legacy 状态归一 ---------- */
section('W4 legacy 状态归一(approved/normal/verified/空 → active)');
check('W4a 归一 approved → active', webSyncJs.includes("norm==='approved'"));
check('W4b 归一 normal → active', webSyncJs.includes("norm==='normal'"));
check('W4c 归一 verified → active', webSyncJs.includes("norm==='verified'"));

/* ---------- W5 仅组员只读 ---------- */
section('W5 仅组员只读落地');
check('W5a 删除 _appendCloudOnlyMembers 死代码', !webSyncJs.includes('_appendCloudOnlyMembers'));
check('W5b 不再包装 renderMemberList(admin 路径)', !/window\.renderMemberList=function/.test(webSyncJs));
check('W5c 重建账号强制 role=user', webSyncJs.includes("role:'user'"));
check('W5d 已有账号降级为 user(仅组员只读)', webSyncJs.includes("local.role!=='user'"));

console.log('\n==============================================================');
console.log('网页端账号层修复测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
