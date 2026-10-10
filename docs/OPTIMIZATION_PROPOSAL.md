# 开源生态优化建议报告（OPTIMIZATION_PROPOSAL）

> **性质**：纯建议文档（Task③ 交付物）。除本文档自身外未改动任何代码、配置与 CI，所有"建议"均未实施。
> **基线**：2026-10-10，HEAD `0931b5e`（V10.25 媒体按车型名分目录已落地），本地领先 `origin/main` 5 个提交未推送。
> **证据来源**：`docs/codebase/`（7 份代码库测绘文档）、`docs/PENDING_ISSUES.md`、`docs/REWRITE_PROPOSAL.md`、`package.json`、`.github/workflows/`（15 条）实读；29 个 GitHub 开源项目（star 数与维护状态为 2026-10-10 快照）。
> **分工**：CONCERNS.md 盘点现状风险，本文回答"用哪些开源方案解、哪些明确不引入"；两文档中已标 ✅ 的完成项不再重复。
> **读者**：项目维护者，作技术选型决策参考；实施顺序由维护者裁定。

## 1. 结论速览

运行时层（`js/`、`demo.html`、`feishu-api.js`、`css/`、`vendor/`，即两端错配门禁的 `SHARED_CODE_PATHS`）维持自研为主；新工具优先落在 `tests/`、`scripts/`、`.github/` 三处——全部在门禁路径之外，引入不动运行时契约。

| 优先级 | 建议 | 引入物 | 落点 | 门禁影响 | 工作量 |
|---|---|---|---|---|---|
| P0 | 媒体路径清洗属性测试 | fast-check | tests/ | 无 | 0.5–1 天 |
| P0 | 结构化数据 Schema 校验 | Ajv | schemas/ + scripts/ + CI | 无 | 1–2 天 |
| P0 | 发布堆积飞书群主动预警 | 新 scheduled workflow | .github/ | 无 | 0.5 天 |
| P1 | 测试框架迁移试点 | Vitest | tests/ + CI | 无 | 3–5 天 |
| P1 | 媒体压缩流水线 + sha256 全量补齐 | sharp | scripts/ + CI | 无（影响产物字节） | 2–3 天 |
| P2 | Service Worker 工程化 | Workbox | sw.js | 路径外，须绑发版回归 | 3–5 天 |
| P2 | Python 同步脚本官方 SDK 化 | oapi-sdk-python | scripts/ | 无 | 2–3 天 |
| P2 | 网页端端到端测试 | Playwright | tests/ | 无 | 3–5 天 |

明确不引入：Vite、esbuild、Capacitor、vite-plugin-pwa、RxDB、PouchDB、Yjs、WatermelonDB、Dexie.js、Zod、Valibot、BLAKE3、ffmpeg.wasm、js-spark-md5，依据见 §4.6。

调研中的一项关键更正：飞书官方 Node SDK `larksuite/oapi-sdk-nodejs` **已归档（DEPRECATED）**，官方在维护的是 `larksuite/node-sdk`（Node）与 `larksuite/oapi-sdk-python`（Python）。后续任何脚本或 CI 引入飞书 SDK 须按此选型（§4.3）。

## 2. 现状基线与痛点映射

Cordova 13 + Vanilla JS 单页应用：16 个 `js/` 模块按 `<script defer>` 加载序隐式耦合，无打包器、无 TypeScript；生产依赖仅 `cordova@^13`，devDependencies 仅 `c8@^12` 与 `jsdom@^29`。同一套共享代码进 App 与网页端，网页端跟 `main`、App 跟 tag。数据真源为飞书 Bitable，`sync-web-data.yml` 以 15 分钟级 cron 镜像到 `web-data/`。质量侧已有 60 个测试文件（59 JS + 1 Python，JS 套件经 `run_all_tests.js` 串行聚合）、c8 行覆盖率门禁、七源版本一致性门禁、两端错配门禁、密钥扫描、web-data 脱敏门禁、媒体映射漂移审计，以及 codeql / fortify / dependency-review / secret-scan 四条安全流水线——门禁密度是本项目最大的工程资产，本报告全部建议以此为前提设计。

