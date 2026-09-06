# V10.15.6 发版说明: 账号级字段选项云同步版
发布日期: 2026-09-06  
版本号: 10.15.6 (versionCode=101506)  
网页版地址: https://361087210.github.io/taicanggang-poweroff-guide/demo.html  
下载地址: https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/v10.15.6  
飞书反馈库: https://mwawzzuvb7f.feishu.cn/base/Gn4db7il9a27QrsOtVbclSE3nnf

---

## 一、版本亮点(一句话给现场组长/组员)

> **本版解决 V10.15.5 遗留风险#3:断电位置/钥匙处理方式/断电步骤的字段选项不再只存在本机,而是升级为「账号级云同步」——组长在车型里增删改选项后自动同步到云端,组长/组员登录或拉取数据时自动覆盖到本机,换机、重装后选项依旧在,跨设备共享。该改动为能力升级,无网络/同步逻辑破坏性变更。**

---

## 二、本次主要交付(交付物对照清单)

| 分类 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| ☁️字段选项 | 账号级云同步 | js/05-sync.js | 新增 `uploadFieldOptionsToFeishu` / `downloadFieldOptionsFromFeishu` / `syncFieldOptionsFromCloud` 三函数,走飞书「偏好设置」子目录 `field_options.json` |
| 🔘本地兜底 | 本地持久化拆分 | js/03-vehicles.js | `persistFieldOptions()` 拆分为本地保存 + 组长自动上传;`applyCloudFieldOptions()` 按「默认种子+数据库为基底,云端为权威自定义层」覆盖 |
| 🔗触发挂载 | 四象限闭合 | js/02-auth.js / js/08-main.js / js/05-sync.js | 登录成功、会话恢复、车辆镜像拉取三处静默下载;组长增删改自动上传 |
| 📄版本 | 版本对齐至 10.15.6 | 多文件联动 | config.xml / version.json / 00-bootstrap.js / sw.js / demo.html / tests / scripts / CI 全量对齐 |
| 📂目录 | 偏好设置子目录 | js/00-bootstrap.js / version.json | `dataSubFolders` 扩容至「偏好设置」(`test:v57` 断言同步更新) |
| 🧪测试 | test:all / test:v57 / test:v110-audit | tests/ | 除 test:cross(需 CI Secret)外全量回归,0 FAIL |
| 📚文档 | 本发版说明 | docs/RELEASE_V10156.md / DEVLOG_V10156.md | 发版知识沉淀 |

---

## 三、问题背景与解决说明(核心)

- **遗留风险#3**: V10.15.5 将断电位置/钥匙处理方式/断电步骤做成可增删改的标准选项,但管理员(组长)的增删改仅持久化到 `localStorage['tcg_field_options']`,属本地作用域——组员端看不到、换机重装后丢失。
- **解决思路**: 利用现有飞书「APP数据备份」云同步链路,新增「偏好设置」子目录存放 `field_options.json` 快照式全量文件。字段选项以「默认种子 + 当前数据库内容」为基底,云端数组作为权威自定义层覆盖。
- **权限设计**: 仅组长(admin)可上传,组员只读应用(组员端本就不展示编辑入口),权限边界明确。
- **触发闭环**: 组长增删改自动上传;组长/组员登录成功、会话恢复、车辆镜像拉取完成三处静默下载覆盖本地,无数据或网络失败时静默保留本地,下次改动自动重试。

---

## 四、根因与交付说明

- **本地作用域根因**: 字段选项此前仅写入浏览器/设备 localStorage,无云上权威层,导致跨设备、跨安装态不共享。
- **覆盖策略**: `applyCloudFieldOptions` 先以默认种子与数据库内容重建基底,再以云端数组覆盖,保证了数据库演进与云端自定义不会互相覆盖丢失。
- **版本编码约定**: `versionCode` = `major*10000 + minor*100 + patch`,例: `10.15.6` → `101506`。

---

## 五、验证

1. `node scripts/check_version_consistency.js` → 退出码 0(version=10.15.6, versionCode=101506 三处一致性通过)。
2. `node scripts/validate_web_assets.js` → 全部校验通过,无凭证泄露。
3. `node scripts/gen_media_mapping.js --check` → 73 条记录与源数据一致。
4. 除 `test:cross`(真机模拟 + 真实飞书云端,需 CI Secret `TCG_FEISHU_APP_SECRET`)外,其余 15 个测试套件逐一运行全部 EXIT=0(含 `test:v57` 更新的 `dataSubFolders` 长度 5 断言、`test:v110-audit` 的 APP_VERSION 断言,0 FAIL)。
5. 双端构建验证与 Release 产物发布状态见 RELEASE 构建记录(以最终对齐提交 `v10.15.6` 触发)。
