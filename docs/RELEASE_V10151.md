# V10.15.1 发版说明: 版本一致性对齐 + 发版门禁
发布日期: 2026-09-06  
版本号: 10.15.1 (versionCode=101501)  
网页版地址: https://361087210.github.io/taicanggang-poweroff-guide/demo.html  
下载地址: https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/v10.15.1  
飞书反馈库: https://mwawzzuvb7f.feishu.cn/base/Gn4db7il9a27QrsOtVbclSE3nnf

---

## 一、版本亮点(一句话给现场组长/组员)

> **本次为「发版对齐补丁」——不新增功能,仅修复三处版本号不一致,确保 APK 内版本(10.15.1)与 OTA 元数据完全一致,杜绝「已是最新还提示更新」的横幅漂移;并新增发版门禁脚本,防止今后再出现版本漂移。**

---

## 二、本次主要交付(交付物对照清单)

| 分类 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| 🔴转绿 | 三处版本对齐 | config.xml / version.json / js/00-bootstrap.js | `config.xml` 由 10.14.4/101404 → 10.15.1/101501;`version.json` 同步为 10.15.1/101501;`00-bootstrap.js` 的 `APP_VERSION` → `'10.15.1'` |
| ⚙️发版门禁 | 版本一致性校验脚本 | scripts/check_version_consistency.js | 解析 config.xml / version.json / 00-bootstrap.js 三处版本,校验三处一致 + versionCode 与版本号编码一致(每段补零到 2 位),不一致即退出非 0 |
| 🧪测试接入 | test:version 回归命令 | package.json | 新增 `test:version` 并纳入 `test:all` 首位,版本漂移即刻中断全量测试 |
| 📚文档 | 本发版说明 | docs/RELEASE_V10151.md | 发版知识沉淀 |

---

## 三、根因与修复说明

- **根因**: V10.15.0 已把 `version.json`(OTA 元数据)与 `js/00-bootstrap.js`(APP_VERSION)升到 10.15.0,但 `config.xml`(Cordova 构建源)仍是 10.14.4/101404。APK 内 `cordova-plugin-app-version` 读到 10.14.4,与 OTA 元数据 10.15.0 不一致 → 触发「请更新」横幅误报(正是历史上修复 C 曾解决的问题)。
- **修复**: 三处统一为 10.15.1/101501,消除漂移;新增门禁脚本把「版本三处必须一致」固化为可执行断言,纳入 `test:all`。
- **编码约定**: `versionCode` = `major*10000 + minor*100 + patch`,即每段补零到 2 位拼接。例: `10.15.1` → `101501`。

---

## 四、验证

1. `node scripts/check_version_consistency.js` → 退出码 0(版本一致性通过)。
2. `npm run test:all` → 全绿(含新增 `test:version` 首位门禁)。
