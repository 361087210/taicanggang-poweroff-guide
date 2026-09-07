# RELEASE V10.15.14

**日期**: 2026-09-07  
**版本号**: V10.15.14 (versionCode: 101514)  
**类型**: 紧急修复  
**一句话**: 改密后换设备登录仍报"密码错误"——pw_ts仲裁边界条件(>改>=) + 镜像脚本多源合并丢密码

---

## 问题现象

用户在安卓端修改密码后，换一台设备登录时输入新密码仍报"密码错误"，旧密码反而能登录。网页版同样如此。

## 根因分析

### 根因1: pw_ts仲裁边界条件

`js/05-sync.js` 和 `js/09-web-sync.js` 的密码跨设备仲裁逻辑：

```javascript
// 旧逻辑（V10.15.11引入）
if(cuTs > loTs){local.password=cu.password;local.pw_ts=cuTs;}
```

旧版本改密不写 `pw_ts`（默认 0），改密推送到云端后 `pw_ts` 仍为 0。当另一台设备拉取时：
- 云端 `cuTs = 0`
- 本地 `loTs = 0`
- `0 > 0` → `false` → **新密码永不被采纳**

### 根因2: 镜像脚本多源合并丢密码

`scripts/sync_web_data.js` 合并多根 `approved_users.json` 时，按文件时间戳取整个用户对象。当新根文件时间戳更新但密码旧、旧根文件时间戳更旧但密码新（改密推送到了旧根）时，新密码被旧文件覆盖。

## 修复内容

| 文件 | 修改点 |
|------|--------|
| `js/05-sync.js` L441 | 密码仲裁 `cuTs > loTs` → `cuTs >= loTs` |
| `js/09-web-sync.js` L162 | 网页镜像版同步改为 `>=` |
| `scripts/sync_web_data.js` L300-328 | 新增 `mergeUser` 函数，密码字段单独按 `pw_ts` 仲裁（`>=`） |

### 安全性验证

本机刚改密时 `pw_ts = Date.now()`（远大于 0），云端旧值 `pw_ts = 0`：
- `cuTs >= loTs` → `0 >= Date.now()` → `false`
- 本地新密码不被回滚 ✓
- 推送的仍是新密码 ✓

## 测试矩阵

| 测试套件 | 结果 |
|----------|------|
| 版本一致性校验 | ✅ 10.15.14 / 101514 |
| 资产校验 (validate_web_assets) | ✅ 全部通过 |
| 映射表漂移检测 | ✅ 73条一致 |
| test:v1011 (密码+反馈同步专项) | ✅ 43/43 通过 |
| test:all (全量回归 18套) | ✅ 0 FAIL |

## 版本一致性

| 来源 | 值 |
|------|-----|
| config.xml | 10.15.14 / 101514 |
| version.json | 10.15.14 / 101514 |
| js/00-bootstrap.js APP_VERSION | 10.15.14 |
| release/version.json | 10.15.14 / 101514 |
| sw.js CACHE_NAME | tcg-poweroff-v10.15.14 |
| demo.html sync-local-ver | v10.15.14 |
| js/11-about.js VERSION_HISTORY | V10.15.14 |
| scripts/sync_release_both_roots.py | 10.15.14 |
| scripts/migrate_drive_to_bitable.js | 10.15.14 |
| tests/test_v110_audit.js | 10.15.14 |
| .github/workflows/ios-release.yml | 10.15.14 |

## 用户操作指引

1. 更新到 V10.15.14 APK
2. 在安卓端「我的→账号安全」重新改一次密码（之前的改密可能因镜像 bug 被旧文件覆盖）
3. 网页版不能改密（CORS 限制），全局密码修改必须走安卓端
