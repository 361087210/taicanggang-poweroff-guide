/**
 * ============================================================
 * test_v10284_media_hard_delete.js — 资源库「移出资源库」软/硬删除 + 云端清理队列
 * ============================================================
 * 覆盖:
 *   T1 模块可加载, 软/硬删除与队列 API 已导出
 *   T2 deleteQueueMerge: done 优先、同状态取新、按路径去重
 *   T3 enqueueHardDelete 幂等(同一路径只留一条)
 *   T4 硬删除落地点: 队列 → 回收站审计 → 墓碑; 二次确认文案含"不可恢复"
 *   T5 UI 契约: 预览入口是「移出资源库」, 软/硬两选项平级
 *   T6 队列云契约: media_delete_queue.json, 下载→并集→上传
 *   T7 工作流接线: 每 15 分钟 + 手动, COS 密钥, 串行, 提交回仓库
 *   T8 消费脚本: COS 签名/删除、飞书删除、git rm、Release 资产删除、重建索引、回写状态
 *   T9 软删除语义未退化(仍只写墓碑, 不删云端文件)
 *
 * 运行: node tests/test_v10284_media_hard_delete.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

/* ---------------- T1 加载模块（window + localStorage 桩） ---------------- */
const MEDIA_SRC = src('js/13-media-library.js');
const MEDIA_FILE = path.join(ROOT, 'js', '13-media-library.js');
let ML = null;
try {
  const store = {};
  const sandbox = {
    window: {},
    console: console,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    fetch: function(){ return Promise.reject(new Error('no net')); },
  };
  sandbox.window.navigator = {};
  sandbox.window.localStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  vm.runInContext(MEDIA_SRC, sandbox, { filename: MEDIA_FILE });
  ML = sandbox.window.MediaLibrary;
} catch (e) {
  check('T1a 模块可在无 DOM 环境加载', false, e.message);
}

section('T1 模块导出');
check('T1a 模块可在无 DOM 环境加载', !!ML, ML ? '' : 'window.MediaLibrary 未生成');
check('T1b 软/硬删除入口已导出', !!(ML && ML.openDeleteChoice && ML.closeDeleteChoice &&
  ML.softDeleteChosen && ML.hardDeleteChosen && ML.hardDelete));
check('T1c 删除队列 API 已导出', !!(ML && ML.deleteQueueItems && ML.deleteQueuePending &&
  ML.deleteQueueMerge && ML.enqueueHardDelete && ML.deleteQueueSync && ML.flushDeleteQueue));

section('T2 队列合并(纯函数)');
const merged = ML ? ML.deleteQueueMerge(
  [{ path: 'vehicle_images/A/a.jpeg', status: 'pending', at: 10 }],
  [{ path: 'vehicle_images/A/a.jpeg', status: 'done', at: 5 }]
) : [];
check('T2a done 覆盖 pending(已完成不被旧请求重开)', merged.length === 1 && merged[0].status === 'done',
  JSON.stringify(merged));
const merged2 = ML ? ML.deleteQueueMerge(
  [{ path: 'vehicle_images/A/a.jpeg', status: 'error', at: 10 }],
  [{ path: 'vehicle_images/A/a.jpeg', status: 'error', at: 20, result: 'newer' }]
) : [];
check('T2b 同状态取较新', merged2.length === 1 && merged2[0].at === 20 && merged2[0].result === 'newer',
  JSON.stringify(merged2));
const merged3 = ML ? ML.deleteQueueMerge(
  [{ path: 'vehicle_images/A/a.jpeg', status: 'pending', at: 1 }],
  [{ path: 'vehicle_videos/B/b.mp4', status: 'pending', at: 2 }]
) : [];
check('T2c 不同路径都保留', merged3.length === 2, JSON.stringify(merged3));

