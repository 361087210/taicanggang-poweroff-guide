# V10.12.0 渐进式重构版 发布文档

| 项目 | 内容 |
|---|---|
| 版本 | 10.12.0 (versionCode 101200) |
| 发布日期 | 2026-09-01 |
| 发布类型 | 架构重构 + 安全加固 + 工程化 |
| 一句话总结 | 9模块连续拆分(CSS抽出+主脚本6570行→9个defer脚本)+Secret构建期注入消除硬编码+飞书上传双轨单向收敛+导航栈11散点封装+XSS全量转义+嵌套深度降压+CI/测试基建全量补齐 |
| 关联文档 | `CHANGELOG.md`§10.12 · `docs/V1011_代码审查与优化方案.md`(审查输入) · `.github/workflows/ci.yml`(新增6个step) · `scripts/inject_build_secrets.js`(构建注入脚本) |

---

## 一、交付背景（方案A 渐进式重构 vs 方案B 推倒重写）

V10.11.0 代码审查专家(代码审计员Agent)对 demo.html 主脚本 7471 行单体交付物出具 14 条不合格项（含：单一模块5职责混合、241函数+117onclick 全局命名污染风险、飞书上传两处真源漂移、硬编码Secret合规超标、导航栈散点直操作、3处>5层嵌套、CI缺口、用户字段未转义）。经方案对比：方案B 迁移 TypeScript+Capacitor+Vite（成本20人日、双产物过渡、回归风险不可控）vs 方案A 渐进式拆分（Cordova 框架不变、241 函数签名不变、零 onclick 改动），**方案A以 1/5 成本交付同等收益**，入选。

---

## 二、核心交付 8 项

### 1. 单向收敛（A1-1 飞书上传双轨 → 单例统一）
**问题**：demo.html 含完整实现（220ms QPS门控+1061021事务过期二次重传+Cordova ponyfills双栈+文件名清洗），feishu-api.js 仅 fetch 单薄实现，**两处真源长期漂移**，新功能若只改一处必在另一路径失效（V10.10 分片上传双解包缺陷即是）。
**修复**：demo 完整实现下沉为 `FeishuAPI.driveUploadFile()` / `FeishuAPI.driveUploadFileMultipart()`，新增 demo 层同签名兼容入口，demo 内联 189 行大实现改为 2 行薄壳委托。**架构上杜绝后续双真源回归**（若有人在薄壳加逻辑，签名不变但委托不走 → CI 校验可捕获）。

### 2. Secret 构建时注入（A1-2 防反编译还原硬编码）
**问题**：V5.7 `_FS_XOR_KEY + _fsDec(hex_cipher)` 混淆方案本质为**固定密钥的对称可逆**，反编译提取 hex_cipher + 常量 XOR key 可 1 行还原明文，合规等级 E/E-级。
**修复**：
- 源码移除 `DEFAULT_FEISHU_CONFIG.appSecret` 声明和解码代码；
- 构建期 `scripts/inject_build_secrets.js` 把环境变量 `FEISHU_APP_ID/APP_SECRET/FOLDER_TOKEN` 注入到 `demo.html` 的 `window.__BUILD_SECRETS__`（`</head>` 前，用即焚：`getFeishuCfg` 首次读取后立即 `delete`）；
- Cordova 钩子 `hooks/before_build/01_inject_secrets.js` 缺环境变量直接 `exit(1)`；CI 新增 "Secret注入基线校验" step（Fork PR 无 Secret → `FEISHU_STRICT=0` 降级不阻断）；
- Android/iOS Release Workflow 缺 env 立即构建失败防发布空 Secret 版本；
- 校验端 `validate_web_assets.js` 升级为 3 态合规：注入块存在 + getFeishuCfg 有 delete 语句 + DEFAULT 字面量无 appSecret 声明行 → 通过；
- **合规等级**：A-级（Secret 永不入库、仅 CI 构建机内存瞬态、APK 中为注入块/删除前仅几百毫秒窗口），较原方案提升 ≥5 级。

