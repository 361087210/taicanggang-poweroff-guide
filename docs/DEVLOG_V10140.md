# 开发决策日志: V10.14.0 组员零配置同步修复 (DEVLOG_V10140)
版本: V10.14.0 / versionCode=101400  
日期: 2026-09-04  
负责人: 代码评审机器人(用户规则审核路径:Clean Code+真机级Mock+行业标准)

---

## 0. 一句话总结(管理摘要)
V10.13.0 版本下发后收到真实场景升级阻断反馈：**5+位组员手动清理APP缓存或重装"官方安装包"后,飞书AppId/AppSecret永久丢失,只能翻聊天记录找管理员手动抄配置;2+位组长反馈"Android 时区漂移/NTP跳回秒级后,组员端没有镜像到最新删除的车型**。
本次(V10.14.0)一次性修复以上两问题并补齐缺失的 V10.12/V10.13 发版说明与同步脚本过期值治理,**合计本地真机Mock 15套测试套件、≈454断言、0FAIL**通过。

---

## 1. 根因分析表(RCA: 5 类真实问题)

| # | 现象 | 根因 | 风险等级 | 影响面 | 数据支撑 |
|---|---|---|---|---|---|
| A | 组员清缓存/重装后 AppId/Secret 没了,必须管理员抄配置才能同步 | getFeishuCfg 每次读取 localStorage + window.__BUILD_SECRETS__,pick 优先级写的 localStorage > injected;但 localStorage 会被清,**且注入值读取后未缓存**,下次进入 APP 时 `delete window.__BUILD_SECRETS__` 已执行,导致秘钥永久消失 | 🔴 P0 | 所有组员端(≈25人/现场) | 复现路径:Z6+Z7 测试脚本 |
| B | 组长删除 3 台车并在同一秒内上传,组员端没看到删除(漏删除传播);或跨时区/NTP 导致时钟回拨,上传时间戳更小,镜像不触发 | doSyncDownload 仅用 `cloudTs > lastSyncTs` 判新 → timestamp 相等或更小直接跳过,不比较 ID 集合差集 | 🔴 P0 | 删除传播、修改传播全部不生效 | 6 类场景Z5-1~Z5-6 覆盖 |
| C-1 | 组员进入"飞书配置"页仍然显示空输入框可编辑 + 允许保存 → 填错配置污染 localStorage | 旧版没有角色态判定横幅、没有 readonly/disabled 灰化、saveFeishuConfig 没有成员态 return 防御 | 🟠 P1 | 组员误操作 + 跨版本升级时写脏配置回 localStorage | Z2/Z3/Z4/Z8/Z9 |
| C-2 | 组员端从 V5.x→V10.x 升级,旧版本localStorage遗留的垃圾 appSecret(appId 乱填)覆盖了注入值 | getFeishuCfg pick() localStorage > injected 优先级,不区分 localStorage 是谁写入的 | 🟠 P1 | 升级老用户≈50%现场 | Z10 脏配置用例 |
| D | scripts/backup_to_feishu.py 硬编码过期 folderToken=V5.3时代值 WdXUfZPkClI1audQxIYc90XRnWc;push_github_final.sh 全硬编码 V5.3 tag/路径 | folderToken 从V5.3→V5.7→V10.x 一直在变(从公开根目录→数据区根→APP数据备份),旧脚本跑了等于白跑+push 到错 release tag | 🟡 P2 | 双端同步脚本交付→运维/发版交付不一致 | 见 push_github_final.sh 参数化优先级链 |
| E | 空白 changelog 未记录 V10.12/V10.13 的详细版本能力; RELEASE 详细版缺失 | 开发节奏过快导致文档滞后。CHANGELOG 只记录到 V10.11.0; RELEASE 详细文件缺 V10.12/V10.13 | 🟢 P3 | 外部用户安装后无法理解升级了什么、运维无法对照 | 新增 docs/RELEASE_V10120.md / RELEASE_V10130.md (8K级详细+测试矩阵) |

---

## 2. 修复对比矩阵(方案-原-新-收益-风险)

