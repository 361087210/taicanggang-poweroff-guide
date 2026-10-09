# Testing Patterns

> 证据基线：`package.json`、`scripts/run_all_tests.js`、`scripts/check_ci_coverage.js`、`tests/README.md`、`tests/e2e_harness.js`、`tests/mock_feishu_server.js`、`.github/workflows/*`、`docs/codebase/.codebase-scan.txt`。

## Core Sections (Required)

### 1) Test Stack and Commands

- Primary test framework: **无标准框架**。不使用 Jest / Mocha / Vitest / pytest 框架本体；全部用例为可独立运行的 Node 脚本（`tests/test_*.js`）加少量 Python 脚本（`tests/test_v57_integration.py`）。唯一的 Node 依赖 `jsdom@^29.1.1`（`package.json:5-7`）承担 HTML 装载与 `window.eval` 断言，而非框架身份。
- Assertion / mocking tools：
  - 断言为两种混用风格 —— 约 5 个套件使用 Node 内置 `assert`（如 `tests/test_v1013_a3.js`、`tests/test_v1014_zero_config_member.js`）；其余多数使用自研 `check(desc, cond)` 计数式断言（累加 `PASSED` / `FAILED`，末尾按失败数决定 `process.exit`），见 `tests/test_v57_logic.js:55-96`。
  - Mock 全部自研，无第三方 mock 库：`tests/mock_feishu_server.js`（飞书开放平台 API 高保真桩）+ `tests/e2e_harness.js`（VM 沙箱 + `fetch`/`localStorage` 桩）。
- Commands:

```bash
npm run test:all        # 全量回归（49 套件）→ node scripts/run_all_tests.js，失败不中断
npm run test:logic      # V5.7 逻辑（jsdom）
npm run test:cross      # V5.7 跨网络（jsdom + mock fetch）
npm run test:integration# Python 真实 API 集成（需 TCG_FEISHU_APP_SECRET）
npm run test:coverage   # c8 包裹 test:all：全量回归 + 行覆盖率采集(--all --include="js/**/*.js")
npm run test:coverage-gate # 行覆盖率验收门禁（js/ 可归因源文件整体 >= 95%）
npm run test:ci-coverage# CI 测试可达性门禁（非行覆盖率）
```

> ⚠️ 文档偏差：`tests/README.md:37` 指引「一键全量回归 `npm test`」，但 `package.json` **未定义 `test` 脚本**，`npm test` 会报错；实际入口为 `npm run test:all`（`package.json:31`）。同理 `test:all` 在迁移到 `run_all_tests.js` 后已不再由 `&&` 串联。

### 2) Test Layout

- Test file placement pattern: **集中式** `tests/` 目录（非 co-located），约 57 个文件；生产源码不内嵌测试。
- Naming convention: `test_<version-or-feature>_<topic>.js`（如 `test_v1020_vehicles_crud.js`、`test_v1034_two_end_gate.js`）；Python 集成测试 `test_v57_integration.py`；基建文件不带 `test_` 前缀（`e2e_harness.js`、`mock_feishu_server.js`）。注意：`scripts/check_ci_coverage.js` 以 `isTestFile = /^test_[^_].*\.(js|py)$/` 识别测试资产，因此基建文件天然不计入门禁闭包。
- Setup files and where they run: 无全局 setup；每套件自带前置（示例 `tests/test_v57_logic.js:8-10` 在装载 `jsdom` 失败时 `process.exit(2)`）。共享基建按需 `require`：`tests/e2e_harness.js`、`tests/mock_feishu_server.js`。产物侧存在历史结果快照（如 `tests/v1010_e2e_results.json`）。

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | yes | 纯逻辑函数、版本一致性、数据校验 | 多为源码文本/行为断言，非隔离模块单测；`check()` 计数式为主 |
| Integration | yes | 飞书 API 边界、同步链路、Bitable 数据访问 | 分两类：① VM 沙箱 + `MockFeishuServer` 的**离线集成**（`tests/e2e_harness.js`）；② Python **真实 API 集成**（`tests/test_v57_integration.py`，需凭据） |
| E2E | partial | 端到端同步/上传下载/两端门禁 | 以 `test_v1010_sync_e2e.js`、`test_v1034_two_end_gate.js` 等覆盖同步闭环；无真实浏览器/真机端到端 |

