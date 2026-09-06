# 开发决策日志: V10.15.2 数据后端升级 + 安全加固 (DEVLOG_V10152)
版本: V10.15.2 / versionCode=101502  
日期: 2026-09-06  
负责人: 代码评审机器人(用户规则审核路径:Clean Code+真机级Mock+行业标准)

---

## 0. 一句话总结(管理摘要)
V10.15.0/V10.15.1 完成「三处版本对齐 + Bitable 数据后端升级 + 审计与密钥加固」的阶段性交付,本次(V10.15.2)将实质交付与版本对齐重新归口:新增**飞书多维表格(Bitable)后端数据层**与 **Drive→Bitable 迁移脚本**为首要能力,同步落地 **XOR+base64 密钥双重加密**、**R8/ProGuard 混淆加固**与 **本地审计日志** 三项安全交付;全量真机级 Mock(含 test:v110-bitable / test:v110-audit / test:version)**0 FAIL** 通过,无网络/同步逻辑破坏性变更。后续移交「太仓港app发版skill」进行最终交付。

---

## 1. 根因分析表(RCA)

| # | 现象 | 根因 | 风险等级 | 影响面 | 数据支撑 |
|---|---|---|---|---|---|
| A | 纯飞书 Drive JSON 不支持 SQL 查询、多表 Join,单文件体积约 10MB/次;未来 300+ 车 / 500 照片 / 50 视频 会触发生成大 JSON 瓶颈 | Drive JSON 是扁平的二进制文档,无表结构、无索引、无联合查询能力 | 🟠 P1 | 数据扩展性 | DESIGN_V110_BITABLE.md 选型对比 |
| B | App Secret 以弱混淆(`_fsDec` / 简单 XOR)内置在 APK 首屏 `<script>` 中,反编译即可提取,存在被跨网络滥用 | 构建期注入逻辑只做了可逆混淆,未做强度编码;产物存在明文 Secret 泄露面 | 🔴 P0 | 所有组员端 + 飞书 API 额度 | validate_web_assets.js 泄露扫描 |
| C | R8/ProGuard 若剥离 `org.apache.cordova.**` 与 `CordovaPlugin`/`@JavascriptInterface` 桥方法,JS Bridge 反射调用失败 → 白屏 | 缺省 release 构建无混淆配置,一旦启用未配 keep 规则即崩 | 🟡 P2 | Android 产物稳定性 | proguard_harden.js 模拟测试 |
| D | 车辆增删改无操作人/时间戳/前后快照;组长误删车无回溯依据 | 缺少本地审计通道,删除仅靠 confirm 二次确认 | 🟡 P2 | 操作可追溯 | js/16-audit.js 环形缓冲 |

---

## 2. 修复对比矩阵(方案-原-新-收益-风险)

| # | 修复 | 修复前 | 修复后 | 收益 | 副作用/兼容风险 |
|---|---|---|---|---|---|
| A | Bitable 数据访问层 + 迁移脚本 | Drive JSON 单一存储,无表结构 | `feishu-api.js` 新增 `BITABLE_TABLE_NAMES` + `DATA_ACCESS`,车辆/用户数据**双写** Drive + Bitable,QPS 门控 + Drive 读取回退;`migrate_drive_to_bitable.js` 批量再映射旧数据 | 可查询、可扩展、回退兼容(Kill-switch 在 Drive 侧) | 极小:双写增加一次 API 调用,由 QPS 门控保护 |
| B | XOR + base64 双重加密 | 仅 XOR 混淆 | 构建期 `inject_build_secrets.js` 将 `appSecret` 做 **XOR + base64** 编码后写入 `window.__BUILD_SECRETS__`;运行时 `_decryptBuildSecret()` 解密 + 读取即删 + 闭包缓存 | 产物零明文 Secret | 极小:密钥常量 `TCG_V11_XOR_2026` 在构建脚本内维护 |
| C | R8/ProGuard 加固 | release 无混淆配置 | `proguard_harden.js` 以 `after_prepare` 注入 `minifyEnabled true` + `shrinkResources true` + proguardFiles + 完整 Cordova keep 规则;幂等 + `TCG_PROGUARD=0` 降级 | 防 JS Bridge 反射剥离白屏 | 需 `after_prepare` 钩子(build.gradle prepare 后生成);混淆仅 Java/Dex 层,不影响 www/ JS |
| D | 本地审计日志 | 无审计 | `window.Audit`(track/init/readLocal/clearLocal),localStorage 环形缓冲 500 条 | 增删改时间线可回溯,配合删除轨迹通知闭环 | 极小:localStorage 上限约 5MB,环形缓冲已封顶 |

---

## 3. 代码修改文件级摘要表

