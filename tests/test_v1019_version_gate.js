/* ============================================================
 * V10.19.1 版本一致性门禁专项测试
 * 运行: node tests/test_v1019_version_gate.js
 *
 * 背景: scripts/check_version_consistency.js 原先只校验 config.xml /
 *       version.json / APP_VERSION 三处, sw.js 的 CACHE_NAME、demo.html 的
 *       版本展示位、以及 js 里 `APP_VERSION || 'X.Y.Z'` 的兜底字面量全都漏网。
 *       sw.js 是**缓存优先**且 CACHE_NAME 绑版本号——漏掉它, 升版后用户会一直
 *       加载缓存里的旧 JS("改了没生效"的高发根因)。
 *
 * 设计原则(避免"纸上通过"):
 *  1. 不只断言"当前一致", 还断言"门禁确实覆盖了这些位置"(防日后被删)
 *  2. S7 用**变异测试**证明门禁真的会拦: 在临时副本里逐个注入漂移, 断言门禁
 *     必须失败且报错指向正确位置。只断言源码里"有 getSwCache 这个函数名"
 *     是不够的——那是静态文本匹配, 函数不被调用也照样通过。
 *  3. 变异在 os.tmpdir() 的副本里做, 绝不动真实工作树。
 * =========================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ver = JSON.parse(src('version.json'));
const CUR = String(ver.version);

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){
  if(cond){ pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t){ console.log('\n========== ' + t + ' =========='); }

console.log('当前应用版本(基准 version.json): ' + CUR + ' / versionCode=' + ver.versionCode);

/* ===== S1 门禁本身必须通过 ===== */
section('S1 版本一致性门禁执行');
function runGateAt(cwd){
  try {
    const out = execFileSync('node', [path.join('scripts', 'check_version_consistency.js')],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exit: 0, out };
  } catch (e) {
    return { exit: 1, out: String((e.stdout || '') + (e.stderr || '')) };
  }
}
const gate = runGateAt(ROOT);
console.log(gate.out.trim().split('\n').map(l => '  | ' + l).join('\n'));
check('S1a npm run test:version 门禁退出码为 0', gate.exit === 0, gate.out.trim().slice(0, 300));
/** 门禁输出里的错误行(去掉标题行) */
const gateErrors = gate.out.split('\n').filter(l => /^\s*-\s/.test(l)).map(l => l.replace(/^\s*-\s*/, '').trim());

/* ===== S2 sw.js 缓存名 ===== */
section('S2 sw.js CACHE_NAME 必须与版本同步(缓存诅咒根因)');
const swSrc = src('sw.js');
const swM = swSrc.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
check('S2a sw.js 存在 CACHE_NAME 常量', !!swM, String(swM && swM[1]));
const swVer = swM ? (String(swM[1]).match(/(\d+\.\d+\.\d+)/) || [])[1] : null;
check('S2b CACHE_NAME 内嵌版本号', !!swVer, String(swM && swM[1]));
check('S2c CACHE_NAME 版本 === version.json 版本', swVer === CUR, 'sw=' + swVer + ' 期望=' + CUR);
check('S2d 缓存名带版本前缀(升版必然换桶)', !!swM && new RegExp('^tcg-poweroff-v' + CUR.replace(/\./g, '\\.') + '$').test(String(swM[1])), String(swM && swM[1]));
check('S2e sw.js 为缓存优先策略(故版本必须绑桶)', /cacheFirst|缓存优先|caches\.match/.test(swSrc), '(决定 CACHE_NAME 不同步会致用户跑旧JS)');

/* ===== S3 demo.html 展示位 ===== */
section('S3 demo.html 本地版本展示位');
const html = src('demo.html');
const demoM = html.match(/id="sync-local-ver"[^>]*>\s*v?(\d+\.\d+\.\d+)\s*</);
check('S3a demo.html 存在 sync-local-ver 展示位', !!demoM, String(demoM && demoM[1]));
check('S3b 展示版本 === version.json 版本', !!demoM && demoM[1] === CUR, String(demoM && demoM[1]));

