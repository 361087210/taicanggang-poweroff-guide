# V10.27.10 发版包体积修复版

> 一句话：v10.27.9 的 APK/IPA 因一张 4.4MB 手机原图被原样打进安装包，双双越过飞书
> 单文件约 20MB 上限，飞书同步失败。本版改为**打包期生成压缩副本**（仓库仍保留原图），
> 并加体积预算门禁防止复发。

## 问题

- v10.27.9 产物：APK 21,175,997 B（20.2MiB）、IPA 23,254,223 B（22.2MiB）
- 飞书同步报错：`预上传失败[tcg_poweroff_v10.27.9.apk]: file size beyond limit`（错误码 1061043）
- 对照上一版（APK 16.5MB / IPA 18.6MB）可知，增量几乎全部来自 2026-11-24 回流进仓库的
  一张 4232×2662 / 4.4MB 原图；构建时 `cp -r vehicle_images tcg_app/www/vehicle_images`
  会把原图原样打进安装包

## 改了什么

### 1. 打包期瘦身（仓库原图不动）

`scripts/shrink_bundled_photos.js`：

- 只处理打包副本里的 `.jpg/.jpeg`（PNG 图标/调色板渲染图有透明与色彩约束，不动）
- 超过 800KB 或最长边超过 1600px 的照片，等比缩到 1600px、quality 80、去元数据
- 仓库里的 `vehicle_images/` 保持原图，资源库与后续 COS 上传拿到的仍是原片

### 2. 体积预算门禁

压缩后若打包照片总量仍超过 18MB，脚本以退出码 1 结束，并打印最大的 5 张，
让构建直接失败 —— 避免"某次回流一张大图，安装包悄悄顶穿飞书上限"再次发生。

### 3. 工作流接线

Android / iOS 两条发布工作流都在 `cp -r vehicle_images` 之后、`Verify bundled web assets`
之前执行瘦身，校验步骤看到的仍是完整图片数量（文件名不变）。

构建镜像不保证预装 ImageMagick，因此两条工作流都新增 `Ensure ImageMagick` 步骤
（Ubuntu 用 apt、macOS 用 brew），缺依赖时先装再瘦身，避免构建在瘦身脚本处直接失败。

## 实测

- 打包照片：20MB → 14.09MB
- 预计 APK 约 15MB、IPA 约 17MB，回到飞书单文件上限以内
- 新测试 `test:v10283-package-photo-budget`：15 断言全过

## 验证

- `node scripts/check_version_consistency.js`：`version=10.27.10, versionCode=102710`
- `node tests/test_v10283_package_photo_budget.js`：13 passed
- 全量 `run_all_tests.js`（Node 22）：全部通过
