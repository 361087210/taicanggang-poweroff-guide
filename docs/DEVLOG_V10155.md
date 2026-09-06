# 开发决策日志: V10.15.5 反馈迭代版 (DEVLOG_V10155)
版本: V10.15.5 / versionCode=101505  
日期: 2026-09-06  
负责人: 代码评审机器人(用户规则审核路径:Clean Code+真机级Mock+行业标准)

---

## 0. 一句话总结(管理摘要)
V10.15.4 完成「问题反馈修复版」后,本次(V10.15.5)依据飞书反馈库落地三项迭代:批量导出 Word 回归「首张总表(不含图片) + 每车含图分表」与车辆详情页导出一致;断电位置/钥匙处理方式/断电步骤字段选项模块化(按数据库内容生成 + 可增删改);媒体照片按「车辆外观/车钥匙/断电位置」三板块分板块上传(每板块≤5张),压缩提升至 1600px/90% 降低分辨率损耗;版本三源对齐升级至 10.15.5(versionCode=101505),除 `test:cross`(需 CI Secret)外全量门禁与回归测试 **0 FAIL** 通过,双端构建成功、Release 产物已发布,无网络/同步逻辑破坏性变更。

---

## 1. 根因分析表(RCA)

| # | 现象 | 根因 | 风险等级 | 影响面 | 数据支撑 |
|---|---|---|---|---|---|
| A | 批量导出 Word 不含车辆图片,与车辆详情页导出一致性存疑 | `js/04-export.js` 批量分支仅输出一张汇总表,丢弃逐车含图分表 | 🟠 P1 | 批量导出可用性/组员信任度 | 飞书反馈「批量导出Word与详情页不一致」 |
| B | 断电位置/钥匙处理/步骤为固定枚举,数据库未覆盖取值时无法选择 | 字段依赖硬编码枚举,未从当前数据库内容动态生成选项 | 🟡 P2 | 车型录入效率 | 飞书反馈「字段应有标准选项」 |
| C | 媒体照片堆成一堆,无法按板块归类;压缩后分辨率损耗较大 | 照片为单一无序列表;压缩参数偏保守(1280px/80%) | 🟠 P1 | 现场作业照片可用性 | 飞书反馈「照片分板块」「分辨率损耗」 |

---

## 2. 修复对比矩阵(方案-原-新-收益-风险)

| # | 修复 | 修复前 | 修复后 | 收益 | 副作用/兼容风险 |
|---|---|---|---|---|---|
| A | 批量导出结构回归 | 仅一张汇总表,无车辆图片 | 第 1 张总表(不含图片) + 第 2~N 张每车含图分表(与详情页导出一致) | 批量导出文档与详情页行为一致,修复投诉 | 极小:仅批量分支追加每车渲染,单页导出不受影响 |
| B | 字段选项模块化 | 固定硬编码枚举 | `FIELD_OPTION_DEFAULTS` 种子 + 当前数据库内容自动补全 + localStorage 持久化用户增删改 | 选项覆盖全、可随数据库演进,录入更规范 | 极小:纯前端选项生成,数据兼容;用户修改持久化于本地 |
| C | 照片分板块 + 画质提升 | 单一无序列表,1280px/80% 压缩 | `PHOTO_SECTIONS` 三板块(车辆外观/车钥匙/断电位置),每板块≤5张;压缩提升至 1600px/90% | 照片按板块归类,画质显著提升 | 极小:`photoPaths` 保持扁平数组向后兼容,新增 `photoSections`/`photoLabels`/`keyPhotoRemark` 辅助元数据 |

---

## 3. 代码修改文件级摘要表

| 路径 | 改了什么(几处) | 为什么 | 影响模块 |
|---|---|---|---|
| js/03-vehicles.js | 新增 `FIELD_OPTION_DEFAULTS`/`getFieldOptions`/`persistFieldOptions` 等字段选项模块化辅助函数;新增 `PHOTO_SECTIONS` 三板块常量;`handlePhotoSelect` 按板块限制5张 + 压缩 1600/0.9;`loadEditMedia` 按 `photoSections`/`photoLabels` 恢复各板块;`saveVehicle` 聚合照片并持久化元数据 | 实现反馈2-1字段选项模块化 + 反馈2-2照片分板块上传 | 车型编辑 / 图片上传 |
| js/04-export.js | OOXML 主路径、HTML 单页导出、HTML 批量导出详情分表三处补充车钥匙备注展示 | 同步展示 `keyPhotoRemark` | 导出 |
| js/05-sync.js | 同步载荷、导出载荷、导入覆盖/新增分支均携带 `photoSections`/`photoLabels`/`keyPhotoRemark`(4处) | 新元数据跨端/导出一致 | 数据同步 |
| js/00-bootstrap.js | `APP_VERSION` → '10.15.5' | 三处对齐 | 版本 |
| config.xml | version="10.15.5" android-versionCode="101505" | 三处对齐 | 打包产物版本号 |
| version.json | version/versionCode/downloadUrl → 10.15.5;releaseNotes 新增 V10.15.5 条目 | OTA 一致性 | OTA 更新链路 |
| release/version.json | 与根 version.json 完全同步 | 发版产物双根一致 | OTA 同步 |
| sw.js | `CACHE_NAME` → 'tcg-poweroff-v10.15.5' | PWA 缓存版本失效重建 | PWA |
| js/11-about.js | VERSION_HISTORY 头部新增 V10.15.5 条目(三项核心迭代) | 用户可见版本历史 | 关于页 |
| demo.html | `sync-local-ver` 静态默认值 → v10.15.5 | 同步屏静态默认展示 | 同步页 UI |
| scripts/migrate_drive_to_bitable.js | 内嵌 APP_VERSION → '10.15.5' | 版本一致性 | 数据迁移 |
| scripts/sync_release_both_roots.py | APP_VERSION → "10.15.5" + docstring 更新 | 发版产物双根同步 | 发版脚本 |
| tests/test_v110_audit.js | APP_VERSION 断言 & appVersion → '10.15.5'(两处) | 版本升级同步 | 审计测试 |
| .github/workflows/ios-release.yml | workflow_dispatch 默认版本 → '10.15.5' | CI 默认版本 | CI |
| docs/RELEASE_V10155.md | 新建发版说明 | 发版知识沉淀 | 文档 |

