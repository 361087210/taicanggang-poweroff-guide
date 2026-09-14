#!/usr/bin/env node
'use strict';
/* ===========================================================
 * 轻量密钥扫描器(自包含, 无外部依赖) — 防再次把密钥提交进仓库。
 * 扫描仓库内所有文本文件(排除 .git/node_modules/web-data/构建产物),
 * 命中任一规则即非零退出, 阻断 CI / 本地提交。
 *
 * 规则:
 *   1) GitHub PAT: ghp_ / github_pat_ 前缀
 *   2) 飞书 App Secret(已知泄露值再次出现)
 *   3) 常见密钥关键字 + 赋值(高熵串)
 *
 * 误报抑制(V10.18.0 增强):
 *   a) 忽略扫描器自身(isSelf, 路径分隔符已统一为正斜杠后再匹配)
 *   b) 忽略注释行(# / // / /* / <!--), 避免把"示例代码/占位符"当真密钥
 *   c) 忽略占位符值(xxxxx / ***** / <...> / your-xxx 等)
 *   d) 提供显式豁免: 行内包含 noqa:secret 的行整体跳过。
 *      用于 SECURITY.md 记录"已轮换的旧凭据"、测试里断言"密钥不存在"等合法场景。
 *      注意: 豁免必须逐行显式标注, 不得整文件豁免, 以免削弱门禁。
 * =========================================================== */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || process.cwd();
const SKIP = new Set(['.git', 'node_modules', 'web-data', 'dist', 'build', '.workbuddy']);
// 已知泄露的飞书 App Secret(必须轮换, 此处仅用于"不允许再出现")
const KNOWN_LEAK = 's35nEpUBk8KtxN3Kwl2AEgUNnwXQHABb';

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (isText(p)) out.push(p);
  }
}

/**
 * 扫描器自身合法引用已知泄露值用于检测, 不应被自身规则命中。
 * ⚠️ 注意: path.join('.', 'scripts') 产出的是不带前导分隔符的 "scripts/secret-scan.js",
 *    因此匹配必须允许「行首或分隔符」作为边界(原题 ^ 处漏了边界导致自身豁免永久失效)。
 */
function isSelf(p) {
  return /(^|\/)scripts\/secret-scan\.js$/.test(p.replace(/\\/g, '/'));
}

function isText(p) {
  const ext = path.extname(p).toLowerCase();
  const textExt = ['.js', '.ts', '.json', '.html', '.css', '.xml', '.yml', '.yaml', '.md', '.txt', '.py', '.sh', '.env', '.toml', '.ini'];
  if (!textExt.includes(ext)) return false;
  try { fs.readFileSync(p, 'utf8'); return true; } catch (_) { return false; }
}

/** 占位符判定: 全同字符 / x* 类 / 尖括号模板 / your-xxx */
function isPlaceholder(v) {
  if (/^([xX*.\-_])\1+$/.test(v)) return true;
  if (/^[<{\[]+.+[>}\]]+$/.test(v)) return true;
  if (/^(your|placeholder|example|changeme|xxx|todo)/i.test(v)) return true;
  return false;
}

/**
 * 取"有效检测内容":
 *   ① 丢弃带 noqa:secret 豁免标记的行
 *   ② 丢弃整行注释(# / // / /* / * / <!--), 避免示例赋值被误判
 */
function effectiveBody(content) {
  return content.split(/\r?\n/)
    .filter(l => !/noqa:secret/i.test(l))
    .filter(l => !/^\s*(\/\/|#|\/\*|\*|<!--)\s?/.test(l))
    .join('\n');
}

const findings = [];
for (const f of (function () { const a = []; walk(ROOT, a); return a; })()) {
  if (isSelf(f)) continue;
  let content;
  try { content = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  const body = effectiveBody(content);
  if (!body) continue;

  // 规则1: GitHub PAT
  if (/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}/.test(body)) {
    findings.push({ file: f, rule: 'GitHub PAT' });
  }
  // 规则2: 已知泄露飞书 Secret 再次出现
  if (body.includes(KNOWN_LEAK)) {
    findings.push({ file: f, rule: 'Known leaked Feishu App Secret' });
  }
  // 规则3: 形如 appSecret = '32位串'(排除占位符)
  const re = /(app_?secret|appSecret)\s*[:=]\s*['"]([^'"]{24,})['"]/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (isPlaceholder(m[2])) continue;
    findings.push({ file: f, rule: 'appSecret literal assignment' });
    break;
  }
}

if (findings.length) {
  console.error('[secret-scan] 发现疑似密钥泄露:');
  findings.forEach(f => console.error('  - ' + f.rule + '  @ ' + path.relative(ROOT, f.file)));
  console.error('\n提示: 若属「记录已轮换凭据/断言密钥不存在」等合法引用,' +
    '请在该行加 noqa:secret 标记显式豁免(仅豁免该行)。');
  process.exit(1);
}
console.log('[secret-scan] 未发现密钥泄露, 通过 ✓');
