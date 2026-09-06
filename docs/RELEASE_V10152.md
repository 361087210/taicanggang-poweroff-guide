# V10.15.2 发版说明: 数据后端升级 + 安全加固
发布日期: 2026-09-06  
版本号: 10.15.2 (versionCode=101502)  
网页版地址: https://361087210.github.io/taicanggang-poweroff-guide/demo.html  
下载地址: https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/v10.15.2  
飞书反馈库: https://mwawzzuvb7f.feishu.cn/base/Gn4db7il9a27QrsOtVbclSE3nnf

---

## 一、版本亮点(一句话给现场组长/组员)

> **本次完成「数据后端升级 + 安全加固」两件实质交付——新增飞书多维表格(Bitable)后端数据层与 Drive→Bitable 迁移脚本,为后续数据可查询/可扩展打下基础;同时把飞书 App Secret 改为构建期 XOR+base64 双重加密(明文永不落盘),并新增 R8/ProGuard 混淆加固与本地审计日志,大幅提升应用安全水位。无网络/同步逻辑破坏性变更。**

---

## 二、本次主要交付(交付物对照清单)

| 分类 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| 📈数据后端 | Bitable 数据访问层 | js/feishu-api.js | 新增 `BITABLE_TABLE_NAMES` 常量 + `DATA_ACCESS` 数据访问层,车辆/用户数据双写 Drive + Bitable,QPS 门控 + Drive 读取回退 |
| 📈数据后端 | Drive→Bitable 迁移脚本 | scripts/migrate_drive_to_bitable.js | 批量再映射云端旧数据到二维表,字段契约与 feishu-api.js 一致 |
| 🔐安全加固 | 密钥双重加密 | scripts/inject_build_secrets.js | 由 XOR 混淆升级为 **XOR + base64** 双重编码,明文 App Secret 不再出现在 demo.html 构建产物 |
| 🔐安全加固 | R8/ProGuard 混淆 | scripts/proguard_harden.js | `after_prepare` 钩子注入 `minifyEnabled true` + `shrinkResources true` + 完整 Cordova keep 规则,防 JS Bridge 反射剥离;幂等 + `TCG_PROGUARD=0` 降级 |
| 🔐安全加固 | 审计与删除轨迹 | js/16-audit.js | `window.Audit`(track/init/readLocal/clearLocal),localStorage 环形缓冲 500 条,增删改操作时间线可追溯 |
| 🔐安全加固 | 文档 | docs/DESIGN_V110_BITABLE.md / SECURITY.md | 设计文档 + 安全策略更新 |
| ⚙️发版门禁 | 版本一致性校验 | scripts/check_version_consistency.js | 三处版本一致性 + versionCode 编码约定持续生效 |
| 🧪测试 | test:v110-bitable / test:v110-audit / test:version | tests/ | 全面回归,0 FAIL |
| 📚文档 | 本发版说明 | docs/RELEASE_V10152.md | 发版知识沉淀 |

---

## 三、安全加固说明(核心)

- **密钥威胁面**: 此前 App Secret 以弱混淆(`_fsDec` / 简单 XOR)内置在 APK 的 `demo.html` 首屏 `<script>` 中,反编译即可提取,存在被跨网络滥用的风险。
- **V10.15.2 缓解**:
  1. `inject_build_secrets.js`(构建期)将 `appSecret` 做 **XOR + base64** 双重编码后写入 `window.__BUILD_SECRETS__`,产物中不再出现明文 Secret;
  2. `00-bootstrap.js` `_decryptBuildSecret()` 运行时解密,`getFeishuCfg()` 采用「读取即删 + 闭包缓存」,运行时外部无法二次读到明文;
  3. `proguard_harden.js`(`after_prepare`)注入 R8 混淆 `minifyEnabled true` + `shrinkResources true` + `proguard-rules.pro`,保留 `org.apache.cordova.**`、全部 `CordovaPlugin` 子类、`@JavascriptInterface` 桥方法,防止 R8 剥离 JS Bridge 引用类导致白屏;
  4. `js/16-audit.js` 对车辆/用户增删改落 `localStorage` 环形缓冲(500 条),删除留痕,配合「删除轨迹 → 组长通知」形成操作回溯闭环。
- **边界与后续**: R8 只混淆 Java/Dex 层,不影响 `assets/www/` 下 JS 源码;混淆非绝对防护,根治方案 = Secret 下沉服务端(云函数代理,APP 仅持设备码),规划于 V11.4 M2。

---

## 四、根因与交付说明

- **Bitable 动机**: 飞书 Drive JSON 不支持 SQL 查询、多表 Join,单文件体积约 10MB/次;`DESIGN_V110_BITABLE.md` 规划用 Bitable 作为可查询、可扩展的数据后端。V10.15.2 落地数据访问层 + 迁移脚本,当前与 Drive 双写保证兼容回退。
- **安全动机**: 详见第三节威胁面分析。
- **版本编码约定**: `versionCode` = `major*10000 + minor*100 + patch`,例: `10.15.2` → `101502`。

---

## 五、验证

1. `node scripts/check_version_consistency.js` → 退出码 0(三处版本一致性通过)。
2. `npm run test:all` → 全绿(含 `test:version` / `test:v110-bitable` / `test:v110-audit`)。
3. `validate_web_assets.js` 泄露扫描 → 产物零明文 Secret。
4. 构建后 `platforms/android/app/build.gradle` 已注入 `minifyEnabled true` + `proguard-rules.pro`(模拟验证通过)。
