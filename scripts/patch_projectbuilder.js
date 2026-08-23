const fs = require('fs');
const path = require('path');

const target = path.resolve(process.cwd(), 'node_modules/cordova-android/lib/builders/ProjectBuilder.js');
if (!fs.existsSync(target)) {
  console.log('ProjectBuilder.js not found, skip patch.');
  process.exit(0);
}

let c = fs.readFileSync(target, 'utf8');
if (c.includes('wrapperExists')) {
  console.log('ProjectBuilder.js already patched.');
  process.exit(0);
}

const old = "        return check_reqs.check_gradle()\n            .then(function () {\n                events.emit('verbose', `Using Gradle: ${config.GRADLE_VERSION}`);\n                return self.installGradleWrapper(config.GRADLE_VERSION);\n            }).then(async function () {";
const replacement = "        const wrapperBatPath = path.join(self.root, 'tools', 'gradlew.bat');\n        const wrapperJarPath = path.join(self.root, 'tools', 'gradle', 'wrapper', 'gradle-wrapper.jar');\n        const wrapperExists = fs.existsSync(wrapperBatPath) && fs.existsSync(wrapperJarPath);\n        const gradleSetupPromise = wrapperExists\n            ? Promise.resolve()\n            : check_reqs.check_gradle()\n                .then(function () {\n                    events.emit('verbose', `Using Gradle: ${config.GRADLE_VERSION}`);\n                    return self.installGradleWrapper(config.GRADLE_VERSION);\n                });\n        return gradleSetupPromise\n            .then(async function () {";

if (c.includes(old)) {
  c = c.replace(old, replacement);
  fs.writeFileSync(target, c, 'utf8');
  console.log('Patch applied.');
} else {
  console.log('Patch target not found - may already be patched.');
}

// ---------- V5.7.1 防御性 gradle 清洗 ----------
// 背景: 部分老插件(如qrscanner 3.0.1)的gradle使用AGP8已删除的 `compile` 配置与已关停的
// jcenter(), 一旦引入即整包构建崩溃。此步骤在构建前清洗 platforms/android 下所有gradle文件,
// 将 compile→implementation、jcenter()→mavenCentral(), 对未来任何插件地雷免疫。
const platformsDir = path.resolve(process.cwd(), 'platforms/android');
let sanitized = 0;
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) { walk(full); continue; }
    if (!name.endsWith('.gradle')) continue;
    let g = fs.readFileSync(full, 'utf8');
    const before = g;
    g = g.replace(/^(\s*)compile(\s+)/gm, '$1implementation$2');
    g = g.replace(/^(\s*)testCompile(\s+)/gm, '$1testImplementation$2');
    g = g.replace(/jcenter\(\)/g, 'mavenCentral()');
    if (g !== before) {
      fs.writeFileSync(full, g, 'utf8');
      sanitized++;
      console.log('[gradle清洗] ' + full.replace(process.cwd() + '/', ''));
    }
  }
}
if (fs.existsSync(platformsDir)) {
  walk(platformsDir);
  console.log(sanitized > 0 ? `gradle清洗完成: ${sanitized} 个文件` : 'gradle清洗完成: 无需清洗');
} else {
  console.log('platforms/android 不存在, 跳过gradle清洗');
}
