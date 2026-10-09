# V10.20.2 仓库治理版 — 发布说明

> 版本号：10.20.2 ｜ versionCode：102002 ｜ 发布时间：2026-10-09

## 一句话

把仓库里 59 个**与业务无关的 AI 工具配置目录**（实体技能包副本 + 符号链接农场，共 2576 个被跟踪文件）请出去库、补上 **Apache-2.0 LICENSE 全文**修好 GitHub 的许可证识别、并把 **README 从 V10.11.0 更新到当前现状** —— 本版**不涉及 APP 功能与安全语义变更**。

## 背景：为什么做这版治理

仓库根目录被各类 AI 编程工具的技能安装器写入了一大批配置、缓存与技能副本路径。它们和业务没有任何关系，却：

- 持续膨胀仓库体积（两份完整的 lark 技能包副本，`.agents/` 与 `agent/` 各 550 文件 / 5.3MB）；
- 暴露本机工具链信息；
- 让 `git status` / 代码检索噪声变大。

同时暴露两个文档与合规问题：README 长期停留在 **V10.11.0**（与实际功能严重脱节），以及 README 声称 Apache-2.0 但仓库里**没有 LICENSE 全文**，导致 GitHub 无法识别许可证。

## 本次内容

### 1. AI 工具配置目录出库（.gitignore + git rm --cached）

- **59 个 AI 工具配置目录取消 git 跟踪**（本地保留，不删除任何文件）：仓库根被各类工具写入 `.claude` / `.agents` / `agent` / `skills` / `.qwen` / `.windsurf` / `.trae` 等路径，共 **2576 个被跟踪文件**。实体内容为两份完整的 lark 技能包副本，其余 50+ 个目录是指向它们的符号链接农场（各 28 条 symlink）。
- **复检补漏**：非根目录的 `data/skills/lark-*` **28 条符号链接**出库。上述技能农场在 `data/` 下另有一份镜像，首轮清理只覆盖仓库根路径故遗漏；经全仓符号链接扫描确认这是唯一残留的非根泄漏点。
- `.gitignore` 新增整段忽略规则防止回潮（含 `/data/skills/`）；已实证业务代码（`js/`、`scripts/`、`feishu-api.js`、`package.json`）与全部 CI workflow **零引用**，取消跟踪无副作用；`.github` / `.gitignore` / `.traeignore` 保留跟踪。
- ⚠️ 历史提交中仍残留这些文件的旧版本，如需彻底缩减仓库体积需另行重写历史（破坏性操作，单独评估）。

### 2. 合规：补 Apache-2.0 LICENSE 全文

新增 `LICENSE` 文件，落到位完整的 Apache-2.0 许可全文，修复 GitHub 无法识别仓库许可证的问题，与 README 声明保持一致。

### 3. 文档：README 更新至当前现状

README 由 **V10.11.0** 更新到当前版本，覆盖版本号、项目结构、功能清单、测试与安全说明，消除文档与实现长期脱节。

### 4. 版本一致性升级 10.20.1 → 10.20.2

| 项 | 值 |
|---|---|
| version | 10.20.1 → **10.20.2** |
| versionCode | 102001 → **102002** |

七源对齐：`version.json` / `release/version.json` / `config.xml` / `sw.js` / `demo.html` / `js/00-bootstrap.js` / `js/11-about.js`（含版本历史与兜底字面量）。

> 顺带修正一处历史漂移：`release/version.json` 的 versionCode 曾为 102000（与根不同步），本版一并对齐为 102002。

## 验证结果

| 检查 | 结果 |
|---|---|
| `node scripts/check_version_consistency.js` | 通过（七源一致：10.20.2 / 102002） |
| `node scripts/validate_web_assets.js` | 通过 |
| `node scripts/gen_media_mapping.js --check` | 通过 |
| `npm run test:all` | 通过 |

## 升级指引

1. 打开 App，确认提示的新版本为 **V10.20.2**。
2. 点击「更新」下载安装（Android 签名包）。
3. 若为 iOS，请联系组长获取安装包。
4. 本版为仓库治理 / 合规版，**功能与上一版完全一致**，更新后使用体验无变化。

## 备注

- 本版是 10.20.1 的超集：功能层面无新增、无修改，只做仓库治理、合规与文档。
- `sw.js` 缓存名同步升至 `tcg-poweroff-v10.20.2`，避免缓存优先策略让用户一直加载旧 JS。
- CI 构建完成后会回写 `version.json` 的 `downloadUrl` / `versionCode` / `version`（以本次 tag 产物为准）。
