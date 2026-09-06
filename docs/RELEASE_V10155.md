# V10.15.5 发版说明: 反馈迭代版
发布日期: 2026-09-06  
版本号: 10.15.5 (versionCode=101505)  
网页版地址: https://361087210.github.io/taicanggang-poweroff-guide/demo.html  
下载地址: https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/v10.15.5  
飞书反馈库: https://mwawzzuvb7f.feishu.cn/base/Gn4db7il9a27QrsOtVbclSE3nnf

---

## 一、版本亮点(一句话给现场组长/组员)

> **本版依据飞书反馈库落地三项迭代:批量导出 Word 回归「首张总表(不含图片) + 每车含图分表」,与车辆详情页导出一致;断电位置/钥匙处理方式/断电步骤做成可增删改的标准选项,录入车型更规范;媒体照片按「车辆外观/车钥匙/断电位置」三板块分板块上传(每板块≤5张),压缩画质提升至 1600px/90%。全部改动为录入/导出体验优化,无网络/同步逻辑破坏性变更。**

---

## 二、本次主要交付(交付物对照清单)

| 分类 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| 📄批量导出 | 总表+每车含图分表结构 | js/04-export.js | 批量选中 N 组数据生成 Word:第 1 张为总表(不含图片),第 2~N 张为每车含图分表(与车辆详情页导出一致) |
| 🔘字段选项 | 断电位置/钥匙/步骤模块化 | js/03-vehicles.js | `FIELD_OPTION_DEFAULTS` 种子 + 当前数据库内容自动补全 + localStorage 持久化,生成可点选、可增删改的选项列表 |
| 🖼️照片板块 | 媒体照片分板块上传 | js/03-vehicles.js | `PHOTO_SECTIONS` 三板块(车辆外观/车钥匙/断电位置),每板块≤5张 |
| 📌钥匙备注 | 车钥匙板块备注 | js/03-vehicles.js / js/04-export.js / js/05-sync.js | 车钥匙板块支持备注「几把遥控钥匙+机械钥匙」,同步/导出均携带 `keyPhotoRemark` 及 `photoSections`/`photoLabels` 元数据 |
| 🖼️照片画质 | 压缩参数提升 | js/03-vehicles.js | `compressImage(file,1280,0.8)` → `compressImage(file,1600,0.9)`,分辨率损耗明显降低 |
| ⚙️发版门禁 | 版本一致性校验 | scripts/check_version_consistency.js | 三处版本一致性 + versionCode 编码约定持续生效 |
| 🧪测试 | test:v110-audit / test:all | tests/ | 除 test:cross(需 CI Secret)外全量回归,0 FAIL |
| 📚文档 | 本发版说明 | docs/RELEASE_V10155.md | 发版知识沉淀 |

---

## 三、反馈闭环说明(核心)

- **数据来源**: 三项迭代均取自飞书反馈库组员提交的真实问题,逐一核实代码落地后进入本版。
- **批量导出结构调整**: 此前批量导出文档不含车辆图片,与车辆详情页导出一致性存疑;本版回归「第 1 张总表(不含图片) + 第 2~N 张每车含图分表(与详情页导出一致)」方案。
- **字段选项模块化**: 断电位置、钥匙处理方式、断电步骤不再依赖固定硬编码,改为根据当前数据库内容生成标准选项(如断电位置:前机盖/后备箱/主驾驶底部/副驾驶底部/后排腿托/无需断电),同时支持增删改,便于按车型编辑详情。
- **照片分板块上传**: 媒体资源按「车辆外观/车钥匙/断电位置」三板块归类上传,每板块最多 5 张;车钥匙板块可备注遥控钥匙与机械钥匙把数。上传前压缩由 1280px/80% 提升至 1600px/90%,减少分辨率损耗。

---

## 四、根因与交付说明

- **批量导出结构差异根因**: `js/04-export.js` 批量分支此前仅输出一张汇总表,丢弃了逐车含图分表,与车辆详情页导出行为不一致。
- **字段硬编码根因**: 断电位置/钥匙处理方式/断电步骤原为固定枚举,遇到数据库未覆盖的取值时无法选择,录入车型不便。
- **照片管理粗糙根因**: 媒体照片原为单一无序列表,无法按板块归类;压缩参数偏保守(1280px/80%),高分辨率照片仍有分辨率损耗。
- **版本编码约定**: `versionCode` = `major*10000 + minor*100 + patch`,例: `10.15.5` → `101505`。

---

## 五、验证

1. `node scripts/check_version_consistency.js` → 退出码 0(version=10.15.5, versionCode=101505 三处一致性通过)。
2. `node scripts/validate_web_assets.js` → 全部校验通过,无凭证泄露。
3. `node scripts/gen_media_mapping.js --check` → 73 条记录与源数据一致。
4. 除 `test:cross`(真机模拟 + 真实飞书云端,需 CI Secret `TCG_FEISHU_APP_SECRET`)外,其余 15 个测试套件逐一运行全部 EXIT=0(test:logic 34 项、test:runtime 21 项、test:v103 62 项、test:v104 46 项、test:v110-audit 31 项等 0 FAIL)。
5. 双端构建验证: Android Actions #56 与 iOS Actions #15 均 `success`(基于对齐后提交 `3377bae`);GitHub Release `v10.15.5` 已发布(2026-09-06T09:42:34Z),包含 APK(17,747,516 B)、SHA256(92 B)、iOS IPA(16,737,259 B)三件产物。
