# Codebase Structure

> 证据基线：`docs/codebase/.codebase-scan.txt` 目录树 + 实际文件读取。

## Core Sections (Required)

### 1) Top-Level Map

| Path | Purpose | Evidence |
|------|---------|----------|
| `demo.html` | **应用主程序**（单页应用，Cordova `content src`），862 行，含全部 screen/modal DOM | `config.xml:6`；`demo.html`（`screen-login`…`video-player`） |
| `index.html` | 入口重定向页（meta refresh + `location.replace` 跳 `demo.html`） | `index.html:6-9` |
| `feishu-api.js` | 飞书 OpenAPI 数据层单例（认证/Bitable/Drive/审批/消息），挂 `window.FeishuAPI` | `feishu-api.js:1095` |
| `js/` | 业务逻辑，16 个按数字前缀顺序加载的模块 | `demo.html:666-686`；`js/` 目录 |
| `css/` | `app.css` 单一样式文件（Tailwind 之上的自定义样式） | `css/app.css`；`sw.js:14` |
| `vendor/` | 本地化第三方库（tailwind/xlsx/jspdf/html-docx/html2canvas），零 CDN 外链 | `sw.js:30-35` |
| `scripts/` | 构建/校验/同步/迁移脚本（Node + Python + shell） | `scripts/` 目录 |
| `tests/` | 测试套件（48 JS + 1 PY + 共享 harness + mock server） | `tests/` 目录 |
| `docs/` | 项目文档 + 媒体映射表/manifest + `参考资料/` + `codebase/`（本文档） | `docs/` 目录 |
| `web-data/` | **自动生成**的网页镜像静态数据（cron 每 15 分钟重写） | `.github/workflows/sync-web-data.yml:33-38`；`.codebase-scan.txt` 高 churn |
| `vehicle_images/` | 车辆图片（运行时契约目录，**内部按车型名分子目录**，见「媒体路径约定」） | `sw.js` 未列；`config.xml`/CI 打包；`docs/codebase/.codebase-scan.txt` |
| `vehicles_data.js` | 车辆数据（由 `web-data/vehicle_sync_data.json` 反向生成） | `scripts/gen_vehicles_data.js:1-17` |
| `release/` | 发版产物镜像（`version.json` 副本、keystore/apk 已 gitignore） | `.gitignore:16-24`；`release/version.json` |
| `.github/workflows/` | 14 条 CI/CD 流水线 | `.github/workflows/` 目录 |
| `hooks/` | Cordova 构建钩子目录 | `config.xml:126-128`（hook 指向 scripts/） |
| `manifest.json` / `sw.js` | PWA 清单 + Service Worker | `sw.js`；`manifest.json` |
| `config.xml` | Cordova 单一真源（版本/平台/插件/权限） | `config.xml` |
| `version.json` | 版本信息 + 飞书公开配置 + 下载地址（App 内更新读取） | `version.json` |
| `CHANGELOG.md` / `SECURITY.md` / `README.md` | 变更史 / 安全治理 / 项目说明 | 根目录 |
| `agent/` `skills/` `data/skills/` `.trae*` | 本地 AI 工具/技能工作区残留（非应用运行时） | `.codebase-scan.txt` 目录树 |
| `.agents` `.adal` `.claude` …（数十个 dot 目录） | 各 AI 编辑器/Agent 工具的 skills 缓存副本（非应用代码） | `.codebase-scan.txt` 目录树 |

### 2) Entry Points

- Main runtime entry：`demo.html`（`config.xml` 的 `<content src="demo.html" />`）。
- Redirect entry：`index.html` → `demo.html`。
- Service worker entry：`sw.js`（PWA 离线壳）。
- CLI entry points（构建/运维，非应用运行时）：
  - `scripts/run_all_tests.js`（`npm run test:all` 聚合执行器）
  - `scripts/validate_web_assets.js`（CI 关卡）
  - `scripts/sync_web_data.js`（网页镜像生成）
  - `scripts/gen_vehicles_data.js`、`scripts/gen_media_mapping.js`
  - `scripts/check_version_consistency.js`、`scripts/check_two_end_sync.js`、`scripts/check_ci_coverage.js`
  - `scripts/inject_build_secrets.js`（构建期密钥注入）
- How entry is selected：`config.xml` 决定 App 主入口；`package.json scripts` 决定 CLI 入口；`demo.html` 的 `<script defer>` 顺序决定模块加载次序。

### 3) Module Boundaries

| Boundary | What belongs here | What must not be here |
|----------|-------------------|------------------------|
| `js/00-config.js` | 公开常量单一真源（`window.TCG_CONFIG`） | 任何密钥/secret（文件头明确红线，`js/00-config.js:13-17`） |
| `js/00-media-paths.js` | 媒体路径约定单一真源（车型名→子目录名、路径解析、本地/云端候选路径） | 任何 I/O（浏览器侧纯函数；Node 侧仅 `fs/path` 只读辅助） |
| `js/00-bootstrap.js` | 启动期原语：拼音/车辆/用户/密码哈希/HTTP/缓存/媒体直链/版本 | 不应再新增独立业务逻辑（已 1759 行，见 CONCERNS） |
| `js/01-state.js` | 页面状态、导航栈、返回键路由 | 数据持久化/网络调用 |
| `js/02-auth.js` | 登录/注册/会话/身份判断/linkKey 迁移 | 车辆业务渲染 |
| `js/03-vehicles.js` | 车辆列表/筛选/详情/编辑/分享/导出文本 | 飞书网络原语（应走 05/12） |
| `js/04-export.js` | Excel/ZIP/Word/PDF 导出 | 车辆数据获取 |
| `js/05-sync.js` | 审批轮询、成员守护、备份、JSON 上传下载、同步日志 | UI 渲染 |
| `js/06-media.js` | 图片查看器/视频播放器/云端媒体/模态 | 审批逻辑 |
| `js/07-cache.js` | 缓存管理、成员管理、审批 UI、toast/通知 | 飞书底层请求实现 |
| `js/08-main.js` | 硬件返回键、双击退出、`deviceready` 顶层副作用 | 业务函数定义 |
| `js/09-web-sync.js` | 网页镜像桥接（绕过浏览器 CORS） | 原生端专属逻辑 |
| `js/10-feedback.js` | 反馈表单/Bitable 写入/列表 | 车辆 CRUD |
| `js/11-about.js` | 关于页/版本历史/署名 | 数据同步 |
| `js/12-bitable.js` | 飞书多维表格操作封装（经 `window.FeishuAPI`） | 业务 UI |
| `js/16-audit.js` | 审计留痕（`window.Audit`） | 业务写入 |
| `feishu-api.js` | 飞书 OpenAPI 单例数据层 | UI 逻辑 |
| `vendor/` | 第三方库（只读引用） | 项目自研代码 |

