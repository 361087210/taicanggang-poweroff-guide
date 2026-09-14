# 安全与密钥治理 (SECURITY)

本项目为太仓港断电指导 App, 主干平台为 **飞书(认证/同步/通知/云存储/多维表格)** 与 **GitHub(仓库/Pages/Actions/Release 媒体)**, 不引入第三方云。

## 密钥分类与处置

| 密钥 | 用途 | 存储位置 | 是否入源码 |
|------|------|----------|-----------|
| 飞书 App ID | 应用标识(公开) | `version.json` / `00-config.js` / 构建注入 | ✅ 可(非机密) |
| 飞书 App Secret | 获取 tenant token | **仅** 构建注入 / CI Secrets | ❌ 绝不 |
| GitHub PAT | 网页注册上行 / 推送 | **仅** CI Secrets / 本地环境变量 | ❌ 绝不 |
| 飞书群 chatId | 拒绝通知推送 | `version.json.feishuConfig.chatId` | ✅ 可(非机密) |

## 红线(不可突破)

1. **源码/构建产物/网络日志中绝不出现 App Secret 或 GitHub PAT 明文。**
2. App Secret 经 `scripts/inject_build_secrets.js` 在构建期注入 `window.__BUILD_SECRETS__`,
   运行期读后立即 `delete`, 不落 localStorage 明文、不进 git。
3. 网页注册上行 token 使用与 appSecretEnc 同款的 XOR+base64 密文存储于 `09-web-sync.js`,
   明文不出现在任何文件。

## 已知泄露与轮换

- 旧版仓库曾硬编码飞书 App Secret (`s35nEpUBk8KtxN3Kwl2AEgUNnwXQHABb`)。该值已在飞书开放平台 <!-- noqa:secret -->
  **轮换作废**, 新值仅通过构建注入 / CI Secrets 提供, 不写入本仓库。
- 若怀疑泄露, 第一时间在飞书开放平台重置 App Secret, 并更新 CI Secret `FEISHU_APP_SECRET`。

## CI 防护

- `.github/workflows/secret-scan.yml` 每次 push/PR 运行 `scripts/secret-scan.js`,
  命中 GitHub PAT / 已知泄露 Secret / 明文 appSecret 赋值时非零退出, 阻断合并。
- `.github/workflows/sync-web-data.yml` 使用 `FEISHU_*` Secrets 运行镜像脚本,
  产物 `web-data/` 仅含脱敏数据(手机号 sha256 哈希, 无明文)。

## 网页镜像隐私

`web-data/approved_users.web.json` 中的手机号经 `sha256(WEB_SYNC_SALT + phone)` 单向哈希,
`WEB_SYNC_SALT` 为公开常量; 哈希不可反解, 网页端仅能做"哈希匹配", 无法还原真实手机号。