| # | 痛点（出处） | 对策 |
|---|---|---|
| T1 | 无测试框架，60 个测试文件串行执行（CONCERNS.md 技术债，记载时为 49 套件） | §4.1 |
| T2 | `web-data/` 镜像高 churn、仓库内嵌（CONCERNS.md） | §4.7 增量二 |
| T3 | 飞书限速下手工维护 QPS 门与退避（feishu-api.js） | §4.3（维持自研） |
| T4 | 巨型模块：05-sync.js 1865 行、00-bootstrap.js 1759 行、04-export.js 1273 行（ARCHITECTURE.md） | §4.6（不拆） |
| T5 | P1 数据一致性 4 项未完成：docx/sheets 类型未处理、视频链接数量不符、Excel 导出车型名不匹配、车型数量不匹配（PENDING_ISSUES.md §2） | §4.2（结构子集） |
| T6 | 媒体无压缩治理：193 个图片全量进 APK 与飞书同步 | §4.4 |
| T7 | 真机测试与 E2E 缺口（PENDING_ISSUES.md P2） | §4.1 第三步 |
| T8 | 客户端持有飞书 Secret（CONCERNS.md 已载架构级风险） | §6（不推翻） |

## 3. 调研项目清单与契合度判定

star 数为 2026-10-10 快照（约数），引入前应复核项目健康度（issue 响应、最近 release、breaking change 历史）。

| 类别 | 项目 | star | 判定 | 依据 |
|---|---|---|---|---|
| 跨端容器 | ionic-team/Capacitor | ≈16.8k | 远期 | docs/ARCHITECTURE.md 重写路线候选，触发条件见 §4.6 |
| 跨端容器 | apache/cordova-android | ≈3.8k | 维持 | 现役基座，跟随版本升级 |
| 本地数据 | pubkey/rxdb | ≈23.4k | 不引入 | 单用户单设备，无多端冲突合并需求 |
| 本地数据 | pouchdb/pouchdb | ≈17.6k | 不引入 | 同上，且以 CouchDB 复制协议为中心 |
| 本地数据 | dexie/Dexie.js | ≈14.6k | 观察 | 当前 IndexedDB 用量简单，抽象层无净收益 |
| 本地数据 | yjs/yjs | ≈22.9k | 不引入 | CRDT 属协同编辑场景，过度设计 |
| 本地数据 | Nozbe/WatermelonDB | ≈11.8k | 不引入 | React Native 生态，场景不符 |
| 哈希 | sqmk/spark-md5 | ≈2.6k | 不引入 | 对账基线是 sha256，无 MD5 需求 |
| 哈希 | Daninet/hash-wasm | ≈1.2k | 观察 | 媒体量级上千、CI 时长成瓶颈时再议 |
| 哈希 | BLAKE3/BLAKE3 | ≈6.5k | 不引入 | 换哈希算法破坏既有对账基线 |
| 数据校验 | ajv-validator/ajv | ≈14.9k | **P0 引入** | JSON Schema 标准 + 纯 JS，无 TS 依赖 |
| 数据校验 | colinhacks/zod | ≈44.1k | 不引入 | TS 优先，本项目无 TS |
| 数据校验 | fabian-hiller/valibot | ≈6.8k | 不引入 | 同上 |
| 媒体处理 | lovell/sharp | ≈32.7k | **P1 引入** | 预编译二进制，Node 侧压缩事实标准 |
| 媒体处理 | GoogleChromeLabs/squoosh | ≈26.0k | 备选 | CLI 形态，与 sharp 二选一 |
| 媒体处理 | ffmpegwasm/ffmpeg.wasm | ≈17.8k | 不引入 | wasm 转码耗时，视频来源多元参数难统一 |
| 媒体处理 | MikeKovarik/exifr | ≈1.3k | 观察 | EXIF 旁证核验，先验证照片是否保留 EXIF |
| 构建/PWA | vitejs/vite | ≈83.3k | 不引入 | 隐式全局作用域会被打包器切断（REWRITE_PROPOSAL.md 论证） |
| 构建/PWA | evanw/esbuild | ≈40.1k | 不引入 | 同上，单独引入无使用场景 |
| 构建/PWA | GoogleChrome/workbox | ≈13.0k | P2 评估 | workbox-cli 不依赖打包器 |
| 构建/PWA | vite-pwa-org/vite-plugin-pwa | ≈4.3k | 不引入 | 依赖 Vite |
| 测试 | vitest-dev/vitest | ≈17.2k | **P1 引入** | 仅测试层，jsdom 内置环境选项 |
| 测试 | microsoft/playwright | ≈97.4k | P2 | 网页端 E2E |
| 测试 | dubzzz/fast-check | ≈5.2k | **P0 引入** | 属性测试，纯 JS，仅测试层依赖 |
| 飞书官方 | larksuite/node-sdk | ≈0.3k | 脚本侧可用 | 官方唯一在维护的 Node SDK |
| 飞书官方 | larksuite/oapi-sdk-nodejs | — | **禁止新引入** | 已 DEPRECATED（归档） |
| 飞书官方 | larksuite/oapi-sdk-python | ≈0.6k | P2 | scripts/ Python 侧迁移候选 |
| 飞书官方 | larksuite/cli | ≈17.6k | 不引入 | 面向飞书低代码平台开发，与 OpenAPI 集成模式不符 |
| 飞书官方 | larksuite/lark-samples | ≈0.1k | 参考 | 官方 API 用法示例，不作依赖 |