/* ===== S4 js 兜底字面量 ===== */
section('S4 js/ 中 APP_VERSION 兜底字面量不得过期');
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).sort();
const stale = [];
let fbCount = 0;
for(const f of jsFiles){
  const text = src(path.join('js', f));
  const re = /APP_VERSION\s*\|\|\s*['"](\d+\.\d+\.\d+)['"]/g;
  let m;
  while((m = re.exec(text)) !== null){
    fbCount++;
    if(m[1] !== CUR) stale.push('js/' + f + ':' + text.slice(0, m.index).split('\n').length + ' = ' + m[1]);
  }
}
console.log('  扫描 js/ 共 ' + jsFiles.length + ' 个文件, 命中兜底字面量 ' + fbCount + ' 处');
check('S4a 无过期兜底版本字面量', stale.length === 0, stale.join(' | '));
check('S4b 扫描器确实扫过 js/ 目录(防止目录为空导致假通过)', jsFiles.length > 0, 'jsFiles=' + jsFiles.length);

/* ===== S5 门禁覆盖面静态自检(防检查项被删, 弱证据) ===== */
section('S5 门禁覆盖面静态自检(弱证据, 强证据见 S7 变异测试)');
const gateSrc = src('scripts/check_version_consistency.js');
check('S5a 门禁源码含 sw.js 检查', /getSwCache/.test(gateSrc));
check('S5b 门禁源码含 demo.html 检查', /getDemoHtml/.test(gateSrc));
check('S5c 门禁源码含 js 兜底字面量检查', /getVersionFallbacks/.test(gateSrc));
check('S5d 原有三项能力未丢(config.xml / version.json / APP_VERSION)',
  /getConfigXml/.test(gateSrc) && /getVersionJson/.test(gateSrc) && /getBootstrap/.test(gateSrc));
check('S5e 门禁被 npm test:version 接线(不是孤儿脚本)',
  /check_version_consistency/.test(src('package.json')), '(门禁没被接线等于不存在)');

/* ===== S6 meta.json 是数据镜像版本, 不参与强校验 ===== */
section('S6 web-data/meta.json 属数据镜像版本, 不参与强校验(防假警报)');
let metaVer = null;
try {
  const meta = JSON.parse(src('web-data/meta.json'));
  metaVer = String(meta.version || '').replace(/^v/, '');
  console.log('  meta.json 数据镜像版本: v' + metaVer + ' (应用版本: ' + CUR + ')');
  /* 关键: 断言"门禁的错误里没有 meta.json 相关项", 而不是"门禁整体通过"。
   * 后者会被别的漂移污染, 从而给出错误的通过信号。 */
  const metaErrs = gateErrors.filter(e => /meta\.json|数据镜像/.test(e));
  check('S6a 门禁未因 meta.json 版本不同而失败(仅提示)', metaErrs.length === 0, metaErrs.join(' | '));
  check('S6b meta.json 版本确实来自数据镜像(vehicle_sync_data.json), 非应用版本',
    metaVer === String(JSON.parse(src('web-data/vehicle_sync_data.json')).version || '').replace(/^v/, '') || metaVer === 'mirror',
    'meta=' + metaVer);
  check('S6c 生成器把 vehicle.version 写入 meta.version(证明是数据源而非手填)',
    /version:\s*vehicle\.version\s*\|\|/.test(src('scripts/sync_web_data.js')));
} catch (e) {
  check('S6 meta.json 可读', false, e.message);
}

/* ============================================================
 * S7 变异测试: 证明门禁真的会拦(强证据)
 * 在 os.tmpdir() 里搭一份最小仓库副本, 逐个注入漂移, 断言门禁必须失败
 * 且报错指向正确位置。绝不动真实工作树。
 * ============================================================ */
section('S7 变异测试: 门禁必须真的会拦(在临时副本中注入漂移)');
function buildSandbox(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-gate-'));
  const cp = (rel, rel2) => {
    const dst = path.join(dir, rel2 || rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
  };
  cp('scripts/check_version_consistency.js');
  cp('config.xml'); cp('version.json'); cp('sw.js'); cp('demo.html');
  cp('js/00-bootstrap.js');
  /* 门禁 getAboutHistoryTop() 强校验 VERSION_HISTORY 最新版本, 沙箱必须带上
   * 该文件, 否则副本基线会因 ENOENT 误红(见 S7a 变异测试自洽性要求)。 */
  cp('js/11-about.js');
  try { cp('web-data/meta.json'); } catch (e) { /* 可选 */ }
  return dir;
}
function mutate(dir, rel, from, to){
  const p = path.join(dir, rel);
  const text = fs.readFileSync(p, 'utf8');
  if(text.indexOf(from) < 0) throw new Error('变异基线未命中: ' + rel + ' :: ' + from);
  fs.writeFileSync(p, text.split(from).join(to), 'utf8');
}
function putJs(dir, name, content){
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'js', name), content, 'utf8');
}

const sb = buildSandbox();
const base = runGateAt(sb);
check('S7a 沙箱副本基线通过(证明副本自洽, 后续失败确由变异引起)', base.exit === 0, base.out.trim().slice(0, 200));

