# 开发决策日志: V10.15.4 问题反馈修复版 (DEVLOG_V10154)
版本: V10.15.4 / versionCode=101504  
日期: 2026-09-06  
负责人: 代码评审机器人(用户规则审核路径:Clean Code+真机级Mock+行业标准)

---

## 0. 一句话总结(管理摘要)
V10.15.3 完成「真实 DeepSeek 分析 + 飞书群通知闭环」后,本次(V10.15.4)依据飞书反馈库落地三项业务修复:批量导出 Word 在总表后逐车追加含图分表(修复「批量导出Word不含图片」)、问题反馈板块由 8 项细化为 15 项、车辆照片压缩由 800px/70% 提升至 1280px/80%(修复「照片压缩太严重」);版本三源对齐升级至 10.15.4(versionCode=101504),除 `test:cross`(需 CI Secret)外全量门禁与回归测试 **0 FAIL** 通过,双端构建成功、Release 产物已发布,无网络/同步逻辑破坏性变更。

---

## 1. 根因分析表(RCA)

| # | 现象 | 根因 | 风险等级 | 影响面 | 数据支撑 |
|---|---|---|---|---|---|
| A | 批量导出 Word 文档中车辆照片缺失 | `js/04-export.js` 批量分支仅生成总表,未像详情页那样逐车渲染含图分表 | 🟠 P1 | 批量导出可用性/组员信任度 | 飞书反馈「批量导出Word不含图片」 |
| B | 问题反馈分类宽泛,组员难以精准归类 | 旧 CATEGORIES 仅 8 项,无法覆盖车型/钥匙/单车导出等高频场景 | 🟡 P2 | 反馈统计与处理效率 | 飞书反馈表分类字段 |
| C | 车辆照片压缩过糊,细节丢失 | `compressImage` 参数过保守(800px/70%) | 🟠 P1 | 现场作业照片可用性 | 飞书反馈「照片压缩太严重」 |

---

## 2. 修复对比矩阵(方案-原-新-收益-风险)

| # | 修复 | 修复前 | 修复后 | 收益 | 副作用/兼容风险 |
|---|---|---|---|---|---|
| A | 批量导出逐车含图分表 | 仅总表,无车辆照片 | 总表后对每车(`for(const v of vehicles)`)追加一张含图分表,与详情页导出一致 | 批量导出文档照片完整,修复投诉 | 极小:仅批量分支追加渲染,单页导出不受影响 |
| B | 板块选项细化 | 8 项 | CATEGORIES 扩充至 15 项(新增车型/钥匙/单车导出等) | 归类更精准,统计更有意义 | 极小:纯前端选项扩充,反馈表字段兼容 |
| C | 照片压缩画质提升 | 800px/70% | `compressImage(file,1280,0.8)` | 照片更清晰;体积可控 | 极小:压缩版文件略增,仍远小于原图 |

---

## 3. 代码修改文件级摘要表

| 路径 | 改了什么(几处) | 为什么 | 影响模块 |
|---|---|---|---|
| js/04-export.js | 批量分支追加`for(const v of vehicles)`循环,每车输出含图分表 | 修复反馈「批量导出Word不含图片」 | 批量导出 |
| js/10-feedback.js | CATEGORIES 由 8 项扩充为 15 项 | 反馈板块归类更精准 | 问题反馈 |
| js/03-vehicles.js | `compressImage(file,800,0.7)` → `compressImage(file,1280,0.8)` | 修复照片压缩过糊 | 图片上传 |
| js/00-bootstrap.js | `APP_VERSION` → '10.15.4' | 三处对齐 | 版本 |
| config.xml | version="10.15.4" android-versionCode="101504" | 三处对齐 | 打包产物版本号 |
| version.json | version/versionCode/downloadUrl → 10.15.4;releaseNotes 新增 V10.15.4 条目 | OTA 一致性 | OTA 更新链路 |
| release/version.json | 与根 version.json 完全同步 | 发版产物双根一致 | OTA 同步 |
| sw.js | `CACHE_NAME` → 'tcg-poweroff-v10.15.4' | PWA 缓存版本失效重建 | PWA |
| js/11-about.js | VERSION_HISTORY 头部新增 V10.15.4 条目(三项核心修复) | 用户可见版本历史 | 关于页 |
| demo.html | `sync-local-ver` 静态默认值 → v10.15.4 | 同步屏静态默认展示 | 同步页 UI |
| scripts/migrate_drive_to_bitable.js | 内嵌 APP_VERSION → '10.15.4' | 版本一致性 | 数据迁移 |
| scripts/sync_release_both_roots.py | APP_VERSION → "10.15.4" + docstring 更新 | 发版产物双根同步 | 发版脚本 |
| tests/test_v110_audit.js | APP_VERSION 断言 & appVersion → '10.15.4'(两处) | 版本升级同步 | 审计测试 |
| .github/workflows/ios-release.yml | workflow_dispatch 默认版本 → '10.15.4' | CI 默认版本 | CI |
| SECURITY.md | 支持版本表 → 10.15.4;凭证安全标题更新 | 与实际交付对齐 | 安全文档 |
| tests/README.md | 安全规范标题 → V10.15.4 | 反映交付 | 测试文档 |
| CHANGELOG.md | 新增「V10.15.4 问题反馈修复版」条目 | 变更记录 | 文档 |
| docs/RELEASE_V10154.md | 新建发版说明 | 发版知识沉淀 | 文档 |