### 4) Mocking and Isolation Strategy

- Main mocking approach：**从真实源码按名称提取函数 + 注入 VM 沙箱**。`tests/e2e_harness.js` 的 `loadCombinedSource()` 拼接 `demo.html` 与排序后的 `js/*.js`，`extractNamedBlock(src, name)` 以状态机扫描精确摘出声明块，再经 `DEMO_BLOCKS`（依赖序清单，含 `_feishuGate`/`httpFetch`/`getFeishuToken`/`State` 等）注入 `vm.createContext`。网络层由 `createMockFetch()` 将 `fetch` 路由到 `MockFeishuServer.handle`；`createLocalStorage()` 提供内存版存储；`createAppSandbox({window: undefined})` 强制走 fetch 路径。
- 飞书语义保真：`tests/mock_feishu_server.js` 的 `MockFeishuServer` 复现认证（`tenant_access_token`）、建/列目录、`upload_all`（20MB 硬上限 `UPLOAD_ALL_LIMIT`）、4MB 定长分片（`BLOCK_SIZE`）+ Adler-32 校验、`upload_finish`、`download`、`DELETE`，并还原错误码 `1061043/1061044/1061021/1062008/1062009/1062010`；支持故障注入 `opts.failPartOnce`、`opts.expireFirstSession` 以测重试/续传。
- Isolation guarantees：每个套件进程独立（`npm run` 子进程），无跨套件共享状态；沙箱内 `window`/`localStorage`/网络均为进程内桩，用例结束即丢弃。密钥隔离：飞书 App Secret 仅经环境变量 `TCG_FEISHU_APP_SECRET` 注入，禁止明文入库。
- Common failure mode in tests：断言依赖源码**文本/结构**（正则匹配 HTML、`w.eval(expr)`），对 `demo.html` 的结构调整、脚本拆分（A2 拆分后依赖 `inlineDeferScripts`/`inlineStylesheets` 兼容）或函数改名**高度敏感**，重构易致大面积误报，而非逻辑缺陷。

### 5) Coverage and Quality Signals

- Coverage tool + threshold：**c8（`c8@^12.0.0`）+ 行覆盖率硬门禁**。`npm run test:coverage` 以 c8（`--all --include="js/**/*.js"`，reporter `text`/`json-summary`/`text-summary`）包裹 `npm run test:all`，单次运行即同时产出全量回归结果与覆盖率数据；`npm run test:coverage-gate`（`scripts/check_coverage_threshold.js`）读取 `coverage/coverage-summary.json`，对 `js/` 下**可归因**源文件强制 **行覆盖率 ≥ 95%**（`MIN_LINES_PCT = 95`），并对声明式排除项做 STALE 检查（`STALE_EPSILON = 1`，覆盖率回升即告警）；任一不满足即 `exit 1`。CI 中两 step 均为独立步骤、退出码直接传播（**不写** `|| true` / `continue-on-error`），排在两端错配门禁之前。`coverage/` 产物不入库（见 `.gitignore`）。
- 度量口径限制（为何存在排除项）：c8 按被装载文件的 **URL/文件名** 归因。`tests/e2e_harness.js` 经 `tests/coverage-attribution.js` 把 `vm.runInContext(block, ctx, { filename })` 的 filename 改写为项目相对路径 `js/xxx.js`，故可归因；而 `js/00-config.js`、`09-web-sync.js`、`10-feedback.js`、`11-about.js`、`12-bitable.js` 由 JSDOM（`window.eval` / `runScripts`）装载，不经 `vm.runInContext`，c8 无法按文件名归因（实测 0%）。这 5 个文件在门禁中以 `EXPECTED_UNATTRIBUTED` 声明式排除，并在归因率回升时触发 STALE 告警，避免“用排除项掩盖真实退化”。
- Current reported coverage（`npm run test:coverage-gate` 实测，基线 V10.20.0）：
  - 可归因（10 个 `js/` 源文件）合计 **99.38%（8939/8995 行）**，逐文件区间 95.51%–100%。
  - 参考（`--all` 全量 15 文件，含上述 5 个不可归因文件）：行 80.32% / 语句 80.32% / 分支 91.78% / 函数 73.17%。
