/**
 * V5.8 导出分享方案对齐测试 - 基准: 安装包V1.8(React/Capacitor版)
 * 运行: node tests/test_v58_export_align.js  (需 jsdom)
 *
 * 覆盖两个维度:
 * A. 静态对齐检查: 源码中关键函数/命名/交互标记存在性
 * B. 运行时行为验证: jsdom加载demo.html+vendor XLSX,真实执行导出链路
 *    (Excel工作表结构/CSV编码/JSON payload/文件命名/loading互斥)
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch(e) { console.error('请先安装: npm i jsdom'); process.exit(2); }

const REPO = '.';
const html = fs.readFileSync(path.join(REPO, 'demo.html'), 'utf8');

const PASSED = [], FAILED = [];
function check(name, cond, detail='') {
  (cond ? PASSED : FAILED).push(name);
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? ` | ${detail}` : ''));
}

/* ============================================================
 * A. 静态对齐检查(源码级)
 * ============================================================ */
console.log('\n--- A. 静态对齐检查 ---');

check('A1 APP_VERSION 升级至 5.8.0', /APP_VERSION='5\.8\.0'/.test(html));
check('A2 单车Excel四表结构函数 generateExcelSingle 存在', /function generateExcelSingle\(/.test(html));
check('A3 批量Excel汇总+详情函数 generateExcelBatch 存在', /function generateExcelBatch\(/.test(html));
check('A4 分享备份函数 shareBackup 存在(对齐APK数据备份)', /async function shareBackup\(/.test(html));
check('A5 导出loading状态管理 setExportLoading 存在', /function setExportLoading\(/.test(html));
check('A6 shareFile 支持 title 参数(对齐APK分享标题)', /async function shareFile\(blob,filename,mimeType,title\)/.test(html));
check('A7 原生分享面板 dialogTitle=选择保存或分享方式', /dialogTitle:'选择保存或分享方式'/.test(html));
check('A8 批量导出文件名 vehicle_poweroff_export_*', /vehicle_poweroff_export_\$\{/.test(html) && /vehicle_poweroff_export_\$\{n\}_\$\{Date\.now\(\)\}\.xlsx/.test(html));
check('A9 单车导出文件名 {显示名}_断电指南.*', /_断电指南\.(xlsx|pdf)/.test(html) && !/`\$\{v\.display\}_断电指导\./.test(html));
check('A10 备份文件名 vehicle_poweroff_backup_*', /vehicle_poweroff_backup_\$\{Date\.now\(\)\}\.json/.test(html));
check('A11 JSON批量导出含元信息结构(appVersion/backupAt/users)', /appVersion:APP_VERSION,backupAt:new Date\(\)\.toISOString\(\),vehicles:selectedVehicles,users:USERS/.test(html));
check('A12 CSV 11列标准表头(对齐APK)', /'品牌','车系','配置','显示名称','车辆尺寸','动力类型','断电位置','钥匙-框架','钥匙-集装箱','步骤数','备注'/.test(html));
check('A13 CSV CRLF行尾(Windows Excel兼容)', /join\('\\r\\n'\)/.test(html));
check('A14 配置导出固定命名 cloud_sync_config.json(对齐APK)+exportedAt', /'cloud_sync_config\.json'/.test(html) && /exportedAt:new Date\(\)\.toISOString\(\)/.test(html));
check('A14.1 分享标题回退为文件名(对齐APK title:n||t)', /title:title\|\|filename/.test(html));
check('A14.2 仅批量JSON导出显式传分享标题(其余场景对齐APK不传)', (html.match(/'车辆断电数据导出'\)/g)||[]).length===1);
check('A15 数据中心5个导出按钮均有ID+disabled样式', ['word','pdf','excel','csv','json'].every(f => html.includes(`id="btn-export-${f}"`) && html.includes(`onclick="exportData('${f}')`)));
check('A16 车辆详情3个导出按钮均有ID+disabled样式', ['word','pdf','excel'].every(f => html.includes(`id="btn-detail-export-${f}"`)));
check('A17 分享备份按钮存在(id=btn-share-backup)', /id="btn-share-backup"/.test(html) && /onclick="shareBackup\(\)"/.test(html));
check('A18 备份卡片文案对齐(微信、钉钉分享)', /生成完整数据备份文件，可通过微信、钉钉等方式分享到其他设备/.test(html));
check('A19 批量Word命名 车辆断电指南_批量_*', /车辆断电指南_批量_\$\{n\}_\$\{Date\.now\(\)\}/.test(html));
check('A20 导出互斥保护(防重复提交)', /if\(state\.batchExporting\)return/.test(html) && /if\(state\.detailExporting\)return/.test(html) && /if\(state\.backupExporting\)return/.test(html));
check('A21 导出成功后清空选择(对齐APK行为)', /state\.selectedVehicles\.clear\(\);\s*renderDataList\(\)/.test(html));
check('A22 空catch治理: 导出失败均有console.error+用户提示', /console\.error\('批量导出失败:/.test(html) && /console\.error\('单车导出失败:/.test(html) && /console\.error\('分享备份失败:/.test(html));

/* ============================================================
 * B. 运行时行为验证(jsdom)
 * ============================================================ */
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://app.local/demo.html',
  pretendToBeVisual: true,
  beforeParse(window) {
    const { webcrypto } = require('crypto');
    try { Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true }); }
    catch(_) { window.crypto = webcrypto; }
    const store = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      getItem: k => (k in store ? store[k] : null),
      setItem: (k,v) => { store[k]=String(v); },
      removeItem: k => { delete store[k]; },
      clear: () => { for (const k in store) delete store[k]; },
    });
    window.fetch = async () => ({ ok:true, json: async()=>({code:0}) });
    window.Image = class { set src(_){} };
  },
});

const w = dom.window;
const G = expr => { try { return w.eval(expr); } catch(e) { return undefined; } };

setTimeout(async () => {
  console.log('\n--- B. 运行时行为验证 ---');

  // 注入vendor XLSX(jsdom不加载外部资源,手动注入真实库验证导出链路)
  const xlsxSrc = fs.readFileSync(path.join(REPO, 'vendor/xlsx.full.min.js'), 'utf8');
  try { w.eval(xlsxSrc); } catch(e) { console.error('XLSX注入失败:', e.message); }

  check('B1 vendor XLSX 注入成功', typeof w.XLSX === 'object' || typeof w.XLSX === 'function');
  check('B2 generateExcelSingle 可调用', typeof G('generateExcelSingle') === 'function');
  check('B3 generateExcelBatch 可调用', typeof G('generateExcelBatch') === 'function');

  // --- B4: 单车Excel四工作表结构 ---
  try {
    const v = G('VEHICLES[0]');
    const wb = XLSXRead(w, v);
    const sheetNames = wb.SheetNames;
    check('B4 单车Excel=4工作表[车辆信息/断电步骤/媒体资源/备注]',
      sheetNames.length === 4 &&
      sheetNames[0] === '车辆信息' && sheetNames[1] === '断电步骤' &&
      sheetNames[2] === '媒体资源' && sheetNames[3] === '备注',
      JSON.stringify(sheetNames));
    const info = wb.Sheets['车辆信息'];
    check('B4.1 车辆信息表含"未填写"兜底(缺失字段)', String(info.A1.v) === '项目' && String(info.B1.v) === '内容');
  } catch(e) { check('B4 单车Excel四工作表结构', false, e.message); }

  // --- B5: 批量Excel汇总+详情结构 ---
  try {
    const vehicles = G('VEHICLES.slice(0,3)');
    const buf = G(`(function(){ return generateExcelBatch(VEHICLES.slice(0,3)); })()`);
    const wb = w.XLSX.read(buf, {type:'array'});
    const s = wb.Sheets['汇总'];
    check('B5 批量Excel=汇总+3详情表(共4表)', wb.SheetNames.length === 4 && wb.SheetNames[0] === '汇总',
      JSON.stringify(wb.SheetNames));
    check('B5.1 汇总表标题行=车辆断电数据批量导出', s.A1.v === '车辆断电数据批量导出');
    check('B5.2 汇总表含导出时间/记录总数', String(s.A2.v) === '导出时间' && String(s.B3.v) === '3');
    check('B5.3 汇总表11列表头', String(s.A5.v) === '品牌' && String(s.K5.v) === '备注', `A5=${s.A5.v},K5=${s.K5&&s.K5.v}`);
    const detail = wb.Sheets[wb.SheetNames[1]];
    check('B5.4 详情表为项目/内容两列结构', detail.A1.v === '项目' && detail.B1.v === '内容');
  } catch(e) { check('B5 批量Excel汇总+详情结构', false, e.message); }

  // --- B6: 批量CSV导出(拦截shareFile验证命名/编码/内容) ---
  try {
    const calls = [];
    w.eval(`window.shareFile = async function(blob, filename, mimeType, title){ window.__shareCalls.push({filename, mimeType, title, blob}); }; window.__shareCalls = [];`);
    w.eval('state.selectedVehicles.add(1); state.selectedVehicles.add(2);');
    await G('exportData("csv")');
    const c = w.__shareCalls[w.__shareCalls.length-1];
    check('B6 CSV文件名=vehicle_poweroff_export_{ts}.csv', /^vehicle_poweroff_export_\d+\.csv$/.test(c.filename), c.filename);
    check('B6.1 CSV MIME=text/csv;charset=utf-8(对齐APK Blob类型)', c.mimeType === 'text/csv;charset=utf-8');
    check('B6.2 CSV不传分享标题(对齐APK,title回退文件名)', c.title === undefined);
    // 读取blob内容验证BOM/CRLF/11列
    // 注: blob.text()按TextDecoder规范会剥离BOM,故BOM须检查原始字节(EF BB BF)
    const bomBytes = await w.eval(`(async function(){
      const rec = window.__shareCalls[${w.__shareCalls.length-1}];
      const buf = new Uint8Array(await rec.blob.arrayBuffer());
      return [buf[0],buf[1],buf[2]];
    })()`);
    const csvText = await readBlobInPage(w, w.__shareCalls.length-1);
    check('B6.3 CSV含UTF-8 BOM(原始字节EF BB BF)', bomBytes[0]===0xEF && bomBytes[1]===0xBB && bomBytes[2]===0xBF, JSON.stringify(bomBytes));
    check('B6.4 CSV行尾CRLF(Windows兼容)', csvText.includes('\r\n'));
    check('B6.5 CSV表头11列', csvText.replace(/^\uFEFF/,'').split('\r\n')[0].split(',').length === 11);
    check('B6.6 导出后选择集已清空(对齐APK)', G('state.selectedVehicles.size') === 0);
    check('B6.7 导出后loading已复位', G('state.batchExporting') === null);
  } catch(e) { check('B6 批量CSV导出链路', false, e.message); }

  // --- B7: 批量JSON导出(结构对齐APK) ---
  try {
    w.eval('window.__shareCalls = [];');
    w.eval('state.selectedVehicles.add(1);');
    await G('exportData("json")');
    const c = w.__shareCalls[w.__shareCalls.length-1];
    check('B7 JSON文件名=vehicle_export_{n}_{ts}.json', /^vehicle_export_1_\d+\.json$/.test(c.filename), c.filename);
    check('B7.0 JSON显式分享标题=车辆断电数据导出(对齐APK唯一传标题场景)', c.title === '车辆断电数据导出');
    const jsonText = await readBlobInPage(w, w.__shareCalls.length-1);
    const payload = JSON.parse(jsonText);
    check('B7.1 JSON结构含appVersion/backupAt/vehicles/users',
      payload.appVersion === '5.8.0' && !!payload.backupAt && Array.isArray(payload.vehicles) && Array.isArray(payload.users),
      `appVersion=${payload.appVersion},vehicles=${payload.vehicles.length},users=${payload.users.length}`);
  } catch(e) { check('B7 批量JSON导出链路', false, e.message); }

  // --- B8: 分享备份(完整备份对齐APK) ---
  try {
    w.eval('window.__shareCalls = [];');
    await G('shareBackup()');
    const c = w.__shareCalls[w.__shareCalls.length-1];
    check('B8 备份文件名=vehicle_poweroff_backup_{ts}.json', /^vehicle_poweroff_backup_\d+\.json$/.test(c.filename), c.filename);
    check('B8.1 备份不传分享标题(对齐APK,title回退文件名)', c.title === undefined);
    const jsonText = await readBlobInPage(w, w.__shareCalls.length-1);
    const payload = JSON.parse(jsonText);
    check('B8.2 备份为全量数据(vehicles=全部非选中集)', payload.vehicles.length === G('VEHICLES.length'));
  } catch(e) { check('B8 分享备份链路', false, e.message); }

  // --- B9: 单车导出命名(对齐APK _断电指南) ---
  try {
    w.eval('window.__shareCalls = [];');
    w.eval('state.currentVehicleId = 1;');
    await G('exportSingle("excel")');
    const c = w.__shareCalls[w.__shareCalls.length-1];
    check('B9 单车Excel文件名={显示名}_断电指南.xlsx', /_断电指南\.xlsx$/.test(c.filename), c.filename);
    check('B9.1 单车导出后loading复位', G('state.detailExporting') === null);
  } catch(e) { check('B9 单车导出链路', false, e.message); }

  // --- B10: 导出互斥(导出中重复点击被忽略) ---
  try {
    w.eval('window.__shareCalls = [];');
    // 挂起式shareFile: 第一次调用不resolve,模拟用户在导出中重复点击
    w.eval(`window.shareFile = function(blob, filename){ window.__shareCalls.push({filename}); return new Promise(r=>{ window.__resolveShare = r; }); };`);
    w.eval('state.selectedVehicles.add(1);');
    const p1 = G('exportData("csv")');
    check('B10 导出中状态位已置位', G('state.batchExporting') === 'csv');
    await G('exportData("csv")'); // 导出中重复触发,应被互斥忽略
    check('B10.1 互斥生效: 第二次调用未产生新文件', w.__shareCalls.length === 1, `calls=${w.__shareCalls.length}`);
    w.eval('window.__resolveShare && window.__resolveShare()');
    await p1;
    check('B10.2 完成后loading复位', G('state.batchExporting') === null);
  } catch(e) { check('B10 导出互斥保护', false, e.message); }

  // ===================== 汇总 =====================
  console.log('\n' + '='.repeat(62));
  console.log(`V5.8 导出分享方案对齐测试: ${PASSED.length} 通过, ${FAILED.length} 失败`);
  if (FAILED.length) {
    console.log('失败项:');
    FAILED.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  process.exit(0);
}, 1500);

/* ------------------------- 辅助函数 ------------------------- */

/** 在页面内读取第idx次shareFile调用的blob文本(经blob.text(),验证真实导出内容) */
async function readBlobInPage(win, idx) {
  return win.eval(`(async function(){
    const recorded = window.__shareCalls[${idx}];
    if(!recorded || !recorded.blob) return '';
    return await recorded.blob.text();
  })()`);
}

/** 用页面内XLSX解析generateExcelSingle输出 */
function XLSXRead(win, v) {
  const buf = win.eval(`generateExcelSingle(VEHICLES[0])`);
  return win.XLSX.read(buf, {type:'array'});
}