section('T3 排队幂等');
const QPATH = 'vehicle_images/比亚迪海豚/海豚_p9_deadbeef.jpeg';
if (ML) {
  ML.enqueueHardDelete(QPATH, 'photo', [{ id: 1, display: '比亚迪海豚' }]);
  ML.enqueueHardDelete(QPATH, 'photo', [{ id: 1, display: '比亚迪海豚' }]);
}
const items = ML ? ML.deleteQueueItems() : [];
check('T3a 同一路径重复排队只留一条', items.filter(x => x.path === QPATH).length === 1, JSON.stringify(items));
check('T3b 新请求状态为 pending', items[0] && items[0].status === 'pending' && items[0].kind === 'photo');
check('T3c 待处理列表包含该请求', !!(ML && ML.deleteQueuePending().some(x => x.path === QPATH)));

/** 取一个顶层函数体(到下一个顶层 function 声明为止), 避免靠固定锚点被后续改动带偏 */
function blockAfter(name) {
  const st = MEDIA_SRC.indexOf('function ' + name + '(');
  if (st < 0) return '';
  const next = MEDIA_SRC.indexOf('\nfunction ', st + 10);
  return MEDIA_SRC.slice(st, next < 0 ? MEDIA_SRC.length : next);
}

section('T4 硬删除落地');
const hardBlock = blockAfter('hardDelete') + blockAfter('runHardDelete');
check('T4a 硬删除需要二次确认', hardBlock.indexOf("showConfirm('彻底删除'") >= 0);
check('T4b 确认文案说明不可恢复', hardBlock.indexOf('不可恢复') >= 0);
check('T4c 先写队列再尽力删飞书(顺序)', hardBlock.indexOf('enqueueHardDelete(') >= 0 &&
  hardBlock.indexOf('enqueueHardDelete(') < hardBlock.indexOf('driveDeleteFile'));
check('T4d 回收站保留审计记录且标记已清理', hardBlock.indexOf("moveToTrash(path, 'hard_delete'") >= 0 &&
  hardBlock.indexOf('markPurged(') >= 0);
check('T4e 写清理墓碑防旧快照复活', hardBlock.indexOf('registryPurge(') >= 0);

section('T5 UI 契约');
const previewStart = MEDIA_SRC.indexOf('function preview(');
const previewEnd = MEDIA_SRC.indexOf('function closePreview(');
const previewBlock = previewStart >= 0 && previewEnd > previewStart ? MEDIA_SRC.slice(previewStart, previewEnd) : '';
check('T5a 预览入口改为「移出资源库」', previewBlock.indexOf('openDeleteChoice(') >= 0 &&
  previewBlock.indexOf('移出资源库') >= 0);
check('T5b 存在软/硬两个平级选项', MEDIA_SRC.indexOf('softDeleteChosen') >= 0 &&
  MEDIA_SRC.indexOf('hardDeleteChosen') >= 0 && MEDIA_SRC.indexOf('软删除') >= 0 && MEDIA_SRC.indexOf('硬删除') >= 0);
check('T5c 硬删除说明覆盖 COS/GitHub/飞书', /硬删除[\s\S]{0,200}COS[\s\S]{0,60}GitHub[\s\S]{0,60}飞书/.test(MEDIA_SRC));
check('T5d 软删除仍提示可恢复', MEDIA_SRC.indexOf('可在回收站恢复') >= 0);

