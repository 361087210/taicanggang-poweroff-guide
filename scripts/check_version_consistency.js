#!/usr/bin/env node
/**
 * 版本一致性校验脚本（发版准入门槛）
 * 校验三处版本来源是否一致，并确保 versionCode 与 version 的数值编码一致。
 *
 * 来源：
 *  1. config.xml         -> widget@version + widget@android-versionCode
 *  2. version.json       -> version + versionCode
 *  3. js/00-bootstrap.js -> const APP_VERSION
 *
 * 失败时退出码非 0，供 `npm run test:version` 作为门禁使用。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

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

  // 1. 三个来源的 version 一致
  const versions = new Set([cfg.version, ver.version, boot.version]);
  if (versions.size !== 1) {
    errors.push(`version 不一致: config.xml=${cfg.version}, version.json=${ver.version}, 00-bootstrap=${boot.version}`);
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
}

main();
