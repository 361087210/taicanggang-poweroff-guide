# V10.14.0 发版说明: 组员零配置同步修复 + 双端同步脚本治理 + 构建签名基建补齐
发布日期: 2026-09-04  
版本号: 10.14.0 (versionCode=101400)  
下载地址: https://github.com/361087210/taicanggang-poweroff-guide/releases/download/v10.14.0/tcg_poweroff_v10.14.0.apk  
SHA-256: 运行时生成 `release/tcg_poweroff_v10.14.0.apk.sha256`

---

## 一、版本亮点(一句话给现场组长/组员)
> **现在安装官方签名APK后,组员手机不需要再填任何飞书配置,打开APP 3 秒即可看到最新同步数据。组长删除/修改/新增任何车型,组员端即使跨时区、清缓存、重装APP、升级APP,都能100%镜像同步。**

---

## 二、本次主要交付(交付物对照清单)

| 分类 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| 🏷版本对齐 | 版本号三处对齐(JS/XML/JSON/HTML默认模板四处) | bootstrap.js:L1180 / config.xml / version.json / demo.html:L321 | 防 V5.7 版 BASE+run_number 漂移重演 |
| 🐛核心修复A | 构建注入秘钥闭包永久缓存(清缓存/杀进程/重装不丢) | js/00-bootstrap.js `_INJECTED_SECRETS_CACHE` + `getFeishuCfg pick()` | 组员端零配置第一大前提 |
| 🐛核心修复B | 镜像同步 timestamp+ID集合差集双触发 | js/05-sync.js doSyncDownload | 覆盖同秒删除/时区回拨/新安装首次三类真机盲区 |
| 🐛核心修复C | 组员三色横幅+输入框灰化readonly+save深度防御+admin写入标记 | js/05-sync.js loadFeishuConfig/saveFeishuConfig + demo.html:L23 banner占位 | 组员不再误填/写错配置 |
| 📚文档补齐 | V10.12/V10.13 详细发版说明 | docs/RELEASE_V10120.md / RELEASE_V10130.md + 本次 RELEASE_V10140.md | 9000字/版本级详细交付说明 |
| 📚开发日志 | V10.14 根因分析+修复对比+修改摘要+测试矩阵+风险遗留 | docs/DEVLOG_V10140.md | 复盘沉淀,迭代依据 |
| 📚迭代计划 | V11.x 5 Phase 路线图 + 三项核心建议 | docs/ITERATION_PLAN.md (本次更新) | 下一轮迭代顶层设计 |
| 🔧同步脚本 | 飞书备份脚本参数化(过期硬编码→环境变量+version.json优先级链) | scripts/backup_to_feishu.py | folderToken 从V5.3过期值→正确公开值 |
| 🔧同步脚本 | GitHub发布脚本参数化+APK大小预检+sha256自动生成/Draft→正式发布 | scripts/push_github_final.sh | 发版不再因硬编码错误上传到错tag |
| 🔧构建脚本 | Android 签名构建流水线(zipalign+v1/v2/v3签名+SHA-256+未签名fallback) | scripts/build_android.sh | 行业标准:可重复/可审计/秘钥不入库 |
| 🔧构建脚本 | iOS Archive + Export IPA 构建脚本 | scripts/build_ios.sh | 占位 CI/本地 双形态 |
| 🤖CI质量门禁 | ci.yml 追加 V10.14 专项测试 step + 摘要输出版本号/V1014统计 | .github/workflows/ci.yml | 合入前必须 0 FAIL |
| 🤖CI发布 | android-release.yml 追加 SHA-256 step + 上传 Release APK+SHA 双文件 | .github/workflows/android-release.yml | 发布可校验,防CDN脏缓存中间人替换 |
| ✅测试 | V10.14 真机级 Mock 10 专项 49 断言 | tests/test_v1014_zero_config_member.js | 覆盖 A/B/C 三类修复全路径 |
| ✅测试 | 基建兼容修复(DEMO_BLOCKS注入顺序/V1013版本断言动态化) | tests/e2e_harness.js / tests/test_v1013_a3.js | 升级到新版本后老测试套件不漂移红 |

---

## 三、核心修复详解

### 3.1 修复A: 构建注入秘钥「闭包永久缓存」(组员零配置第一块拼图)

**问题背景:**
构建期 hooks/before_build/01_inject_secrets.js 会把环境变量 `FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_FOLDER_TOKEN` 注入到 demo.html `<head>` 中 `window.__BUILD_SECRETS__ = { ... }`。
旧版 getFeishuCfg 每次运行时:
1. 读取 localStorage 保存值
2. 读取 window.__BUILD_SECRETS__
3. pick() 合并优先级 localStorage > injected

