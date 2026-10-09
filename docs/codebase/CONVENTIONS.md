# Coding Conventions

> 证据基线：`js/*.js`、`scripts/*`、`tests/*`、`config.xml`、git 提交历史。
> ⚠️ 本项目**无 ESLint/Prettier 配置**，以下多为从现有代码归纳的**事实约定**（非强制工具约束）。

## Core Sections (Required)

### 1) Naming Rules

| Item | Rule | Example | Evidence |
|------|------|---------|----------|
| Files (业务 JS) | `NN-kebab.js`，两位数字前缀表加载顺序 | `00-config.js`、`16-audit.js` | `js/` 目录；`demo.html:666-682` |
| Files (脚本) | snake_case.js / .py / .sh | `check_two_end_sync.js`、`sync_release_both_roots.py`、`build_android.sh` | `scripts/` 目录 |
| Files (测试) | `test_v{版本}_{描述}.js`/`.py` | `test_v1035_reset_member_pass.js` | `tests/` 目录 |
| Files (文档) | `RELEASE_V*.md`（发版正文）、中文名说明 | `docs/RELEASE_V10.20.0.md`、`docs/CICD使用说明.md` | `docs/` 目录 |
| Functions/methods | camelCase | `deriveLinkKey`、`syncPendingToFeishu`、`mediaDirectUrl` | `js/00-bootstrap.js:144,1586`；`js/05-sync.js` |
| 全局对象 | camelCase 挂 `window` | `window.TCG_CONFIG`、`window.FeishuAPI`、`window.Audit` | `js/00-config.js:21`；`feishu-api.js:1095`；`js/16-audit.js:1-6` |
| 常量 | UPPER_SNAKE_CASE | `APP_VERSION`、`IDLE_TIMEOUT`、`MEDIA_RELEASE_BASE`、`SHARED_CODE_PATHS` | `js/00-bootstrap.js:1481-1523`；`scripts/check_two_end_sync.js:38-48` |
| 环境变量 | UPPER_SNAKE_CASE，`TCG_`/`FEISHU_`/`KEYSTORE_` 前缀 | `TCG_FEISHU_APP_SECRET`、`FEISHU_APP_SECRET`、`KEYSTORE_BASE64` | `scripts/inject_build_secrets.js`；`docs/CICD使用说明.md:31-40` |
| 版本常量 | 语义化 `major.minor.patch`，`versionCode=MMmmmpp`（如 `102000`=10.20.0） | `version.json`、`config.xml` | `config.xml:2`；`version.json:2-3` |

### 2) Formatting and Linting

- Formatter：**未配置**（无 `.prettierrc*`）。
- Linter：**未配置**（无 `.eslintrc*` / `golangci` / `ruff` 等）。
- 实际风格（从代码归纳）：2 空格缩进；业务 JS 多为 ES5 风格（`var`/`function`，为兼容旧 WebView）；部分新模块用 `const`/箭头函数；语句多无尾分号（`sw.js`、`js/00-bootstrap.js` 混用）。
- TypeScript 严格度：`tsconfig.json` 设 `"strict": true`（`tsconfig.json:11`），但**无 `ts/` 源码，未生效**。
- 实际"门禁"替代 lint：语法/一致性靠 CI 脚本（`node scripts/validate_web_assets.js` 校验 `vehicles_data.js` 可解析、`gen_media_mapping.js --check` 校验漂移等）。
- Run commands：`node scripts/validate_web_assets.js`、`npm run test:all`。

### 3) Import and Module Conventions

- Import grouping/order：**无 import 语句** —— 模块靠 `demo.html` 的 `<script defer>` 顺序与全局作用域耦合（`demo.html:666-682`）。
- Alias vs relative：无别名体系。`tsconfig.json` 预留了 `paths` 别名（为未来 TS 重写），当前未使用。
- Public exports/barrel policy：无 barrel。对外暴露靠挂 `window`（`window.TCG_CONFIG`、`window.FeishuAPI`、`window.Audit`）或顶层 `function`/`const`。
- 结论：**改动任一模块前必须确认其被哪些后加载模块以全局名引用**，否则易触发运行时 `undefined`。

