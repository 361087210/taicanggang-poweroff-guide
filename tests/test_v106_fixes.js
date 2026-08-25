/**
 * V10.6.0 根因修复验证测试
 * 运行: node tests/test_v106_fixes.js  (需 jsdom: npm i)
 *
 * 覆盖维度:
 * A. 静态源码检查:
 *    A1-A8   问题1: Word真OOXML生成器+中文PDF画布链路(根因: HTML伪docx+jsPDF无CJK字形)
 *    A9-A13  问题2: 跨网络申请完全隐形(hidden标记+全UI过滤+即消费即删+仅console留痕)
 *    A14-A16 问题3: 本地备份直存通道(saveBlobToLocalFolder,不调分享控件)
 *    A17-A23 问题4: IndexedDB持久化+照片分离上传(根因: 内存态数据+base64直传膨胀)
 *    A24-A26 问题6: 版本10.6.0三处一致性
 * B. 运行时行为验证(jsdom加载demo.html真实执行):
 *    B1. _xmlEsc OOXML文本转义
 *    B2. _strHashDjb2 幂等哈希(照片去重文件名)
 *    B3. _b64ToU8 base64解码
 *    B4. generateDocxOOXML 产出真ZIP(PK魔数)+正确MIME+document.xml入包
 *    B5. _buildExportHtml 中文HTML模板完整性
 *    B6. persistVehicles/loadPersistedVehicles 无IndexedDB环境优雅降级
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch(e) { console.error('请先安装: npm i jsdom'); process.exit(2); }

const REPO = '.';
const html = fs.readFileSync(path.join(REPO, 'demo.html'), 'utf8');
const configXml = fs.readFileSync(path.join(REPO, 'config.xml'), 'utf8');
const versionJson = JSON.parse(fs.readFileSync(path.join(REPO, 'version.json'), 'utf8'));

const PASSED = [], FAILED = [];
function check(name, cond, detail='') {
  (cond ? PASSED : FAILED).push(name);
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? ` | ${detail}` : ''));
}

/* ============================================================
 * A. 静态源码检查
 * ============================================================ */
console.log('\n--- A. 静态源码检查 ---');

// ---- 问题1: 导出文档生成管线重构 ----
console.log('-- 问题1: Word真OOXML + 中文PDF画布 --');
check('A1 问题1: html2canvas本地化打包(vendor脚本引用)', /<script src="vendor\/html2canvas\.min\.js"><\/script>/.test(html));
check('A2 问题1: 真OOXML docx生成器存在(标准包结构)',
  /async function generateDocxOOXML\(vehicles,photoMap\)/.test(html)
  && html.includes('[Content_Types].xml') && html.includes('word/document.xml')
  && html.includes('word/styles.xml') && html.includes('_rels/.rels'));
