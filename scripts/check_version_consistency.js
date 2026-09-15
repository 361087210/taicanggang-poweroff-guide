#!/usr/bin/env node
/**
 * 版本一致性校验脚本（发版准入门槛）
 * 校验各版本来源是否与 version.json 一致，并确保 versionCode 与 version 的数值编码一致。
 *
 * 来源（强校验，不一致即失败）:
 *  1. config.xml         -> widget@version + widget@android-versionCode
 *  2. version.json       -> version + versionCode（基准）
 *  3. js/00-bootstrap.js -> const APP_VERSION
 *  4. sw.js              -> const CACHE_NAME 中的版本号
 *  5. demo.html          -> id="sync-local-ver" 展示的版本号
 *  6. js/*.js            -> `APP_VERSION || 'X.Y.Z'` 形式的兜底字面量
 *
 * ---------------------------------------------------------------------------
 * 为什么把 sw.js / demo.html / 兜底字面量也纳入(V10.19.1):
 *  sw.js 是**缓存优先**且 CACHE_NAME 绑版本号——版本号不跟着升, 用户会永远跑
 *  缓存里的旧 JS, 等于白部署(此前"视频修好了但用户看不到"的直接原因之一)。
 *  兜底字面量同理: 一旦 APP_VERSION 缺失就静默展示一个早已过期的版本号。
 *  这类漂移靠人肉记忆必然复发, 必须交给门禁。
 *
 * ---------------------------------------------------------------------------
 * 刻意**不**纳入强校验的一项: web-data/meta.json 的 version 字段。
 *  该字段是**数据镜像版本**(来自 vehicle_sync_data.json 的 version, 当前
 *  v10.17.1), 与应用版本不是同一个东西; 且它由 sync-web-data.yml 每 15 分钟
 *  cron 重新生成并推送。若拿它和应用版本做强校验, 门禁会在每个整 15 分钟自己
 *  变红一次——是假警报。故此处只做**提示**, 不阻断。
 *
 * 失败时退出码非 0，供 `npm run test:version` 作为门禁使用。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

/** @param {string} rel */
function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function getConfigXml() {
  const xml = readText('config.xml');
  const m = xml.match(/<widget[^>]*version="([^"]+)"[^>]*android-versionCode="([0-9]+)"/);
  if (!m) throw new Error('config.xml: 未找到 widget@version / android-versionCode');
  return { version: m[1], versionCode: m[2] };
}

function getVersionJson() {
  const json = JSON.parse(readText('version.json'));
  return { version: String(json.version), versionCode: String(json.versionCode) };
}

function getBootstrap() {
  const js = readText('js/00-bootstrap.js');
  const m = js.match(/const APP_VERSION\s*=\s*'([^']+)'/);
  if (!m) throw new Error('js/00-bootstrap.js: 未找到 APP_VERSION 常量');
  return { version: m[1] };
}

/**
 * sw.js: Service Worker 缓存名中携带的版本号
 * 缓存优先策略下 CACHE_NAME 不变 => 用户永远拿到旧资源, 是"改了没生效"的高发根因。
 * @returns {{version:string}|null} 解析不到返回 null(由调用方决定是否报错)
 */
function getSwCache() {
  const sw = readText('sw.js');
  const m = sw.match(/const\s+CACHE_NAME\s*=\s*['"][^'"]*?v?(\d+\.\d+\.\d+)['"]/);
  return m ? { version: m[1] } : null;
}

/**
 * demo.html: 同步页"本地版本"展示位
 * @returns {{version:string}|null}
 */
function getDemoHtml() {
  const html = readText('demo.html');
  const m = html.match(/id="sync-local-ver"[^>]*>\s*v?(\d+\.\d+\.\d+)\s*</);
  return m ? { version: m[1] } : null;
}

/**
 * js/*.js 中的版本兜底字面量: 形如 `APP_VERSION || '10.15.0'`
 * APP_VERSION 一旦缺失就会静默展示这个早已过期的值, 属于隐性漂移。
 * @returns {Array<{file:string, version:string, line:number}>}
 */
function getVersionFallbacks() {
  const out = [];
  if (!fs.existsSync(JS_DIR)) return out;
  for (const f of fs.readdirSync(JS_DIR).filter(n => n.endsWith('.js')).sort()) {
    const text = readText(path.join('js', f));
    const re = /APP_VERSION\s*\|\|\s*['"](\d+\.\d+\.\d+)['"]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ file: 'js/' + f, version: m[1], line: text.slice(0, m.index).split('\n').length });
    }
  }
  return out;
}

/**
 * js/11-about.js 关于板块 VERSION_HISTORY 数组的最新条目版本号。
 * 关于板块需随版本迭代同步更新, 最新版本必须与 version.json 对齐,
 * 否则"关于"页展示的版本历史落后于实际发版(网页版与安卓版共用此文件)。
 * @returns {string|null} 最新版本号(不含 V 前缀), 解析失败返回 null
 */