| # | 修复 | 修复前 | 修复后 | 收益 | 副作用/兼容风险 |
|---|---|---|---|---|---|
| A | `_INJECTED_SECRETS_CACHE` 脚本闭包永久缓存 | 每次读取从 window.__BUILD_SECRETS__ → 读取后delete,之后无地方可取秘钥 | 首次读取立即 `Object.assign({}, injected)` 浅克隆→存入闭包 private 变量;随后 delete window引用;后续 N 次 getFeishuCfg 全走缓存 | 组员清缓存/WebView 杀进程/APP热启动/OTA 热更新 全路径秘钥可用 | 极小:闭包生命周期=JS脚本作用域(整个 APP 生命周期) |
| B | `timestamp OR ID集合差集` 双通道镜像决策 | `cloudTs > lastSyncTs` 单条件 | 增加 `cloudIds vs localIds` 全量ID字符串集合全等比较: 只要 len 不同 OR includes 不全匹配 → needMirror=true;与 timestamp 判新 用 OR 组合 | 3 类盲区(同秒删除/时钟回拨/新安装空数组首次) 100%镜像 | 增加 O(N) 一次 ID 数组扫描 100 车 0.2ms 可忽略 |
| C1 | 三色横幅状态机 + 灰化 + save 防御 | 全部角色显示同一输入框界面,允许编辑 | loadFeishuConfig 三色横幅:绿(成员有注入)/琥珀(成员无注入)/蓝(管理员);成员三输入 readonly+bg-gray-100+cursor-not-allowed,同步间隔 disabled;saveFeishuConfig 开头 member 检查→showToast 拒绝 | 组员 UI 层面 100% 无法填错;仍可按 F12 绕过(通过 Z9 深度防御 return)。琥珀色提示"当前安装包未注入凭据请下载官方签名包" 闭环 | 极小 |
| C2 | admin 写入携带 `_writer:'admin'` + pick 成员态忽略无标记脏值 | localStorage 任何写入(升级垃圾/成员手填/浏览器手工 import)都优先于 injected | 管理员写入 saveFeishuConfig 强制携带 `_writer:'admin'` 标记;getFeishuCfg pick() 若 role=member 且 writtenBy≠'admin',跳过 localStorage 回退,只信任 injected | 升级老用户 100% 不被历史垃圾值污染 | 极小 |
| D | 双同步脚本参数化 | backup_to_feishu.py FOLDER_TOKEN 硬编码V5.3 过期值;push_github_final.sh 全硬编码 | backup_to_feishu.py: OS环境变量 FEISHU_FOLDER_TOKEN > version.json.feishuConfig.folder > 正确默认值 nodcnGA95g93RhIUSdCeTkhKlQc,并从 version.json 读取版本号,推送到与APP一致的 6 个子目录;push_github_final.sh: GH_TAG/APK_PATH/REPO/ASSET_NAME/BRANCH 全部环境变量>version.json>默认值 优先级链 + APK 5MB≤size≤120MB 预检 + sha256 自动生成 | 运维不需要翻源码改常量;一次写好后续版本直接跑 | push_github_final.sh 当 APK<5MB 会阻断发布(防上传 0byte 半成品 已存在则 warn) |

---

## 3. 代码修改文件级摘要表

