# 安全策略

## 支持版本

当前仅支持以下版本的安全更新：

| 版本 | 支持状态 | 说明 |
| ---- | -------- | ---- |
| **10.15.2** | ✅ 支持 | **当前活跃版本**（V11.3 里程碑）：审计日志 + 秘钥构建期加密 + R8 混淆加固 |
| V10.x | ✅ 支持 | 历史活跃版本（数据分仓 + 零配置同步），建议升级 10.15.2 |
| V5.x | ❌ 不再支持 | 历史版本，存在飞书 CORS / 明文凭证等遗留问题，建议升级 10.15.2 |

## 凭证安全（V11.3 里程碑，随 10.15.2 交付）

### 飞书 App Secret
- **构建期加密（V11.3）**：由 `scripts/inject_build_secrets.js`（`before_build`）在构建时将 `appSecret` 做 **XOR + base64** 加密，写入 `demo.html` 的 `window.__BUILD_SECRETS__`，产物中不再出现明文 Secret
- **运行时解密（V11.3）**：`js/00-bootstrap.js` 的 `_decryptBuildSecret()` 在读取时解密；`getFeishuCfg()` 采用「读取即删 + 闭包缓存」，运行时外部无法二次读到明文
- **可覆盖**：可在「设置 → 飞书配置」手动填写覆盖，保存于 `localStorage`（仅本机）
- **代码库零明文**：源码、文档、测试脚本中均不含明文凭证（`validate_web_assets.js` 泄露扫描关卡把关）
- **测试脚本**：通过环境变量 `TCG_FEISHU_APP_SECRET` 传递
- **根治方案（V11.4 M2 规划）**：Secret 下沉服务端（云函数代理），APP 仅持设备码

### R8 / ProGuard 混淆（V11.3）
- **构建期加固（V11.3）**：`scripts/proguard_harden.js`（`after_prepare`）自动在 `platforms/android/app/build.gradle` 注入 `minifyEnabled true`、`shrinkResources true`、`proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'`，并在 `gradle.properties` 写入 `android.enableR8=true`
- **Cordova keep 规则**：生成的 `proguard-rules.pro` 保留 `org.apache.cordova.**`、所有 `CordovaPlugin` 子类、`@JavascriptInterface` 桥方法及 `com.taicanggang.**`，防止 R8 剥离 JS Bridge 反射类导致白屏
- **幂等**：重复构建不重复注入；`TCG_PROGUARD=0` 可跳过（仅调试）
- **边界**：R8 只混淆 Java/Dex 层，不影响 `assets/www/` 下 JS 源码；混淆非绝对防护，根治 = 秘钥下沉服务端

### 审计与删除轨迹（V11.3）
- **本地审计**：`js/16-audit.js` 的 `window.Audit` 对车辆 / 用户增删改操作落 `localStorage` 环形缓冲（500 条）
- **云端通知**：删除等敏感动作通过飞书机器人推送通知（5s 节流），可选写 Bitable 审计表
- **零侵入**：业务代码以 `if(window.Audit)` 防御式埋点，审计模块缺失时优雅降级

## 密码存储（V5.4 升级）
- **本地哈希化**：所有密码使用 SHA-256 + 随机盐值（`salt$hash` 格式）存储于 `localStorage`
- **自动迁移**：启动时自动将明文旧密码幂等升级为哈希格式
- **飞书云端无密码**：上传到飞书的 `approved_users.json` 和 `pending_reg_*.json` 均不含密码字段

## 报告安全漏洞

如发现安全漏洞，请通过以下方式报告：

1. **优先渠道**：GitHub Issues 提交（标记 `security` 标签）
2. **紧急情况**：联系项目维护者

报告时请包含：
- 漏洞类型（凭证泄露 / 越权访问 / 数据泄露 / 其他）
- 影响范围（版本 / 模块）
- 复现步骤
- 严重程度评估（高 / 中 / 低）

## 安全最佳实践

### 部署侧
- **IP 白名单（待配置）**：在飞书开放平台为应用配置「IP 白名单」，仅放行内网 / 网关出口，阻断非预期来源
- **配额告警（待配置）**：为飞书应用设置 API 调用量监控与告警（QPS / 日调用），防止异常流量拖垮配额
- **月轮换（待执行）**：每 30 天轮换一次飞书 App Secret，轮换后同步更新 `inject_build_secrets.js` 读取的当前 Secret
- 不要将 Secret 写入版本控制或 CI 配置文件
- 生产环境建议使用服务端代理，不建议客户端直连飞书 API
- **签名密钥不入库**：keystore 已从 git 跟踪移除并加入 `.gitignore`，CI 走 GitHub Secrets（`KEYSTORE_BASE64`/`KEYSTORE_PASSWORD`/`KEY_ALIAS`）
- **签名密码零明文**：本地构建读环境变量 `TCG_KS_PASSWORD`，CI 从 Secrets 注入，泄露扫描关卡防回归

### 使用侧
- 组长账号密码不要与个人账号共用
- 定期清理离职人员账号
- 首次安装后立即在设置页填写飞书 Secret，不要分享给无关人员

## 已知安全限制

| 限制项 | 说明 | 计划修复版本 |
| ------ | ---- | ------------ |
| ~~密码明文存储~~ | ~~审批账号密码以明文存储于飞书云端~~ | **V5.4 ✅ 已修复：SHA-256 哈希** |
| ~~客户端明文 Secret~~ | ~~App Secret 明文 / `_fsDec` 弱混淆内置~~ | **V11.3 ✅ 已缓解：构建期 XOR+base64 加密 + 读取即删** |
| 客户端直连飞书 | App Secret 仍存在于客户端（已加密），APK 反编译结合密钥可能提取 | **V11.4 M2 规划：服务端代理（云函数）** |
| 无传输加密 | 数据上传下载走 HTTPS，但本地存储无加密 | V11.4+（评估中） |

## 安全更新历史

| 版本 | 日期 | 安全变更 |
| ---- | ---- | -------- |
| V11.3 | 2026-09-06 | 审计与秘钥加固过渡：App Secret 改为构建期 XOR+base64 加密（产物零明文）；新增 R8/ProGuard 混淆加固（`minifyEnabled`+`shrinkResources`+Cordova keep 规则）；新增本地审计 + 删除轨迹机器人通知；IP 白名单 / 配额告警 / 月轮换待运营配置 |
| V5.7 | 2026-08-23 | 默认飞书 App Secret 改为 `_fsDec` 混淆内置（开箱即用、非明文合规），校验脚本支持混淆形态检测 |
| V5.4 | 2026-08-23 | 密码 SHA-256+盐值哈希化（本地存储），飞书云端不再同步密码字段，启动时自动幂等迁移明文旧密码 |
| V5.3.1 | 2026-08-21 | 飞书 App Secret 从默认配置移除，代码库零明文凭证；签名 keystore/APK 移出 git 跟踪；构建脚本密码环境变量化；CI 凭证泄露扫描关卡上线 |
| V5.3 | 2026-08-20 | 数据分仓（项目产物与用户数据物理隔离） |
| V4.0 | 2026-06-15 | 账号系统与角色权限（组长/组员） |
