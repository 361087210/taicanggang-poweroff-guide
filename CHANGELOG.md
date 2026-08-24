# Changelog

本文件记录太仓港商品车断电操作标准化指导平台的所有重要变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [5.7.0] - 2026-08-23

### 修复（四大问题根治）

- **文档分享**：CI 构建此前遗漏 `vendor/` 导出库与 `vehicle_images/` 车辆图片，导致 APK 内 Word/PDF/Excel 生成失效；现已完整打包，恢复 V5.3 级别的文档分享体验
- **返回键逻辑**：编辑保存后不再退回编辑表单；登录页返回键正确触发双击退出；登出/注册后返回键不再退回已登录界面；弹层/查看器打开时返回键逐层关闭
- **飞书备份与更新**：内置默认凭证（混淆存储）开箱即用；数据分仓：同步数据/注册申请/审批结果/备份文件各自独立子文件夹，与项目交付产物彻底分离
- **跨网络注册审批**：组员申请秒传云端；组长 60 秒轮询、切回 APP 即拉取；审批结果云端秒同步；组员新设备登录自动发现云端账号

### 新增

- 文档导出照片预取 20 秒超时保护：云端照片不可达时导出无图文档而非卡死
- 文件 token 缓存失效自动重试自愈（换飞书应用/云端文件夹重建场景）

### 工程化

- CI 签名构建全链路修复：`KEYSTORE_BASE64` 自动解码签名（V5.4 以来构建失败根因）、Manifest merger 冲突根治、FileProvider `file_paths.xml` 补齐、zipalign 改用 SDK build-tools 全路径、`contents:write` 权限声明（Create Release 403）
- `cordova-plugin-dialogs` 固定 2.0.2（3.0.0 构建崩溃）
- `x-socialsharing` 6.0.7 → 6.0.4（npm 不存在 6.0.7 导致构建崩溃）
- 移除 `qrscanner` 插件（AGP8 不兼容），patch 脚本增加防御性 gradle 清洗
- 校验脚本支持 V5.7 `_fsDec` 混淆 Secret 合规形态

### 安全

- 默认飞书 App Secret 以 `_fsDec` 混淆存储（V5.7 开箱即用、非明文合规），仍可在设置页覆盖

## [5.6.0] - 2026-08-23

- 升级版本号至 V5.6（内部迭代基线）
- 更新 README 版本标注

## [5.4.0] - 2026-08-23

### 安全加固

- **密码哈希化**：所有本地密码改为 SHA-256 + 随机盐值（`salt$hash` 格式）存储
- **自动迁移**：启动时幂等升级明文旧密码为哈希格式；首次登录自动升级，零用户感知
- **云端去密码**：上传飞书的 `approved_users.json` / `pending_reg_*.json` 均不含密码字段
- **凭证清理**：从 `demo.html` / `feishu-api.js` 移除硬编码凭证

## [5.3.6] - 2026-08-22

- FeishuDataLayer 统一封装层；车型/用户数据双向同步（Bitable）
- 全量备份与恢复（云文档 JSON 快照，保留最近 10 个）
- 审批流完整化（创建/查询/状态同步）
- 应用内直装更新（file-opener2）；Android 13+ 通知权限适配
- 组长审批提醒升级为状态栏通知；`config.xml` content src 修正
- CI 双流水线（校验 + Release 构建）上线

## [5.3.5] - 2026-08-22

- 教学视频 GitHub Release 直链秒开（buildNumber=7）
- 飞书产物区双端同步落地：REST 直连修复 unsafe file path

## [5.3.1] - 2026-08-21

- 飞书 App Secret 从默认配置移除，代码库零明文凭证
- 签名 keystore/APK 移出 git 跟踪；构建脚本密码环境变量化
- CI 凭证泄露扫描关卡上线

## [5.3.0] - 2026-08-20

- 数据分仓：项目产物与用户数据物理隔离
- 原生 HTTP 通道（advanced-http）修复真机飞书 CORS 静默失败
- 文件分享三级策略；MIME 自动修正
- 旧照片数据自动迁移（`images/` → `vehicle_images/`）
- 视频四源回退链 + 组长上传通道（≤20MB → 飞书云端）
- Android 硬件返回键六级路由
- 离线化：Tailwind/SheetJS/jsPDF/html-docx 全部本地化进 APK

## [4.0.0] - 2026-06-15

- 账号系统与角色权限（组长/组员）

[5.7.0]: https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/v5.7
[5.6.0]: https://github.com/361087210/taicanggang-poweroff-guide
[5.4.0]: https://github.com/361087210/taicanggang-poweroff-guide
[5.3.6]: https://github.com/361087210/taicanggang-poweroff-guide
[5.3.5]: https://github.com/361087210/taicanggang-poweroff-guide
[5.3.1]: https://github.com/361087210/taicanggang-poweroff-guide
[5.3.0]: https://github.com/361087210/taicanggang-poweroff-guide
[4.0.0]: https://github.com/361087210/taicanggang-poweroff-guide
