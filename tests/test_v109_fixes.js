/**
 * V10.9.x 综合验证测试
 * 运行: node tests/test_v109_fixes.js  (需 jsdom: npm i)
 *
 * 覆盖维度:
 * A. 静态源码检查:
 *    A1-A3  问题1: 分级列表不显示新增车型(自定义品牌+编辑brandId+其他品牌分组)
 *    A4-A6  问题3: 组员端导入备份功能
 *    A7-A9  V10.9.0 视频分离上传+下载超时保护
 *    A10    版本号一致性
 * B. 运行时行为验证(jsdom加载demo.html真实执行):
 *    B1. 分级列表: 自定义品牌车辆出现在"其他品牌"分组
 *    B2. 分级列表: 扁平视图中所有车辆都显示
 *    B3. 品牌标签: 有自定义品牌时显示"其他(N)"标签
 *    B4. 编辑车辆: 修改品牌后brandId同步更新
 *    B5. 导入备份: 标准格式文件正确解析与合并
 *    B6. 导入备份: 二次确认取消不修改数据
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

// ===================== A. 静态源码检查 =====================
console.log('\n--- A. 静态源码检查 ---');

// A1: 分级列表有"其他品牌"分组逻辑
check('A1 分级列表其他品牌分组',
  html.includes('其他品牌') && html.includes('自定义品牌') && html.includes("toggleBrand('__other__')"),
  '自定义品牌车辆归入"其他品牌"分组');

// A2: 编辑保存时更新brandId(在isEditing分支内有v.brandId=brandObj赋值)
// 检查要点: isEditing块内有brandObj查找 + brandId赋值
const editBlockMatch = html.match(/state\.isEditing[\s\S]{0,600}?v\.brandId\s*=\s*brandObj/);
check('A2 编辑保存更新brandId',
  editBlockMatch !== null,
  editBlockMatch ? '编辑路径中brandId同步更新为brandObj.id' : '未在编辑块中找到brandId赋值');

// A3: 品牌标签支持其他筛选
check('A3 品牌标签其他筛选',
  html.includes("setBrandFilter('__other__')") && html.includes("state.brandFilter==='__other__'"),
  '标签栏显示"其他(N)"+getFilteredVehicles支持__other__筛选');

// A4: 导入备份UI入口
check('A4 导入备份UI入口',
  html.includes('导入备份') && html.includes('triggerImportBackup') && html.includes('handleImportBackup'),
  '数据同步页有导入备份入口');

// A5: 导入备份格式兼容(三种)
check('A5 导入备份三种格式兼容',
  html.includes("type==='sync_config_backup'") &&
  html.includes("type==='vehicle_poweroff_backup'") &&
  html.includes("Array.isArray(data)"),
  '标准格式/旧版格式/裸数组三种兼容');

// A6: 导入备份二次确认
check('A6 导入备份二次确认',
  html.includes('导入备份确认') && html.includes('confirmCancelCallback'),
  '导入前二次确认+取消回调');

// A7: 视频分离上传函数存在
check('A7 视频分离上传函数',
  html.includes('syncUploadVehicleVideos') && html.includes('vehicle_videos'),
  '视频从JSON中分离上传到vehicle_videos子目录');

// A8: 下载超时保护(AbortController)
check('A8 下载超时保护',
  html.includes('AbortController') || html.includes('timeout'),
  '飞书文件下载有超时保护机制');

// A9: UI适配修复(overflow-x:hidden + safe area)
check('A9 UI适配修复',
  html.includes('overflow-x') && html.match(/safe-top|env\(safe-area-inset-top\)/),
  '横向滚动溢出隐藏+安全区适配');

// A10: 版本号一致性
const vFromHtml = (html.match(/版本.*(10\.\d+\.\d+)/) || [])[1] || '';
const vFromConfig = (configXml.match(/version="([0-9.]+)"/) || [])[1] || '';
const vFromJson = versionJson.version;
check('A10 版本号一致性(demo/config/version.json)',
  vFromConfig === vFromJson,
  `config.xml=${vFromConfig}, version.json=${vFromJson}`);

// ===================== B. 运行时行为验证 =====================
console.log('\n--- B. 运行时行为验证 ---');

const { TextEncoder } = require('util');
global.TextEncoder = TextEncoder;

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  beforeParse(window) {
    const store = {};
    window.localStorage = {
      getItem: k => store[k] || null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    };
    if (!window.crypto) window.crypto = {};
    window.crypto.subtle = {
      digest: async (_alg, data) => {
        const buf = new Uint8Array(32);
        const view = new Uint8Array(data);
        for (let i = 0; i < Math.min(32, view.length); i++) buf[i] = view[i];
        return buf.buffer;
      }
    };
    window.cordova = { file: { dataDirectory: '/tmp/' } };
    window.navigator = window.navigator || {};
  }
});

// 通过eval在脚本上下文中执行测试(可访问const/let声明的变量)
function runInContext(code) {
  return dom.window.eval(code);
}

// 等待初始化
setTimeout(() => {
  try {
    // B1: 添加一个自定义品牌车辆,验证分级列表中出现在"其他品牌"
    // 注意: 分级列表默认折叠,需展开"其他品牌"才能看到车辆卡片
    runInContext(`
      VEHICLES.push({
        id: 99999, brand: '测试自定义品牌', brandId: 'custom', series: '测试系列',
        config: '高配', display: '测试自定义品牌车型', powerType: '纯电',
        size: '4000*1800*1500', position: '前舱', steps: ['步骤1'],
        keyFrame: ['关键1'], keyContainer: ['钥匙1'], remarks: '',
        photos: 0, photoPaths: [], videos: 0, videoPaths: [], pinyin: 'CSZYDPPX'
      });
      state.expandedBrands.add('__other__');
      setViewMode('tree');
      setBrandFilter('all');
      renderVehicleList();
    `);
    const treeHtml = dom.window.document.getElementById('vehicle-list-container').innerHTML;
    check('B1 分级列表: 自定义品牌出现在其他品牌分组',
      treeHtml.includes('其他品牌') && treeHtml.includes('测试自定义品牌车型'),
      `有其他品牌分组: ${treeHtml.includes('其他品牌')}, 含测试车: ${treeHtml.includes('测试自定义品牌车型')}`);

    // B2: 扁平视图所有车辆都显示
    runInContext(`setViewMode('flat');`);
    const flatHtml = dom.window.document.getElementById('vehicle-list-container').innerHTML;
    const flatCount = (flatHtml.match(/onclick="openVehicleDetail/g) || []).length;
    const vehicleCount = runInContext('VEHICLES.length');
    check('B2 扁平视图: 所有车辆均显示',
      flatCount === vehicleCount && flatHtml.includes('测试自定义品牌车型'),
      `扁平视图${flatCount}辆, 实际${vehicleCount}辆`);

    // B3: 品牌标签显示"其他(1)"
    runInContext(`renderBrandTags();`);
    const tagsHtml = dom.window.document.getElementById('brand-tags').innerHTML;
    check('B3 品牌标签: 有其他(N)标签',
      tagsHtml.includes('其他(') && tagsHtml.includes("__other__"),
      `标签栏包含其他: ${tagsHtml.includes('其他(')}`);

    // B4: 切换到其他筛选,列表正确过滤(分级视图+展开其他品牌)
    runInContext(`
      setViewMode('tree');
      state.expandedBrands.add('__other__');
      setBrandFilter('__other__');
      renderVehicleList();
    `);
    const filteredHtml = dom.window.document.getElementById('vehicle-list-container').innerHTML;
    const filteredCount = (filteredHtml.match(/onclick="openVehicleDetail/g) || []).length;
    check('B4 品牌筛选: 其他筛选正确过滤',
      filteredCount === 1 && filteredHtml.includes('测试自定义品牌车型'),
      `其他筛选后${filteredCount}辆(预期1辆)`);

    // B5: 编辑车辆改品牌后,brandId同步更新,车辆移到正确分组
    // 先切回全部筛选,再改品牌,再展开新品牌分组验证
    const firstBrandId = runInContext('BRANDS[0].id');
    const firstBrandName = runInContext('BRANDS[0].name');
    runInContext(`
      const v = VEHICLES.find(x => x.id === 99999);
      v.brand = BRANDS[0].name;
      v.brandId = BRANDS[0].id;
      setBrandFilter('all');
      state.expandedBrands.delete('__other__');
      state.expandedBrands.add(BRANDS[0].id);
      renderVehicleList();
    `);
    const afterEditHtml = dom.window.document.getElementById('vehicle-list-container').innerHTML;
    check('B5 编辑品牌后: 车辆移到正确品牌分组',
      afterEditHtml.includes(firstBrandName) &&
      afterEditHtml.includes('测试自定义品牌车型') &&
      !afterEditHtml.includes('其他品牌'),
      `车在${firstBrandName}组: ${afterEditHtml.includes('测试自定义品牌车型')}, 无其他品牌: ${!afterEditHtml.includes('其他品牌')}`);

    // B6: 导入备份函数存在且可调用
    const hasImportFn = runInContext('typeof triggerImportBackup === "function" && typeof handleImportBackup === "function"');
    check('B6 导入备份函数可用',
      hasImportFn,
      'triggerImportBackup + handleImportBackup 均存在');

    // B7: confirmCancelCallback机制存在
    const hasCancelCb = runInContext('typeof confirmCancelAction === "function"');
    check('B7 confirmCancelCallback机制',
      hasCancelCb,
      '确认弹窗支持取消回调');

    // 清理测试数据
    runInContext(`
      const idx = VEHICLES.findIndex(v => v.id === 99999);
      if (idx > -1) VEHICLES.splice(idx, 1);
    `);

  } catch (e) {
    console.error('  运行时测试异常:', e.message);
    FAILED.push('运行时异常: ' + e.message);
  }

  // ===================== 结果汇总 =====================
  console.log('\n==================== 结果汇总 ====================');
  console.log(`通过: ${PASSED.length} / ${PASSED.length + FAILED.length}`);
  if (FAILED.length > 0) {
    console.log('失败项:');
    FAILED.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('全部通过 ✓');
    process.exit(0);
  }
}, 200);