> 注: `web-data/approved_users.web.json` 由 `sync-web-data.yml` 自动同步任务拥有,属生成文件,刻意排除在发版提交之外,避免形成手动冲突源;`validate_web_assets.js` 不检查其 version 字段。

---

## 4. 测试矩阵(全量真机级Mock聚合)

| Suite | Pass | Fail | 说明 |
|---|---|---|---|
| check_version_consistency | 通过 | 0 | version=10.15.4, versionCode=101504 三处一致性 |
| validate_web_assets | 通过 | 0 | 全文件扫描,无凭证泄露,签名密钥未入库 |
| gen_media_mapping --check | 通过 | 0 | 73 条记录与源数据一致 |
| test:version | 通过 | 0 | 三处版本一致性 + versionCode 编码约定 |
| test:v110-audit | 通过 | 0 | 审计 + APP_VERSION 断言 |
| test:logic / test:runtime / test:v103~v1014 | 通过 | 0 | 既有全量回归无回退 |
| **合计** | **全绿** | **0** | 注: `test:cross` 需 CI Secret `TCG_FEISHU_APP_SECRET`,沙箱不可用,其余 15 套件逐一单独运行均 EXIT=0 |

---

## 5. 构建与产物

| # | 项目 | 结果 |
|---|---|---|
| 1 | Android Actions #54 | success(APK 17,743,420 B + SHA256 92 B) |
| 2 | iOS Actions #13 | success(IPA 16,733,441 B) |
| 3 | GitHub Release v10.15.4 | 已发布 2026-09-06T08:35:27Z,含 3 件产物 |
| 4 | version.json / release/version.json downloadUrl | 已指向 `.../releases/download/v10.15.4/tcg_poweroff_v10.15.4.apk` |

---

## 6. 风险与遗留

| # | 风险 | 缓解措施 | 下一版本计划 |
|---|---|---|---|
| 1 | 批量导出逐车分表在极多车辆时文档体积变大 | 仅批量分支追加,复用现有导出渲染 | 视反馈再优化(分文件/分批) |
| 2 | 压缩提升后上传体积略增 | 1280px/80% 仍远小于原图,网速可控 | 按现场网络实测再平衡 |
| 3 | 断网多人合并冲突仍存在(组长绝对权威模式) | 当前业务 OK | V11.2 Phase 3 CRDT 增量合并 |
| 4 | OTA 需整包下载重装 | 整包通道可用 | V11.4 Phase 5 热更新 |

---

## 7. 代码审查(Clean Code)摘要

- 单一职责核查: 三项修复分别内聚于 `js/04-export.js`(批量导出)、`js/10-feedback.js`(反馈分类)、`js/03-vehicles.js`(图片压缩),改动面清晰、无跨模块耦合。
- 防御式编程: 批量分支复用既有渲染逻辑,单页导出路径不受影响;压缩参数调整不影响上传失败回退。
- 版本一致性: config.xml / version.json / 00-bootstrap.js 三处对齐,`check_version_consistency.js` 门禁持续生效。
- 发版纪律: 将 `web-data/approved_users.web.json`(同步任务生成文件)排除在提交外,避免推送竞态;测试重跑产生的 json 时间戳/耗时噪音剔除,提交仅保留发版改动。

---

## 8. 附录: 三处版本号一致性最终值

| 来源 | version | versionCode | 验证方式 |
|---|---|---|---|
| js/00-bootstrap.js APP_VERSION | 10.15.4 | - | `test:version` 断言 |
| config.xml `<widget>` | version="10.15.4" | android-versionCode="101504" | 同上 |
| version.json | "version": "10.15.4" | "versionCode": 101504 | 同上 |
| release/version.json | "version": "10.15.4" | "versionCode": 101504 | 双根同步校验 |
| demo.html sync-local-ver | v10.15.4 (静态默认值,运行时 JS 重写为 APP_VERSION) | - | 运行时一致性 |