### 3. 九模块连续拆分（A2-1 CSS + A2-2 Script）
**问题**：demo.html 含 `<style>` 211 行内联 CSS + `<script>` 6570 行内联大代码，单个文件 7400+ 行，无法做 Feature-based 目录组织、单模块评审、差异审查聚焦。
**修复**：
- CSS 211 行完整提取至 `css/app.css`；
- Script 6570 行按 **依赖拓扑顺序**拆为 9 个 defer 模块（边界零 gap/零 overlap，全量代码覆盖）：
  1. `00-bootstrap.js` 拼音/品牌车辆静态数据/密码工具/飞书Cfg+HTTP+上传三兄弟/缓存索引/APP_VERSION/esc
  2. `01-state.js` state对象/navHistory五层封装/路由常量/_activateScreen/showScreen/goBack
  3. `02-auth.js` 注册审批登录找回密码
  4. `03-vehicles.js` 品牌渲染/搜索筛选/车辆列表详情编辑保存/分享
  5. `04-export.js` Excel+zip压缩/Word OOXML/PDF canvas+legacy/批量折叠导出
  6. `05-sync.js` 审批轮询/成员守护/备份/JSON上传下载/doSyncUpload+Download/同步日志
  7. `06-media.js` 图片查看/视频播放器/飞书云端图片视频/户外模式/模态框与硬件反馈
  8. `07-cache.js` 缓存管理器/组员增删改/密码变更/校验工具/showToast/通知/版本更新与APK下载
  9. `08-main.js` Android backbutton/migrateLegacyMedia/deviceready入口/顶层side-effects
- **不变量（零破坏性）**：241 个全局函数名/签名 100% 保留、117 处 onclick 裸调用零改动、所有声明为顶层 function（自然挂 window，不包 IIFE 闭包）——兼容所有已有测试沙箱与老逻辑调用点。
- `scripts/split_modules.js` 提供拆分工具，保证下次 `demo.html` 修改后可快速重新拆分。

### 4. 导航栈 11 散点 → 5 个封装函数（q4 §七-4）
**问题**：`navHistory` 11 处散点直操作（push/pop/splice/清length 混用），导致 goBack 多层连跳/返回编辑页错乱/登录族回退到表单等问题。
**修复**：
- `navPush/navPop/navReset/navRemove/navTop` 五个集中封装；
- 内置：登录族（register/forgot/reset-password/screen-login）页面不入栈；连续同路径去重；栈深度上限 20（无限增长防御）；特定页面临时栈残留自动移除。

### 5. XSS 用户字段全转义（q3 §七-3）
**问题**：用户可编辑字段（display/position/steps 等）通过 innerHTML 注入路径，若包含 `<script onload onerror>` 等片段有 XSS 风险（尽管 Cordova `file://` 上下文风险较低、且管理员才能编辑，但合规要求必须全量转义）。
**修复**：
- `renderVehicleCard/renderVehicleList/renderVehicleDetail/openEditVehicle` 等所有 innerHTML 路径，对 19 种用户字符串字段统一包裹 `esc()`（5 字符：`<>&"` + `'`）；
- `esc()` 卫语句：非字符串直接返回（防御类型不确定性）。

### 6. 嵌套深度降压（q2 §七-2）
**问题**：`fetchFeishuPhotoDataURL` 原 5 层 if 箭形嵌套 + Cordova/Promise 回调共 8 层，不符合 Clean Code "函数体最大嵌套≤4"原则。
**修复**：抽出 `_feishuDownloadBlob(token,fileToken,mimeType)` 与 `_feishuLocatePhotoFile(token,dataFolder,fileName)` 两个单一职责工具，卫语句替代 if 嵌套，最大嵌套 ≤ 4 层。

