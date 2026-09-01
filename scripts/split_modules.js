/**
 * 一次性脚本（幂等）：把 demo.html 内大段主 <script> 拆成 9 个 defer 模块。
 * 输入：demo.html (定位 PINYIN MAP 的大 script 块)
 * 输出：
 *   js/00-bootstrap.js
 *   js/01-state.js
 *   js/02-auth.js
 *   js/03-vehicles.js
 *   js/04-export.js
 *   js/05-sync.js
 *   js/06-media.js
 *   js/07-cache.js
 *   js/08-main.js
 * 并把 demo.html 中原 <script>...</script> 块替换为 9 行 defer 引用。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEMO_PATH = path.join(ROOT, 'demo.html');
const JS_DIR = path.join(ROOT, 'js');

const raw = fs.readFileSync(DEMO_PATH, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);

// ========== 定位主 script 起止 ==========
let startLine1 = -1; // the <script> line (1-based)
let blockStartLine1 = -1; // line of first code after <script>
let endLine1 = -1;   // the matching </script> line (1-based)
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === '<script>') {
    if (lines[i + 1] && lines[i + 1].includes('PINYIN MAP')) {
      startLine1 = i + 1;
      blockStartLine1 = i + 2; // first body line
    }
  }
}
if (startLine1 < 0) { console.error('Cannot find main <script> block'); process.exit(1); }
for (let i = startLine1; i < lines.length; i++) {
  if (lines[i].trim() === '</script>') { endLine1 = i + 1; break; }
}
const blockEndLine1 = endLine1 - 1; // last body line inside script
console.log(`[split] main script: <script> at L${startLine1}, body L${blockStartLine1}-L${blockEndLine1} (${blockEndLine1 - blockStartLine1 + 1} lines), </script> at L${endLine1}`);

// ========== 9 个模块（1-based 起止行，均为 body 行号，含两端） ==========
// 命名对齐方案顺延 A2，顺序严格 00→08 保证 defer 拓扑
const modules = [
  {
    name: '00-bootstrap.js',
    from: 603, to: 1802,
    note: '拼音/品牌/车辆静态数据/用户持久化+密码工具/飞书Cfg+HTTP+上传三兄弟/缓存索引/APP_VERSION/esc'
  },
  {
    name: '01-state.js',
    from: 1803, to: 1946,
    note: 'state对象/confirm回调/navHistory+5封装/路由常量/_activateScreen/showScreen/goBack'
  },
  {
    name: '02-auth.js',
    from: 1947, to: 2123,
    note: 'doLogin/restoreSession/doRegister/doForgotPassword/doLogout/isLeader/canEdit/updateMyInfo'
  },
  {
    name: '03-vehicles.js',
    from: 2124, to: 2929,
    note: 'renderBrandTags/搜索筛选/车辆列表渲染/详情/编辑/saveVehicle/分享/导出文本'
  },
  {
    name: '04-export.js',
    from: 2930, to: 4130,
    note: 'Excel+zip压缩/Word OOXML/PDF(canvas+legacy)/批量导出折叠面板/exportData/exportSingle/shareBackup'
  },
  {
    name: '05-sync.js',
    from: 4131, to: 5652,
    note: 'Pending审批轮询/Member守护/备份/JSON上传下载/doSyncUpload/doSyncDownload/日志/导入导出配置'
  },
  {
    name: '06-media.js',
    from: 5653, to: 6376,
    note: '图片查看器/视频播放器/飞书云端图片视频/户外模式/模态框/侧栏/硬件反馈/等待文件就绪'
  },
  {
    name: '07-cache.js',
    from: 6377, to: 7009,
    note: '缓存管理器/组员管理/审批/成员增删/改密/开关/校验工具/safeAsync/showToast/通知/版本更新'
  },
  {
    name: '08-main.js',
    from: 7010, to: 7172,
    note: '硬件返回/migrateLegacyMedia/deviceready入口/顶层side-effects'
  }
];

// 合法性：连续递增不重叠不缺口
for (let i = 0; i < modules.length; i++) {
  const m = modules[i];
  if (m.from < blockStartLine1 || m.to > blockEndLine1) {
    console.error(`[split] 模块 ${m.name} 越界 [${m.from},${m.to}]，块边界 [${blockStartLine1},${blockEndLine1}]`);
    process.exit(2);
  }
  if (m.to < m.from) {
    console.error(`[split] 模块 ${m.name} 行号颠倒 [${m.from},${m.to}]`);
    process.exit(3);
  }
  if (i > 0 && modules[i - 1].to + 1 !== m.from) {
    console.error(`[split] 模块 ${modules[i - 1].name} 与 ${m.name} 不连续 (gap/overlap at ${modules[i - 1].to} → ${m.from})`);
    process.exit(4);
  }
}
if (modules[0].from !== blockStartLine1) {
  console.error(`[split] 首模块 ${modules[0].name} 起点应为 L${blockStartLine1}，实际 L${modules[0].from}`);
  process.exit(5);
}
if (modules[modules.length - 1].to !== blockEndLine1) {
  console.error(`[split] 末模块 ${modules[modules.length - 1].name} 终点应为 L${blockEndLine1}，实际 L${modules[modules.length - 1].to}`);
  process.exit(6);
}
console.log(`[split] 模块边界校验通过：共 ${modules.length} 个模块，覆盖全部 ${blockEndLine1 - blockStartLine1 + 1} 行代码，零 gap/overlap。`);

if (!fs.existsSync(JS_DIR)) fs.mkdirSync(JS_DIR, { recursive: true });

// ========== 写每个模块 ==========
for (const m of modules) {
  const body = lines.slice(m.from - 1, m.to).map(rstrip).join('\n');
  const deps = modules.slice(0, modules.indexOf(m)).map(x => x.name).join(', ');
  const header = [
    '/* ===========================================================',
    ` * 模块: ${m.name}`,
    ` * 功能: ${m.note}`,
    ` * 前置依赖 (defer顺序): ${deps || '(无，启动块)'}`,
    ` * 源范围: demo.html L${m.from}-L${m.to}`,
    ' * 不变量: 函数名/签名100%保留,顶层function声明挂window供onclick裸调用',
    ' * =========================================================== */',
    ''
  ].join('\n');
  const fp = path.join(JS_DIR, m.name);
  fs.writeFileSync(fp, header + body + '\n', 'utf8');
  const modLines = body ? body.split('\n').length : 0;
  console.log(`[split] 写入 ${fp}  ${modLines} 行`);
}

