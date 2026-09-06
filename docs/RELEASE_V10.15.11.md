# V10.15.11 发版说明 —— 问题反馈多端同步+组长状态审核+密码跨设备同步

**发版日期**: 2026-09-06
**版本号**: V10.15.11 (versionCode=101511)
**发版类型**: 功能增强 + 存量缺陷修复 + 权限加固

---

## 一、版本亮点

### 1. 问题反馈多端同步（核心交付）

修复用户反馈两大问题：网页端与安卓端反馈不同步、安卓不同设备间反馈不同步。

**实现**（js/10-feedback.js `loadAndRenderFeedbackList`）：
- 组员按「提交人姓名」从云端 Bitable 拉回自己的反馈（换机/重装不丢），他人反馈不可见
- 云端状态/AI分析摘要/技术文档链接同步展示
- 反馈提交后保存云端 `record_id`（供审核定位）
- 网页镜像端跳过 `syncPendingFeedback` 无效重试（无上行通道）

### 2. 组长状态审核

需求：反馈过并分析过的问题提交到组长端，由组长确定反馈状态——已解决/待处理。

- js/12-bitable.js 新增 `updateFeedbackStatus`（bitableUpdateRecord 云端回写）并暴露到 `window.FeedbackBase`
- js/10-feedback.js 详情页渲染「标记已解决/重新打开(待处理)」按钮
- 云端更新失败时本地状态不变（防假成功）
- 网页镜像端隐藏按钮并提示走安卓端

### 3. 组长角色判断 Bug 修复（本次审查发现的最严重问题）

**根因**: 组长角色实际值为 `admin`（isLeader() 判 `role==='admin'`），但反馈模块 4 处误用 `role === 'leader'`，导致：
- 组长审核按钮**永不显示**
- 组长拉不到云端全量反馈（列表只剩自己的）
- 组长提交反馈被标记为「组员」

**修复**: 4 处统一改为 `admin`（js/10-feedback.js L288/L391/L422/L490/L574）。

### 4. 密码跨设备同步

**根因**: 改密只写本地 localStorage，云端 approved_users.json 仍是旧哈希；且拉取合并「密码以本地为准」——旧设备永远拿不到新哈希。

**修复**:
- js/07-cache.js `changePassword`: 改密后推送云端（推送前 fullMerge 拉取防旧表覆盖竞态）
- 账号级 `pw_ts` 时间戳仲裁（js/05-sync.js / js/09-web-sync.js / scripts/sync_web_data.js）：
  - 云端 pw_ts 较新 → 采纳云端哈希（旧设备同步新密码）
  - 本机 pw_ts 较新 → 保留本机（改密未推成功不回滚）
  - 旧数据无 pw_ts → 保持本地为准（向后兼容 V5.7 语义）
- `resetMemberPass` 重置密码记录 pw_ts + 推送前 fullMerge（防旧表覆盖其他成员新密码）

### 5. 权限加固

- `setFeedbackStatus`: 函数层组长守卫（防绕过 UI 直接调用）
- `resetMemberPass`: 组长守卫 + 禁止重置组长账号密码（与 deleteMember 保护一致）

### 6. 网页端反馈镜像

- scripts/sync_web_data.js: 新增反馈表镜像（分页拉取+脱敏，不含问题描述/联系方式/设备信息）
- js/09-web-sync.js: FeedbackBase 镜像桥读 `web-data/feedback_data.json`，写入/审核/截图上传封堵并引导走安卓端

---

## 二、四端审查矩阵（本次交付依据）

| 维度 | 审查结论 |
| ---- | ---- |
| 组长-界面/功能 | 详情页新增状态审核区（仅 admin 可见） |
| 组长-权限 | 审批/拒绝/删除/重置密码/反馈审核全部函数层校验 |
| 组员-数据可见性 | 反馈仅本人可见；账号表拉取合并 |
| 网页端-功能对齐 | 反馈只读镜像+封堵引导；账号同步含 pw_ts 仲裁 |
| 安卓端-同步 | 反馈云端读写/审核回写；密码推送+拉取仲裁 |
| 数据 CRUD | 反馈：本地缓存+云端 Bitable 双轨 |
| 同步备份 | approved_users.json 含 pw_ts；feedback_data.json 镜像 |
| 账号数据同步 | 改密/重置密码全链路云端闭环 |

---

## 三、验证

- 新增专项 tests/test_v1011_feedback_sync.js（36 项全过：静态 15 + 运行时 21）
- test:all 全绿（test:cross 需真实飞书凭证，由 CI 执行）
- check_version_consistency / validate_web_assets / gen_media_mapping --check 全过

## 四、版本三源对齐

config.xml(10.15.11/101511)、version.json 与 release/version.json、js/00-bootstrap.js(APP_VERSION) 同步，含 sw.js 缓存名、11-about.js 版本历史、demo.html 本地版本标记、双脚本与 iOS workflow 版本、审计测试断言。
