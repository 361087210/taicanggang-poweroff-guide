# 太仓港断电指导 APP — 安全审查报告

**审查日期**：2026-09-08
**审查范围**：全仓库源码（JS/HTML/Python/Node 脚本/CI Workflow）
**审查方法**：基于 `security-best-practices` 规范的主动审计模式
**仓库状态**：公开仓库（https://github.com/361087210/taicanggang-poweroff-guide）

---

## 执行摘要

本次审查共发现 **14 项安全问题**，其中：

| 严重程度 | 数量 | 说明 |
|---------|------|------|
| **P0 严重** | 3 | 可直接导致凭据泄露、权限提升、账号接管 |
| **P1 高危** | 5 | 加密失效、缺乏纵深防御、权限模型缺陷 |
| **P2 中危** | 4 | 敏感数据暴露面扩大、防护仅在开发环境生效 |
| **P3 低危** | 2 | 防御纵深缺失、供应链风险 |

**最紧急动作**：立即轮换飞书 App Secret（已在 `docs/DEVELOPMENT.md` 明文泄露到公开仓库），并从 Git 历史中清除。

---

## P0 严重问题

### P0-1：飞书 App Secret 明文泄露到公开仓库

| 字段 | 内容 |
|------|------|
| **规则** | JS-XSS-001 / 凭据管理基线 |
| **位置** | [docs/DEVELOPMENT.md:33](docs/DEVELOPMENT.md#L33) |
| **证据** | `- **App Secret**: \`s35nEpUBk8KtxN3Kwl2AEgUNnwXQHABb\`` |
| **影响** | 该仓库为公开仓库，任何人可获取此 Secret。结合 App ID `cli_aa0ce4fd91f85be8`，攻击者可调用 `tenant_access_token/internal` 接口获取租户访问令牌，进而**读写整个飞书云文档目录、审批、多维表格**，导致所有车型断电数据、用户审批数据被窃取或篡改。Folder Token `WdXUfZPkClI1audQxIYc90XRnWc`（第 34 行）同样泄露。 |

**修复方案**：
1. **立即**到飞书开放平台重置 App Secret
2. 删除 `docs/DEVELOPMENT.md` 中的明文凭证，替换为占位符（如 `<FEISHU_APP_SECRET>`）
3. 用 `git filter-repo` 或 BFG Repo-Cleaner 从 Git 历史中清除泄露的 Secret
4. 轮换后更新 GitHub Actions Secrets 中的 `FEISHU_APP_SECRET`

---

### P0-2：默认管理员账号 + 硬编码组长手机号 + 弱密码

| 字段 | 内容 |
|------|------|
| **规则** | 认证基线 / 默认凭证 |
| **位置** | [js/00-bootstrap.js:37](js/00-bootstrap.js#L37), [js/00-bootstrap.js:41](js/00-bootstrap.js#L41), [js/02-auth.js:127](js/02-auth.js#L127) |
| **证据** | `const LEADER_PHONE='17602554481';` + `password:'123456'` + `const isLeader=phone===LEADER_PHONE;` |
| **影响** | 任何人安装 APP 后，用组长手机号 `17602554481` 注册即可自动获得 `admin` 角色。初始密码 `123456` 为 6 位纯数字，极易被暴力破解或社工获取。获得 admin 后可审批任意注册申请、删除车辆数据、修改同步配置。 |

**修复方案**：
1. 移除 `LEADER_PHONE` 硬编码，改为构建期注入或首次启动时由用户设定
2. 强制默认密码在首次登录时修改
3. 注册时不自动授予 admin，管理员角色需由已存在的 admin 手动指派
4. 密码策略提升：至少 8 位，包含字母+数字

---

### P0-3：密码重置无任何身份验证

| 字段 | 内容 |
|------|------|
| **规则** | 认证基线 / 密码重置 |
| **位置** | [js/02-auth.js:144-162](js/02-auth.js#L144-L162) |
| **证据** | `doForgotPassword()` 仅校验手机号格式和是否已注册，即可直接重置密码 |
| **影响** | 攻击者只需知道目标用户的手机号（组长手机号已硬编码在代码中），即可在任意设备上重置其密码并登录。结合 P0-2，组长账号可被完全接管。 |

**修复方案**：
1. 密码重置必须经过身份验证：短信验证码（最优）或至少验证注册时的安全问题
2. 若无法接入短信服务，至少要求验证旧密码才能设置新密码
3. 重置操作应记录审计日志并通知组长

---

## P1 高危问题

### P1-1：XOR + base64 假加密，密钥硬编码在客户端

| 字段 | 内容 |
|------|------|
| **规则** | 密码学基线 / 客户端密钥管理 |
| **位置** | [scripts/inject_build_secrets.js:43](scripts/inject_build_secrets.js#L43), [js/00-bootstrap.js:183](js/00-bootstrap.js#L183) |
| **证据** | `const SECRET_XOR_KEY = 'TCG_V11_XOR_2026';`（构建端）和 `const _SECRET_XOR_KEY = 'TCG_V11_XOR_2026';`（运行端） |
| **影响** | XOR 不是加密算法，且密钥 `TCG_V11_XOR_2026` 硬编码在客户端代码中。反编译 APK 后：① grep 到 `appSecretEnc` 密文；② grep 到 `_SECRET_XOR_KEY`；③ 简单 XOR 运算还原明文 Secret。SECURITY.md 自身也承认此方案"不构成绝对防护"。 |

**修复方案**：
1. **根治**（V11.4 M2 已规划）：Secret 下沉服务端，APP 仅持设备码，所有飞书 API 调用走云函数代理
2. **过渡**：若暂无法上服务端，至少使用 Android Keystore 存储密钥，配合 ProGuard 字符串混淆，提升逆向成本
3. **立即**：在飞书开放平台配置 IP 白名单（仅放行门店出口 IP），限制 Secret 泄露后的影响范围

---

### P1-2：无 Content-Security-Policy (CSP) 防护

| 字段 | 内容 |
|------|------|
| **规则** | JS-CSP-001 |
| **位置** | [demo.html](demo.html)（全文无 CSP meta 或 header） |
| **证据** | `demo.html` 的 `<head>` 中仅有 charset/viewport/theme-color 等 meta，无 `Content-Security-Policy` |
| **影响** | 项目中有 **117+ 处内联 `onclick` 事件** 和大量 `innerHTML` 渲染。一旦某个 `esc()` 遗漏点被攻破（如新增字段未转义），无 CSP 作为纵深防御，XSS 可直接执行任意 JS、窃取 localStorage 中的所有数据（用户表、appSecret、飞书 token）。 |

**修复方案**：
1. 在 `demo.html` `<head>` 顶部添加 CSP meta（因 Cordova/GitHub Pages 无法设 HTTP header）：
   ```html
   <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://open.feishu.cn https://*.aliyuncs.com;">
   ```
2. 中长期：将内联 `onclick` 迁移为 `addEventListener`，去掉 `unsafe-inline`

---

### P1-3：权限校验纯客户端，无服务端验证

| 字段 | 内容 |
|------|------|
| **规则** | 授权基线 |
| **位置** | [js/02-auth.js:183-184](js/02-auth.js#L183-L184) |
| **证据** | `function isLeader(){return state.currentUser&&state.currentUser.role==='admin';}` / `function canEdit(){return isLeader();}` |
| **影响** | `state.currentUser` 来自 `localStorage`（`tcg_users`）和内存。攻击者通过 DevTools 修改 `localStorage.tcg_users` 中自己账号的 `role` 为 `admin`，或直接修改内存中的 `state.currentUser.role`，即可获得管理员权限，审批任意注册、删除数据。无任何服务端校验。 |

**修复方案**：
1. 飞书多维表格中存储角色字段，关键操作（审批、删除、同步配置修改）前从云端重新拉取角色校验
2. 审批操作增加二次确认 + 审计日志
3. 组员端的敏感 UI 元素在渲染前校验角色，且操作时再次校验

---

### P1-4：会话令牌无签名，可伪造

| 字段 | 内容 |
|------|------|
| **规则** | 会话管理基线 |
| **位置** | [js/02-auth.js:59](js/02-auth.js#L59), [js/02-auth.js:88-112](js/02-auth.js#L88-L112) |
| **证据** | `localStorage.setItem('tcg_session',JSON.stringify({uid:user.id,phone:user.phone,ts:Date.now()}));` — 仅存 uid/phone/ts，无签名/令牌 |
| **影响** | `restoreSession()` 仅检查 `uid` 是否存在于 USERS 数组和 7 天过期。攻击者修改 `localStorage.tcg_session` 的 `uid` 为任意已存在用户的 ID（如组长的 uid=1），即可冒充该用户登录，无需密码。 |

**修复方案**：
1. 会话存储加入签名：`HMAC-SHA256(uid + phone + ts, server_secret)`，服务端验证签名
2. 若无服务端，至少存储密码哈希的截断值作为校验因子
3. 会话绑定设备指纹（WebView UserAgent + 屏幕分辨率哈希）

---

### P1-5：密码哈希使用单轮 SHA-256，非 bcrypt/argon2

| 字段 | 内容 |
|------|------|
| **规则** | 密码存储基线 |
| **位置** | [js/00-bootstrap.js:121-125](js/00-bootstrap.js#L121-L125) |
| **证据** | `async function hashPassword(password, salt) { ... const hashHex = await _digestSha256Hex(data); return salt + '$' + hashHex; }` |
| **影响** | SHA-256 是快速哈希（单轮，GPU 可每秒数十亿次）。虽然 SECURITY.md 声称"bcrypt"，实际代码是 SHA-256 + salt。若 `tcg_users`（含所有密码哈希）被 XSS 窃取，6 位数字密码（如默认 `123456`）可在毫秒内被彩虹表/暴力破解。 |

**修复方案**：
1. 迁移到 PBKDF2（`crypto.subtle.deriveBits` 支持，浏览器原生），迭代次数 ≥ 100,000
2. 或引入 bcrypt.js（纯 JS 实现），cost factor ≥ 10
3. 密码策略强制至少 8 位字母+数字，缩小可破解空间

---

## P2 中危问题

### P2-1：用户手动填写的 appSecret 明文存于 localStorage

| 字段 | 内容 |
|------|------|
| **规则** | JS-STORAGE-001 |
| **位置** | [js/00-bootstrap.js:232](js/00-bootstrap.js#L232), [feishu-api.js:47-63](feishu-api.js#L47-L63) |
| **证据** | `const saved=JSON.parse(localStorage.getItem('feishu_config')||'{}');` — appSecret 以明文存入 `feishu_config` |
| **影响** | 若组长在设置页手动填写了 appSecret，该 Secret 以明文存在 localStorage。任何 XSS 漏洞可直接窃取。虽然 V11.3 构建注入路径已加密，但手动填写路径仍是明文。 |

**修复方案**：
1. 手动填写的 appSecret 同样用 `_SECRET_XOR_KEY` 加密后存储（至少不直接 grep 到明文）
2. 组员端禁止手动填写 appSecret（V10.14 已有部分逻辑，确保完全拦截）
3. 优先使用构建注入路径，减少手动填写场景

---

### P2-2：innerHTML XSS 绊线仅在开发环境生效

| 字段 | 内容 |
|------|------|
| **规则** | JS-XSS-001（纵深防御） |
| **位置** | [js/00-bootstrap.js:1264](js/00-bootstrap.js#L1264) |
| **证据** | `if(typeof window!=='undefined'&&!window.cordova&&!window.__innerHTMLGuardInstalled__)` — 条件 `!window.cordova` 意味着生产 APK 中绊线不生效 |
| **影响** | 绊线仅拦截 `<script>` 和 `javascript:`，且仅在浏览器预览/测试环境生效。生产 APK 中一旦某个新字段遗漏 `esc()`，无运行时检测。当前 `renderVehicleCard` 中 `v.photoPaths[0]` 直接插入 `src` 未验证协议，`v.id` 直接插入 `onclick`。 |

**修复方案**：
1. 确认所有用户可控字段在 innerHTML 中都经过 `esc()`（`v.photoPaths[0]` 至少验证 `http://` 或 `https://` 前缀）
2. `v.id` 插入 `onclick` 前确保是数字类型
3. 考虑在生产环境也启用绊线（仅 warn，不阻断）

---

### P2-3：localStorage 存储全部用户表（含密码哈希）

| 字段 | 内容 |
|------|------|
| **规则** | JS-STORAGE-001 |
| **位置** | [js/00-bootstrap.js:39-46](js/00-bootstrap.js#L39-L46) |
| **证据** | `localStorage.setItem('tcg_users',JSON.stringify(users));` — 全部用户（含密码哈希、手机号、角色）存于 localStorage |
| **影响** | XSS 可窃取全部用户的密码哈希和手机号。结合 P1-5（弱哈希），可批量破解密码。 |

**修复方案**：
1. 仅存储当前登录用户的必要信息，不存储全部用户表
2. 其他用户数据按需从飞书云端拉取
3. 密码哈希不存 localStorage，改为登录时即时验证

---

### P2-4：飞书 tenant_access_token 内存中无过期保护

| 字段 | 内容 |
|------|------|
| **规则** | 令牌管理基线 |
| **位置** | [feishu-api.js:39-155](feishu-api.js#L39-L155) |
| **证据** | `let _token = null;` + `_token = data.tenant_access_token;` — token 仅在内存中，不持久化 ✓ |
| **影响** | token 不持久化是好的。但内存中的 token 在 WebView 生命周期内有效（2 小时），XSS 可通过 `getTenantToken()` 间接获取。无 token 级别的权限隔离（所有操作共用同一 tenant token）。 |

**修复方案**：
1. 关键操作（删除、审批）前强制刷新 token 并校验
2. 考虑按操作类型使用不同权限范围的 token（飞书应用权限细分）

---

## P3 低危 / 建议

### P3-1：Service Worker postMessage 无 origin 校验

| 字段 | 内容 |
|------|------|
| **规则** | JS-MSG-001 |
| **位置** | [sw.js:65-69](sw.js#L65-L69) |
| **证据** | `self.addEventListener('message',e=>{ if(e.data&&e.data.action==='SKIP_WAITING'){ self.skipWaiting(); } });` |
| **影响** | 仅处理 `SKIP_WAITING` 动作（立即激活新 SW），风险较低。但无 `event.origin` / `event.source` 校验，理论上任意页面可触发此动作。 |

**修复方案**：添加 `if (e.origin !== self.location.origin) return;`

---

### P3-2：第三方库无 SRI 校验

| 字段 | 内容 |
|------|------|
| **规则** | JS-SRI-001 |
| **位置** | [demo.html](demo.html) vendor 脚本引用 |
| **证据** | `vendor/tailwind.js`、`vendor/xlsx.full.min.js`、`vendor/jspdf.umd.min.js` 等本地引用，无 `integrity` 属性 |
| **影响** | 库文件已本地化（非 CDN），供应链风险较低。但若构建流程被篡改，无完整性校验。 |

**修复方案**：为关键 vendor 库计算 SHA-384 并添加 `integrity` 属性（本地文件同样适用）。

---

## 优先修复路线图

| 优先级 | 动作 | 预计工作量 | 风险降低 |
|--------|------|-----------|---------|
| **立即** | 轮换飞书 App Secret + 清除 Git 历史 | 30 分钟 | P0-1 |
| **立即** | 移除硬编码组长手机号，admin 角色改为手动指派 | 2 小时 | P0-2 |
| **立即** | 密码重置增加身份验证（旧密码校验） | 1 小时 | P0-3 |
| **本周** | 配置飞书 IP 白名单 + 配额告警 | 1 小时 | P1-1 缓解 |
| **本周** | 添加 CSP meta 到 demo.html | 1 小时 | P1-2 |
| **本周** | 密码哈希迁移到 PBKDF2（≥100k 迭代） | 3 小时 | P1-5 |
| **V11.4** | Secret 下沉服务端（云函数代理） | 2-3 天 | P1-1 根治 |
| **V11.4** | 关键操作增加服务端角色校验 | 1-2 天 | P1-3 |
| **V11.4** | 会话签名 + 设备绑定 | 1 天 | P1-4 |

---

## 审查覆盖说明

**已审查**：
- 前端 JS（`js/*.js`）的 XSS 汇聚点、认证逻辑、存储安全
- 构建脚本（`scripts/inject_build_secrets.js`）的密钥处理
- 飞书 API 层（`feishu-api.js`）的 token 管理
- HTML 入口（`demo.html`）的 CSP/meta 配置
- Service Worker（`sw.js`）的消息处理
- CI Workflow（`.github/workflows/*.yml`）的密钥注入方式（使用 GitHub Secrets ✓）
- 文档（`docs/DEVELOPMENT.md`、`SECURITY.md`）的凭据泄露

**未深入审查**（需后续补充）：
- `tests/` 目录中的测试脚本（发现 `window.eval` 使用，但属测试代码，不影响生产）
- Python 脚本（`scripts/*.py`）的路径遍历/注入风险
- `vehicles_data.js`（87KB 静态数据）的内容安全

---

*报告生成基于 security-best-practices 技能规范。所有发现均附带文件路径与行号证据，可直接定位修复。*
