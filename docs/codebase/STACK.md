# Technology Stack

> 证据基线：`docs/codebase/.codebase-scan.txt`（Phase 1 扫描产物）+ 各源文件。仅记录可从文件/命令输出证实的内容。

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | JavaScript（Vanilla ES5/ES6，无类型系统；`JavaScript` 91 文件） | `.codebase-scan.txt` 代码指标；`js/*.js` |
| Runtime + version | Apache Cordova 13（Android `cordova-android@13` / iOS `cordova-ios@7`），运行于 WebView | `package.json`（`cordova@^13.0.0`）；`config.xml:14-99`；`README.md:81` |
| Node version | `^20.19.0 || ^22.12.0 || >=24.0.0`（jsdom engine 约束）；CI 用 Node 22 | `package-lock.json`（`engines`）；`.github/workflows/ci.yml:31-34` |
| Package manager | npm | `package-lock.json`（`lockfileVersion: 3`） |
| Module/build system | 无打包器。`demo.html` 以 `<script defer>` 按数字前缀顺序加载 `js/*.js`；原生构建走 Cordova CLI | `demo.html:666-682`；`config.xml:6` |
| Java / Gradle（Android 构建） | JDK 17 + Gradle 8.14.2 | `README.md:85`；`.github/workflows/android-release.yml:40-44` |

> 说明：仓库存在 `tsconfig.json`，但**无 `ts/` 源码目录、无 Vite/Capacitor 实际接线**，属重写预留（见 CONCERNS.md 意图-现实偏差）。

### 2) Production Frameworks and Dependencies

`package.json` 中**唯一的生产依赖**是 Cordova；所有前端能力均通过本地化 vendor 库提供，不走 npm。

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| cordova | ^13.0.0 | 唯一 npm 生产依赖；原生壳构建/插件宿主 | `package.json` |
| cordova-plugin-advanced-http | 3.3.1 | 原生 HTTP 栈，绕过 WebView CORS（飞书请求主通道） | `config.xml:115` |
| cordova-plugin-file / file-transfer / file-opener2 | 8.1.0 / 2.0.0 / 4.0.0 | 文件读写、上传下载、外部打开 | `config.xml:106-107,125` |
| cordova-plugin-camera / media-capture / geolocation | 7.0.0 / 5.0.0 / 5.0.0 | 拍照、录视频、定位 | `config.xml:108,111-114` |
| cordova-plugin-x-socialsharing | 6.0.4 | 分享导出文件到微信/钉钉等 | `config.xml:116` |
| cordova-plugin-local-notification | 1.2.3 | 本地通知（审批提醒） | `config.xml:124` |
| cordova-plugin-inappbrowser / dialogs / device / network-information / app-version / statusbar / splashscreen / screen-orientation / android-permissions / whitelist | 见 config.xml | 系统能力补齐 | `config.xml:101-123` |
| vendor/tailwind.js | 本地化 | CSS 原子类（离线，零 CDN） | `sw.js:30`；`README.md:80` |
| vendor/xlsx.full.min.js | 本地化 | Excel 导出（SheetJS） | `sw.js:31`；`README.md:83` |
| vendor/jspdf.umd.min.js + jspdf.plugin.autotable.min.js | 本地化 | PDF 导出 | `sw.js:32-33`；`README.md:83` |
| vendor/html-docx.js | 本地化 | Word(docx) 导出 | `sw.js:34`；`README.md:83` |
| vendor/html2canvas.min.js | 本地化 | DOM 截图（导出用） | `sw.js:35` |

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| jsdom | ^29.1.1 — 测试用 DOM 环境（唯一 devDependency） | `package.json` |
| Node.js 原生脚本 | 测试/校验/同步（无 Jest/Mocha） | `tests/*.js`；`scripts/*.js` |
| Python 3 | 集成测试与飞书同步脚本 | `tests/test_v57_integration.py`；`scripts/sync_*.py` |
| Cordova CLI | 原生构建 | `.github/workflows/android-release.yml:63-66` |
| tsconfig.json | 类型检查配置（**当前无 TS 源码，未接线**） | `tsconfig.json` |
| ESLint / Prettier | **未配置**（无 `.eslintrc*` / `.prettierrc*`） | 扫描未见；见 CONVENTIONS.md |
| CodeQL / Fortify / dependency-review | 安全扫描 CI | `.github/workflows/codeql.yml`、`fortify.yml`、`dependency-review.yml` |
| secret-scan.js | 自定义密钥泄露扫描 | `scripts/secret-scan.js`；`.github/workflows/secret-scan.yml` |

### 4) Key Commands

```bash
npm install                                   # 安装依赖（cordova + jsdom）
cordova build android --release               # Android 原生构建（CI 中另含签名步骤）
cordova platform add android@13               # 添加 Android 平台
npm run test:all                              # 全量测试（scripts/run_all_tests.js 聚合）
node scripts/validate_web_assets.js           # Web 资产综合校验（CI 核心关卡）
node scripts/gen_media_mapping.js --check     # 媒体映射表漂移检测
node scripts/check_version_consistency.js     # 版本一致性（发版准入）
node scripts/check_two_end_sync.js            # 两端错配门禁
npm run test:ci-coverage                      # CI 测试覆盖率门禁
node scripts/secret-scan.js .                 # 密钥扫描
```

### 5) Environment and Config

- Config sources：`version.json`（版本/飞书公开配置/下载地址）、`js/00-config.js`（`window.TCG_CONFIG` 单一配置真源）、`config.xml`（Cordova/插件/权限）、`.github/workflows/*.yml`（CI 变量）。
- Required env vars（从 CI/脚本读取处证实）：
  - 构建注入：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_FOLDER_TOKEN`、`TCG_REGISTER_TOKEN`、`FEISHU_STRICT`（`scripts/inject_build_secrets.js:1-20`）
  - 测试：`TCG_FEISHU_APP_SECRET`（`tests/README.md:11-20`）
  - AI 反馈：`DEEPSEEK_API_KEY`（`.github/workflows/ai-feedback.yml:62-75`）
  - Android 签名：`KEYSTORE_BASE64`、`KEYSTORE_PASSWORD`、`KEY_ALIAS`（`docs/CICD使用说明.md:31-40`）
  - iOS 签名：Apple P12 / Provisioning Profile / Team ID（`.github/workflows/ios-release.yml:186-219`）
  - `[TODO]` 完整环境变量矩阵（dev/stage/prod 差异）未见文档化。
- Deployment/runtime constraints：Android `minSdk 24` / `targetSdk 34` / `compileSdk 34`；iOS `deployment-target 14.0`；`usesCleartextTraffic=true`；`allowBackup=false`；iOS ATS `NSAllowsArbitraryLoads=true`（`config.xml:18-20,34,93-98`）。

### 6) Evidence

- `package.json` / `package-lock.json`
- `config.xml`
- `js/00-config.js`
- `version.json`
- `.github/workflows/ci.yml`、`android-release.yml`、`ios-release.yml`
- `sw.js`
- `docs/codebase/.codebase-scan.txt`

## Extended Sections (Optional)

### Dependency taxonomy（按来源分类）

- npm 生产：仅 `cordova`。
- npm 开发：仅 `jsdom`。
- 本地 vendor（非 npm，随源码分发）：tailwind / xlsx / jspdf(+autotable) / html-docx / html2canvas。
- 原生插件（config.xml 声明）：19 个（见 `config.xml:101-125`）。
- 脚本依赖：Node 内置模块 + Python 标准库（未见 requirements.txt / poetry 配置）。