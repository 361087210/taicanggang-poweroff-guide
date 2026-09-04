# V10.14.1 发版说明: 同步配置出口统一修复(组长组员数据无法同步根因闭环)
发布日期: 2026-09-04  
版本号: 10.14.1 (versionCode=101401)  
下载地址: https://github.com/361087210/taicanggang-poweroff-guide/releases/download/v10.14.1/tcg_poweroff_v10.14.1.apk  
SHA-256: 运行时生成 `release/tcg_poweroff_v10.14.1.apk.sha256`

---

## 一、版本亮点(一句话给现场组长/组员)
> **本次修复"组长组员数据无法同步、组员端显示飞书配置不完整"的根因: 五处同步链路绕过统一配置出口直读本地存储,组员端(及未手动保存过配置的组长端)被配置门禁误拦。升级后,上传/拉取/轮询/导出四条链路全部恢复,组员打开同步页即为绿色"✅云端配置已内置"横幅,点拉取即可获取最新数据。**

---

## 二、本次主要交付(交付物对照清单)

| 分类 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| 🐛核心修复 | 同步配置出口统一: 五处直读 localStorage 改走 `getFeishuCfg()` | js/05-sync.js `loadFeishuConfig`/`_syncUploadPipeline`/`doSyncDownload`/`checkCloudDataUpdate`/`exportSyncConfig` | 本次"数据无法同步"主根因 |
| ✅专项测试 | V10.14.1 出口统一专项 50 断言 11 场景(红-绿-红验证) | tests/test_v1015_member_sync_gate.js | 修复前 34 项失败复现 bug |
| 🩹测试修复 | test:v107 B6 fixture 现代化(补 `_writer:'admin'` 标记) | tests/test_v107_fixes.js | 31/31 恢复,轻量通知通道用例语义保留 |
| 🩹测试修复 | test:cross 真机 harness 补构建期秘钥注入 | tests/test_v57_cross_network.js | V10.12.0 秘钥剥离遗留缺陷,16/16 恢复 |
| 🩹测试修复 | test:logic 维度4闭包缓存重置修状态污染 | tests/test_v57_logic.js | 35/35、34/34 双场景通过 |
| 🏷版本对齐 | 10.14.0 → 10.14.1 八处一致性升级(versionCode 101401) | bootstrap.js / config.xml / version.json / demo.html / test_v1014 / package.json / ci.yml / ios-release.yml | 防 versionCode 漂移 |
| 🤖CI质量门禁 | ci.yml 追加 V10.14.1 专项 step; package.json 新增 test:v1015 并入 test:all | .github/workflows/ci.yml / package.json | 合入前必须 0 FAIL |
| 📚文档 | CHANGELOG [未发布] 段 + 本发版说明 | CHANGELOG.md / docs/RELEASE_V10141.md | 发版知识沉淀 |

---

## 三、根因与核心修复详解

### 3.1 根因: 五处直读 localStorage 绕过统一出口

V10.14.0 建立的秘钥安全体系是: 构建期把 `appSecret` 注入 `window.__BUILD_SECRETS__`,首次 `getFeishuCfg()` 读取即浅克隆进脚本私有闭包 `_INJECTED_SECRETS_CACHE` 并 delete window 引用;此后所有同步链路统一经 `getFeishuCfg()` 取配置(`syncPendingToFeishu` 等 8 处既有出口均如此)。

但 `js/05-sync.js` 中有 **5 处历史代码仍直接 `JSON.parse(localStorage.getItem('feishu_config'))`**:

| # | 函数 | 被拦截的链路 | 用户可见症状 |
|---|---|---|---|
| 1 | `loadFeishuConfig` | 设置页配置回显+三色横幅判定 | 横幅误报"⚠️未注入同步凭据"(应为绿色✅) |
| 2 | `_syncUploadPipeline` | 上传管线门禁 | 组长未手动保存过配置时提示"飞书配置不完整",数据无法上云 |
| 3 | `doSyncDownload` | 拉取管线门禁 | **组员云端数据永远拉不下来(本次主诉)** |
| 4 | `checkCloudDataUpdate` | 60秒轻量通知轮询 | 红点永不亮,"云端有新数据"感知失效 |
| 5 | `exportSyncConfig` | 导出同步配置 | 导出的 appId/folder 为空或历史脏值 |

关键放大器: **组员端本地从未保存过 `feishu_config` 键**(V10.14.0 修复C 成员态禁写),直读恒得 `appSecret=''` → `feishuCfgReady()` 恒 false → 门禁恒拦截。组长端若依赖构建注入凭据、未在设置页手动保存,同样中招。

### 3.2 修复: 五处全部改走 `getFeishuCfg()` 统一出口

- 优先消费构建期注入秘钥的闭包缓存 `_INJECTED_SECRETS_CACHE`(与既有 8 处出口对齐),组员零配置场景仍返回完整可用配置
- `syncSub/pendingSub/approvedSub/backupSub` 全部子目录字段随统一出口返回(V10.10.0 根因修复②语义保留)
- **安全语义完整保留**: ①Secret 输入框仅回显用户手动保存值,注入秘钥只在闭包内存供同步链路使用,不落 DOM 可读值;②`interval` 为用户偏好(数字,非秘钥)保留 localStorage 回显;③admin 显式保存(`_writer='admin'`)手动值仍优先覆盖注入值(覆盖语义不变);④成员端忽略无 admin 标记的本地脏配置(V10.14.0 修复C 防御不回退)

