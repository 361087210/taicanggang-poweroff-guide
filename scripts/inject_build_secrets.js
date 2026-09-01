#!/usr/bin/env node
/**
 * V10.12.0 构建时注入飞书Secret
 * 用法(源码根目录):
 *   node scripts/inject_build_secrets.js              # 读取当前 demo.html, 注入/覆写__BUILD_SECRETS__
 *   node scripts/inject_build_secrets.js --check      # 只校验环境变量存在性,不改文件(CI前置)
 *   node scripts/inject_build_secrets.js --strip      # 移除注入的脚本标签(还原源码/用于git commit前)
 *
 * 环境变量(缺一即非零退出,防止构建出空Secret APK):
 *   FEISHU_APP_ID        - 飞书应用ID (cli_*)
 *   FEISHU_APP_SECRET    - 飞书应用Secret (唯一真正机密,绝不能入库)
 *   FEISHU_FOLDER_TOKEN  - 项目根目录Token(公开值,但注入可切换环境)
 *
 * 可选:
 *   FEISHU_STRICT=0      - 缺env变量时仅警告不抛错(本地预览用)
 *   DEMO_HTML_PATH       - demo.html 路径(默认: <scriptDir>/../demo.html)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const DEMO_PATH = process.env.DEMO_HTML_PATH || path.resolve(SCRIPT_DIR, '..', 'demo.html');
const INJECT_MARK_BEGIN = '<!-- BUILD_SECRETS_BEGIN (scripts/inject_build_secrets.js) -->';
const INJECT_MARK_END   = '<!-- BUILD_SECRETS_END -->';

function escJsStr(s){ return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r'); }

function readEnv(name){
  const v = process.env[name];
  return (typeof v === 'string') ? v.trim() : '';
}

/** 已存在的注入块删除,返回清理后的HTML */
function stripInjected(html){
  const re = new RegExp(
    '\\s*' + INJECT_MARK_BEGIN.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&') +
    '[\\s\\S]*?' +
    INJECT_MARK_END.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&') + '\\s*',
    'g'
  );
  return html.replace(re, '\n');
}

function buildInjectScriptBlock(appId, appSecret, folderToken){
  // 不写入源码到磁盘:直接把注入块放到 </head> 之前
  const inner =
    "  <script>\n" +
    "    window.__BUILD_SECRETS__ = {\n" +
    "      appId: '" + escJsStr(appId) + "',\n" +
    "      appSecret: '" + escJsStr(appSecret) + "',\n" +
    "      folderToken: '" + escJsStr(folderToken) + "'\n" +
    "    };\n" +
    "    Object.defineProperty(window, '__BUILD_SECRETS_CONSUMED__', { configurable: false, writable: false, value: false });\n" +
    "  </script>\n";
  return '\n' + INJECT_MARK_BEGIN + '\n' + inner + '  ' + INJECT_MARK_END + '\n';
}

function fail(msg){
  process.stderr.write('[inject_build_secrets] ERROR: ' + msg + '\n');
  process.exit(1);
}

function main(){
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const stripOnly = args.includes('--strip');
  const strict = process.env.FEISHU_STRICT !== '0'; // 默认严格:缺就死

  const appId = readEnv('FEISHU_APP_ID');
  const appSecret = readEnv('FEISHU_APP_SECRET');
  const folderToken = readEnv('FEISHU_FOLDER_TOKEN');

  const missing = [];
  if (!appId) missing.push('FEISHU_APP_ID');
  if (!appSecret) missing.push('FEISHU_APP_SECRET');
  if (!folderToken) missing.push('FEISHU_FOLDER_TOKEN');

  if (missing.length) {
    const msg = '缺失构建环境变量: ' + missing.join(', ');
    if (strict) fail(msg + '。设置后再构建,或临时 FEISHU_STRICT=0 仅做本地预览。');
    process.stderr.write('[inject_build_secrets] WARN: ' + msg + '(FEISHU_STRICT=0, 继续但APK飞书功能将只能依赖设置页手动配置。)\n');
  }

  if (checkOnly) {
    process.stdout.write('[inject_build_secrets] ✓ 环境变量检查' + (missing.length ? ' (警告非致命)' : '通过') + '\n');
    process.exit(missing.length && strict ? 1 : 0);
  }

  // 读取 & 清理旧的注入块
  if (!fs.existsSync(DEMO_PATH)) fail('demo.html 不存在: ' + DEMO_PATH);
  let html = fs.readFileSync(DEMO_PATH, 'utf8');
  html = stripInjected(html);

  if (stripOnly) {
    fs.writeFileSync(DEMO_PATH, html, 'utf8');
    process.stdout.write('[inject_build_secrets] ✓ 已移除注入的脚本标签(源码已还原)\n');
    process.exit(0);
  }

  // 注入新的脚本标签(插入到 </head> 之前)
  const block = (appId && appSecret && folderToken)
    ? buildInjectScriptBlock(appId, appSecret, folderToken)
    : ('\n' + INJECT_MARK_BEGIN + '\n  <!-- 注入禁用: 未检测到完整FEISHU_*环境变量(已严格模式会拦截构建) -->\n  ' + INJECT_MARK_END + '\n');

  if (!/<\/head>/i.test(html)) fail('demo.html 中找不到 </head> 标签,无法注入');
  html = html.replace(/<\/head>/i, m => (block + '  ' + m));

  fs.writeFileSync(DEMO_PATH, html, 'utf8');
  process.stdout.write('[inject_build_secrets] ✓ 已写入构建期Secret注入标记到 demo.html\n');
  process.exit(missing.length && strict ? 1 : 0); // 严格模式下缺秘钥即使写入占位也报错
}

main();