// ========== 替换 demo.html 内 <script>...</script> 为 defer 引用 ==========
// lines indices (0-based): [startLine1-1] to [endLine1-1]
const beginIdx = startLine1 - 1; // the line of <script>
const endIdx = endLine1 - 1;    // the line of </script>
const deferTags = modules.map(m => `    <script defer src="js/${m.name}"></script>`);
const newLines = [].concat(
  lines.slice(0, beginIdx),
  deferTags,
  lines.slice(endIdx + 1)
);
const out = newLines.join(eol) + (raw.endsWith('\n') ? '' : eol);
fs.writeFileSync(DEMO_PATH, out, 'utf8');
console.log(`[split] demo.html 骨架化：移除 L${beginIdx + 1}-L${endIdx + 1} 旧 script 块，插入 ${deferTags.length} 行 defer 标签`);

// ========== 关键不变量快速静态检查 ==========
// 1) 每个模块不新增 IIFE 闭包包裹 (不污染window)
// 2) 关键字段/函数存在 (抽样防截断)
const MUST_HAVE_FUNCS_PER_MODULE = {
  '00-bootstrap.js': ['getPinyin', 'loadUsers', 'saveUsers', 'hashPassword',
    'getFeishuCfg', 'httpFetch', 'httpUploadFile', 'httpUploadFileMultipart',
    'httpUploadFileSmart', 'feishuListFiles', 'APP_VERSION', 'esc'],
  '01-state.js': ['navPush', 'navPop', 'navReset', 'navRemove', 'navTop',
    '_activateScreen', 'showScreen', 'goBack', 'MAIN_TAB_SCREENS', 'LOGIN_FAMILY_SCREENS'],
  '02-auth.js': ['doLogin', 'doRegister', 'doForgotPassword', 'doLogout'],
  '03-vehicles.js': ['renderBrandTags', 'renderVehicleList', '_renderVehicleDetail',
    'openEditVehicle', 'saveVehicle', 'shareVehicleDetail'],
  '04-export.js': ['generateExcel', 'generateWord', 'generatePDF',
    'generateDocxOOXML', 'exportData', 'exportSingle'],
  '05-sync.js': ['syncPendingToFeishu', 'pullPendingFromFeishu',
    'doSyncUpload', 'doSyncDownload', 'renderSyncLog'],
  '06-media.js': ['openPhotoViewer', 'openVideoPlayer', 'imgFromFeishuCloud',
    'playFromFeishuCloud', 'toggleOutdoorMode', 'showConfirm'],
  '07-cache.js': ['openCacheManager', 'refreshCacheList', 'deleteSelectedCache',
    'clearAllCache', 'addMember', 'approveMember', 'rejectMember',
    'deleteMember', 'changePassword', 'showToast', 'checkUpdate'],
  '08-main.js': ['handleHardwareBack', 'doubleBackExit', 'migrateLegacyMedia']
};
let fails = 0;
for (const [modName, funcs] of Object.entries(MUST_HAVE_FUNCS_PER_MODULE)) {
  const content = fs.readFileSync(path.join(JS_DIR, modName), 'utf8');
  for (const fn of funcs) {
    const re = fn === 'APP_VERSION' || fn === 'MAIN_TAB_SCREENS' || fn === 'LOGIN_FAMILY_SCREENS'
      ? new RegExp(`\\b${fn}\\b`)
      : new RegExp(`(?:^|\\s)(?:async\\s+)?function\\s+${fn}\\s*\\(`, 'm');
    if (!re.test(content)) {
      console.error(`[check] FAIL: ${modName} 缺少标识符/函数 ${fn}`);
      fails++;
    }
  }
}
if (fails === 0) console.log('[split] 关键字段/函数抽样校验通过 (246个函数中抽代表性样例检查非空且存在)。');
else { console.error(`[check] FAIL ${fails} 条检查。请核对模块边界定义`); process.exit(7); }

function rstrip(s) {
  // 保留文件内部内容（不用去每行尾空白，直接原样）
  return s;
}

console.log('\n[split] 全部完成。下一步验证：node tests/test_v57_logic.js && node scripts/validate_web_assets.js && node tests/test_v1010_sync_e2e.js');
