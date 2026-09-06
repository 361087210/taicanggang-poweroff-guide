---
name: "taicanggang-app-release"
description: "太仓港断电指导 app 发版技能。执行正式发布迭代：版本号三源对齐、本地全量门禁、git 提交与打 tag 触发双端 CI、验证构建、生成发版文档。Invoke when 用户要求发布/发版/上线新版本，或完成一项实质性交付需要走发布流程时。"
---

# 太仓港app发版技能

对「太仓港商品车断电指导」Cordova app 执行一次完整、可追溯、可验证的发布迭代。目标产物：GitHub Release 签名 APK + OTA(version.json)，双端（Android/iOS）CI 全绿。

## 触发条件

- 用户明确要求「发布 / 发版 / 上线」一个新版本
- 一项实质性交付（功能、安全加固、数据后端迁移）完成后需要走发布流程
- 需要对新增版本做版本号与门槛校验

## 前置约束（固定，全程生效）

- 只读取与版本/构建相关的必要文件，不读取无关源码
- 版本号 `V<major>.<minor>.<patch>`；versionCode 用每段补零到 2 位拼接：`major*10000 + minor*100 + patch`（如 `10.15.2 -> 101502`）
- 不向任何文件写入密钥/凭证；密钥只在 CI Secrets 中配置
- 每一次实质交付，`patch` 至少 +1；纯「仅版本对齐」可复用同一 versionCode 但需在 releaseNotes 说明

## 第一步：版本三源对齐与增量

以下来源必须完全一致（三源），不一致即阻断：

| 来源 | 字段 | 说明 |
| ---- | ---- | ---- |
| `config.xml` | `version` / `android-versionCode` | Cordova 构建源 |
| `version.json`（根） | `version` / `versionCode` / `downloadUrl` | OTA 元数据源（web 端主源） |
| `js/00-bootstrap.js` | `APP_VERSION` | 运行时探测主源 |

需同步的联动文件：

- `release/version.json`（OTA 元数据标准源，发版前必须与根 `version.json` 完全同步）
- `sw.js` 中 `CACHE_NAME='tcg-poweroff-v<a.b.c>'`
- `js/11-about.js` 的 `VERSION_HISTORY` 头部（date / highlight）
- `demo.html` 中版本标记（如 `sync-local-ver` 文本）
- `scripts/sync_release_both_roots.py` 与 `scripts/migrate_drive_to_bitable.js` 内的 `APP_VERSION`
- `tests/test_v110_audit.js` 的版本断言
- `.github/workflows/ios-release.yml` 的 `default: '<a.b.c>'`
- 各 docs 中带版本号的标题（CHANGELOG / SECURITY / tests README）

操作：按增量后的新版本号，同步改写以上所有位置。

## 第二步：本地全量门禁（全绿才可发版）

```bash
# 版本一致性校验（三源 + 联动文件）
node scripts/check_version_consistency.js

# CI 资产校验（核心文件存在性 / JS 语法 / JSON 合法性 / 凭证泄露扫描 / 映射表漂移）
node scripts/validate_web_assets.js

# 媒体映射表漂移检测
node scripts/gen_media_mapping.js --check

# 全量回归（含业务逻辑 / Bitable 数据层 / 审计模块；需 FEISHU App Secret 环境变量）
TCG_FEISHU_APP_SECRET="<app_secret>" npm run test:all
```

任一失败：修复后重跑，禁止带失败发版。

## 第三步：git 提交流程

```bash
git add -A
git commit -m "feat: V<a.b.c> <简短标题>"
git push
```

- 若 push 因远端自动同步（`chore(web-data)` 等）被拒：`git pull --rebase origin main` 后重试，直至成功
- 注意排查未跟踪文件（如 `docs/EVR_*.md`）是否应一并入库

## 第四步：打 tag 触发双端正式构建

```bash
git tag v<a.b.c>
git push origin v<a.b.c>
```

- 标签必须指向第一步对齐后的交付提交
- tag 推送后自动触发 `Android Release Build`、`iOS Release Build`（含 CodeQL / CI / Pages Deploy）

## 第五步：验证构建

1. 确认 tag 指向正确 commit：`git show v<a.b.c> --stat`
2. 到 GitHub Actions 页确认 Android/iOS/CI 均通过；Android Release 完成后 GitHub Release 页自动出现签名 APK
3. 若发布产物需转飞书「APP数据备份」，用 `scripts/*feishu*` 脚本手动推送

## 第六步：生成发版文档（可选但推荐）

- `docs/RELEASE_V<a.b.c>.md`：发版说明（版本亮点 / 交付物清单 / 安全加固说明 / 验证步骤）
- `docs/DEVLOG_V<a.b.c>.md`：开发日志（RCA / 修复对比 / 文件级摘要 / 测试矩阵 / 版本一致性附录）
- `docs/EVR_V<a.b.c>.md`：多维度评估（若本次含方案评估）

## 副作用约定

- 不发版但需保留进度时，允许先提交代码、暂不打 tag
- `dry_run` 试构建不发布：Actions → 对应 workflow → Run workflow → 勾选 `dry_run`
- SDK 产物内不含密钥；签名密钥仅存在于仓库 Secrets

## 示例（发版标题）

```
feat: V10.15.2 数据后端升级+安全加固
```
