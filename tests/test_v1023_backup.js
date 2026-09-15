/**
 * ============================================================
 * test_v1023_backup.js — doBackup 吞错修复测试(需求1)
 * ============================================================
 * Bug: js/05-sync.js doBackup() 对 httpUploadFile 的返回值从不校验——
 *      飞书上传返回业务错误码(如 99991400 权限不足)时不抛错, 直接弹
 *      「飞书备份完成」假成功; 且重试分支 catch(e2){/* 重试仍失败 *​/}
 *      吞掉真实错误, 用户只看到首次泛化错误。
 *
 * 期望:
 *  T1 上传返回 code!=0 时 doBackup 必须进入失败分支(Toast 含「失败」), 绝不假成功
 *  T2 doBackup 源码含返回值校验(.code!==0)
 *  T3 重试分支保留真实错误(不吞 e2)
 *
 * 运行: node tests/test_v1023_backup.js
 * 要求: 先红后绿——修复前 T1/T2/T3 红, 修复后全绿。
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
function check(name, cond){ if(cond){ pass++; console.log('  [PASS] ' + name); } else { fail++; failures.push(name); console.log('  [FAIL] ' + name); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

const syncJs = src('js/05-sync.js');

(async () => {
  /* ---------- T1 动态: 上传返回 code!=0 → 必须失败(非假成功) ---------- */
  section('T1 doBackup 返回值校验(动态执行)');
  try {
    const block = extractNamedBlock(syncJs, 'doBackup');
    const toasts = [];
    const sandbox = {
      console,
      document: { querySelector: () => ({ value: 'feishu' }) },
      VEHICLES: [], USERS: [],
      APP_VERSION: '10.19.1',
      Blob, Date, JSON, Promise, String, Number, Boolean, Array, Object,
      getFeishuCfg: () => ({ appId: 'cli_x', appSecret: 's', backupSub: '备份文件', folder: 'fld_x' }),
      feishuCfgReady: () => true,
      getFeishuToken: async () => 'token_x',
      getDataSubFolderToken: async () => 'folder_tok_x',
      invalidateDataFolderCache: () => {},
      // 关键: 模拟飞书返回业务错误码(权限不足), 但不抛异常
      httpUploadFile: async () => ({ code: 99991400, msg: '无权限' }),
      showToast: msg => toasts.push(String(msg)),
      addBackupHistory: () => {},
      addSyncLog: () => {},
      saveBlobToLocalFolder: async () => null,
    };
    sandbox.globalThis = sandbox;
    const ctx = vm.createContext(sandbox);
    vm.runInContext(block, ctx, { filename: 'doBackup.js' });
    await vm.runInContext('doBackup()', ctx);
    const joined = toasts.join(' | ');
    check('T1a 上传返回 code!=0 时出现失败提示', toasts.some(t => /失败/.test(t)), joined);
    check('T1b 绝不弹「备份完成」假成功', !toasts.some(t => /备份完成/.test(t)), joined);
    check('T1c 失败提示含真实原因(无权限)', toasts.some(t => /无权限/.test(t)), joined);
  } catch (e) {
    check('T1 动态执行异常: ' + e.message, false);
  }

  /* ---------- T2/T3 静态断言 ---------- */
  section('T2/T3 doBackup 源码结构');
  check('T2 doBackup 校验上传返回值(up.code!==0)', syncJs.includes('up.code!==0'));
  check('T3 重试分支保留真实错误(err=e2)', /catch\(e2\)\{[\s\S]{0,120}err\s*=\s*e2/.test(syncJs));

  console.log('\n==============================================================');
  console.log('doBackup 吞错修复测试汇总: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
  else console.log('全部通过 OK');
})();