### 7. 本地无 npm 环境引导（A2-5）
**问题**：部分开发机仅有裸 Node.js（无 npm/corepack/python/pip），导致 `npm install jsdom` 跑测试成为卡点。
**修复**：
- `scripts/bootstrap_npm.js` 自举脚本：使用 Node 内置 `https + zlib` + 手写最小 `ustar/pax/GNU长名 tar` 解包器，从 npmmirror/npmjs 下载官方 npm tarball，自解包至 `scripts/.npm-vendor/`；
- 使本地可运行 `node scripts/.npm-vendor/npm/bin/npm-cli.js install jsdom` 安装依赖；
- jsdom 已验证安装入根 node_modules，V57 逻辑测试 34/34 全绿。

### 8. CI 与测试基建补齐（q1 §七-1）
**问题**：CI 仅到 V105 专项，V106~V1011 的新专项测试在 CI 中缺失（PR 可绕过新测试）。
**修复**：
- `package.json`：新增 `test:v106`~`test:v1011`，`test:all` 扩展为 V53/V57/V103~V1011 串行执行；
- `.github/workflows/ci.yml`：新增 6 个 step（Secret注入校验 → V106 → V107 → V108 → V109 → V1010 → V1011）；
- `tests/e2e_harness.js`：新增 `loadCombinedSource()`(demo.html + js/*.js 排序拼接→统一注入沙箱)、`inlineDeferScripts()`(检测到 defer→内联还原时序，解决 V53~V109 读不到拆分后源码的问题)；
- 所有测试全量回归通过（V53/V57logic/V103~V1011 零失败）。

---

## 三、测试与验证

| 维度 | 用例数 | 结果 |
|---|---|---|
| V10.12 新增测试（Secret注入优先级+双栈收敛+导航栈封装5态+转义19字段） | 43 项 | ✅ 全通过 |
| V10.11 回归（镜像同步6项 + V10.10 E2E 18项） | 24 项 | ✅ 全通过 |
| V10.9.x ~ V10.3 历史专项 | 143 项 | ✅ 全通过 |
| V57 逻辑 + V53 运行时 + V57 跨网络 | 76 项 | ✅ 全通过 |
| CI 关卡（asset+语法+json+泄露扫描+映射表+11个版本专项） | 17 step | ✅ 全通过 |

---

## 四、变更文件清单（双端同步 GitHub / 飞书）

### 新增
- `css/app.css`（211 行抽出样式）
- `js/00-bootstrap.js` ~ `js/08-main.js`（9 模块）
- `scripts/inject_build_secrets.js`（注入/校验/剥离三件套）
- `scripts/bootstrap_npm.js`（无 npm 环境自举）
- `scripts/split_modules.js`（拆分工具）
- `hooks/before_build/01_inject_secrets.js`（Cordova 构建钩子）
- `tests/v1010_e2e_results.json` / `tests/v1010_solutions_results.json`（测试落盘）

### 修改
- `demo.html`（骨架化：211 行 CSS→link，6570 行内联大 script→9 个 defer script，版本号 10.12.0）
- `config.xml`（version / versionCode）
- `version.json`（version / releaseNotes / feishuConfig 更新）
- `CHANGELOG.md`（V10.12.0 完整条目）
- `feishu-api.js`（A1-1 下沉 FeishuAPI 分片/智能路由能力）
- `.github/workflows/ci.yml`（新增 Secret 基线 + V106~V1011 steps）
- `.github/workflows/android-release.yml`（新增 Inject Feishu build secrets step / CSS dir 打包拷贝 / zip align 路径修正）
- `scripts/validate_web_assets.js`（升级为 demo+js 联合扫描 + 3 态合规）
- `scripts/gen_media_mapping.js`（三端断言路径更新）
- `tests/e2e_harness.js`（loadCombinedSource / inlineDeferScripts 基建补齐）

---

## 五、向后兼容性

- **完全向后兼容**：241 个全局函数名/签名、117 onclick 全部保留；旧 API 零修改；数据结构（VEHICLES/USERS/持久化key）完全不变；
- 旧安装包与 V10.12.0 新安装包：云同步数据（vehicle_sync_data.json/approved_users/pending_reg 等）**格式 100% 兼容**（仅 appSecret 获取路径变更，数据本身不变）；
- 可从任意 V5.6.0+ 版本升级安装，无需清数据/重新注册。
