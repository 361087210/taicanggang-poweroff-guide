# 开发决策日志: V10.15.6 账号级字段选项云同步版 (DEVLOG_V10156)
版本: V10.15.6 / versionCode=101506  
日期: 2026-09-06  
负责人: 代码评审机器人(用户规则审核路径:Clean Code+真机级Mock+行业标准)

---

## 0. 一句话总结(管理摘要)
V10.15.5 遗留风险#3「字段选项用户增删改持久化于本地,换机/重装不共享」在本版被彻底解决:断电位置/钥匙处理方式/断电步骤字段选项由「localStorage 本地持久化」升级为「飞书账号级云同步」——组长端增删改后自动上传 `field_options.json`,组长/组员登录或拉取数据时静默下载覆盖本地,跨设备、跨换机/重装实现账号级共享闭环;版本三源对齐升级至 10.15.6(versionCode=101506),除 `test:cross`(需 CI Secret)外全量门禁与回归测试 **0 FAIL** 通过,`dataSubFolders` 扩容至「偏好设置」并联动 `test:v57` 断言同步更新。

---

## 1. 根因分析表(RCA)

| # | 现象 | 根因 | 风险等级 | 影响面 | 数据支撑 |
|---|---|---|---|---|---|
| A | 组长增删改断电位置/钥匙/步骤选项,组员或新设备看不到 | 字段选项仅写入 `localStorage['tcg_field_options']`,属本地作用域,未跨端共享 | 🟠 P1(遗留风险#3) | 现场车型录入的选项一致性 | V10.15.5 DEVLOG 风险#3 显式记录 |
| B | 换机/重装 App 后自定义字段选项丢失 | 本地存储随设备/安装态清除,无云上权威层兜底 | 🟡 P2 | 重装后选项回归默认 | 硬件升级/卸载重装场景 |

---

## 2. 修复对比矩阵(方案-原-新-收益-风险)

| # | 修复 | 修复前 | 修复后 | 收益 | 副作用/兼容风险 |
|---|---|---|---|---|---|
| A | 字段选项账号级云同步 | 仅 localStorage 本地持久化 | 飞书「偏好设置」子目录 `field_options.json` 快照式全量,组长上传、全员下载覆盖本地 | 换机/重装共享,账号级闭环 | 极小:默认种子+数据库内容为基底,云端为权威自定义层,无数据时静默保持本地 |
| B | 云同步挂载点全覆盖 | 仅本地改动触发 | 组长增删改自动上传 + 登录/会话恢复/车辆镜像下载三处拉取 | 四象限触发闭合,无需手动同步 | 极小:异步静默,失败保留本地,下次改动重试 |

---

## 3. 代码修改文件级摘要表

| 路径 | 改了什么(几处) | 为什么 | 影响模块 |
|---|---|---|---|
| js/00-bootstrap.js | `DEFAULT_FEISHU_CONFIG` 新增 `prefSub:'偏好设置'`,`getFeishuCfg()` 返回该字段 | 云端新增字段选项专属子目录 | 配置 / 云同步 |
| js/05-sync.js | 新增 `FIELD_OPTION_CLOUD_FILE` 常量与 `uploadFieldOptionsToFeishu`/`downloadFieldOptionsFromFeishu`/`syncFieldOptionsFromCloud` 三函数;`doSyncDownload()` 车辆镜像末尾顺带拉取云端选项 | 字段选项云端上传/下载/同步核心 | 数据同步 |
| js/03-vehicles.js | `persistFieldOptions()` 拆分为本地保存 `_saveFieldOptionsLocal` + 组长自动上传;新增 `applyCloudFieldOptions()` 按「默认种子+数据库内容为基底,云端为权威自定义层」覆盖 | 改动触发上传 + 云端覆盖逻辑 | 车型编辑 / 字段选项 |
| js/02-auth.js | `doLogin` 成功分支新增静默拉取云端字段选项 | 登录即跨端共享 | 认证 / 同步 |
| js/08-main.js | `restoreSession()` 成功分支新增静默拉取云端字段选项 | 免登录会话恢复亦共享 | 会话恢复 / 同步 |
| js/11-about.js | VERSION_HISTORY 头部新增 V10.15.6 条目 | 用户可见版本历史 | 关于页 |
| js/00-bootstrap.js | `APP_VERSION` → '10.15.6' | 版本对齐 | 版本 |
| config.xml | version="10.15.6" android-versionCode="101506" | 版本对齐 | 打包产物版本号 |
| version.json | version/versionCode/downloadUrl → 10.15.6;`dataSubFolders` 新增「偏好设置」;releaseNotes 新增 V10.15.6 条目 | OTA 一致性 + 子目录清单扩容 | OTA 更新链路 |
| release/version.json | 与根 version.json 完全同步 | 发版产物双根一致 | OTA 同步 |
| sw.js | `CACHE_NAME` → 'tcg-poweroff-v10.15.6' | PWA 缓存版本失效重建 | PWA |
| demo.html | `sync-local-ver` 静态默认值 → v10.15.6 | 同步屏静态默认展示 | 同步页 UI |
| scripts/migrate_drive_to_bitable.js | 内嵌 APP_VERSION → '10.15.6' | 版本一致性 | 数据迁移 |
| scripts/sync_release_both_roots.py | APP_VERSION → "10.15.6" + docstring 更新 | 发版产物双根同步 | 发版脚本 |
| tests/test_v110_audit.js | APP_VERSION 断言 & appVersion → '10.15.6'(两处) | 版本升级同步 | 审计测试 |
| tests/test_v57_logic.js | `dataSubFolders.length === 4` → `=== 5` | 新增「偏好设置」子目录联动 | 逻辑测试 |
| .github/workflows/ios-release.yml | workflow_dispatch 默认版本 → '10.15.6' | CI 默认版本 | CI |
| docs/RELEASE_V10156.md / DEVLOG_V10156.md | 新建发版说明与开发决策日志 | 发版知识沉淀 | 文档 |

> 注: `web-data/approved_users.web.json` 由 `sync-web-data.yml` 自动同步任务拥有,属生成文件,刻意排除在发版提交之外,避免形成手动冲突源;`validate_web_assets.js` 不检查其 version 字段。测试重跑产生的 json 时间戳/耗时噪音剔除,提交仅保留发版改动。

---

## 4. 云同步机制(技术方案)

| 维度 | 设计 |
|---|---|
| 存储位置 | 飞书「APP数据备份」→ **偏好设置** 子目录(`prefSub`) → `field_options.json` |
| 文件结构 | `{type:'field_options', appVersion, updatedBy, updatedAt, options:{position[],keyframe[],keycontainer[],step[]}}` 快照式全量 |
| 上传权限 | 仅组长(admin)可上传(`uploadFieldOptionsToFeishu` 校验 `state.currentUser.role==='admin'`) |
| 下载范围 | 全员可下载(组员端不展示编辑入口,只读应用) |
| 覆盖策略 | `applyCloudFieldOptions`:默认种子 + 当前数据库内容为基底 → 云端数组为权威自定义层覆盖 |
| 触发挂载点 | ①组长 `persistFieldOptions` 增删改自动上传;②`doLogin` 登录成功;③`restoreSession` 会话恢复;④`doSyncDownload` 车辆镜像拉取后顺带拉取 |
| 容错 | 上传/下载失败静默保留本地;无数据/字段缺失返回 null 不破坏本地 |

---

## 5. 测试矩阵(全量真机级Mock聚合)

| Suite | Pass | Fail | 说明 |
|---|---|---|---|
| check_version_consistency | 通过 | 0 | version=10.15.6, versionCode=101506 三处一致性 |
| validate_web_assets | 通过 | 0 | 全文件扫描,无凭证泄露,签名密钥未入库 |
| gen_media_mapping --check | 通过 | 0 | 73 条记录与源数据一致 |
| test:version | 通过 | 0 | 三处版本一致性 + versionCode 编码约定 |
| test:logic | 通过 | 0 | 含 test:v57 `dataSubFolders` 长度 5 断言 |
| test:runtime | 通过 | 0 | 21 项 |
| test:v103 | 通过 | 0 | 62 项 |
| test:v104 | 通过 | 0 | 46 项 |
| test:v110-audit | 通过 | 0 | 31 项,审计 + APP_VERSION 断言 |
| 其余 v105-v1014 套件 | 通过 | 0 | 既有全量回归无回退 |
| **合计** | **全绿** | **0** | 注: `test:cross` 需 CI Secret `TCG_FEISHU_APP_SECRET`,沙箱不可用,其余 15 套件逐一单独运行均 EXIT=0 |

---

## 6. 风险与遗留

| # | 风险 | 缓解措施 | 下一版本计划 |
|---|---|---|---|
| 1 | 多组长同时改字段选项存在云端覆盖竞态 | 当前业务单组长绝对权威;字段选项为低频增删改 | 视团队规模再评估合并策略 |
| 2 | 断网时字段选项改动仅落地本地,联网后需再次触发上传 | 本地 LocalStorage 兜底 + 下次改动/下载自动重试 | 视反馈补联网自动补偿上传 |
| 3 | 断网多人合并冲突仍存在(组长绝对权威模式) | 当前业务 OK | V11.2 Phase 3 CRDT 增量合并 |
| 4 | OTA 需整包下载重装 | 整包通道可用 | V11.4 Phase 5 热更新 |

---

## 7. 代码审查(Clean Code)摘要

- 单一职责核查: 云同步三函数收敛于 `js/05-sync.js`,上传触发与云端覆盖逻辑收敛于 `js/03-vehicles.js`,挂载点分散于 auth/main/sync 三处仅做静默调用,改动面清晰、无跨模块耦合。
- 防御式编程: `applyCloudFieldOptions` 以「默认种子 + 数据库内容补全 + 云端数组覆盖」三级兜底,云数据缺失/字段异常时返回 null 不破坏本地;上传/下载均 try-catch 静默,失败保留本地,下次改动自动重试;仅组长上传、全员下载,权限边界明确。
- 权限最小化: `uploadFieldOptionsToFeishu` 显式校验 `role==='admin'`,组员端调用返回 false,杜绝越权写云端。
- 版本一致性: config.xml / version.json / 00-bootstrap.js 三处对齐,`check_version_consistency.js` 门禁持续生效;发版技能联动文件(about/history、同步脚本、审计断言、CI 默认版本、`test:v57` 子目录长度)同步升级,杜绝残留旧版本号。
- 发版纪律: 将 `web-data/approved_users.web.json`(同步任务生成文件)排除在提交外,避免推送竞态;测试重跑产生的 json 时间戳/耗时噪音剔除,提交仅保留发版改动。

---

## 8. 附录: 三处版本号一致性最终值

| 来源 | version | versionCode | 验证方式 |
|---|---|---|---|
| js/00-bootstrap.js APP_VERSION | 10.15.6 | - | `test:version` 断言 |
| config.xml `<widget>` | version="10.15.6" | android-versionCode="101506" | 同上 |
| version.json | "version": "10.15.6" | "versionCode": 101506 | 同上 |
| release/version.json | "version": "10.15.6" | "versionCode": 101506 | 双根同步校验 |
| demo.html sync-local-ver | v10.15.6 (静态默认值,运行时 JS 重写为 APP_VERSION) | - | 运行时一致性 |