新增 npm 依赖会自动落入既有 dependency-review、codeql、secret-scan 三条流水线的扫描范围，供应链风险有现成防线。

## 4. 分项建议

### 4.1 测试：fast-check（P0）、Vitest（P1）、Playwright（P2）

`js/00-media-paths.js` 是 V10.25 媒体路径约定的单一真源，`sanitizeName` / `folderNameForVehicle` / `parseMediaPath` / `candidateRelPaths` 处理的输入空间包括 emoji、控制字符、`\ / : * ? " < > |` 非法字符、空白与 `_{2,}` 折叠、40 字符截断、空名兜底——正是属性测试的典型靶点：用随机输入验证不变量（任意车型名经 `folderNameForVehicle` 输出必为合法目录名、同一输入两次调用结果一致、清洗结果不含非法字符），比枚举用例的覆盖密度高一个量级。落点 `tests/test_v1026_media_paths_property.js`，devDependencies 增加 fast-check，半天可完成。

⚠️ 属性测试大概率暴露新的清洗边界缺陷；修复要改 `00-media-paths.js`，属共享代码，触发两端门禁，须绑发版。节奏应为：测试先行入库，缺陷修复攒到下个发版窗口统一处理。

Vitest 解决串行执行痛点（T1），要点：

- 只存在于 devDependencies 与测试层，不触碰"运行时无打包器"约束；
- jsdom 是其内置环境选项（devDependencies 已有 jsdom@29，版本兼容需实测）；
- 迁移用绞杀者模式：新测试一律 Vitest，存量套件按"纯函数 → mock server → 端到端"顺序分批收编，双 runner 对照运行一段时间后再切换 `test:all` 主入口；
- 隐性成本：`test:coverage` 目前是 `c8 --all --include="js/**/*.js"` 包裹 `npm run test:all`，迁移后须改为 Vitest coverage（默认同为 v8 provider，数值口径接近但调用链不同），覆盖率门禁切换须与迁移同一提交完成，避免统计空窗。

Playwright 补 T7 的网页侧等价物：`demo.html` 可在浏览器直接运行，覆盖登录 → 车型浏览 → 视频播放（Range 直链）→ 反馈提交主链路；真机侧（两台手机 + 真实飞书云端）仍需人工实测，工具无法替代。

### 4.2 数据契约：Ajv + JSON Schema（P0）

P1 四项未完成（T5）的共性是字段契约没有形式化定义，漂移只能事后发现。建议：

1. 为 `version.json`、`web-data/vehicle_sync_data.json`、`vehicles_data.js` 导出结构、`docs/vehicle_media_manifest.json` 各定义一份 JSON Schema；
2. `scripts/` 新增 Ajv 校验步骤并入 `ci.yml`。