> ⚠️ 边界为**约定**而非强制：模块间通过隐式全局变量互引（见 ARCHITECTURE.md / CONCERNS.md）。

### 4) Naming and Organization Rules

- 业务 JS 文件命名：`NN-name.js`（两位数字前缀 + kebab-case），如 `00-bootstrap.js`、`16-audit.js`；前缀决定 `demo.html` 加载顺序（`demo.html:666-682`）。
- 脚本命名：`scripts/` 下多为 snake_case（`check_two_end_sync.js`、`sync_web_data.js`、`gen_media_mapping.js`），shell 为 `.sh`，Python 为 `.py`。
- 测试命名：`test_v{版本}_{描述}.js` / `.py`（如 `test_v1035_reset_member_pass.js`、`test_v57_integration.py`）；历史遗留 `test_v53_*`、`test_v57_*`。
- 目录组织：**按层/职能**（js 按职责，scripts 按动作，tests 平铺），非 feature/domain 划分。
- 无 import 别名体系：所有模块靠全局作用域 + 加载顺序耦合（无 ESM import/export，见 CONCERNS.md）。
- 文档命名：`docs/RELEASE_V*.md`（发版正文硬前置）、`docs/*.md` 中文名文档。

### 5) Evidence

- `docs/codebase/.codebase-scan.txt`（目录树 + 代码指标）
- `config.xml:6`（入口）
- `demo.html:666-682`（模块加载顺序）
- `package.json`（scripts 入口）
- `scripts/`、`tests/`、`.github/workflows/` 目录清单

## Extended Sections (Optional)

### 生成物 vs 源码边界

- **生成物（勿手改，cron 覆盖）**：`web-data/*.json`、`vehicles_data.js`（由镜像反向生成）、`docs/vehicle_media_mapping.{json,csv}`、`docs/vehicle_media_manifest.json`。
- **源码**：`js/`、`demo.html`、`feishu-api.js`、`css/`、`scripts/`、`tests/`、`config.xml`、`version.json`。
- **运行时契约目录（不得改名/移动）**：`vehicle_images/`、`vehicle_videos/`（云端同步链路依赖，见项目 memory 硬约束；**其内部按车型名分子目录**，见下节）。

### 媒体路径约定（V10.25，单一真源 `js/00-media-paths.js`）

> 本约定**不可随意更改**；更改须同步本文档与本文件头注（`js/00-media-paths.js:17`）。

- **顶层目录名不变**：`vehicle_images/`（照片）、`vehicle_videos/`（视频）——GitHub 与飞书两侧一致，保留既有契约，避免外部链接失效。
- **三段式路径（新规范）**：`vehicle_images/<车型子目录名>/<文件名>`、`vehicle_videos/<车型子目录名>/<文件名>`。
- **车型子目录名**（`folderNameForVehicle`）：取 `display || series || brand`，经 `sanitizeName` 清洗（去控制字符与 emoji；`\ / : * ? " < > |` → `_`；折叠空白与 `_{2,}`；去首尾 `[.\s_]`；截断 40 字符）；清洗后为空则兜底 `vehicle_<id>`（无 id 则 `vehicle_unknown`）。
- **共享目录**：`_共享`（`SHARED_FOLDER`），用于不归属单一车型的媒体；与车型子目录同级。
- **向下兼容（关键）**：`parseMediaPath` 同时识别两段式（历史扁平 `vehicle_images/xxx.jpeg`）与三段式，`isNested` 标识是否为三段式；`candidateRelPaths` 按 `三段式 → 两段式 → 裸文件名` 顺序给出云端/本地候选，保证迁移过渡期两侧都能命中。
- **启动期归一**：`js/08-main.js` 的 `migrateLegacyMedia()` 在每次启动把历史扁平路径归一为三段式（模块缺失时退化为旧扁平拼接），且**幂等**——已三段式路径原样保留，重复执行零改写。
- **递归约束**：所有遍历媒体的脚本/CI 与测试必须**递归**统计（`scripts/gen_media_mapping.js`、`scripts/audit_media_consistency.js`、`scripts/sync_photos_to_repo.js`、`android-release.yml`/`ios-release.yml` 门禁），非递归会在迁移后误报为 0。
- **测试锚点**：`tests/test_v1025_media_paths.js`（单元）、`tests/test_v1025_media_paths_e2e.js`（E2E + 门禁）。

### 非应用目录（可忽略）

`.agents`/`.adal`/`.aider-desk`/`.augment`/`.autohand`/`.claude` 等数十个 dot 目录为各 AI 工具 skills 缓存副本，`agent/`、`skills/`、`data/skills/` 同理，均非应用运行时依赖。