check('A3 问题1: docx经_zipWrite产出真ZIP(非HTML伪装)', /const u8=_zipWrite\(entries\);/.test(html));
check('A4 问题1: docx中文按字体名引用微软雅黑(打开端本地渲染,天然无乱码)', html.includes('w:eastAsia="微软雅黑"') && html.includes('w:hint="eastAsia"'));
check('A5 问题1: generateWord主链路=真OOXML(失败才降级htmlDocx)',
  /async function generateWord\(vehicles,photoMap\)\{[\s\S]{0,200}return await generateDocxOOXML\(vehicles,photoMap\);/.test(html));
check('A6 问题1: 中文PDF画布链路存在(DOM→html2canvas→A4图像分页→jsPDF)',
  /async function generatePDFCanvas\(vehicles,photoMap\)/.test(html)
  && /html2canvas\(holder,\{scale:2/.test(html)
  && /pdf\.addImage\(slice\.toDataURL\('image\/jpeg'/.test(html));
check('A7 问题1: generatePDF主链路=画布中文渲染(失败回退文本链路)',
  /async function generatePDF\(vehicles,photoMap\)\{[\s\S]{0,120}return await generatePDFCanvas\(vehicles,photoMap\);/.test(html)
  && /generatePDFLegacy\(vehicles,photoMap\)/.test(html));
check('A8 问题1: 导出HTML模板抽取复用(Word降级链与PDF同源同构)', /function _buildExportHtml\(vehicles,photoMap\)/.test(html));

// ---- 问题2: 跨网络申请完全隐形 ----
console.log('-- 问题2: 跨网络申请隐形通过 --');
const pullFnMatch = html.match(/async function pullPendingFromFeishu[\s\S]*?\n\}/);
const pullFnSrc = pullFnMatch ? pullFnMatch[0] : '';
check('A9 问题2: 跨端申请即时激活(active+hidden+crossPlatform三标记)',
  /u\.crossPlatform=true;\s*\n\s*u\.hidden=true;\s*\n\s*u\.status='active';/.test(html));
check('A10 问题2: 已存在用户补齐隐形标记(防旧数据漏过滤)',
  /existingUser\.status='active';\s*\n\s*existingUser\.crossPlatform=true;\s*\n\s*existingUser\.hidden=true;/.test(html));
check('A11 问题2: 即消费即删云端申请文件(防反复消费/目录堆积)',
  pullFnSrc.includes('deletePendingFileFromFeishu(u.phone)'));
check('A12 问题2: 跨端处理完全隐形——仅console留痕,无Toast/通知/日志UI',
  /跨网络申请已默认通过\(不显示\)/.test(html) && !/leaderNotify\([^)]*跨网络/.test(html));
check('A13 问题2: 组员列表+待审列表双过滤隐形用户',
  /!u\.hidden&&!u\.crossPlatform/.test(html)
  && html.match(/!u\.hidden&&!u\.crossPlatform/g).length >= 2);

// ---- 问题3: 本地备份直存 ----
console.log('-- 问题3: 本地备份不调分享控件 --');
const backupFnMatch = html.match(/async function doBackup\(\)\{[\s\S]*?\n\}/);
const backupFnSrc = backupFnMatch ? backupFnMatch[0] : '';
check('A14 问题3: 本地备份走直存通道saveBlobToLocalFolder', backupFnSrc.includes('saveBlobToLocalFolder(blob,filename)'));
check('A15 问题3: 本地备份分支零分享调用(无shareFile/系统面板)',
  !/shareFile\(/.test(backupFnSrc.split("target==='feishu'")[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));
check('A16 问题3: 直存通道复用V10.5.0目录解析+权限分流(下载/太仓港断电指导)',
  /async function saveBlobToLocalFolder\(blob,filename\)/.test(html)
  && html.includes('_resolveSaveDestDir()') && html.includes('_ensureSavePermission()'));

// ---- 问题4: 数据持久化+照片分离上传 ----
console.log('-- 问题4: IndexedDB持久化+照片分离上传 --');
check('A17 问题4: IndexedDB持久化层存在(库tcg_poweroff/仓vehicles/键user_data)',
  /async function persistVehicles\(\)/.test(html) && /async function loadPersistedVehicles\(\)/.test(html)
  && html.includes("indexedDB.open('tcg_poweroff'") && html.includes("'user_data'"));
check('A18 问题4: 新增/编辑保存后立即持久化', /persistVehicles\(\);\s*\n\s*showToast\('保存成功'\)/.test(html));
check('A19 问题4: 删除车辆同步持久化', /VEHICLES\.splice\(idx,1\);persistVehicles\(\);/.test(html));
check('A20 问题4: 启动时序先恢复快照再渲染(异步IIFE包裹)', /\(async\(\)=>\{\s*\nawait loadPersistedVehicles\(\);/.test(html));
check('A21 问题4: 照片分离上传函数存在(降采样归一+哈希文件名+vehicle_images目录)',
  /async function syncUploadVehiclePhotos\(token,vehicles\)/.test(html)
  && /async function _normalizePhotoForUpload\(dataUrl,maxEdge\)/.test(html)
  && html.includes('user_v${v.id}_p${i+1}_${hash}.jpeg') && html.includes("getDataSubFolderToken(token,'vehicle_images')"));
check('A22 问题4: 同步上传前先分离照片再写JSON(根因修复顺序)',
  /const photoStat=await syncUploadVehiclePhotos\(token,VEHICLES\);/.test(html)
  && html.indexOf('syncUploadVehiclePhotos(token,VEHICLES)') < html.indexOf('正在上传同步数据'));
check('A23 问题4: 照片路径替换后持久化+同步合并后持久化(双钩子)',
  /if\(photoStat\.replaced>0\)\{\s*\n\s*persistVehicles\(\);/.test(html)
  && /if\(totalChanges>0\)persistVehicles\(\);/.test(html));

// ---- 问题6: 版本一致性 ----
console.log('-- 问题6: 版本10.6.0一致性 --');
check('A24 问题6: demo.html APP_VERSION=10.6.0', /const APP_VERSION='10\.6\.0';/.test(html));
check('A25 问题6: config.xml version/versionCode=10.6.0/100600',
  configXml.includes('version="10.6.0"') && configXml.includes('android-versionCode="100600"'));
check('A26 问题6: version.json 10.6.0+下载链接指向v10.6.0',
  versionJson.version === '10.6.0' && versionJson.versionCode === 100600
  && versionJson.downloadUrl.includes('v10.6.0'));

/* ============================================================
 * B. 运行时行为验证
 * ============================================================ */
console.log('\n--- B. 运行时行为验证 ---');

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
    window.fetch = async () => ({ ok:true, json: async()=>({code:0, data:{files:[]}}) });
  },
});
const w = dom.window;
const G = expr => { try { return w.eval(expr); } catch(e) { return undefined; } };

setTimeout(async () => {
  check('B0 页面加载无JS语法错误(内联脚本已执行)', typeof G('goBack') === 'function');

  // B1: OOXML文本转义
  const esc = G(`_xmlEsc('<a&"b">')`);
  check('B1 _xmlEsc OOXML特殊字符转义', esc === '&lt;a&amp;&quot;b&quot;&gt;', String(esc));

  // B2: djb2哈希幂等性(照片去重文件名基础)
  const h1 = G(`_strHashDjb2('dataURL模拟内容')`), h2 = G(`_strHashDjb2('dataURL模拟内容')`);
  check('B2 _strHashDjb2 同输入同输出(幂等去重)', h1 === h2 && typeof h1 === 'number' && h1 >= 0, `${h1} vs ${h2}`);

  // B3: base64解码('aGVsbG8='='hello'的base64, 5字节)
  const u8len = G(`_b64ToU8('aGVsbG8=').length`);
  check('B3 _b64ToU8 base64解码长度正确', u8len === 5, String(u8len));

  // B4: 真OOXML docx生成——ZIP魔数+MIME+包结构
  try {
    const blob = await G(`(async()=>{
      const v={id:999,brand:'测试品牌',series:'测试车系',config:'测试配置',display:'测试车型',
        powerType:'纯电',position:'主驾驶位',steps:['步骤一','步骤二'],
        keyFrame:['框架处理'],keyContainer:['集装箱处理'],remarks:'',
        photos:0,photoPaths:[],videos:0,videoPaths:[]};
      return await generateDocxOOXML([v]);
    })()`);
    const buf = Buffer.from(await blob.arrayBuffer());
    const isZip = buf[0] === 0x50 && buf[1] === 0x4B; // 'PK' ZIP魔数
    const mimeOk = blob.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    check('B4 generateDocxOOXML 产出真ZIP docx(PK魔数+正确MIME)', isZip && mimeOk && blob.size > 1000,
      `size=${blob.size} type=${blob.type.split('.').pop()}`);
  } catch(e) {
    check('B4 generateDocxOOXML 产出真ZIP docx(PK魔数+正确MIME)', false, e.message);
  }

  // B5: 导出HTML模板(中文PDF渲染源)
  const htmlOut = G(`_buildExportHtml([{id:1,brand:'比',series:'系',config:'配',display:'车型X',powerType:'纯电',position:'位',steps:['甲','乙'],keyFrame:['k1'],keyContainer:['k2'],remarks:'备注',photos:0,photoPaths:[],videos:0,videoPaths:[]}],{})`);
  check('B5 _buildExportHtml 中文模板完整(DOCTYPE+中文内容)',
    typeof htmlOut === 'string' && /<!DOCTYPE html>/i.test(htmlOut) && htmlOut.includes('车型X') && htmlOut.includes('断电'),
    `长度${htmlOut ? htmlOut.length : 0}`);

  // B6: 持久化层优雅降级(无IndexedDB/写入失败均不抛异常)
  try {
    const r1 = await G(`persistVehicles()`);
    const r2 = await G(`loadPersistedVehicles()`);
    check('B6 持久化层无异常降级(返回布尔不抛出)', typeof r1 === 'boolean' && typeof r2 === 'boolean', `persist=${r1} load=${r2}`);
  } catch(e) {
    check('B6 持久化层无异常降级(返回布尔不抛出)', false, e.message);
  }

  // ===== 汇总 =====
  console.log('\n========== 测试总结 ==========');
  console.log(`通过: ${PASSED.length}  失败: ${FAILED.length}`);
  if (FAILED.length) { console.log('失败项:', FAILED.join(', ')); process.exit(1); }
  console.log('✅ V10.6.0 全部验证通过');
  process.exit(0);
}, 1500);
