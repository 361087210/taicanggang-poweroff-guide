#!/usr/bin/env node
/**
 * Cordova before_build 钩子: 构建APK前注入飞书Secret
 * 触发方式: Cordova CLI `cordova build android` 或 `cordova prepare` 前自动调用本钩子。
 * 行为: 调用仓库根的 scripts/inject_build_secrets.js(同源CI使用的同一脚本)。
 *       构建系统(CI/本地)需要先 export FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_FOLDER_TOKEN。
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

// Cordova 钩子脚本工作目录通常是项目根的 hooks/before_build/
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const INJECT_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'inject_build_secrets.js');

const proc = spawnSync(process.execPath, [INJECT_SCRIPT], {
  cwd: PROJECT_ROOT,
  stdio: 'inherit',
  env: process.env
});

if (proc.status !== 0) {
  process.stderr.write('[hook:before_build] inject_build_secrets.js 失败(状态码=' + proc.status + ')。请确认FEISHU_APP_ID/APP_SECRET/FOLDER_TOKEN环境变量已配置。中止构建。\n');
  process.exit(proc.status || 1);
}
