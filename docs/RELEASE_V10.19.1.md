# V10.19.1 稳定性加固版 — 发布说明

> 发布日期：2026-09-15 ｜ 版本号：10.19.1 ｜ versionCode：101901
> 平台：Android（APK）+ iOS（IPA）+ Web（GitHub Pages）

## 一句话总结

修复新建车辆照片分区丢失，并给版本一致性、CI 测试覆盖、测试产物入库三处工程隐患补上常驻防线。

---

## 🔴 核心修复

### 1. 新建车辆照片分区丢失
`addVehicle` 逐字段字面量遗漏 `photoSections` / `photoLabels` / `keyPhotoRemark` 三个字段，导致新建车辆的照片分区与备注静默丢失。现补回三字段，并加透传兜底防复发，配 16 条回归断言。

### 2. 飞书跨网络测试掐断全量测试链
`test_v57_cross_network.js` 在缺少飞书凭据时原以 `exit(1)` 退出，会掐断 `test:all` 聚合链，导致其后 19 个套件从未执行。改为「跳过」语义 `exit 0`（断言真失败仍 `exit 1`），全量测试不再被假红灯阻断。

---

## 🚩 工程加固

| 项 | 说明 |
|---|---|
| 版本一致性门禁扩展 | 校验范围新增 sw.js 缓存名 / demo.html 展示位 / js 兜底字面量，附变异测试证明拦得住 |
| 版本漂移修复 | `js/11-about.js` 兜底版本号停在 10.15.0（落后 4 版），已同步 |
| 测试覆盖补全 | `test:all` 聚合入口补全至 27 个测试文件；补原型污染守卫 23 条 + 车辆 CRUD 冒烟 51 条 |
| 测试产物入库清理 | `tests/*_results.json` 不再入库（加 .gitignore），测试不得依赖 git 工作区状态 |
| Android 构建修复 | 移除失效的 `setup-android@v3`，改用 runner 预装 SDK |

---

## 产物清单

| 产物 | 说明 |
|---|---|
| `tcg_poweroff_v10.19.1.apk` | Android 签名安装包（v1+v2 签名） |
| `tcg_poweroff_v10.19.1.apk.sha256` | APK SHA-256 校验和 |
| `tcg_poweroff_v10.19.1_ios.ipa` | iOS 安装包（development，无签名） |
| `version.json` | 版本清单（含 downloadUrl 指向 v10.19.1） |

---

## 验证

- 全量回归 `npm run test:all` → 0 失败（27 个测试文件全在链上）
- 版本一致性门禁 → exit 0（七源对齐）
- 密钥泄露扫描 → 通过
- 线上 Pages 验证 → version.json / sw.js / demo.html 三处均为 10.19.1
