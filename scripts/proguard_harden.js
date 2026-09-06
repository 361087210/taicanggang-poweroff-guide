#!/usr/bin/env node
/**
 * V11.3 构建期 ProGuard/R8 混淆加固(过渡)
 * 对应 plan §建议3: Google Play 官方要求至少 ProGuard 混淆 + appSecret 字符串加密。
 * 字符串加密由 inject_build_secrets.js(before_build) 承担; 本脚本负责 R8 混淆工程配置。
 *
 * 触发时机: after_prepare —— 因为 platforms/android/ 由 `cordova prepare` 生成,
 *           build.gradle 在 prepare 之后才存在; before_build 时 gradle 尚未生成, 会白跑。
 *           (plan 里写的是 before_build 加固 hook, 经反方审查此处更正为 after_prepare,
 *            与已有 patch_projectbuilder.js 同为 prepare 后处理。)
 *
 * 行为(全部防御式, 幂等):
 *   1) platforms/android/app/build.gradle 的 release{} 开启 minifyEnabled + shrinkResources
 *   2) 确保 groovy 引用 app/proguard-rules.pro (proguardFiles)
 *   3) 生成/覆写 proguard-rules.pro —— 关键: 必须保留 Cordova JS Bridge 反射用的插件类,
 *      否则 R8 剥离后 APP 的 JS 调原生插件全挂(白屏/黑屏/无响应)。
 *
 * 环境变量:
 *   TCG_PROGUARD=0     跳过 R8 加固(仅本地 debug 调试用, 生产禁止)
 *
 * 反方审查(已知边界): 
 *   - R8 只混淆 Java/Dex 层, 不影响 assets/www/ 下 JS 源码;
 *     但 JS 里的 appSecret 密文已由 inject_build_secrets.js 处理, 双管齐下。
 *   - R8 混淆非绝对防护, 根治 = 秘钥下沉服务端(Phase1 Supabase/Bitable) + V11.4 M2 商用加固。
 */
'use strict';
const fs = require('fs');
const path = require('path');

if (process.env.TCG_PROGUARD === '0') {
  console.log('[proguard_harden] TCG_PROGUARD=0, 跳过 R8 加固(仅调试用)。');
  process.exit(0);
}

const PROJ = path.resolve(process.cwd());
const gradlePath = path.join(PROJ, 'platforms', 'android', 'app', 'build.gradle');
const proguardPath = path.join(PROJ, 'platforms', 'android', 'app', 'proguard-rules.pro');

if (!fs.existsSync(gradlePath)) {
  console.log('[proguard_harden] platforms/android/app/build.gradle 不存在, 跳过(非android构建或未prepare)。');
  process.exit(0);
}

// ---------- 1. Cordova 专用 keep 规则 ----------
// 核心: Cordova 经 JS Bridge 反射调用 Java 插件类(Class.forName 按插件名实例化),
//       若 R8 剥离/混淆这些类, 运行时"Plugin not found"白屏。必须 keep。
const PROGUARD_RULES = [
  '# V11.3 Cordova/R8 混淆 keep 规则(proguard_harden.js 生成)',
  '',
  '# Cordova JS Bridge 反射入口: 保留所有 Cordova 核心类与其结构',
  '-keep class org.apache.cordova.** { *; }',
  '-dontwarn org.apache.cordova.**',
  '',
  '# 所有 Cordova 插件类(JS 通过类名反射实例化, 不能剥/不能混淆名)',
  '-keep public class * extends org.apache.cordova.CordovaPlugin { *; }',
  '-keep public class * extends org.apache.cordova.CordovaPlugin',
  '',
  '# 插件入口 Activity/WebView 相关反射',
  '-keep public class * extends org.apache.cordova.engine.* { *; }',
  '-keep public class * extends android.app.Activity',
  '',
  '# @JavascriptInterface: 原生暴露给 JS 的桥方法不能被混淆/R8 移除',
  '-keepclassmembers @android.webkit.JavascriptInterface class * {',
  '    *** *;',
  '}',
  '-keepattributes *Annotation*, JavascriptInterface',
  '',
  '# 本项目应用入口(com.taicanggang.poweroff 相关)',
  '-keep class com.taicanggang.** { *; }',
  '',
  '# Files/FileTransfer 等插件用到的反射类型',
  '-keep class org.apache.cordova.file.** { *; }',
  '-keep class org.apache.cordova.camera.** { *; }',
  '',
  '# 通用: 保留枚举名与默认序列化方法(部分插件依赖)',
  '-keepclassmembers enum * {',
  '    public static **[] values();',
  '    public static ** valueOf(java.lang.String);',
  '}',
].join('\n');

// ---------- 2. build.gradle 注入 ----------
let g = fs.readFileSync(gradlePath, 'utf8');
const original = g;

// 确保 release{} 开启混淆: 把 minifyEnabled false 改 true(所有 buildType 统一开启, 免歧义)
g = g.replace(/minifyEnabled\s+false/g, 'minifyEnabled true');
g = g.replace(/shrinkResources\s+false/g, 'shrinkResources true');
// 若整个文件无 minifyEnabled true(模板未内联), 在 release{} 块首按当前缩进补齐 minify/shrink
if (!/minifyEnabled\s+true/.test(g)) {
  g = g.replace(/([ \t]*)release\s*\{/, (m, indent) => {
    return indent + 'release {\n' + indent + '    minifyEnabled true\n' + indent + '    shrinkResources true';
  });
}

// 确保 proguardFiles 引用本地规则文件 —— 必须注入, 否则 Cordova 插件类会被 R8 剥掉。
// 采用"release{ 块首插行"策略, 按当前缩进对齐, 定位稳、幂等、输出干净。
const proguardFileRef = "proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'";
if (!g.includes("'proguard-rules.pro'")) {
  g = g.replace(/([ \t]*)release\s*\{/, (m, indent) => {
    return indent + 'release {\n' + indent + '    ' + proguardFileRef;
  });
}

if (g !== original) {
  fs.writeFileSync(gradlePath, g, 'utf8');
  console.log('[proguard_harden] build.gradle 已注入 R8 混淆配置(minifyEnabled + shrinkResources + proguard-rules.pro)');
} else {
  console.log('[proguard_harden] build.gradle 已含 R8 配置, 跳过');
}

// ---------- 3. 写入 proguard-rules.pro ----------
fs.writeFileSync(proguardPath, PROGUARD_RULES, 'utf8');
console.log('[proguard_harden] 已写入/更新 proguard-rules.pro (' + PROGUARD_RULES.split('\n').length + ' 行)');

// ---------- 4. gradle.properties 开启 R8(防御性, AGP8 默认已用 R8) ----------
const gradlePropsPath = path.join(PROJ, 'platforms', 'android', 'gradle.properties');
if (fs.existsSync(gradlePropsPath)) {
  let p = fs.readFileSync(gradlePropsPath, 'utf8');
  if (!/android\.enableR8\s*=/.test(p)) {
    p += '\n# V11.3 强制 R8(proguard_harden.js)\nandroid.enableR8=true\n';
    fs.writeFileSync(gradlePropsPath, p, 'utf8');
  }
}

console.log('[proguard_harden] ✓ R8 加固配置完成');