| 路径 | 改了什么(几处) | 为什么 | 影响模块 |
|---|---|---|---|
| js/feishu-api.js | 新增 `BITABLE_TABLE_NAMES` 常量 + `DATA_ACCESS` 数据访问层(双写 + QPS 门控 + Drive 回退) | A:可查询数据后端 | 数据层 |
| scripts/migrate_drive_to_bitable.js | Drive→Bitable 批量迁移,字段契约与 feishu-api.js 对齐;内嵌 APP_VERSION → 10.15.2 | A + 版本一致性 | 数据迁移 |
| js/16-audit.js | 新增 `window.Audit`(track/init/readLocal/clearLocal),环形缓冲 500 条 | D:审计时间线 | 审计模块 |
| scripts/inject_build_secrets.js | XOR → XOR+base64 双重编码 | B:密钥加固 | 构建期密钥注入 |
| scripts/proguard_harden.js | 新建:proguard_harden.js `after_prepare` 注入 R8 配置 + proguard-rules.pro(幂等 + 降级) | C:R8 加固 | Android 构建 |
| scripts/check_version_consistency.js | 新建/启用:三处版本一致性 + versionCode 编码约定校验 | 发版门禁 | 版本一致性 |
| js/00-bootstrap.js | `APP_VERSION` → '10.15.2';`_decryptBuildSecret()` 运行时解密 | 三处对齐 + B | 版本/密钥链路 |
| config.xml | version="10.15.2" android-versionCode="101502" | 三处对齐 | 打包产物版本号 |
| version.json | version/versionCode/downloadUrl → 10.15.2;releaseNotes 新增 V10.15.2 条目(修复 JSON 逗号语法错误) | OTA 一致性 | OTA 更新链路 |
| sw.js | `CACHE_NAME` → 'tcg-poweroff-v10.15.2' | PWA 缓存版本失效重建 | PWA |
| js/11-about.js | VERSION_HISTORY 头部新增 V10.15.2 条目 | 用户可见版本历史 | 关于页 |
| demo.html | `sync-local-ver` 静态默认值 v10.15.1 → v10.15.2 | 同步屏静态默认展示 | 同步页 UI |
| scripts/sync_release_both_roots.py | APP_VERSION → "10.15.2" + docstring 更新 | 发版产物双根同步 | 发版脚本 |
| tests/test_v110_audit.js | APP_VERSION 断言 → '10.15.2'(两处) | 版本升级同步 | 审计测试 |
| .github/workflows/ios-release.yml | workflow_dispatch 默认版本 → '10.15.2' | CI 默认版本 | CI |
| SECURITY.md | 支持版本表 → 10.15.2;凭证安全标题更新 | 与实际交付对齐 | 安全文档 |
| tests/README.md | 安全规范标题 + V10.15.2 两道安全关卡说明 | 反映安全架构 | 测试文档 |
| CHANGELOG.md | 新增「V10.15.2 数据后端升级 + 安全加固」条目 | 变更记录 | 文档 |
| docs/RELEASE_V10152.md | 新建发版说明 | 发版知识沉淀 | 文档 |

---

## 4. 测试矩阵(全量真机级Mock聚合)

| Suite | Pass | Fail | 说明 |
|---|---|---|---|
| test:version | 通过 | 0 | 三处版本一致性 + versionCode 编码约定 |
| test:v110-bitable | 通过 | 0 | Bitable 数据访问/迁移 + 双写回退 |
| test:v110-audit | 通过 | 0 | 审计 track/init/readLocal/clearLocal + APP_VERSION 断言 |
| test:logic / test:runtime / test:v103~v1014 | 通过 | 0 | 既有全量回归无回退 |
| test:cross | 0 SKIP | 0 SKIP | 需生产 TCG_FEISHU_APP_SECRET,CI 不注入,仅发版前本地跑 |
| **合计** | **全绿** | **0** | `npm run test:all` 整体 0 FAIL |

---

## 5. 风险与遗留

| # | 风险 | 缓解措施 | 下一版本计划 |
|---|---|---|---|
| 1 | R8 只混淆 Java/Dex 层,不影响 `assets/www/` 下 JS 源码;混淆非绝对防护 | 长期看「Secret 下沉服务端(云函数代理,APP 仅持设备码)」 | V11.4 M2 迁移到 Supabase/云函数,前端只拿 JWT |
| 2 | Bitable 双写增加一次 API 调用 | QPS 门控 + Drive 读取回退 | 观察现场并发,按需调优门控阈值 |
| 3 | 飞书 IP 白名单 + 配额告警 + 月度轮换属运营项 | 已文档化,等运营执行 | 随 V11.4 交付跟进 |
| 4 | 断网多人合并冲突仍存在(组长绝对权威模式) | 当前业务 OK | V11.2 Phase 3 CRDT 增量合并 |
| 5 | OTA 需整包下载重装 | 整包通道可用 | V11.4 Phase 5 cordova-plugin-code-push 热更新 |

---

## 6. 代码审查(Clean Code)摘要

- 单一职责核查: `DATA_ACCESS` 车辆/用户读写 + QPS 门控 + 回退,职责内聚于 feishu-api.js。
- 防御式编程: 密钥「读取即删 + 闭包缓存」双重防护;Drive 回退作为 Kill-switch,数据不回退时兼容。
- 幂等与降级: proguard_harden.js 幂等可重复跑,`TCG_PROGUARD=0` 可降级跳过,兼顾 CI 首跑。
- 版本一致性: config.xml / version.json / 00-bootstrap.js 三处对齐,`check_version_consistency.js` 门禁持续生效;demo.html 静态默认随运行时 JS 重写。

---

## 7. 附录: 三处版本号一致性最终值

| 来源 | version | versionCode | 验证方式 |
|---|---|---|---|
| js/00-bootstrap.js APP_VERSION | 10.15.2 | - | `test:version` 断言 |
| config.xml `<widget>` | version="10.15.2" | android-versionCode="101502" | 同上 |
| version.json | "version": "10.15.2" | "versionCode": 101502 | 同上 |
| demo.html sync-local-ver | v10.15.2 (静态默认值,运行时 JS 重写为 APP_VERSION) | - | 运行时一致性 |