Schema 保证结构，既有七源对齐脚本保证跨文件一致性，两者互补。Ajv 选型而非 Zod/Valibot 的依据：本项目无 TypeScript，后两者的类型推导收益为零；JSON Schema 是独立于代码的声明式契约，飞书侧脚本与 IDE 均可直接复用。

数据级数量对账（视频链接数量、车型数量匹配）不属 Schema 覆盖范围，仍按 PENDING_ISSUES §2 既定路径重新派发，先红后绿配测试。

### 4.3 飞书 SDK：选型更正与双轨策略

运行时 `feishu-api.js` 维持自研，依据有三：运行环境是 Cordova WebView + `cordova-plugin-advanced-http` 原生栈，官方 SDK 以 Node/浏览器 fetch 为假设；自研层已内建 QPS 门（150ms/3 并发）与限流退避（400→800→1600ms）及原生/fetch 双栈回退，替换无能力增益；该文件在 `SHARED_CODE_PATHS` 内，改动必须绑发版。T3 的正确处置是维持现状而非换库。

脚本侧双轨：

- Python：`backup_to_feishu.py`、`sync_release_to_feishu.py` 的 token 获取刷新与错误码分类可渐进交给 `oapi-sdk-python`；Python 脚本不在门禁路径。迁移时保留既有教训——脚本必须继续从 `version.json` 读 `folderToken` 字段（曾因读错字段静默回退旧默认值）。
- Node：GitHub Actions 内如需调飞书（§4.7 预警 workflow），用 `larksuite/node-sdk`。`larksuite/cli` 是飞书低代码平台开发工具，与本项目"外部系统经 OpenAPI 集成"的模式不符。

### 4.4 媒体流水线：sharp 压缩与 sha256 补齐（P1）

193 个图片文件当前无压缩治理，全量进 APK（10.19.x 发版记录 APK 17.19MB）与飞书同步。方案：`scripts/` 新增 sharp 压缩步骤，置于 `gen_media_mapping` 之前，与 manifest 生成同一流水线原子执行。

三个前置约束：

1. 可读性优先：图片是断电操作指导，压缩必须视觉无损（WebP q≥90 或高质量 JPEG）；先在典型图集上测体积收益，收益不足 20% 则放弃；
2. sha256 耦合：压缩改变全部文件字节，manifest 哈希整体失效，须与 manifest 重建原子化；飞书侧同名文件会被同步脚本判为内容更新，须先确认 sync 脚本支持"内容变更更新"语义；
3. 既有重复文件清理纪律是"SHA-256 字节级核验后才删除"，压缩后新旧文件哈希必然不同，演练须先在独立目录跑一轮全量对账。

manifest sha256 全量补齐（对应审计 C3 项：2 条跨车共用视频缺 sha256）是独立小项，可与压缩合并实施，也可单独先行。

观察项：hash-wasm 在媒体量级上千、CI 时长成为瓶颈时替代 Node 内置 crypto；exifr 若现场照片保留 EXIF 拍摄时间，可作为 `audit_media_consistency` 的旁证信号交叉核验照片与车型归属——先抽样验证（社交软件传图通常剥离 EXIF），有数据再立项。

### 4.5 离线层：Workbox（P2）

`sw.js` 目前手写维护缓存版本号。Workbox 的 workbox-cli / build 模式不依赖打包器，生成 precache 清单与 runtime caching 策略，与无打包器约束兼容。`sw.js` 不在 `SHARED_CODE_PATHS` 内，但直接决定离线可用性（项目硬约束：视频播放弱网/离线可用），因此必须绑发版窗口做真机回归，并先在网页端灰度验证缓存命中率。

### 4.6 明确不引入清单