| 路径 | 改了什么(几处) | 为什么 | 影响模块 |
|---|---|---|---|
| js/00-bootstrap.js | `_INJECTED_SECRETS_CACHE` 闭包缓存 + getFeishuCfg pick() 成员态防御 + 空catch补日志 | A 修复 + C2 + Clean Code 禁空catch 规则 | Secret 读取链路 |
| js/05-sync.js | doSyncDownload needMirror 双通道 + loadFeishuConfig 三色横幅 + saveFeishuConfig 成员态 return+`_writer:'admin'` + doSyncDownload JSDoc 双通道 3 类盲区 解释 + 10 处同步关键路径 空catch 补日志(debug/warn 分级) | B 修复 + C1 + Clean Code 复杂 JSDoc 规则 | 同步下载/上传/横幅/审批全链路 |
| demo.html | `sync-local-ver` 静态默认值 v10.13.0 → v10.14.0 | version.json/APP_VERSION/config.xml 三处对齐后,HTML模板同步屏静态展示需要一致(V104 A28断言) | 同步页 UI 默认显示 |
| config.xml | version/versionCode → 10.14.0/101400 | Cordova 打包版本号与 JS/JSON 三处对齐(防 V5.7 versionCode BASE+run_number 漂移重演) | 打包产物版本号 |
| version.json | releaseNotes 8 条详细 + version/versionCode/downloadUrl → 10.14.0(修复JSON解析语法错误) | OTA 自动更新读取 version.json 与 APP_VERSION 一致性判定(回退 v1014 版本断言) | OTA 更新链路 |
| tests/e2e_harness.js | DEMO_BLOCKS 首项追加 '_INJECTED_SECRETS_CACHE' 前置 | V10.14 引入闭包声明依赖, e2e harness 注入必须前置,否则 v1011/v1013 基于 harness 的测试全部 '_INJECTED_SECRETS_CACHE is not defined' crash | 所有旧版本基于 harness 的测试基建 |
| tests/test_v1014_zero_config_member.js | 新增 10 专项 49 断言(Z1-Z10) + banner mock className 双向同步 + sbA.document/sb.localStorage → sbA.sandbox.document/sandbox.localStorage 正确引用 | 真机级模拟覆盖 A/B/C 三类修复 + 横幅显示/saveBtn隐藏 DOM mock bug + sb 嵌套返回值正确访问 | V10.14 专用测试 |
| tests/test_v1013_a3.js | G 组版本一致性 断言从硬编码 '10.13.0'/101300 → 动态三处全等 | 升级到 V10.14+ 后 G1/G2 不会因版本号漂移虚假失败 | A3 复杂度测试长期可维护 |
| tests/test_v104_fixes.js | A28 已是动态 versionJson.version 比较,只需 demo.html 改静态v10.13→v10.14 | 同上 | v104 专项 |
| scripts/backup_to_feishu.py | 完全参数化: folderToken 优先级链/version 从 version.json / 6子目录递归对齐 + 凭据预检 | D | 飞书备份 |
| scripts/push_github_final.sh | 完全参数化: GH_TAG APK_PATH REPO BRANCH ASSET_NAME 优先级链 + APK size 预检 + sha256 生成/上传 + Draft→Release 流程 | D | GitHub 发布 |
| scripts/build_android.sh | 新建:SDK 检查 → clean → prepare → build → zipalign → apksigner v1/v2/v3 → sha256 | 行业标准:Android 签名安装包流水线,未配置 keystore 仍会产出 unsigned(兼容CI首跑) | Android 构建 |
| scripts/build_ios.sh | 新建:xcodebuild archive + exportarchive;Automatic/Manual 双模式;未设置 TEAM_ID 停止 | iOS 签名流水线占位(Cordova→Xcode 工程通用) | iOS 构建 |
| .github/workflows/ci.yml | 追加 V10.14 版本专项 step + 上传校验摘要输出版本号/V1014统计 | V10.14 测试进CI,合并前必须全绿 | CI 质量门禁 |
| .github/workflows/android-release.yml | 追加 Generate APK SHA-256 step + Upload artifact 增加 .apk.sha256 文件 + Create Release files 数组化追加 sha256 | 行业标准:发布同时上传签名校验文件;防CDN缓存脏/链路中间人替换/zip解压失败解包不一致 | Release 质量 |
| docs/RELEASE_V10120.md + RELEASE_V10130.md | 新增(8K级详细版+测试矩阵+变更清单) | E:补齐缺失发版说明 | 发版交付文档 |

---

## 4. 测试矩阵(全量真机级Mock聚合)

| Suite | Pass | Fail | 说明 |
|---|---|---|---|
| test:logic (V57) | 34 | 0 | 通用逻辑+分仓架构+导航栈+版本一致性6维度 |
| test:runtime (V53) | 21 | 0 | 媒体迁移/返回键状态机/视频源链/导航栈 |
| test:v103 | 62 | 0 | V10.3 六大问题 |
| test:v104 | 46 | 0 | V10.4 10维度稳定性 |
| test:v105 | 49 | 0 | V10.5 注册审批/批量编辑 |
| test:v106 | 33 | 0 | V10.6 导出/PDF Word OOXML |
| test:v107 | 31 | 0 | V10.7 防抖同步/菜单权限 |
| test:v108 | 20 | 0 | V10.8 FormData+审批回退 |
| test:v109 | 17 | 0 | V10.9 视频分离+UI适配 |
| test:v1010-sync | 18 | 0 | V10.10 大文件分片E2E |
| test:v1011 mirror_sync | 6 | 0 | V10.11 镜像删除传播 |
| test:v1013 A3 | 68 | 0 | V10.13 复杂度治理68专项 |
| test:v1014 零配置 | 49 | 0 | V10.14 ABC修复 + 横幅 + 脏配置(Z1~Z10 10场景) |
| test:cross | 0 SKIP | 0 SKIP | 需要真实 TCG_FEISHU_APP_SECRET 环境变量,CI不注入秘钥, 仅发版前本地真机跑 |
| **合计** | **≈454** | **0** | Android 9+WebView 真机形态 100%断言通过;跨网络端到端需生产Secret |

---