- Reachability gate（非行覆盖率）：`scripts/check_ci_coverage.js`（`npm run test:ci-coverage`）校验**测试可达性** —— 三方一致性（`tests/` 资产 ⇄ `package.json` 的 `test:*` ⇄ workflows 引用），沿 `run_all_tests.js` 的 `TEST_SUITES` 展开闭包；`realMissing` / `badFileRefs` / `staleExcluded` 任一非空即 `exit 1`，`unreachable`（未被任何 CI 入口引用的 `test:*`）**仅提示不阻断**。`EXPECTED_EXCLUDED` 白名单当前仅 `test_v57_integration.py`（Python 集成，由 release 流程按需执行）。实测：测试文件 50 / 已覆盖 49 / 声明排除 1。
- Known gaps / flaky areas：
  - 无真实浏览器/真机 E2E，UI 渲染与 Cordova 原生能力（文件系统、通知）依赖桩模拟。
  - 覆盖率口径受装载方式限制：5 个 JSDOM 装载文件不可归因（见上），其真实覆盖率未被本门禁约束。
  - `test:all` 历史上因 `&&` 串联会「红灯静默吞掉」，已由 `run_all_tests.js` 修复（`scripts/run_all_tests.js:1-26` 注释记载），但该修复本身说明此前验收线长期不可信。
  - 套件与版本强绑定（`test:v10xx`），旧套件随重构可能需要同步维护，存在陈旧套件风险。

### 6) Evidence

- `package.json:8-75`（全部 `test:*` / `check:*` / `scan:*` 脚本定义；无 `test` 脚本）
- `scripts/run_all_tests.js:38-88`（`TEST_SUITES` 49 项单一真源 + 失败容忍执行器）
- `scripts/check_ci_coverage.js`（CI 测试可达性门禁）
- `scripts/check_coverage_threshold.js`（c8 行覆盖率门禁，`MIN_LINES_PCT = 95` + `EXPECTED_UNATTRIBUTED` STALE 检查）
- `tests/coverage-attribution.js`（改写 `vm.runInContext` filename，使 `js/` 源文件可被 c8 归因）
- `tests/e2e_harness.js`（VM 沙箱、`extractNamedBlock`、`DEMO_BLOCKS`、`createMockFetch`/`createLocalStorage`）
- `tests/mock_feishu_server.js`（`MockFeishuServer`、Adler-32、分片、错误码、故障注入）
- `tests/test_v57_logic.js:1-96`（jsdom + `check()` 断言范式）
- `tests/test_v57_integration.py`（Python 真实 API 集成）
- `tests/README.md`（`TCG_FEISHU_APP_SECRET`、V5.7 套件 82 用例、历史遗留说明）

## Extended Sections (Optional)

### 测试套件分组（按版本/主题）

| 分组 | 代表性套件 | 覆盖内容 |
|------|-----------|----------|
| 基建/一致性 | `test:version`、`check:two-end`、`test:two-end-gate` | 版本号三源一致、两端同步门禁 |
| V5.7 核心 | `test:logic`、`test:runtime`、`test:cross`、`test:integration` | 逻辑/运行时/跨网络/真实 API（共 82 用例） |
| 历次修复回归 | `test:v103` ~ `test:v1019` | 逐版本缺陷回归 |
| 数据/账号 | `test:v1020-crud`、`test:linkkey`、`test:web-account`、`test:vehicles-sync` | 车型 CRUD、账号连接键、网页账号、数据同步 |
| 安全/卫生 | `test:validate-web`、`test:v1019-hygiene`、`test:audit` | 网页资源校验、仓库卫生、审计日志 |
| 媒资/导出 | `test:video`、`test:video-sync`、`test:export-photo`、`test:docx-sheets` | 视频播放/发布同步、照片导出、文档表格 |
| 反馈流程 | `test:feedback-version`、`test:feedback-status`、`test:process-feedback` | 反馈字段/状态枚举/处理接线 |

### 已知测试性能特征

- 串行执行：`run_all_tests.js` 逐个 `execSync('npm run <suite>')`，49 套件无法并行（为换取失败容忍与清晰输出）；在 CI 上为主要耗时点，`[TODO]` 无实测耗时基线。
