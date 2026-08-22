#!/usr/bin/env node
/**
 * V5.3.5 教学视频 GitHub Release 直链播放 专项测试
 * =====================================================
 * 背景: 23个真实断电教学视频重组上传至GitHub Release(media-videos标签),
 *       直链免鉴权+HTTP Range流式播放, 播放链升级为五源回退。
 * 覆盖: D1 直链映射表 / D2 mediaDirectUrl查询 / D3 五源回退链顺序
 *       D4 播放链解耦 / D5 映射与车型数据交叉校验 / D6 版本一致性
 *
 * 运行: node tests/test_v535_media_direct.js
 *   (可选在线校验: ONLINE=1 时抽样HEAD探测直链可达性)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = path.join(__dirname, '..');
let PASS = 0, FAIL = 0;

function check(name, cond, detail = '') {
  const mark = cond ? 'PASS' : 'FAIL';
  PASS += cond ? 1 : 0; FAIL += cond ? 0 : 1;
  console.log(`  [${mark}] ${name}${cond ? '' : '  ← ' + detail}`);
}
function section(t) { console.log(`\n===== ${t} =====`); }

const html = fs.readFileSync(path.join(BASE, 'demo.html'), 'utf8');
const vj = JSON.parse(fs.readFileSync(path.join(BASE, 'version.json'), 'utf8'));
const cfgXml = fs.readFileSync(path.join(BASE, 'config.xml'), 'utf8');
const ciwf = fs.readFileSync(path.join(BASE, '.github/workflows/android-release.yml'), 'utf8');

/** 沙箱提取demo.html中的具名函数体(带依赖常量) */
function evalFn(fnName, extraSrc = '') {
  const re = new RegExp(`function ${fnName}\\([^)]*\\)\\{`);
  const m = html.match(re);
  if (!m) return null;
  const start = m.index;
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = html.slice(start, i + 1);
  try {
    // eslint-disable-next-line no-new-func
    return new Function(extraSrc + '\n' + body + `\nreturn ${fnName};`)();
  } catch (e) { return null; }
}

// ==================== D1 直链映射表完整性 ====================
section('D1 MEDIA_DIRECT_ASSETS 映射表');

const mapMatch = html.match(/const MEDIA_DIRECT_ASSETS=\{([\s\S]*?)\};/);
check('MEDIA_DIRECT_ASSETS 常量存在', !!mapMatch);
check('MEDIA_RELEASE_BASE 指向 media-videos 标签',
  /MEDIA_RELEASE_BASE=`https:\/\/github\.com\/\$\{GITHUB_REPO\}\/releases\/download\/media-videos`/.test(html));

const MAP = {};
if (mapMatch) {
  // asset名格式为 tcgv_<10位hex>.mp4 (含.mp4扩展名)
  const entryRe = /'([^']+)'\s*:\s*'(tcgv_[0-9a-f]+\.mp4)'/g;
  let em;
  while ((em = entryRe.exec(mapMatch[1])) !== null) MAP[em[1]] = em[2];
}
const mapCount = Object.keys(MAP).length;
check(`映射条目数 = 23 (实际 ${mapCount})`, mapCount === 23);

const allAssetValid = Object.values(MAP).every(a => /^tcgv_[0-9a-f]{10}\.mp4$/.test(a));
check('所有asset名为 tcgv_+10位hex 规范', allAssetValid);
const assetSet = new Set(Object.values(MAP));
check('asset名无重复(哈希冲突防护)', assetSet.size === mapCount);

// ==================== D2 mediaDirectUrl 查询函数 ====================
section('D2 mediaDirectUrl 查询函数');

const deps = `
const GITHUB_REPO='361087210/taicanggang-poweroff-guide';
const MEDIA_RELEASE_BASE=\`https://github.com/\${GITHUB_REPO}/releases/download/media-videos\`;
const MEDIA_DIRECT_ASSETS=${JSON.stringify(MAP)};
`;
const mediaDirectUrl = evalFn('mediaDirectUrl', deps);
check('mediaDirectUrl 函数可提取', typeof mediaDirectUrl === 'function');
if (mediaDirectUrl) {
  const u1 = mediaDirectUrl('通用断电视频.mp4');
  check('已映射文件 → 返回Release直链', u1 === 'https://github.com/361087210/taicanggang-poweroff-guide/releases/download/media-videos/tcgv_b5fc668c92.mp4', String(u1));
  check('未映射文件 → null(走飞书回退)', mediaDirectUrl('新上传视频.mp4') === null);
  check('空入参 → null', mediaDirectUrl('') === null);
  check('undefined入参 → null', mediaDirectUrl(undefined) === null);
}

// ==================== D3 五源回退链顺序 ====================
section('D3 五源回退链(openVideoPlayer)');

