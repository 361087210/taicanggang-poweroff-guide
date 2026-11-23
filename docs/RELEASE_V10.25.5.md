# V10.25.5 发布说明（自动化修复版）

- **发布日期**：2026-11-23
- **版本号**：10.25.5（versionCode 102505）
- **一句话总结**：本版**不含业务代码变更**，只修 CI 与工程元信息 —— 让持续红了半个月的数据镜像流水线开口说话、修好长期必红的 Labeler、补齐 `package.json` 元信息。App 行为与 V10.25.4 一致，仅版本号前进。

## 为什么要发这一版

排查发现两个"红了没人知道"的自动化缺陷，它们不影响 App 运行时，但直接决定这条仓库还能不能被信任：

1. **`Sync Web Data Mirror` 从 2026-11-09 起连续失败 49/50 次**：`web-data/` 镜像与 `vehicles_data.js`、媒体映射全部冻结在 11-09；因为熔断只打普通日志、workflow 也不通知任何人，两周无人发现。
2. **`Labeler` 自 2026-11-09 起 18 次运行 0 次成功**：仓库从来没有 `.github/labeler.yml`。

## 本版改了什么

### CI — 数据镜像同步（`scripts/sync_web_data.js`、`.github/workflows/sync-web-data.yml`）
- 两道熔断（0 车 / 车数回退）改走 `_abortGuard()`：
  - 打 GitHub Actions 错误注解 `::error::[mirror] …`，失败原因进 run 摘要；
  - 打**诊断三元组**：本次实际取到的源文件（token + 修改时间）、本次车数、已有镜像 `syncedAt` + 车数 + 数据版本；
  - 给出 `--force` 处置提示。
- 正常路径也打印一行「车型源文件」，两次运行取的是不是同一份文件一眼可辨。
- `notify-failure` job：失败**自动开 issue**（已存在则刷新正文，不刷评论），恢复后**自动关闭**；需要 `issues: write`。

### CI — Labeler（`.github/labeler.yml`、`.github/workflows/label.yml`）
- 新增 `labeler.yml`：`documentation` / `javascript` / `dependencies` 三条路径规则，**只使用仓库已存在的标签**，避免"标签不存在"再红一次；
- `actions/labeler@v4 → v7`，并显式写出 `configuration-path`。

### 工程 — 元信息（`package.json`、`scripts/check_version_consistency.js`）
- `package.json` 补 `name` / `version` / `private` / `description` / `license: Apache-2.0` / `engines.node >= 18`；
- 版本一致性门禁对 `package.json` 增加**非阻断**漂移提示（它不参与 App 版本/缓存名/下载地址，强校验只会制造误红）。

### 测试 — `tests/test_v10255_mirror_diag.js`（新增，21 断言）
用本地模式（`--source-dir`）实跑 CLI，钉住四件事：熔断必红、必带 `::error::` 注解、必自解释、**不得覆盖已有产物**，且 `--force` 才是唯一放行开关。

## 升级方式

- **网页版**：随 `main` 自动生效（刷新即最新）。
- **Android / iOS**：安装本 Release 的 APK / IPA（版本号 10.25.5）。

## 已知遗留（不在本版范围）

1. 数据镜像的**根因**尚未定位 —— 本版只让失败可见（下一轮失败会开出 issue，正文与日志里直接给出源文件 token 与车数对比）；
2. `audit:media`：63 张照片真缺失、64 条视频 0 条有 sha256 指纹（无法证明内容一致）；
3. `softprops/action-gh-release@v1` 被 actionlint 判 runner 过旧，建议升 v2（只能在打 tag 时验证）；
4. `cordova` 仍在 `dependencies`，下移需同步重算 `package-lock.json`；
5. 三个长期 open 的 PR（#4 / #5 / #6）待合或关。
