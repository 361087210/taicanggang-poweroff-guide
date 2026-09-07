# RELEASE V10.15.15

**日期**: 2026-09-07
**版本号**: V10.15.15 (versionCode: 101515)
**类型**: 数据治理 + 仓库整理（小修小改 +0.01 规则）
**一句话**: 统一车型数据池消除38KB双份冗余 + 清理GitHub/飞书冗余文件

---

## 1. 版本亮点

### 1.1 统一车型数据池（需求1：内置+后添加数据同一数据池）

**改造前**：车型数据存在双份——`js/00-bootstrap.js` 内联 73 条 `const VEHICLES=[...]`（运行时使用）+ `vehicles_data.js` 的 `window.VEHICLES=[...]`（CI/脚本使用），两者靠人工同步，极易漂移。

**改造后**：
- `demo.html` 加载 `vehicles_data.js` 作为唯一内置数据源
- `js/00-bootstrap.js` 内联 73 条替换为 `const VEHICLES=window.VEHICLES||[]`
- 内置 73 条 + 组长后添加车型统一在同一 `VEHICLES` 数组，IndexedDB 持久化 + 飞书云端同步

**数据流**（唯一事实源）：

```
vehicles_data.js (内置73条)
    ↓ demo.html 加载
window.VEHICLES → const VEHICLES (00-bootstrap.js)
    ↓ State.addVehicle/pushVehicle/replaceVehicles (01-state.js)
内置 + 用户新增 → 同一数据池
    ↓ persistVehicles() IndexedDB 全量快照(重启不丢)
    ↓ pushVehicleSyncDataToFeishu (05-sync.js 组长上传)
vehicle_sync_data.json (飞书云端)
    ↓ sync_web_data.js (CI 镜像)
web-data/vehicle_sync_data.json (GitHub Pages 同源)
```

### 1.2 仓库文件整理（需求2：删多余重复文件）

| 删除文件 | 原因 |
|----------|------|
| `release/RELEASE_V10144.md` | 与 `docs/RELEASE_V10144.md` 重复 |
| `release/RELEASE_V10150.md` | 与 `docs/RELEASE_V10150.md` 重复 |
| `release/README_WEB_V10144.txt` | 旧版网页说明，已过期 |
| `web-data/debug_structure.json` | CI 自动生成的取证快照（11000+行），每60秒重生成，不该入库 |
| `.trae-html-share-packages/*.zip` | IDE分享构建产物，约1MB不入库 |

`.gitignore` 新增对应规则防止回归。`release/` 目录仅保留 `version.json`（OTA 元数据标准源）。

### 1.3 V10.15.14 全部能力保留（需求3）

密码跨设备同步三重修复完整继承：
- `js/05-sync.js` `pullApprovedStatusFromFeishu`：密码仲裁 `cuTs>=loTs`
- `js/09-web-sync.js` 网页镜像版：同样 `>=` 语义对齐
- `scripts/sync_web_data.js` `mergeUser`：多源合并密码单独按 `pw_ts` 仲裁

## 2. 交付物清单

| 交付物 | 位置 |
|--------|------|
| 签名 APK | GitHub Release `v10.15.15` → `tcg_poweroff_v10.15.15.apk` (17.2MB) |
| APK 校验 | `tcg_poweroff_v10.15.15.apk.sha256` |
| iOS IPA | `tcg_poweroff_v10.15.15_ios.ipa` (16.2MB) |
| OTA 元数据 | `version.json` / `release/version.json`（版本+下载地址+releaseNotes） |
| 飞书双根 | Sync Release to Feishu workflow → 旧根组长缓存 + 新根应用云盘 |

## 3. 测试矩阵

| 测试套件 | 结果 |
|----------|------|
| 版本一致性校验（三源+联动） | ✅ 10.15.15 / 101515 |
| 资产校验 validate_web_assets | ✅ 全部通过 |
| 映射表漂移检测 gen_media_mapping --check | ✅ 73条一致 |
| test:logic (V57) | ✅ 34/34 |
| test:runtime (V53) | ✅ 21/21（修复 e2e_harness 后） |
| test:v1013 (A3 治理) | ✅ 68/68 |
| test:v1014 (零配置) | ✅ 49/49 |
| test:v1015 (门禁统一) | ✅ 50/50 |
| test:v1011 (密码/反馈同步专项) | ✅ 43/43 |
| test:v110-bitable / v110-audit | ✅ 24/24 + 31/31 |
| 全量 18 套回归 | ✅ 0 FAIL |

## 4. CI 验证

| Workflow | 状态 |
|----------|------|
| Android CI Build & Release (v10.15.15) | ✅ success |
| iOS CI Build & Release (v10.15.15) | ✅ success |
| CI / CodeQL Advanced (main) | ✅ success |
| Deploy Web to GitHub Pages | ✅ 线上 version.json=10.15.15 |
| Sync Release to Feishu | ✅ 已触发 (workflow_dispatch) |

线上验证：`https://361087210.github.io/taicanggang-poweroff-guide/demo.html` 已引用 `vehicles_data.js`，缓存标记 v10.15.15。

## 5. 版本一致性附录

| 来源 | 值 |
|------|-----|
| config.xml | 10.15.15 / 101515 |
| version.json（根 + release/） | 10.15.15 / 101515 |
| js/00-bootstrap.js APP_VERSION | 10.15.15 |
| sw.js CACHE_NAME | tcg-poweroff-v10.15.15 |
| demo.html sync-local-ver | v10.15.15 |
| js/11-about.js VERSION_HISTORY | V10.15.15 |
| scripts/sync_release_both_roots.py | 10.15.15 |
| scripts/migrate_drive_to_bitable.js | 10.15.15 |
| tests/test_v110_audit.js | 10.15.15 |
| .github/workflows/ios-release.yml | 10.15.15 |

## 6. 关键修改文件

| 文件 | 修改 |
|------|------|
| `demo.html` | 新增 `<script defer src="vehicles_data.js">`；版本标记 10.15.15 |
| `js/00-bootstrap.js` | 内联73条 → `window.VEHICLES\|\|[]`（-38KB）；APP_VERSION 10.15.15 |
| `tests/e2e_harness.js` | `inlineDeferScripts` 正则支持根目录 JS（`(?:js\/)?`） |
| `.gitignore` | 新增 debug_structure.json / .trae-html-share-packages/ 排除规则 |
| 版本联动 7 处 | config.xml / sw.js / 11-about.js / 双 version.json / 脚本×2 / audit测试 / ios-workflow |