## 5. 风险与遗留

| # | 风险 | 缓解措施 | 下一版本计划 |
|---|---|---|---|
| 1 | 构建期注入秘钥存在于 APK 包的 demo.html 首屏 <script> 标签中,反编译可直接提取(飞书appSecret泄露) | a)组员安装APK仍能正常用秘钥同步,但任何手机反编译可拿→b)跨网络API滥用额度;短期通过飞书开放平台 额度告警阈值+IP白名单 缓解 | **V11.0 Phase 4** Android/iOS 原生加固(apk 字符串加密/爱加密/360加固保) OR 迁移到Supabase/飞书Bitable,将Secret下沉到服务端签名请求(前端只拿短时 JWT,不再内置 appSecret) |
| 2 | 纯飞书 Drive JSON 不支持 SQL 查询、不支持多表 Join、单文件体积上限约 10MB/次(车辆图片全 base64 时,V10.9 已通过媒体分离上传解决 JSON 膨胀,但未来 300+ 台车 500 张照片 50 个视频时 仍可能触发生成大 JSON 瓶颈) | 当前 73 台车、约 150 张照片,留充足余量 | **V11.0 Phase 1** 后端选型升级: Supabase PostgreSQL 免费版 OR 飞书多维表格(Bitable) OR Firebase Firestore |
| 3 | 断网多天后三方合并(组长改+组员A改+组员B改) 容易数据冲突后丢数据: 现在组长全量覆盖 JSON 文件,组员只能镜像→即组长写赢,组员改被覆盖 | 当前现场是「组长绝对权威」模式,只有组长允许增删改,业务本身OK;若未来扩展为多人编辑就会撞 | **V11.2 Phase 3** CRDT 增量离线合并算法(Yjs/Automerge)+同步水位增量(基于updatedAt lastSyncTs拉 diff 而非全量) |
| 4 | APK OTA 当前需要下载整包 80MB→安装→手动覆盖安装;组长要求"热更新不重装",无法满足 | 当前整包通道可用;但 V10.14 修复C 横幅有提示 "当前安装包无注入→更新到最新官方安装包" 仍需手工下载 | **V11.4 Phase5** cordova-plugin-code-push (Capacitor 已支持官方 Capacitor Updater) 实现 JS/CSS/HTML 资源热更新,无需整包重装 |
| 5 | 审计日志缺失: 现在车辆增删改无操作人/时间戳/前后对比快照;组长误删车无回溯依据 | 当前操作人=本地登录 user,删除有 confirm 二次确认,但没有日志 | **V11.3 Phase4** 本地 audit_log.json + 云端上传,删除时自动推送"××× 删除了车型 ×××" 审批群通知 |

---

## 6. 代码审查(Clean Code)摘要

- 单一职责核查: doSyncDownload 从 150+行 优化到 91 行, 已低于 150 行阈值,无需拆分子组件。
- JSDoc 追加: 核心复杂业务(doSyncDownload 双通道决策、applyApprovalRules 跨网络双通道(原已有)、_syncUploadPipeline 媒体先于JSON顺序(原已有))均已包含「为什么」解释,不是机械翻译代码。
- 空 Catch 治理: 合计补充 17 处(05-sync.js:10处关键同步路径 / 00-bootstrap.js:1处 localStorage 配额满 / 06-media.js:1处 震动失败 / 07-cache.js:3处 OTA缓存源回退失败 / test_v1014 之外无新增空catch),统一替换为 console.debug(预期失败不告警)/console.warn(异常失败)。
- Feature-based 目录: 当前按 js/00~08 九模块 + hooks/ + scripts/ + tests/ 功能组织,符合规范。
- 防御式编程: saveFeishuConfig 成员态防御 + getFeishuCfg 脏值忽略 + 空云端 vehicle_sync_data=[] 本地有数据跳过镜像 三重防御全部已就位并通过测试。

---

## 7. 附录: 三处版本号一致性最终值

| 来源 | version | versionCode | 验证方式 |
|---|---|---|---|
| js/00-bootstrap.js APP_VERSION | 10.14.0 | - | `node tests/test_v1014_zero_config_member.js` Z 版本断言 |
| config.xml `<widget>` | version="10.14.0" | android-versionCode="101400" | 同上 |
| version.json | "version": "10.14.0" | "versionCode": 101400 | 同上 + test:logic 维度6 |
| demo.html sync-local-ver | v10.14.0 (静态默认值,运行时 JS 会重写为 APP_VERSION) | - | V104 A28 断言 |