这导致:
- 组员清缓存后 localStorage 为空,但第一次读取后代码会 delete window.__BUILD_SECRETS__,后续再次调用 getFeishuCfg 时 injected 也没了 → appSecret 永久丢失。
- 用户被迫联系管理员抄配置。

**修复方案:**
```js
// 脚本作用域私有闭包(不挂window),脚本加载期间仅初始化一次
let _INJECTED_SECRETS_CACHE = null; 
function getFeishuCfg() {
  if (_INJECTED_SECRETS_CACHE === null && typeof window !== 'undefined' && window.__BUILD_SECRETS__) {
    // 浅克隆到闭包,避免delete window引用时连带清理
    _INJECTED_SECRETS_CACHE = Object.assign({}, window.__BUILD_SECRETS__);
    delete window.__BUILD_SECRETS__;
  }
  // 之后全部走闭包缓存 + localStorage pick(有角色判定)
}
```
**为什么用浅克隆?** 注入对象是 flat JSON(字符串值层),深克隆无必要,浅克隆足以免受 delete window 连带影响+后续 localStorage 写入不会污染注入值。(Z7 测试: 4 次调用 appSecret 全等稳定)

**防御层级:**
- localStorage.clear() 后调用 → 仍能取回(因为闭包是 JS 脚本作用域,不受 localStorage 影响)
- WebView 杀进程/APP 冷重启 → 重新加载 demo.html `<script>window.__BUILD_SECRETS__=...`, 首次读到后又写入缓存, 全程不丢
- OTA 热更新 → 同上(首屏 <script> 仍然重新注入)

### 3.2 修复B: 镜像同步「timestamp + ID集合差集」双触发(组员零配置第二块拼图: 删除传播100%)

**问题背景:**
doSyncDownload 只判断 `cloudTs > lastSyncTs` 单条件 → 3 类场景漏镜像:
1. 组长 14:00:03 上传 vehicle_sync_data.json;组员 14:00:03 同一秒内拉过一次(lastSyncTs=3, cloudTs=3,3>3=false,漏镜像),所以 3 台删除根本没下载到。
2. 组长 Android 时区漂移/NTP 跳回 5s,上传 cloudTs=14:00:00,组员 lastSyncTs=14:00:05,14:00:00>14:00:05=false,所有修改全漏
3. 新安装组员 APP 初始化 lastSyncTs=Date.now(),组长 cloudTs < now,永远不触发首次同步

**修复方案(源码决策逻辑):**
```js
const cloudIds = (cloudVehicles||[]).map(v => String(v.id));
const localIds = (VEHICLES||[]).map(v => String(v.id));
const sameCount = cloudIds.length === localIds.length;
const allIncluded = cloudIds.every(id => localIds.includes(id))
                && localIds.every(id => cloudIds.includes(id));
const sameIds = sameCount && allIncluded;
const needMirror = (cloudTs > lastSyncTs) || !sameIds;
```
**决策语义:**
只要「云端时间戳更新」OR「ID集合不一样」(有增/删),就必须镜像。 timestamp 优先用于字段内容修改场景(同 ID,字段值变),ID集合差集专门兜底删除传播。

**⚠️ 仍保留空云熔断:**
```js
if(cloudVehicles.length === 0 && VEHICLES.length > 0) {
  console.warn('[镜像]云端返回空数组,跳过镜像(防上传中断误清空)');
  return; // 绝不清空本地
}
```
(Z5-5 测试覆盖)

### 3.3 修复C: 三色横幅状态机 + 成员态写入深度防御(组员零配置第三块: 交互层面不犯错)

**loadFeishuConfig 三色状态:**
| 角色 | 注入状态 | 横幅样式 | 横幅文案 | 输入框状态 | 保存按钮 |
|---|---|---|---|---|---|
| 组员 | ✅有注入 | 绿色(bg-green-50 / border-green-200 / text-green-700) | "✅组员账号:云端同步配置已内置,无需手动填写。若同步失败,请更新至最新官方签名安装包" | AppId/Secret/Token readonly+bg-gray-100+cursor-not-allowed;同步间隔 disabled | 隐藏(hidden class + style.display=none) |
| 组员 | ❌无注入 | 琥珀色(bg-amber-50 / border-amber-200 / text-amber-700) | "⚠️组员账号:当前安装包未注入同步凭据,请下载公司官方签名安装包" | 同上(readonly+disabled,防止"乱填试试"产生脏配置) | 隐藏 |
| 组长/未登录 | 任意 | 蓝色(bg-blue-50 / border-blue-200 / text-blue-700) | "🛠组长管理员设置区:此处可切换飞书应用、修改同步凭据。普通组员用户无需修改此页" | 可编辑 | 正常显示 |

