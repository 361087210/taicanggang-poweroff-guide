# 回滚手册（ROLLBACK）

> 覆盖四个层面：安装包、网页、数据、媒体文件。每个层面的"回滚"含义不同，
> 先确认你要回滚的是哪一层，再按对应小节操作。

## 0. 先查：这个版本到底有没有产物

单一真源是仓库根的 `releases_index.json`（由 `node scripts/gen_release_index.js` 生成，
`--check` 可校验是否与线上一致）。

- `complete`：APK + IPA + sha256 齐全，可回滚
- `partial`：缺件（例如只有 IPA），该端可回滚、另一端起不来
- `missing`：有 Release 但没资产
- `unreleased`：只有 tag，历史上未产出安装包

App 内「我的 → 历史版本」读的也是这份清单。

## 1. 安装包回滚（APK / IPA）

1. 在 `releases_index.json` 找到目标版本，取 `apk.url` / `ipa.url`
2. 下载后用同一版本的 `.apk.sha256` 校验：
   `sha256sum tcg_poweroff_v<版本>.apk`
3. 安装前注意：
   - **Android 不允许 versionCode 变小覆盖安装**，必须先卸载当前版本再安装旧包
   - 卸载会清掉本地 localStorage（账号会话、偏好设置）；云端数据不受影响，
     重新登录后会自动拉取
   - iOS 需用旧版 IPA（TestFlight/描述文件），App Store 渠道无法降级
4. 企业内部分发建议：先备份（见第 3 节）再卸载

## 2. 网页端回滚（GitHub Pages）

```
Actions → Rollback (回滚到指定版本) → Run workflow
  version: v10.28.2        # 目标 tag
  scope:   pages
  confirm: v10.28.2        # 再输一次，防误操作
```

- 站点内容取自目标 tag，发布清单取自默认分支的 `scripts/prepare_pages.sh`
- 部署完成后站点根目录会带 `_rollback_info.txt`（回滚时间 / 目标版本 / 触发人）
- 想回到最新：等下一次 main 推送，或再跑一次 `Deploy Web to GitHub Pages`

## 3. 数据回滚

两种粒度：

| 场景 | 操作 | 语义 |
| --- | --- | --- |
| 误删几条 / 想找回某天的数据 | App → 数据 → 从云端备份恢复 | **合并**：同 ID 覆盖、新 ID 追加 |
| 要整体回到某个时间点 | 先导出当前数据，再用备份恢复，最后手工清理多余条目 | 无"整体替换"开关，避免误清空 |

- 备份来源：`APP数据备份 / 备份文件 / vehicle_backup_YYYY-MM-DD.json`，按天一份
- 本地备份：`下载/太仓港断电指导/` 目录，可用「导入备份」从文件恢复
- 恢复前一定看清二次确认弹窗里的「新增 N 条 / 覆盖 N 条」

## 4. 媒体文件回滚

媒体有独立的回收站与清理队列，见 `docs/RUNBOOK.md`：

- 软删除：回收站可恢复（文件仍在云端）
- 硬删除：写飞书 `media_delete_queue.json`，15 分钟内由工作流清 COS/飞书/GitHub
  —— **硬删除不可逆**，只能靠 GitHub 历史或备份找回
- 注意：COS 桶当前没有照片对象，照片硬删除的 COS 步骤是幂等空转

## 5. 版本本身打错了怎么办

发布 tag 受保护、不可移动。规则是：**不重打旧 tag，直接发下一个 patch**。

- 例：v10.28.1 的 tag 指向了工作流语法损坏的提交 → 不发 10.28.1，改发 v10.28.2
- 残缺 Release（如只有 IPA）可以删除 Release 对象，但 tag 保留，清单里会记为 `partial` / `unreleased`

## 6. 回滚后要核对的四件事

1. 版本号：`version.json`、`config.xml`、`APP_VERSION`、`sw.js` 是否一致（`npm run check:version`）
2. 站点：`/releases_index.json`、`/version.json` 能否正常取到
3. App：打开「检查更新」应提示"已是最新"或可升级到目标版本
4. 数据：抽查车型数、照片数、账号数是否与预期一致