// 变异1: sw.js 缓存名回退旧版本 —— 这正是"用户永远跑旧JS"的根因
try {
  mutate(sb, 'sw.js', CACHE_OF(), 'tcg-poweroff-v10.0.0');
  const r = runGateAt(sb);
  check('S7b 注入 sw.js 缓存名漂移 -> 门禁必须失败', r.exit !== 0, 'exit=' + r.exit);
  check('S7c 且报错指向 sw.js', /sw\.js/.test(r.out), r.out.trim().slice(0, 160));
  mutate(sb, 'sw.js', 'tcg-poweroff-v10.0.0', CACHE_OF()); // 还原
} catch (e) { check('S7b sw.js 变异可执行', false, e.message); }

// 变异2: demo.html 展示位回退
try {
  mutate(sb, 'demo.html', '>v' + CUR + '<', '>v10.0.0<');
  const r = runGateAt(sb);
  check('S7d 注入 demo.html 展示版本漂移 -> 门禁必须失败', r.exit !== 0, 'exit=' + r.exit);
  check('S7e 且报错指向 demo.html', /demo\.html|sync-local-ver/.test(r.out), r.out.trim().slice(0, 160));
  mutate(sb, 'demo.html', '>v10.0.0<', '>v' + CUR + '<'); // 还原
} catch (e) { check('S7d demo.html 变异可执行', false, e.message); }

// 变异3: config.xml versionCode 不一致
try {
  mutate(sb, 'config.xml', 'android-versionCode="' + ver.versionCode + '"', 'android-versionCode="100000"');
  const r = runGateAt(sb);
  check('S7f 注入 config.xml versionCode 漂移 -> 门禁必须失败', r.exit !== 0, 'exit=' + r.exit);
  check('S7g 且报错指向 versionCode', /versionCode/.test(r.out), r.out.trim().slice(0, 160));
  mutate(sb, 'config.xml', 'android-versionCode="100000"', 'android-versionCode="' + ver.versionCode + '"');
} catch (e) { check('S7f config.xml 变异可执行', false, e.message); }

// 变异4: js 兜底字面量过期(本次真实修复的那一类)
try {
  putJs(sb, '_mut_fallback.js', "const x = APP_VERSION || '9.9.9';\n");
  const r = runGateAt(sb);
  check('S7h 注入 js 过期兜底字面量 -> 门禁必须失败', r.exit !== 0, 'exit=' + r.exit);
  check('S7i 且报错指向兜底字面量', /兜底/.test(r.out), r.out.trim().slice(0, 160));
  fs.unlinkSync(path.join(sb, 'js', '_mut_fallback.js'));
} catch (e) { check('S7h js 兜底变异可执行', false, e.message); }

// 变异5: meta.json 版本不同 -> 门禁**不得**失败(证明不是假警报源)
try {
  if(fs.existsSync(path.join(sb, 'web-data/meta.json'))){
    const mp = path.join(sb, 'web-data/meta.json');
    const meta = JSON.parse(fs.readFileSync(mp, 'utf8'));
    const old = meta.version;
    meta.version = 'v10.0.0';
    fs.writeFileSync(mp, JSON.stringify(meta, null, 2), 'utf8');
    const r = runGateAt(sb);
    check('S7j 注入 meta.json 数据版本漂移 -> 门禁仍通过(不制造假警报)', r.exit === 0, r.out.trim().slice(0, 160));
    meta.version = old;
    fs.writeFileSync(mp, JSON.stringify(meta, null, 2), 'utf8');
  } else {
    check('S7j meta.json 存在于沙箱', false, '未找到');
  }
} catch (e) { check('S7j meta.json 变异可执行', false, e.message); }

// 收尾: 还原后沙箱必须回到通过态(证明上述变异都已还原, 无残留污染)
const after = runGateAt(sb);
check('S7k 全部变异还原后沙箱恢复通过(无残留污染)', after.exit === 0, after.out.trim().slice(0, 200));
try { fs.rmSync(sb, { recursive: true, force: true }); } catch (e) { /* 临时目录清理失败无妨 */ }

console.log('\n=========================================');
console.log('结果: 通过 ' + pass + ' / 失败 ' + fail);
if(fail){ console.log('失败项:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('=========================================');
process.exit(fail ? 1 : 0);

/** 读取当前 sw.js 的 CACHE_NAME 字面量(供变异/还原使用) */
function CACHE_OF(){
  const m = src('sw.js').match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
  if(!m) throw new Error('无法解析 CACHE_NAME');
  return m[1];
}
