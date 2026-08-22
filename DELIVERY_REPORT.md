# V5.3.6 交付报告

## 仓库信息
- 仓库: https://github.com/361087210/taicanggang-poweroff-guide
- 标签: v5.3.6
- 时间: 2026-08-22

## 已交付产物 (13 个文件)

| # | 文件 | 说明 |
|---|------|------|
| 1 | config.xml | 版本升级 5.3.6，新增权限与插件 |
| 2 | version.json | V5.3.6 版本信息 |
| 3 | feishu-api.js | 飞书数据同步统一封装层 |
| 4 | demo.html | 主程序 (FeishuAPI 集成、通知、应用内安装) |
| 5 | tests/test_v536_feishu_sync.js | 飞书同步回归测试 |
| 6 | tests/test_v536_perms_notify.js | 权限通知回归测试 |
| 7 | scripts/sync_feishu_v536.py | 产物双端同步脚本 |
| 8 | scripts/backup_to_feishu.py | 全量数据备份脚本 |
| 9 | docs/DEVELOPMENT.md | 开发文档 |
| 10 | docs/ARCHITECTURE.md | 架构文档 |
| 11 | docs/ITERATION_PLAN.md | 迭代计划 |
| 12 | .github/workflows/android-release.yml | CI/CD 配置 |
| 13 | DELIVERY_REPORT.md | 本报告 |

## 核心变更

### 1. 飞书数据同步架构重构 (feishu-api.js)
- 统一认证管理: 自动获取/缓存 tenant_access_token
- 云文档操作: 上传/下载/列表/删除
- Bitable 结构化数据: 批量增删改查
- 审批流完整化: 创建/查询/状态同步
- 消息推送: 文本消息 + 交互式卡片
- 车型/用户数据双向同步: 增量上传 + 智能合并
- 全量备份与恢复: JSON 快照 + 自动清理旧备份
- 定时自动同步: 可配置间隔

### 2. 权限放宽 (config.xml)
- POST_NOTIFICATIONS: Android 13+ 通知权限
- REQUEST_INSTALL_PACKAGES: 应用内安装更新包
- VIBRATE: 通知震动
- READ_EXTERNAL_STORAGE maxSdkVersion=32
- WRITE_EXTERNAL_STORAGE maxSdkVersion=28
- 新增插件: cordova-plugin-local-notification, cordova-plugin-file-opener2

### 3. 通知增强 (demo.html)
- ensureNotifyPermission(): 自动请求通知权限
- leaderNotify(): 审批提醒状态栏通知
- 审批轮询自动触发本地通知
- 降级保护: 无插件时自动降级为 Toast

### 4. 应用内直装更新 (demo.html)
- downloadAndInstallApk(): 一键下载+安装
- 加载状态: 按钮禁用 + 进度提示
- 失败降级: 自动切换浏览器下载

### 5. 安全修复
- config.xml content src 修正为 demo.html
- 飞书凭证改为运行时配置(不再硬编码)
- HTTP 请求统一封装: 重试 + 超时 + 错误处理

## 后续操作

### CI 构建
GitHub Actions 已自动触发构建，APK 将发布到 Release 页面。

### 双端同步
构建完成后执行:
```bash
export FEISHU_APP_ID=your_app_id
export FEISHU_APP_SECRET=your_app_secret
export FEISHU_CHAT_A=oc_xxx_group_a
export FEISHU_CHAT_B=oc_xxx_group_b

python scripts/sync_feishu_v536.py
python scripts/backup_to_feishu.py
```

### 飞书后台配置
登录 https://open.feishu.cn/app/cli_aa0ce4fd91f85be8
确保以下权限已开启:
- drive:drive (云文档读写)
- bitable:bitable (多维表格读写)
- approval:approval (审批实例管理)
- im:message (消息发送)

## 关键提醒

1. 飞书群聊 ID: sync_feishu_v536.py 中的 FEISHU_CHAT_A/B 需替换为实际值
2. Bitable 配置: 如需结构化数据同步，在 APP 设置页填写 bitableAppToken
3. 审批 Code: 如需完整审批流，在飞书管理后台获取 approvalCode
4. 通知权限: Android 13+ 首次启动时会弹窗请求通知权限
5. 应用内安装: 首次使用需到系统设置中允许"安装未知应用"

## 回归测试

```bash
node tests/test_v536_feishu_sync.js
node tests/test_v536_perms_notify.js
```

## 迭代路线图

- V5.3.6 ✅ 当前: 飞书数据同步架构重构 + 权限放宽 + 通知增强
- V5.3.7 规划: 备份加密 + SQLite 迁移 + 离线模式 + 飞书机器人 Webhook
- V5.4.0 规划: Vue3 重构 + 后端独立部署 + 多语言 + AI 识别
- V5.5.0 规划: 数字孪生 + IoT 集成 + 区块链存证