### 3.3 顺带修复的两个既有测试缺陷(基线对照确认与本次修复无关)

1. **test:cross 真机 harness(V10.12.0 秘钥剥离时遗留)**: `makePhone` 未模拟发版 APK 的构建期 `window.__BUILD_SECRETS__` 注入,加载干净源码时模拟手机内 `getFeishuCfg().appSecret` 恒空 → 组员注册申请/组长审批回推全部静默拦截(2.3 起 9 项连锁失败)。基线(git stash 撤销修复)复现同样失败,确认非本次回归;harness 补注入后 16/16 全绿。
2. **test:logic 维度4状态污染**: 1.4d 用例(设置了 `TCG_FEISHU_APP_SECRET` 环境变量时)提前消费 `getFeishuCfg()` 致注入秘钥进入闭包缓存常驻,后续"默认未注入"三断言(4.1/4.2a/4.2c)失真。维度4前重置闭包缓存等价模拟全新页面加载,有/无环境变量两场景均通过。

---

## 四、测试验证(16 套件 0 FAIL,含真实飞书云端)

| 套件 | 断言数 | 结果 | 说明 |
|---|---|---|---|
| V10.14.1 出口统一专项(新增) | 50 | ✅ 0 FAIL | B1-B11: 组长/组员 × 注入/零本地/脏配置 × 上传/拉取/轮询/导出/安全守卫全矩阵 |
| V57 跨网络真机模拟 | 16 | ✅ 0 FAIL | **真实飞书云端**: 组员注册上云→组长拉取审批→新设备登录发现账号全链路 |
| V10.14.0 零配置专项 | 49 | ✅ 0 FAIL | 版本断言已随 10.14.1 对齐 |
| V10.7.0 防抖同步 | 31 | ✅ 0 FAIL | B6 fixture 现代化后恢复 |
| V57 逻辑 | 35 | ✅ 0 FAIL | 状态污染修复后(带环境变量场景) |
| V53 运行时 + V103-V1013 其余套件 | 合计 | ✅ 0 FAIL | 全量回归 |
| **合计** | ≈505 | **✅ 0 FAIL** | 修复专项 50 项经红-绿-红三步验证(git stash 回退后测试重新失败) |

红-绿-红验证记录: 修复前 34 项失败(bug 复现) → 修复后 50/50 通过 → `git stash` 撤销修复后测试重新失败(证明测试真实捕捉回归) → 恢复修复后全绿。

---

## 五、兼容性与回退

- **升级路径**: 直接安装覆盖(同签名,versionCode 101401 > 101400),本地数据/登录态/用户表保留
- **数据兼容**: 本次仅修配置解析出口,云端数据格式(`vehicle_sync_data.json` 信封)、文件夹结构(6 子目录)零变更,新老版本可混用
- **🛟 紧急回退**: 若现场 V10.14.1 出现罕见 bug,可从 GitHub Release 页下载 V10.14.0 的 apk 直接安装降级(需先卸载再安装,数据保留在本地);或组长端重新同步上传云端即可
- **组员感知**: 升级后打开「数据同步」页,横幅应为绿色"✅ 组员账号：云端配置已内置",点「拉取云端数据」即得最新车型手册

---

## 六、发版流程(签名流水线)

### 6.1 发版前检查(本报告出具时已全部完成)
1. ✅ 版本八处对齐: `js/00-bootstrap.js` APP_VERSION = `config.xml` = `version.json`(含 downloadUrl) = `demo.html` = **10.14.1 / 101401**;test_v1014 断言 / package.json / ci.yml / ios-release.yml 同步
2. ✅ 专项+全量回归: 16 套件 ≈505 断言 0 失败(含真实飞书跨网络 16 项)
3. ✅ 映射表校验: `gen_media_mapping.js --check` 通过(73 条一致)
4. ✅ 工作区干净: 全部变更已提交(ece2acc)

### 6.2 签名流水线(自动)
```
推送 origin main → 打标签 git tag -a v10.14.1 → 推送标签
→ GitHub Actions「Android CI Build & Release」自动触发:
   config.xml 读取版本 → Secret 构建注入 → Cordova 构建 → zipalign
   → V1+V2 签名(KEYSTORE_BASE64 Secrets) → apksigner verify 自校验
   → 生成 SHA-256 → Release 挂载 APK + .apk.sha256 双资产
→ 发版后可用 scripts/sync_release_to_feishu.py 同步产物至飞书(双通道分发)
```

### 6.3 发版后核验
1. CI 工作流全绿(重点: 映射表一致性校验 + V10.14.1 专项 step)
2. Release v10.14.1 资产完整: `tcg_poweroff_v10.14.1.apk`(约16MB) + `.apk.sha256`
3. `version.json.downloadUrl` 指向 v10.14.1 资产(APP 内检查更新链路)
4. APK 签名校验: `apksigner verify --print-certs` 输出与历史版本一致(同 KEYSTORE)
5. 真机冒烟: 组员账号登录 → 同步页绿色横幅 → 拉取云端数据成功