> 注: `web-data/approved_users.web.json` 由 `sync-web-data.yml` 自动同步任务拥有,属生成文件,刻意排除在发版提交之外,避免形成手动冲突源;`validate_web_assets.js` 不检查其 version 字段。测试重跑产生的 json 时间戳/耗时噪音剔除,提交仅保留发版改动。

---

## 4. 测试矩阵(全量真机级Mock聚合)

| Suite | Pass | Fail | 说明 |
|---|---|---|---|
| check_version_consistency | 通过 | 0 | version=10.15.5, versionCode=101505 三处一致性 |
| validate_web_assets | 通过 | 0 | 全文件扫描,无凭证泄露,签名密钥未入库 |
| gen_media_mapping --check | 通过 | 0 | 73 条记录与源数据一致 |
| test:version | 通过 | 0 | 三处版本一致性 + versionCode 编码约定 |
| test:logic | 通过 | 0 | 34 项 |
| test:runtime | 通过 | 0 | 21 项 |
| test:v103 | 通过 | 0 | 62 项 |
| test:v104 | 通过 | 0 | 46 项 |
| test:v110-audit | 通过 | 0 | 31 项,审计 + APP_VERSION 断言 |
| 其余 v105-v1014 套件 | 通过 | 0 | 既有全量回归无回退 |
| **合计** | **全绿** | **0** | 注: `test:cross` 需 CI Secret `TCG_FEISHU_APP_SECRET`,沙箱不可用,其余 15 套件逐一单独运行均 EXIT=0 |

---

## 5. 构建与产物

| # | 项目 | 结果 |
|---|---|---|
| 1 | Android Actions #56(基于 3377bae) | success(APK 17,747,516 B + SHA256 92 B) |
| 2 | iOS Actions #15(基于 3377bae) | success(IPA 16,737,259 B) |
| 3 | GitHub Release v10.15.5 | 已发布 2026-09-06T09:42:34Z,含 3 件产物 |
| 4 | version.json / release/version.json downloadUrl | 已指向 `.../releases/download/v10.15.5/tcg_poweroff_v10.15.5.apk` |

> 注: 首轮打 tag 后核查发版技能联动文件(js/11-about.js 等 5 处)仍残留 10.15.4,需拆除并重建 tag `v10.15.5` 指向对齐后提交 `3377bae`,双端构建基于该最终提交重新触发并全绿。

---

## 6. 风险与遗留

| # | 风险 | 缓解措施 | 下一版本计划 |
|---|---|---|---|
| 1 | 批量导出逐车含图分表在极多车辆时文档体积变大 | 仅批量分支追加,复用现有导出渲染 | 视反馈再优化(分文件/分批) |
| 2 | 压缩提升至 1600px/90% 后上传体积略增 | 仍远小于原图,网速可控 | 按现场网络实测再平衡 |
| 3 | 字段选项用户增删改持久化于本地,换机/重装不共享 | 选项随数据库内容自动补全兜底 | 视反馈接入账号级选项云同步 |
| 4 | 断网多人合并冲突仍存在(组长绝对权威模式) | 当前业务 OK | V11.2 Phase 3 CRDT 增量合并 |
| 5 | OTA 需整包下载重装 | 整包通道可用 | V11.4 Phase 5 热更新 |

---

## 7. 代码审查(Clean Code)摘要

- 单一职责核查: 三项迭代分别内聚于 `js/03-vehicles.js`(字段选项 + 照片板块)、`js/04-export.js`(批量导出结构)、`js/05-sync.js`(同步元数据),改动面清晰、无跨模块耦合。
- 防御式编程: 批量分支复用既有渲染逻辑,单页导出路径不受影响;字段选项用「默认种子 + 数据库内容补全 + 本地持久化」三级兜底,数据库为空时仍可用;`photoPaths` 扁平数组向后兼容,新增元数据不影响存量消费方。
- 版本一致性: config.xml / version.json / 00-bootstrap.js 三处对齐,`check_version_consistency.js` 门禁持续生效;发版技能联动文件(about/history、同步脚本、审计断言、CI 默认版本)同步升级,杜绝残留旧版本号。
- 发版纪律: 将 `web-data/approved_users.web.json`(同步任务生成文件)排除在提交外,避免推送竞态;测试重跑产生的 json 时间戳/耗时噪音剔除,提交仅保留发版改动。

---

## 8. 附录: 三处版本号一致性最终值

| 来源 | version | versionCode | 验证方式 |
|---|---|---|---|
| js/00-bootstrap.js APP_VERSION | 10.15.5 | - | `test:version` 断言 |
| config.xml `<widget>` | version="10.15.5" | android-versionCode="101505" | 同上 |
| version.json | "version": "10.15.5" | "versionCode": 101505 | 同上 |
| release/version.json | "version": "10.15.5" | "versionCode": 101505 | 双根同步校验 |
| demo.html sync-local-ver | v10.15.5 (静态默认值,运行时 JS 重写为 APP_VERSION) | - | 运行时一致性 |