### 4) Error and Logging Conventions

- Error strategy by layer：
  - 网络/飞书层：`try/catch` + 多源回退 + 优雅降级（失败不崩溃）；限流走退避重试（`js/00-bootstrap.js`、`feishu-api.js:306-318`）。
  - UI 层：`showToast` / 弹层提示用户（`js/07-cache.js`）。
  - 构建/脚本层：`process.exit(非0)` 阻断 CI；门禁用固定哨兵行输出（`scripts/check_two_end_sync.js` PASS/SKIP 哨兵）。
- Logging style：`console.log/warn/error`，前缀带模块标识，如 `[FeishuAPI xxx]`（`docs/DEVELOPMENT.md:84`）、`[SW]`（`sw.js:51`）、`[两端错配门禁]`（`scripts/check_two_end_sync.js`）。无集中日志库、无结构化日志。
- Sensitive-data redaction：**密钥红线** —— appSecret / GitHub PAT 绝不进源码；构建期 `inject_build_secrets.js` 做 XOR+base64 注入 `window.__BUILD_SECRETS__`，运行期读后 `delete`（`SECURITY.md:16-20`；`js/00-bootstrap.js:353-360`）。测试用 `TCG_FEISHU_APP_SECRET` 环境变量（`tests/README.md:5`）。`secret-scan.js` 支持 `noqa:secret` 逐行豁免（`scripts/secret-scan.js:13-19`）。
- 注释语言：中文为主，含大段分节 banner（`js/00-config.js:1-18`、`sw.js:1-9`）。

### 5) Testing Conventions

- Test file naming/location rule：`tests/test_v{版本}_{描述}.js`，平铺于 `tests/`（不与源码同目录）。
- Mocking strategy norm：`tests/e2e_harness.js` 从真实源码 `extractNamedBlock` 提取函数注入 `vm` 沙箱，`fetch` 路由到 `tests/mock_feishu_server.js`；不 mock 类/模块，而是**注入浏览器 API 桩 + mock 网络**。
- Coverage expectation：**无百分比阈值**；等价门禁为"所有测试必须能从 CI 触达"（`scripts/check_ci_coverage.js:17-29`）。
- 断言风格不统一：Node 内置 `assert`（`test_v1010_sync_e2e.js:22`）、自定义 `check(name,cond)`（`test_v57_integration.py:23-25`）、直接断言退出码（`test_v1034_two_end_gate.js`）。

### 6) Evidence

- `js/00-config.js`、`js/00-bootstrap.js`、`sw.js`
- `scripts/check_two_end_sync.js`、`scripts/secret-scan.js`、`scripts/check_ci_coverage.js`
- `tests/README.md`、`tests/e2e_harness.js`
- `tsconfig.json`、`config.xml`、`version.json`
- `SECURITY.md`、`docs/DEVELOPMENT.md`、`docs/CICD使用说明.md`

## Extended Sections (Optional)

### Commit / Branching Conventions（从 `git log` 归纳）

- Conventional Commits 前缀 + 中文描述：`feat:`、`fix(飞书):`、`fix(同步):`、`refactor(同步):`、`ci:`、`chore:`、`docs:`（`.codebase-scan.txt` 最近 20 次提交）。
- 自动同步提交固定文案：`chore: 自动同步数据 (web-data + vehicles_data + manifest) (<ISO时间>)`。
- 分支：主干 `main`；特性分支曾用 `feat-two-end-gate` 等（`docs/PENDING_ISSUES.md:193`）。
- 发布：推 `v*` tag 触发原生构建（`docs/CICD使用说明.md:47-51`）。

### 已知约定违规/不一致

- 缩进与分号风格不统一（ES5 `var` 与 `const` 混用）。
- 断言风格多套并存（见上）。
- 版本字面量在历史文档/注释中易漂移（`docs/PENDING_ISSUES.md:33-40` 专门列出"版本字面量分类表"警告禁止一刀切全局替换）。