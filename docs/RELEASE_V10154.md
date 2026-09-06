# V10.15.4 发版说明: 问题反馈修复版
发布日期: 2026-09-06  
版本号: 10.15.4 (versionCode=101504)  
网页版地址: https://361087210.github.io/taicanggang-poweroff-guide/demo.html  
下载地址: https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/v10.15.4  
飞书反馈库: https://mwawzzuvb7f.feishu.cn/base/Gn4db7il9a27QrsOtVbclSE3nnf

---

## 一、版本亮点(一句话给现场组长/组员)

> **本版依据飞书反馈库落地三项业务修复:批量导出 Word 现在会在总表后自动追加每车含图分表,彻底修复「批量导出不含图片」问题;问题反馈板块由 8 项细化为 15 项,让组员能精准按车型/搜索/照片/详情/步骤/钥匙/单车导出等场景归类;车辆照片压缩由 800px/70% 提升到 1280px/80%,解决照片压缩过糊的投诉。全部改动均为体验修复,无网络/同步逻辑破坏性变更。**

---

## 二、本次主要交付(交付物对照清单)

| 分类 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| 📄批量导出 | 每车含图分表追加 | js/04-export.js | 批量导出 Word 时,在总表之后对每台车追加一个含图分表,与详情页导出一致,修复「批量导出Word不含图片」 |
| 🏷️反馈分类 | 板块选项细化 | js/10-feedback.js | CATEGORIES 由 8 项扩充为 15 项,覆盖车型/搜索/照片/详情/步骤/钥匙/单车导出等细分场景 |
| 🖼️照片质量 | 压缩画质提升 | js/03-vehicles.js | `compressImage(file,800,0.7)` → `compressImage(file,1280,0.8)`,修复「照片压缩太严重」 |
| ⚙️发版门禁 | 版本一致性校验 | scripts/check_version_consistency.js | 三处版本一致性 + versionCode 编码约定持续生效 |
| 🧪测试 | test:v110-audit / test:all | tests/ | 除 test:cross(需 CI Secret)外全量回归,0 FAIL |
| 📚文档 | 本发版说明 | docs/RELEASE_V10154.md | 发版知识沉淀 |

---

## 三、反馈闭环说明(核心)

- **数据来源**: 三条修复均取自飞书反馈库(反馈表 `tblPB0AnsTS9puqw`)组员提交的真实问题,逐一核实代码落地后进入本版。
- **批量导出修复**: 原逻辑仅在导出文档开头生成一张总表,车辆照片被遗漏;本版在总表后逐车追加含图分表,与详情页导出行为对齐。
- **板块细化**: 反馈分类从宽泛的 8 项到 15 项,便于后续统计与组员快速选择,覆盖新增的"车型""钥匙""单车导出"等高频场景。
- **压缩画质**: 照片上传前压缩上限从 800px/70% 提升至 1280px/80%,兼顾体积与清晰度,修复压缩过糊投诉。

---

## 四、根因与交付说明

- **批量导出无图根因**: `js/04-export.js` 的批量分支只生成总表,未像详情页那样逐车渲染含图内容,导致导出文档缺照片。
- **板块不足根因**: 旧 CATEGORIES(8 项)无法覆盖组员实际提交的多类场景,归类困难。
- **照片发糊根因**: `compressImage` 压缩参数偏保守(800px/70%),高分辨率车辆照片被压缩后细节丢失。
- **版本编码约定**: `versionCode` = `major*10000 + minor*100 + patch`,例: `10.15.4` → `101504`。

---

## 五、验证

1. `node scripts/check_version_consistency.js` → 退出码 0(version=10.15.4, versionCode=101504 三处一致性通过)。
2. `node scripts/validate_web_assets.js` → 全部校验通过,无凭证泄露。
3. `node scripts/gen_media_mapping.js --check` → 73 条记录与源数据一致。
4. 除 `test:cross`(真机模拟 + 真实飞书云端,需 CI Secret `TCG_FEISHU_APP_SECRET`)外,其余 15 个测试套件(v103-v110-audit)逐一运行全部 EXIT=0。
5. 双端构建验证: Android Actions #54 与 iOS Actions #13 均 `success`;GitHub Release `v10.15.4` 已发布(2026-09-06T08:35:27Z),包含 APK(17,743,420 B)、SHA256(92 B)、iOS IPA(16,733,441 B)三件产物。
