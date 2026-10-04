# V10.20.0 组员密码重置安全加固版 — 发布说明

> 版本号：10.20.0 ｜ versionCode：102000

## 一句话

根治组员密码重置的弱口令与口令泄露隐患：重置口令改为 CSPRNG 随机生成（12 位、去歧义字符集），不再写死 `123456`、不再明文回显，改用一次性弹层展示；同时把「两端共享代码变更未升版」的错配门禁并入主干并接入 CI，清理视频直链映射表死键、校正数据镜像残留的编码损坏字符。

## 根因

旧版 `resetMemberPass` 把重置口令固化为 `123456` 并通过 `toast` 明文念出，任何能看到提示的人都可登录该账号；口令弱且可预测，且与账号解耦（多账号同口令）。此外主干长期存在两类隐性风险：共享代码（`js/`、`demo.html` 等）改动后忘记升版导致网页端与 App 端行为错配；视频直链映射表残留无引用死键、数据镜像残留 U+FFFD 替换字符。

## 本次内容

### 安全加固（组员密码重置）

- 新增 `generateRandomPassword(len)`：基于 `crypto.getRandomValues`（CSPRNG）取随机源，采用拒绝采样消除取模偏差，字符集剔除易混淆字符（`0/O/o/1/l/I/i`）；CSPRNG 不可用时降级 `Math.random`（仍远优于固定口令）。
- `resetMemberPass` 改用 `generateRandomPassword(12)`，代码中不再出现固定口令 `123456`。
- 存储侧改为 `hashPassword` 落库哈希（非明文），并用同一新口令 `deriveLinkKey(u.phone, newPass)` 重算链接密钥，保证网页端可用新口令登录。
- `toast` 不再回显口令明文；新增一次性口令弹层 `modal-reset-pass`（口令展示位 + 使用提示位 + 复制/关闭按钮接线），元素缺失时静默降级，兼容真机旧页与测试沙箱。
- 保留原有安全边界：函数层组长守卫（仅组长可重置组员）与「禁止重置组长账号」校验不变，云端推送链路 `pushApprovedUsersToFeishu()` 不变。

### 治理（两端错配门禁并入主干）

- `scripts/check_two_end_sync.js` 并入主干并接入 CI：共享代码路径（`js`、`demo.html`、`feishu-api.js`、`css`、`vendor`）有变更而版本未升时，主干硬失败（`exit 1`）；版本已升时降级为告警，避免「改了共享代码忘了升版」的错配隐患再次流入。

### 工程（测试与数据）

- 新增专项测试 `tests/test_v1035_reset_member_pass.js`：**34 条断言**全覆盖（静态防回退 16 条 + 运行时行为 15 条 + 安全边界 3 条），已登记进 `TEST_SUITES` 并接入 CI 覆盖校验。
- 清理视频直链映射表 `MEDIA_DIRECT_ASSETS` 中 3 个无任何车型引用的死键（`user_v74_v1_bba4db96.mp4` / `user_v74_v1_2d41bb72.mp4` / `user_v22_v2_7a155908.mp4`），映射表 52 → 49 条，与「全部引用全覆盖」断言对齐。
- `scripts/gen_vehicles_data.js` 校正表新增 2 条（`id=15 比亚迪元(元UP)`、`id=100 北汽-极狐ARCFOX-T1` 的 `keyContainer` 句），重生成 `vehicles_data.js` 后消除镜像侧残留的 4 个 U+FFFD，`vehicles_data.js` 现为 0 个替换字符。
- 版本升号 10.19.5 → 10.20.0（七源对齐：`config.xml` / `version.json` / `release/version.json` / `js/00-bootstrap.js` / `sw.js` / `demo.html` / `js/11-about.js` 版本历史与兜底字面量）。

## 升级指引

1. 打开 App，确认提示的新版本为 **V10.20.0**。
2. 点击「更新」下载安装（Android 签名包）。
3. 若为 iOS，请联系组长获取安装包。
4. 组长重置组员密码后，请从一次性弹层复制口令并单独转发给该组员，**弹层关闭后口令不再可查**，遗失请重新重置。

## 资产

| 文件 | 说明 |
|---|---|
| `tcg_poweroff_v10.20.0.apk` | Android 签名安装包（v1+v2 签名） |
| `tcg_poweroff_v10.20.0.apk.sha256` | APK SHA-256 校验和 |
| `tcg_poweroff_v10.20.0_ios.ipa` | iOS 安装包（development，无签名） |
| `version.json` | 版本清单（`downloadUrl` 指向 v10.20.0） |

## 备注

- 本版是 10.19.5 的超集，包含其全部内容（飞书限流治理等），只需更新这一次。
- 重置口令为一次性展示：弹层关闭即清空，不会写入任何日志或提示文案。
- 数据镜像残留的 U+FFFD 已由本地校正表兜底；建议后续在飞书源表同步修正这两句文案，校正表条目可在源表修复后移除。
