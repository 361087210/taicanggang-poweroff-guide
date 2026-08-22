# 太仓港停电指南 APP 开发文档 V5.3.6

## 一、项目概述

- **仓库**: https://github.com/361087210/taicanggang-poweroff-guide
- **技术栈**: Cordova 12 + Android 13 + Vanilla JS
- **目标 SDK**: 34, 最低 SDK: 24
- **主程序**: `demo.html` + `feishu-api.js`

## 二、环境搭建

### 2.1 本地开发
```bash
npm install -g cordova@12
cordova platform add android@13
cordova plugin add cordova-plugin-advanced-http@3.3.1
cordova plugin add cordova-plugin-local-notification@1.2.3
cordova plugin add cordova-plugin-file-opener2@4.0.0
# ... 其他插件见 config.xml
```

### 2.2 构建
```bash
cordova build android --release
jarsigner -verbose ...  # 签名
zipalign -v 4 ...       # 对齐
```

## 三、飞书集成配置

### 3.1 凭证配置（已内置）
- **App ID**: `cli_aa0ce4fd91f85be8`
- **App Secret**: `s35nEpUBk8KtxN3Kwl2AEgUNnwXQHABb`
- **云文档文件夹 Token**: `WdXUfZPkClI1audQxIYc90XRnWc`

### 3.2 用户自定义配置（可选）
在 APP 设置页可覆盖：
- `bitableAppToken`: 多维表格 AppToken（用于结构化数据同步）
- `approvalCode`: 审批定义 Code
- `chatId`: 默认群聊 ID

### 3.3 权限申请
飞书应用后台需开启：
- `drive:drive` 云文档读写
- `bitable:bitable` 多维表格读写
- `approval:approval` 审批实例管理
- `im:message` 消息发送

## 四、核心模块说明

### 4.1 feishu-api.js 数据层

| 模块 | 功能 |
|------|------|
| `getTenantToken()` | 自动获取/缓存 tenant_access_token |
| `driveUploadFile()` | 上传文件到云文档 |
| `bitableBatchCreate/Update()` | 批量操作多维表格 |
| `syncVehiclesToBitable()` | 车型数据增量同步上传 |
| `syncVehiclesFromBitable()` | 车型数据拉取合并 |
| `backupAllData()` | 全量 JSON 快照备份 |
| `approvalCreate/Query()` | 审批流完整生命周期 |

### 4.2 通知机制

```javascript
// 请求权限（Android 13+ 需要运行时授权）
ensureNotifyPermission((granted) => { ... });

// 发送审批提醒（优先本地通知，降级 Toast）
leaderNotify('新注册待审批', '收到 3 条新注册申请');
```

### 4.3 应用内更新

```javascript
// 一键下载安装（降级：浏览器下载）
downloadAndInstallApk();
```

## 五、调试技巧

1. **飞书 API 调试**: 开启 Chrome DevTools，查看 Console 中 `[FeishuAPI xxx]` 日志
2. **Token 问题**: 检查 `localStorage.feishu_token_cache` 是否过期
3. **通知不显示**: 检查系统设置中 APP 通知权限 + Android 13 POST_NOTIFICATIONS 授权

## 六、安全规范

- App Secret 已内置在 `feishu-api.js` 中（客户端风险可控，因飞书权限已最小化）
- 生产环境建议通过后端代理转发敏感 API
- 用户密码使用 bcrypt 哈希存储
