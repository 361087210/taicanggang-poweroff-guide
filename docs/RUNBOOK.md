# RUNBOOK — 太仓港断电指导（运维 / 故障处置 / 回滚）

> 适用对象：值班人员、发布负责人、被叫醒的开发者。
> 原则：**先恢复可用，再查根因**；任何操作都要能在 5 分钟内回答"线上现在是哪一版、数据是哪一份"。

## 0. 线上拓扑（出事先看这张图）

| 资产 | 位置 | 更新方式 |
|---|---|---|
| 网页（PWA） | GitHub Pages `https://361087210.github.io/taicanggang-poweroff-guide/` | push `main` → `deploy-pages` 自动部署 |
| Android APK / iOS IPA | GitHub Release `v<版本>` + 飞书「发版产物/v<版本>/」 | push tag `v<版本>` → 构建 + 签名 + 上传 |
| 车型数据（唯一真源） | 飞书云盘 `APP数据备份/同步数据/vehicle_sync_data.json` | 人工编辑 → 每 15 分钟同步到 `web-data/` |
| 照片/视频 | 仓库 `vehicle_images/`、GitHub Release `media-videos`、飞书 | 同步脚本 / 指纹工作流 |
| 版本号 | 七源一致：`config.xml`、`version.json`、`release/version.json`、`js/00-bootstrap.js`、`sw.js`、`demo.html`、`js/11-about.js` | 见 CONTRIBUTING §3 |

**快速自检（30 秒）**
```bash
curl -s https://361087210.github.io/taicanggang-poweroff-guide/version.json | head -3
curl -s -o /dev/null -w '%{http_code}\n' https://361087210.github.io/taicanggang-poweroff-guide/js/17-error-report.js
```

## 1. 回滚预案

### 1.1 网页回滚（最常用，1 分钟）

```bash
# 找到上一个「好的」发布提交（tag 是最可靠的锚点）
git log --oneline -10
git revert --no-edit <坏提交>        # 首选 revert，保留历史
git push origin main                  # main 受保护：管理员账号可直推，否则走 PR
```
Pages 会在 push 后自动重新部署；用 §0 的自检确认 `version.json` 回到预期版本。

> 若坏提交是**数据同步**提交（`chore: 自动同步数据`）：不要去 revert，直接修云盘数据 → 触发一次同步（见 1.4）。

### 1.2 App 回滚（无法强制降级）

应用商店/侧载的旧版本无法远程降级。处置顺序：
1. 在服务端数据侧做兼容（例如把新字段降级为旧字段的等价形式）；
2. 发一个 patch 版本（`10.26.x`）修复，并在「关于 → 检查更新」里提示；
3. 若为严重安全问题：在 `version.json` 提升 `versionCode` 并给出明确升级提示，同时由组长在群里通知。

### 1.3 数据回滚（云盘是真源）

1. 飞书云盘 → `APP数据备份` → 找到最近一次 JSON 快照（`backup_to_feishu.py` 产出）；
2. 用快照覆盖 `同步数据/vehicle_sync_data.json`；
3. 触发同步：`workflow_dispatch` → `Sync Web Data Mirror`；
4. 验证：`version.json` 不变、`media_library.json` 的 `stats` 与预期一致、`node scripts/audit_media_consistency.js` 无新增告警。

### 1.4 手动触发同步 / 重建派生数据

```bash
# CI 内（推荐）
gh workflow run sync-web-data.yml --ref main

# 本地（需要飞书凭据）
node scripts/sync_web_data.js
node scripts/migrate_vehicle_rename.js --apply
node scripts/fix_shared_refs.js
node scripts/gen_vehicles_data.js
node scripts/gen_media_mapping.js
node scripts/gen_media_library.js
```

## 2. 常见故障与处置

| 症状 | 先查 | 处置 |
|---|---|---|
| Pages 部署失败 `Multiple artifacts named "github-pages"` | 是否**重跑**过失败的部署 job | 不要重跑；用 `workflow_dispatch` 触发一次**全新**部署 |
| 同步流水线红：`push declined due to repository rule violations` | 分支保护规则集 | 见 §3（机器人令牌 / 规则集） |
| 同步流水线红：`改名迁移未完成` | `migrate_vehicle_rename --json` | 有冲突（目标目录已存在）→ 人工确认后合并文件再 `--apply` |
| 现场照片 404 | 资源库「断链」筛选 | 改名失配 → 跑 `migrate_vehicle_rename --apply`；无主目录 → 确认归属后移动文件 |
| 白屏 / 某个页面报错 | 「我的 → 复制诊断信息」 | 拿到最近 20 条错误（已脱敏）定位；必要时在「资源库 → 核对云端」验证数据 |
| 视频打不开 | Release 资产是否存在 | `Fingerprint Videos` 工作流会暴露缺失资产；补传后重跑 |
| 数据明显变旧 | 最近一次同步提交时间 | 手动 `workflow_dispatch` 同步；若持续失败看 §2 第 1 行 |

## 3. 分支 / tag 保护与机器人令牌

当前生效的规则集：

| 规则集 | 范围 | 规则 |
|---|---|---|
| 保护分支 | `refs/heads/main` | 禁删除、禁 force push、要求线性历史（管理员可绕过，用于应急） |
| 保护发布 tag | `refs/tags/v*` | 禁删除、禁移动（打错就发下一个 patch 版本） |

**升级到"强制 PR + 必过检查"的前置条件**：自动化必须能拿到可满足的必需检查。
已知问题：`GITHUB_TOKEN` 创建的 PR 不会自动触发 `CI`/`Secret Scan`（check 名恒为 `null`，PR 卡 `blocked`）。
两条可行路线：
1. 给同步工作流配置 `SYNC_TOKEN`（具备 `contents:write` 的 PAT/令牌）→ 由它直推（管理员角色可绕过规则集）；
2. 或让同步工作流在开 PR 后**显式 `workflow_dispatch` 派发 CI + Secret Scan**，并等检查通过再合并。

达标后再把 `pull_request` + `required_status_checks` 两条规则加回 `保护分支`（规则集 JSON 见 `.github/rulesets/branch-strict.json`）。

## 4. 恢复演练（每季度一次，30 分钟）

1. 从飞书备份取一份 `vehicle_sync_data.json` 的副本；
2. 在临时目录 `git clone` 仓库，用副本跑 `sync -> gen_*` 全链；
3. 对比 `git diff --stat`：应只有数据文件变化，无源码变化；
4. 记录本次演练的耗时与差异，写进 `docs/RUNBOOK_DRILLS.md`（首次演练时创建）。

## 5. 值班升级路径

1. 先按 §2 自查（5 分钟）；
2. 无法恢复 → 冻结发版（暂停打 tag）、在仓库开 issue 并 @ 发布负责人；
3. 数据类故障 → 同步通知组长（云盘真源由组长维护）。