section('T6 队列云契约');
check('T6a 云端文件名正确', /DELETE_QUEUE_CLOUD_FILE\s*=\s*'media_delete_queue\.json'/.test(MEDIA_SRC));
check('T6b 队列走下载→并集→上传', /async function deleteQueueSync\([\s\S]{0,900}downloadJsonFromDataFeishu[\s\S]{0,400}deleteQueueMerge[\s\S]{0,600}uploadJsonToDataFeishu/
  .test(MEDIA_SRC));
check('T6c 进入资源库补交离线请求', /function open\(\)[\s\S]{0,500}flushDeleteQueue\(\)/.test(MEDIA_SRC));

section('T7 工作流接线');
const wf = src('.github/workflows/media-hard-delete.yml');
check('T7a 每 15 分钟定时', /cron:\s*'\*\/15 \* \* \* \*'/.test(wf));
check('T7b 支持手动触发', wf.indexOf('workflow_dispatch:') >= 0);
check('T7c 串行不并发', /concurrency:[\s\S]{0,80}media-hard-delete/.test(wf) && wf.indexOf('cancel-in-progress: false') >= 0);
check('T7d 注入 COS 密钥', wf.indexOf('TCG_COS_SECRET_ID') >= 0 && wf.indexOf('TCG_COS_SECRET_KEY') >= 0);
check('T7e 执行消费脚本', wf.indexOf('scripts/process_media_delete_queue.py') >= 0);
check('T7f 清理结果提交回仓库', /git add -A[\s\S]{0,300}git push/.test(wf));

section('T8 消费脚本');
const py = src('scripts/process_media_delete_queue.py');
check('T8a 读取飞书队列文件', py.indexOf('media_delete_queue.json') >= 0 || py.indexOf('QUEUE_NAME') >= 0);
check('T8b COS 签名算法', py.indexOf('q-sign-algorithm=sha1') >= 0 && py.indexOf('hmac.new') >= 0);
check('T8c 视频 COS 前缀与配置一致', py.indexOf('media-library/baseline/') >= 0);
check('T8d 照片走 git rm', /'git',\s*'rm'/.test(py));
check('T8e 视频删 Release 资产', py.indexOf('releases/assets/') >= 0);
check('T8f 重建索引与映射', py.indexOf('gen_media_library.js') >= 0 && py.indexOf('gen_media_mapping.js') >= 0);
check('T8g 回写 done/error 状态', /'status'\]\s*=\s*'done' if ok else 'error'/.test(py));
check('T8h 路径白名单(只能删两个媒体目录)', py.indexOf("path.startswith('vehicle_images/')") >= 0 &&
  py.indexOf("path.startswith('vehicle_videos/')") >= 0);
check('T8i 缺 COS 密钥时明确报错', py.indexOf('缺少 COS 密钥') >= 0);

let pyOk = true, pyErr = '';
try {
  execSync('python3 -m py_compile scripts/process_media_delete_queue.py', { cwd: ROOT, stdio: 'pipe' });
} catch (e) {
  pyOk = false; pyErr = String((e && e.stderr) || e.message).slice(0, 300);
}
check('T8j 脚本语法可编译', pyOk, pyErr);

let signOk = false, signOut = '';
try {
  signOut = execSync(
    "python3 -c \"import sys; sys.path.insert(0,'scripts');" +
    "import process_media_delete_queue as q;" +
    "a=q.cos_signature('id','key','DELETE','vehicle_images/中文/a b.jpeg','h.cos.cn',1700000000);" +
    "b=q.cos_signature('id','key','DELETE','vehicle_images/中文/a b.jpeg','h.cos.cn',1700000000);" +
    "print((a==b), a.startswith('q-sign-algorithm=sha1&q-ak=id&'))\"",
    { cwd: ROOT, stdio: 'pipe' }).toString().trim();
  signOk = signOut === 'True True';
} catch (e) {
  signOut = String((e && e.stderr) || (e && e.message) || e).slice(0, 200);
}
check('T8k COS 签名稳定且格式正确', signOk, signOut);

section('T9 软删除不退化');
const delBlock = blockAfter('deleteCloud');
check('T9a 软删除只写回收站+墓碑', delBlock.indexOf('moveToTrash(') >= 0 && delBlock.indexOf('registryTombstone(') >= 0);
check('T9b 软删除不直接删云端文件', delBlock.indexOf('driveDeleteFile') < 0);
check('T9c 软删除写队列? 不写(硬删才排队)', delBlock.indexOf('enqueueHardDelete') < 0);