function getAboutHistoryTop() {
  const about = readText('js/11-about.js');
  const m = about.match(/const\s+VERSION_HISTORY\s*=\s*\[\s*\{\s*version:\s*'V?(\d+\.\d+\.\d+)'/);
  return m ? m[1] : null;
}

/** "10.15.1" -> "101501"：每段补零到 2 位后拼接（major*10000 + minor*100 + patch） */
function versionToCode(version) {
  const parts = version.split('.');
  if (parts.length !== 3 || !parts.every((p) => /^[0-9]+$/.test(p))) {
    throw new Error(`version 格式非法（需为 x.y.z 三段纯数字）: ${version}`);
  }
  return parts.map((p) => p.padStart(2, '0')).join('');
}

function main() {
  const errors = [];

  const cfg = getConfigXml();
  const ver = getVersionJson();
  const boot = getBootstrap();
  const sw = getSwCache();
  const demo = getDemoHtml();
  const fallbacks = getVersionFallbacks();

  // 1. 三个来源的 version 一致
  const versions = new Set([cfg.version, ver.version, boot.version]);
  if (versions.size !== 1) {
    errors.push(`version 不一致: config.xml=${cfg.version}, version.json=${ver.version}, 00-bootstrap=${boot.version}`);
  }

  // 1b. sw.js 缓存名版本必须同步(缓存优先策略下不同步 = 用户永远跑旧 JS)
  if (!sw) {
    errors.push('sw.js: 未能在 CACHE_NAME 中解析到版本号');
  } else if (sw.version !== ver.version) {
    errors.push(`sw.js 缓存名版本漂移: CACHE_NAME=${sw.version}, version.json=${ver.version}（不同步会导致用户一直加载缓存里的旧资源）`);
  }

  // 1c. demo.html 本地版本展示位
  if (!demo) {
    errors.push('demo.html: 未能在 id="sync-local-ver" 中解析到版本号');
  } else if (demo.version !== ver.version) {
    errors.push(`demo.html 展示版本漂移: sync-local-ver=${demo.version}, version.json=${ver.version}`);
  }

  // 1d. js 兜底字面量(APP_VERSION 缺失时会静默展示过期版本)
  for (const fb of fallbacks) {
    if (fb.version !== ver.version) {
      errors.push(`兜底版本字面量漂移: ${fb.file}:${fb.line} = ${fb.version}, version.json=${ver.version}`);
    }
  }

  // 1e. 关于板块版本历史(VERSION_HISTORY 最新条目须随迭代同步, 否则关于页落后于发版)
  const aboutTop = getAboutHistoryTop();
  if (!aboutTop) {
    errors.push('js/11-about.js: 未能在 VERSION_HISTORY 解析到最新版本');
  } else if (aboutTop !== ver.version) {
    errors.push(`关于板块版本历史未同步: VERSION_HISTORY 最新=${aboutTop}, version.json=${ver.version}（发版需同步更新关于页版本历史）`);
  }

  // 2. versionCode 一致
  if (cfg.versionCode !== ver.versionCode) {
    errors.push(`versionCode 不一致: config.xml=${cfg.versionCode}, version.json=${ver.versionCode}`);
  }

  // 3. versionCode 必须为纯数字，且等于 version 去点编码
  const canonical = (cfg.version && cfg.version.includes('.')) ? versionToCode(cfg.version) : cfg.version;
  if (!/^[0-9]+$/.test(ver.versionCode)) {
    errors.push(`versionCode 非纯数字: ${ver.versionCode}`);
  } else if (ver.versionCode !== canonical) {
    errors.push(`versionCode 与 version 编码不符: version=${ver.version} (期望 ${canonical}), versionCode=${ver.versionCode}`);
  }

  if (errors.length > 0) {
    console.error('[版本一致性校验] 失败:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }

  // 附注：versionCode 应随版本号递增（防止回退），此处仅提示非强制
  console.log(`[版本一致性校验] 通过: version=${cfg.version}, versionCode=${ver.versionCode}`);
  console.log(`  已覆盖: config.xml / version.json / 00-bootstrap / sw.js / demo.html / js兜底字面量(${fallbacks.length}处) / 关于板块版本历史`);

  /* 仅提示, 不阻断: web-data/meta.json 的 version 是**数据镜像版本**
   * (源自 vehicle_sync_data.json), 由 sync-web-data.yml 每 15 分钟 cron 重写,
   * 与应用版本本就不同源。做强校验会让门禁每 15 分钟自己红一次(假警报)。 */
  try {
    const meta = JSON.parse(readText('web-data/meta.json'));
    const mv = String(meta.version || '').replace(/^v/, '');
    if (mv && mv !== ver.version) {
      console.log(`  提示(非阻断): web-data/meta.json 数据镜像版本为 v${mv}（数据版本, 非应用版本, 由 cron 每15分钟重写）`);
    }
  } catch (e) { /* meta.json 缺失/异常与本门禁无关, 静默跳过 */ }
}

main();