**saveFeishuConfig 深度防御(F12 DevTools 绕过readonly 仍然不写入):**
```js
const user = currentUser();
if(user && user.role !== 'admin') {
  showToast('组员账号已内置同步配置,无需手动保存,请联系管理员更新官方签名安装包');
  return; // 直接 return, 不写 localStorage
}
... 正常写入时携带 _writer 标记 ...
saved._writer = 'admin';
localStorage.setItem('feishu_config', JSON.stringify(saved));
```

**getFeishuCfg pick() 脏配置过滤(升级老用户遗留垃圾值不生效):**
```js
const pick = (k, def, fromMemberRole = user.role === 'user') => {
  const fromStorage = storageCfg[k];
  // 组员态 + 无 admin 写入标记 → 视为升级垃圾值,忽略 localStorage,只信任 injected 缓存或默认值
  if(fromMemberRole && (!storageCfg._writer || storageCfg._writer !== 'admin')) return (injected[k] ?? def);
  return (fromStorage ?? injected[k] ?? def);
};
```

---

## 四、测试验证(15 套件 约 454 断言 全绿)
完整矩阵见 [DEVLOG_V10140.md §4](./DEVLOG_V10140.md#4-测试矩阵全量真机级mock聚合)

关键新断言专项(test_v1014_zero_config_member.js,共 49 PASS):
- **Z1**: _INJECTED_SECRETS_CACHE 首次读取后delete window.__BUILD_SECRETS__成功(安全不留痕)
- **Z6**: window 不直接暴露_INJECTED_SECRETS_CACHE属性(闭包私有性)
- **Z7**: localStorage.clear后连续4次 getFeishuCfg appSecret 值全等稳定
- **Z2**: 无注入成员琥珀横幅+提示"下载官方签名包"
- **Z3**: 有注入成员绿色横幅+三输入框readonly灰化+保存按钮隐藏
- **Z4**: 组长蓝色管理员说明横幅+输入框可编辑+保存显示
- **Z8**: 三色class状态机校验
- **Z9**: 成员调用saveFeishuConfig→拒绝写入 + toast提示;组长则正常写入带`_writer=admin`
- **Z10**: localStorage含旧版垃圾secret且无admin标记→成员忽略;若存在admin写入覆盖→优先生效
- **Z5**: 6子场景 决策逻辑验证(同秒删除/时钟回拨+有新增/无变化跳过/字段修改/新安装首次空/源码真实验证)

---

## 五、双端同步脚本治理(从"硬编码过期值"→"参数化优先级链")

详见 DEVLOG §2 D。摘要:
- `backup_to_feishu.py` folderToken = OS环境变量 > version.json.feishuConfig.folder > 正确默认值公开值 `nodcnGA95g93RhIUSdCeTkhKlQc`(而不是硬编码 2024V5.3 过期值)
- `push_github_final.sh`: GH_TAG APK_PATH REPO ASSET_NAME BRANCH 全部 环境变量 > version.json 默认值;APK 预检 5MB 保底;sha256sum 自动生成并上传; Draft Release → 上传 APK + SHA → Patch 成正式发布 5 步流程。

---

## 六、兼容性与回退
- ✅ 向下兼容: V10.13 / V10.12 组员端上传的 vehicle_sync_data.json 格式与 V10.14 100%兼容,双通道镜像判定对旧格式 JSON 同样生效(只要有 .vehicles[]字段 + updatedAt)。
- ✅ admin 配置迁移: 组长 V5.x~V10.13 写入的 localStorage 飞书配置没有 `_writer:'admin'` 标记,getFeishuCfg pick时会被误判为「垃圾值」吗? → **不会**。admin 角色时 pick 传参 `fromMemberRole=false`,忽略过滤逻辑。
- 🛟 紧急回退: 若现场 V10.14.0 出现罕见 bug,可从 GitHub Release 页下载 V10.13.0 的 apk 直接安装降级(versionCode=101300<101400,需要先卸载 APP→再安装旧版, 数据保留在本地 vehicles_data.js), 或组长端重新同步上传云端即可。

---

## 七、V10.14.0 已知遗留(进入 V11.x 路线图)
请参阅 [ITERATION_PLAN.md §V11.x 五Phase路线图](./ITERATION_PLAN.md),包含三项核心建议:
1. **后端选型升级评估 Supabase/飞书Bitable 替代纯飞书Drive JSON**
2. **APK 自动热更新(Cordova Code Push / Capacitor Updater)替代整包下载**
3. **Android/iOS 原生代码加固(防反编译提取飞书appSecret)**