check('源②直链在源①本地之后接入', /源①: 本地APK内路径[\s\S]{0,400}源②: GitHub Release直链/.test(html));
check('直链未命中时跳过直达飞书源③', /if\(directUrl\)\{[\s\S]*?tryFeishuVideoSource[\s\S]*?\}else\{[\s\S]*?tryFeishuVideoSource/.test(html));
check('飞书源失败仍回退jsDelivr源④', /playFromFeishuCloud\(video,fileName\)\.then\(ok=>\{[\s\S]*?cdnBase\+'\/'\+videoPath/.test(html));
check('最终兜底仍是诚实提示源⑤', /showVideoMissing\(fileName,video\)/.test(html));

// ==================== D4 播放链解耦 ====================
section('D4 tryFeishuVideoSource 解耦');

check('tryFeishuVideoSource 独立函数存在', /function tryFeishuVideoSource\(video,fileName,cdnBase,videoPath\)/.test(html));
check('openVideoPlayer 内无 >3 层嵌套回调', (() => {
  const m = html.match(/async function openVideoPlayer\(\)\{[\s\S]*?\n\}/);
  if (!m) return false;
  const fnBody = m[0];
  return (fnBody.match(/tryPlaySource/g) || []).length <= 2;
})());

// ==================== D5 映射与车型数据交叉校验 ====================
section('D5 映射与 vehicles_data.js 交叉校验');

// 载入车型数据(浏览器全局风格脚本, 用沙箱执行)
global.VEHICLES = undefined;
const vdSrc = fs.readFileSync(path.join(BASE, 'vehicles_data.js'), 'utf8');
let VEHICLES = [];
try {
  // eslint-disable-next-line no-new-func
  VEHICLES = new Function(vdSrc + '\nreturn typeof VEHICLES!=="undefined"?VEHICLES:(typeof window!=="undefined"?[]:[]);')() || [];
} catch (e) { /* 结构差异时降级为文本匹配 */ }

const videoRefs = new Set();
if (VEHICLES.length) {
  VEHICLES.forEach(v => (v.videoPaths || []).forEach(p => videoRefs.add(p.split('/').pop())));
} else {
  const re = /vehicle_videos\/([^"')\s]+)/g; let m2;
  while ((m2 = re.exec(vdSrc)) !== null) videoRefs.add(m2[1]);
}
check(`车型视频引用数 > 20 (实际 ${videoRefs.size})`, videoRefs.size > 20);

// 关键资产: 通用断电视频被最多车型引用, 必须在映射内
check('通用断电视频.mp4 在车型引用集合中', videoRefs.has('通用断电视频.mp4'));
check('通用断电视频.mp4 已映射直链', !!MAP['通用断电视频.mp4']);

// 每个映射的文件都应真实存在于车型引用(防止映射了无人用的死文件)
const orphanMaps = Object.keys(MAP).filter(k => !videoRefs.has(k));
check('映射表无孤儿条目(全部被车型引用)', orphanMaps.length === 0, '孤儿: ' + orphanMaps.join(', '));

// ==================== D6 版本一致性 ====================
section('D6 版本一致性(5.3.5)');

check('demo.html APP_VERSION=5.3.5', /APP_VERSION='5\.3\.5'/.test(html));
check('version.json version=5.3.5', vj.version === '5.3.5');
check('version.json 含 V5.3.5 changelog', (vj.changelog || []).some(c => c.includes('V5.3.5')));
check('config.xml version=5.3.5', /version="5\.3\.5"/.test(cfgXml));
check('config.xml versionCode=50305', /android-versionCode="50305"/.test(cfgXml));
check('CI workflow APP_VERSION=5.3.5', /APP_VERSION: '5\.3\.5'/.test(ciwf));
check('CI workflow BASE_VERSION_CODE=50305', /BASE_VERSION_CODE: 50305/.test(ciwf));

// ==================== ONLINE 在线探测(可选) ====================
if (process.env.ONLINE === '1') {
  section('ONLINE 直链可达性抽样探测');

  // 用系统curl探测: 天然遵循HTTPS_PROXY等代理环境变量(沙箱/CI环境直连可能超时)
  // -L必须: github.com直链经302跳转release-assets.githubusercontent.com(Azure Blob),
  // 该节点才是真正承载体(HEAD头无accept-ranges属正常, Range实测以206为准)。
  const { execFileSync } = require('child_process');
  function probe(url) {
    try {
      // Range实测(206=支持流式播放), -L跟随302到真实资产节点
      const out = execFileSync('curl', ['-s', '-L', '--max-time', '25', '-r', '0-1023',
        '-o', '/dev/null', '-w', '%{http_code} %{size_download}', url],
        { encoding: 'utf8', timeout: 30000 });
      const [status, size] = out.trim().split(/\s+/).map(Number);
      return { status, size };
    } catch (e) { return { status: 0, err: String(e).slice(0, 80) }; }
  }

  (async () => {
    const samples = ['通用断电视频.mp4', '比亚迪海豚_低配.mp4', '长安深蓝_S7_S5.mp4'];
    for (const name of samples) {
      const info = MAP[name];
      if (!info) { check(`${name} 映射缺失`, false); continue; }
      const url = `https://github.com/361087210/taicanggang-poweroff-guide/releases/download/media-videos/${info}`;
      const r = await Promise.resolve(probe(url));
      check(`${name} Range请求206(流式播放)`, r.status === 206, JSON.stringify(r));
      check(`${name} 实取1024字节(免鉴权可达)`, r.size === 1024, JSON.stringify(r));
    }
    finish();
  })();
} else {
  console.log('\n(提示: ONLINE=1 node tests/test_v535_media_direct.js 可附加在线直链探测)');
  finish();
}

function finish() {
  console.log(`\n========== 结果: ${PASS} PASS / ${FAIL} FAIL ==========`);
  process.exit(FAIL > 0 ? 1 : 0);
}
