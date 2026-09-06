# V10.15.11 开发日志 —— 反馈同步+密码仲裁

**日期**: 2026-09-06 | **版本**: V10.15.11 (101511)

## 1. RCA（根因分析）

### RCA-1 反馈不同步
- 现象: 网页端/安卓不同设备看不到已提交的反馈
- 根因: ①非组长用户从未从云端拉取自己的反馈（只渲染本地）；②组长角色判断用 `role==='leader'`，实际值 `admin`，导致组长也拉不到全量
- 修复: 按提交人拉回自己的反馈；4 处角色判断改 admin

### RCA-2 改密后换设备新密码失效
- 根因: ①changePassword 只写本地；②拉取合并「密码以本地为准」旧设备永不更新
- 修复: ①改密推送云端；②账号级 pw_ts 时间戳仲裁（云端新→采纳/本机新→保留/无 pw_ts→兼容旧语义）

### RCA-3 权限缺口
- setFeedbackStatus/resetMemberPass 无函数层角色校验（UI-only 防护可被绕过）
- 修复: 补 isLeader/admin 守卫；resetMemberPass 禁重置 admin

## 2. 文件级摘要

| 文件 | 修改 |
| ---- | ---- |
| js/10-feedback.js | 角色判断修复×4、组员按提交人拉回、组长审核按钮、函数层守卫、镜像端跳过重试 |
| js/12-bitable.js | updateFeedbackStatus + 暴露 |
| js/07-cache.js | changePassword 推送云端+pw_ts；resetMemberPass 守卫+pw_ts+fullMerge |
| js/05-sync.js | push 载荷含 pw_ts；pull 合并 pw_ts 仲裁 |
| js/09-web-sync.js | FeedbackBase 镜像桥；pull pw_ts 仲裁；新设备重建带 pw_ts |
| scripts/sync_web_data.js | 反馈表镜像(脱敏)；账号镜像含 pw_ts |
| tests/test_v1011_feedback_sync.js | 新增 36 项专项 |
| 版本联动 | config.xml/version.json×2/00-bootstrap/sw.js/11-about/demo.html/双脚本/ios workflow/审计断言 |

## 3. 测试矩阵

- A 静态 15 项: 审核链路/跨设备拉回/密码同步/镜像桥/角色统一admin/守卫
- B1 组长审核 5 项: 云端调用/本地更新/失败防假成功/无recordId拒绝/组员拦截
- B2 跨设备 4 项: 拉回自己/字段完整/他人排除/组长全量
- B3 密码 5 项: fullMerge 竞态保护/推送/哈希更新/提示/失败引导
- B3b pw_ts 仲裁 4 项: 云端新采纳/本机新保留/旧数据兼容/载荷含 pw_ts
- B4 镜像桥 3 项: 读能力/写封堵/审核封堵
- 全量: test:all 0 FAIL（cross 需凭证走 CI）

## 4. 已知边界

- 组长删除组员的推送不做前置 fullMerge（拉取会复活已删账号），极端并发窗口内其他成员的云端哈希可能短暂回旧；现有设备因 pw_ts 保护不受影响，新设备下次改密推送自愈。
- 组员反馈跨设备匹配键为提交人姓名（组内重名概率极低，可接受）。

## 5. 版本一致性附录

check_version_consistency.js 通过: version=10.15.11, versionCode=101511；三源+全部联动文件同步。