| 项 | 依据 |
|---|---|
| Vite / esbuild | 打包器会切断隐式全局作用域（REWRITE_PROPOSAL.md 已论证），渐进引入等于启动重写路线 |
| Capacitor | 属 docs/ARCHITECTURE.md 既有重写路线。建议明确触发条件：Cordova 关键插件停止维护，或需要 Capacitor 独有能力；在此之前迁移是纯成本 |
| RxDB / PouchDB / Yjs / WatermelonDB | 单用户、单设备、飞书 Bitable 唯一云端真源，无多端冲突合并需求 |
| Dexie.js | 当前 IndexedDB 用量简单；本地缓存结构复杂化（多表/索引/游标）后再评估 |
| vite-plugin-pwa | 依赖 Vite |
| Zod / Valibot | 无 TS，见 §4.2 |
| BLAKE3 / js-spark-md5 | sha256 是既有对账基线，换算法破坏全链兼容 |
| ffmpeg.wasm | 转码收益真实但成本错配，远期再议 |
| 拆分巨型模块（T4） | 每个模块都在门禁路径内，拆分须多次发版验证；建议绑定重写立项，当前不动 |

### 4.7 GitHub 与飞书协同增量

现有分工——GitHub 承担代码、CI、产物与 CDN 直链，飞书承担数据、协作与 Bitable——已覆盖两端需求，`sync-web-data.yml`（15 分钟镜像）、`sync-release-feishu.yml`（发版产物回传）、两端错配门禁构成完整闭环，以下仅为增量。

**发布堆积主动预警（P0）。** 当前唯一 CI 红灯（`unpublished_change_stack`：7 个共享代码文件堆积于 tag v10.20.2 之后且 version.json 未升版）依赖人工盯 CI。现有 15 条 workflow 中无一定时巡检该门禁并推送飞书的任务（`summary.yml` 是 issue 摘要评论，`sync-web-data.yml` 只同步数据）。建议新增 scheduled workflow：每日调用 `scripts/check_two_end_sync.js`，非 PASS 时经发版通知同款飞书通道推送提醒。落点 `.github/`，零门禁影响；只提醒不阻断，升版本号与打 tag 仍是人工动作（既定纪律：门禁不得由自动化单方修改）。

**sync-web-data 无变化跳过（条件项）。** 若 15 分钟 cron 在内容无变化时仍产生空提交，加 `git diff --quiet` 守卫跳过，降低 `web-data/` 高 churn（T2）与历史噪声；已实现则忽略。

**发版文档双端同源。** `RELEASE_V*.md` 目前仅在 repo，可在发版同步脚本中顺带写入飞书对应分类目录（沿用"飞书根目录按分类整理"约定），替代手工复制。

版本探测回退链（GitHub Raw → jsDelivr → 飞书）与媒体双通道（GitHub Release 直链 + 飞书云端）维持现状，不加第三通道——维护成本高于边际可用性收益。

## 5. 实施顺序

| 时点 | 事项 | 前置条件 |
|---|---|---|
| 立即可做 | fast-check 属性测试、Ajv Schema 门禁、发布堆积预警 workflow | 无 |
| 红灯处置之后 | Vitest 试点、sharp 压缩 + sha256 补齐 | 人工升版本号 + 打 tag 清掉 `unpublished_change_stack` |
| 下个发版窗口 | 属性测试暴露的清洗缺陷修复（改 00-media-paths.js） | 与该窗口版本升号绑定 |
| 空闲时 | oapi-sdk-python 迁移、Playwright E2E、Workbox 评估 | Workbox 须配真机回归计划 |

## 6. 风险声明

1. star 数与维护状态为 2026-10-10 快照，实施前复核 issue 响应、最近 release 与 breaking change 历史。
2. "零门禁影响"的判断前提是 `SHARED_CODE_PATHS` 维持当前定义（`js/**`、`demo.html`、`feishu-api.js`、`css/**`、`vendor/**`）；门禁范围扩大时全部结论重估。
3. 压缩、哈希、飞书同步三方耦合（§4.4）是本报告风险最高的建议，任一环节不同步都会造成本地与云端对账断裂；必须原子化实施并先在独立目录演练。
4. Vitest 迁移的覆盖率口径切换须与迁移同一提交完成，否则覆盖率门禁出现统计空窗。
5. 客户端持有飞书 Secret 是 CONCERNS.md 已载的架构级决策，本报告不重新开题；若未来要消除需引入服务端代理（新基础设施），另做专项评估。
6. 本报告全部建议均未实施；当前优先级最高的动作仍是人工处置 `check:two-end` 红灯（升版本号 + 打 tag），先于本报告任何 P0 项。
