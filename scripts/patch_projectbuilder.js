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
