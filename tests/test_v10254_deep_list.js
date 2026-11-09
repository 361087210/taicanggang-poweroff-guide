#!/usr/bin/env node
/**
 * test_v10254_deep_list.js — 云盘递归列举测试(纯函数, 注入假 listFn, 不联网)
 *
 * 背景: V10.25 媒体改成三段式布局(<top>/<车型目录>/<文件>)后, 两条同步脚本仍只列顶层,
 *   每晚 cron 实收 0 个文件且不报错 —— 新增照片/视频永远回不到仓库。
 */
'use strict';

const path = require('path');
const { feishuListFilesDeep } = require(path.join(__dirname, '..', 'scripts', 'sync_photos_to_repo.js'));

let pass = 0, fail = 0;
function ok(c, n, e) { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.error('  ❌ ' + n + (e ? '  → ' + e : '')); } }

// 假云盘: 根目录 1 个散文件 + 2 个车型目录 + 1 个空目录; 子目录里各有文件与更深一层
const TREE = {
  ROOT: [
    { type: 'file', name: '顶层遗留.jpeg', token: 'f0' },
    { type: 'folder', name: 'A车型', token: 'dA' },
    { type: 'folder', name: 'B车型', token: 'dB' },
    { type: 'folder', name: '空目录', token: 'dE' }
  ],
  dA: [
    { type: 'file', name: 'A_p1_aa.jpeg', token: 'f1' },
    { type: 'file', name: 'A_p2_bb.jpeg', token: 'f2' },
    { type: 'folder', name: '更深一层', token: 'dAA' }
  ],
  dB: [{ type: 'file', name: 'B_p1_cc.jpeg', token: 'f3' }],
  dE: [],
  dAA: [{ type: 'file', name: '不该被收集.jpeg', token: 'fx' }]
};
const listFn = async tk => TREE[tk] || [];

(async () => {
  const files = await feishuListFilesDeep(listFn, 'ROOT');
  const names = files.map(f => f.name);

  console.log('\n[1] 收集范围');
  ok(names.length === 4, '共收集 4 个文件(1 顶层 + 2 + 1)', JSON.stringify(names));
  ok(names.includes('顶层遗留.jpeg'), '含顶层遗留文件(向后兼容扁平布局)');
  ok(names.includes('A_p1_aa.jpeg') && names.includes('B_p1_cc.jpeg'), '含各车型目录下文件');
  ok(!names.includes('不该被收集.jpeg'), '只下探一层, 不递归更深');

  console.log('\n[2] 边界');
  ok(!files.some(f => f.type === 'folder'), '结果中不含目录条目');
  const empty = await feishuListFilesDeep(async () => [], 'X');
  ok(empty.length === 0, '空目录返回空数组不报错');

  console.log('\n' + '='.repeat(50));
  console.log(`结果: ${pass} 通过 / ${fail} 失败 / ${pass + fail} 总计`);
  if (fail) process.exit(1);
})();