section('T10 交互与队列真跑(轻量 DOM 桩)');
(async function(){
  const els = {};
  function makeEl() {
    return {
      id: '', className: '', innerHTML: '', textContent: '', style: {},
      classList: { add(){}, remove(){}, contains(){ return false; } },
      addEventListener(){}, appendChild(){}, querySelector(){ return null; },
      querySelectorAll(){ return []; },
    };
  }
  els['screen-media-library'] = makeEl();
  els['ml-preview'] = makeEl();
  els['ml-del-name'] = makeEl();
  els['ml-del-path'] = makeEl();
  const doc = {
    getElementById: (id) => els[id] || null,
    createElement: () => makeEl(),
    body: { appendChild: (el) => { if (el.id) els[el.id] = el; } },
    addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
  };
  const store = {};
  let uploaded = null, toasts = [];
  const sandbox = {
    window: {}, console: console, document: doc,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    canEdit: () => true,
    showToast: (m) => { toasts.push(m); },
    showConfirm: (title, body, cb) => { if (cb) cb(); },
    downloadJsonFromDataFeishu: async () => ({ items: [{ path: 'vehicle_images/A/old.jpeg', status: 'done', at: 1 }] }),
    uploadJsonToDataFeishu: async (token, name, text) => { uploaded = { name, text }; },
    setTimeout: (fn) => { /* 不跑防抖定时器, 避免测试异步收尾不确定 */ return 0; },
    clearTimeout: () => {},
  };
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.VEHICLES = [{ id: 1, display: '测试车', photoPaths: ['vehicle_images/A/a.jpeg'], videoPaths: [] }];
  sandbox.window.FeishuAPI = {
    getTenantToken: async () => 'tenant-token',
    driveDeleteFile: async () => ({ ok: true }),
  };
  vm.createContext(sandbox);
  vm.runInContext(MEDIA_SRC, sandbox, { filename: MEDIA_FILE });
  const M = sandbox.window.MediaLibrary;

  /* 打开选择层 → 软删除 */
  M.openDeleteChoice('vehicle_images/A/a.jpeg');
  const modal = els['ml-delete-choice'];
  check('T10a 选择层渲染并显示文件名', !!modal && modal.classList &&
    els['ml-del-name'].textContent === 'a.jpeg' && els['ml-del-path'].textContent === 'vehicle_images/A/a.jpeg');
  M.closeDeleteChoice();
  const trashBefore = JSON.parse(store['tcg_media_trash'] || '[]').length;
  M.softDeleteChosen();
  check('T10b 关闭后不再持有待删路径',
    JSON.parse(store['tcg_media_trash'] || '[]').length === trashBefore);
  M.openDeleteChoice('vehicle_images/A/a.jpeg');
  M.softDeleteChosen();
  check('T10c 软删除写入回收站并提示可恢复',
    JSON.parse(store['tcg_media_trash'] || '[]').some(t => t.path === 'vehicle_images/A/a.jpeg') &&
    toasts.some(t => t.indexOf('回收站') >= 0));

  /* 打开选择层 → 硬删除(确认回调同步执行) */
  M.openDeleteChoice('vehicle_images/A/a.jpeg');
  M.hardDeleteChosen();
  const q = JSON.parse(store['tcg_media_delete_queue'] || '[]');
  check('T10d 硬删除写入队列', q.some(x => x.path === 'vehicle_images/A/a.jpeg' && x.status === 'pending'));
  const trash = JSON.parse(store['tcg_media_trash'] || '[]');
  check('T10e 回收站保留已清理审计记录', trash.some(t => t.path === 'vehicle_images/A/a.jpeg' && t.purged));
  check('T10f 硬删除提示已排队', toasts.some(t => t.indexOf('已彻底删除') >= 0));

  /* 队列上云: 本地请求 + 云端 done 合并后上传 */
  const okSync = await M.deleteQueueSync();
  const up = uploaded ? JSON.parse(uploaded.text) : { items: [] };
  check('T10g 队列同步上传 media_delete_queue.json', okSync === true && uploaded && uploaded.name === 'media_delete_queue.json');
  check('T10h 云端 done 与本地 pending 并集', up.items.length === 2 &&
    up.items.some(x => x.path === 'vehicle_images/A/old.jpeg' && x.status === 'done') &&
    up.items.some(x => x.path === 'vehicle_images/A/a.jpeg' && x.status === 'pending'));
  const okFlush = await M.flushDeleteQueue();
  check('T10i 进入资源库补交返回成功', okFlush === true);

  /* 非组长: 入口拒绝 */
  sandbox.canEdit = () => false;
  toasts = [];
  M.openDeleteChoice('vehicle_images/A/a.jpeg');
  check('T10j 非组长不能移出资源库', toasts.some(t => t.indexOf('仅组长') >= 0));

  section('结果');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) {
    console.log('失败项: ' + failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
})();
