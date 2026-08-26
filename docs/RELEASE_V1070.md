# V10.7.0 开发文档 — 自动同步 + 全屏适配版

> 版本: 10.7.0 (versionCode 100700) | 基线: V10.6.0 | 状态: 已交付
> 定位: 注册审批全自动默认通过、飞书同步崩溃根治 + 保存即自动上云并通知组员、
> 组员端菜单权限收紧、全界面自适应近 10 年主流手机屏四大需求交付,
> 并在不破坏既有功能的前提下完成管线重构、代码质量优化与全量回归。

---

## 一、问题根因分析与修复方案

### 问题1: 待审核注册列表默认通过且不显示跨网络组员账号的申请

**现象**: 新组员注册后长期停留在"审核中",需组长手动点"通过"才能登录;
跨网络申请虽 V10.6.0 已隐形,但与本端申请的审批策略不一致。

**根因**: 本端申请(`source='tcg-cordova'`)沿用 V5.x 人工审批流——
`status='pending'` 落盘后等待组长进入组员管理页手动通过;组长不操作组员就永远卡住。

**修复方案**(默认通过策略,`pullPendingFromFeishu()` 内三分支):

| 申请类型 | 判定 | 策略 | 组长感知 |
|---------|------|------|---------|
| 本端新用户 | 无既有记录 | `status='active'` 直接激活入列 | Toast + 推送知会(无需操作) |
| 本端pending存量 | `status==='pending'` | 自动转 `active` | 同上 |
| 本端已拒绝 | `status==='rejected'` | **不自动复活**(人工拒绝优先级最高) | console 留痕 |
| 跨网络 | `source!=='tcg-cordova'` | 保持 V10.6.0 完全隐形三件套 | 完全零感知 |

配套机制:
- **即消费即删**: 两类申请处理完立即 `deletePendingFileFromFeishu()` 删除云端申请文件,
  杜绝 60 秒轮询反复消费与目录堆积;
- **回推云端**: 自动通过后 `_debouncePushApprovedUsers()`(5 秒去抖)回推
  `approved_users.json`,组员端注册守望轮询(≤60 秒)即可看到激活状态,闭环不依赖手动审批;
- **兜底保留**: `approveMember()/rejectMember()` 手动通道保留——遇恶意注册组长仍可先删后拒,
  拒绝后的新申请不再自动通过。

### 问题2: 同步失败 "advanced-http: missing mandatory 'onSuccess' callback function"

**现象**: 应用端数据同步到飞书必失败,报 advanced-http 回调缺失。

**根因诊断**(插件源码级,`public-interface.js`):
cordova-plugin-advanced-http 3.x 的 `uploadFile` 真实签名为
`uploadFile(url, params, headers, filePath, name, success, failure)` 七个扁平参数。
旧版按"options 对象"风格调用 `http.uploadFile(url, options, done, fail)`,
导致 `done` 落位到 `headers` 参数、`fail` 落位到 `filePath` 参数,
success/failure 两位实参为 `undefined`——插件内部 `handleMissingCallbacks` 直接抛出
`missing mandatory "onSuccess" callback function`。注册申请/照片/视频/备份全部上传通道被斩断。

**修复方案**(`httpUploadFile()` 重写):
```javascript
http.uploadFile(
  'https://open.feishu.cn/open-apis/drive/v1/files/upload_all',   // url
  {file_name, parent_type:'explorer', parent_node, size},          // params→查询串(飞书官方支持)
  {Authorization:'Bearer '+token},                                 // headers→鉴权头
  fileUrl,                                                         // filePath→本地缓存文件
  'file',                                                          // name→multipart字段名(飞书约定)
  done,                                                            // success回调
  fail                                                             // failure回调
);
```
- `params` 由插件序列化为 URL 查询串,飞书 `upload_all` 官方即支持查询串传参;
- 原生调用整体包裹 `try/catch`,插件参数校验同步抛错也走 `reject`,不静默吞掉;
- 浏览器/回退路径维持 fetch+FormData。

**新增机制: 保存即自动同步闭环**(需求原文"检测到应用端新数据上传...上传成功后飞书同步通知组员账号更新数据"):

```
保存车型(saveVehicle)
  └→ scheduleAutoSyncAfterSave()          8秒防抖合并连续保存;组员/未配置飞书静默跳过
       └→ _runAutoSyncAfterSave()         detectPendingLocalMedia()检出未上云base64媒体才执行
            └→ _syncUploadPipeline()      单一事实源管线(手动上传按钮共用,零分叉):
                 ①取token ②照片降采样→vehicle_images分离上传→路径原位替换
                 ③本地持久化对齐 ④车型JSON上传(同步数据/) ⑤历史旧档迁移清理
                 ⑥data_update_notice.json落云 ⑦本地同步水位更新
                      └→ 组员端 checkCloudDataUpdate() 60秒轻轮询:
                           优先读data_update_notice.json(数百字节)→时间戳>本地水位→亮红点
                           通知文件不存在(老版本组长数据)→自动回退全量JSON比对,兼容完整
```

- `detectPendingLocalMedia()`: 扫描全部车辆 `photoPaths/videoPaths` 中 `data:image://data:video:`
  前缀项,纯文字编辑不惊动云端;
- `_autoSyncBusy` 互斥防管线重入;失败明确 toast 且数据保留本地,下次保存/手动上传自动重试。

### 问题3: 组员应用端车型页面右上角菜单隐藏组员管理入口

**根因**: 车型页右上角按钮打开的侧边菜单(`modal-side-menu`)中组员管理项**无 id 无权限控制**,
组员可见可点(「我的」页入口 V10.3 已有 `canEdit()` 控制,此路径遗漏)。

**修复**:
- 侧边菜单项挂 `id="side-menu-members"`;
- `openSideMenu()` 打开时 `smm.style.display=canEdit()?'flex':'none'` 按角色裁剪,
  组员仅见 数据中心/数据同步/个人中心/退出登录 四项;
- 与「我的」页 `menu-members` 入口权限策略完全一致,双入口同构。

### 问题4: 全界面自适应近 10 年主流手机屏幕

**目标设备带**(2016-2026): 320×568(iPhone SE/小屏 Android) ~ 480×960(折叠屏外屏/平板手机)。

**实现策略**: 基线布局 + 六维断点微调,不动 DOM 结构零回归风险。

| 维度 | 机制 | 覆盖机型 |
|------|------|---------|
| 安全区(刘海/挖孔/手势条) | `viewport-fit=cover` + 四向 `--safe-*` CSS变量(`env(safe-area-inset-*)`) | 全面屏全系 |
| 动态视口 | `height:100vh;height:100dvh`(带回退) | 浏览器工具栏伸缩 |
| 小屏 ≤360px | 压缩间距/字号,触控区仍 ≥44px | 2016-2019 入门机/SE |
| 大屏 ≥412px | 弹层限宽 400px 防稀疏 | Pro Max/折叠屏外屏 |
| 矮屏 ≤620px | 顶栏压缩+隐藏"最近查看" | 横屏/小尺寸机 |
| 超长屏 ≥850px | 底部导航上浮呼吸感 | 21:9 带鱼屏 |
| 横屏 | 左右安全区内收(`--safe-left/right`) | 刘海横置 |
| 老 WebView | `-webkit-text-size-adjust:100%` 禁字体自动膨胀 + `min-height:0` flex 收缩修复 | 低端机 WebView |

**设备分级识别**(呼应"应用识别到手机和屏幕信息后"): 启动时按
`small(≤360)/standard(361-411)/large(≥412)+tall(≥850)` 给根节点打 `data-devclass` 标记,
供 CSS 钩子与真机诊断;「我的」页设备信息卡(屏幕尺寸/像素密度/平台/型号)已有,同源增强。
附带修复: 登录页版本号由静态写死 `V5.1·2026-08-20` 改为动态渲染 `APP_VERSION`。

---

## 二、代码质量优化

| 优化项 | 动机 | 收益 |
|--------|------|------|
| 同步管线重构为 `_syncUploadPipeline()` 单一事实源 | 手动上传与自动同步需同构,复制粘贴产生两份漂移风险 | 七步管线一处维护,手动/自动零分叉 |
| `checkCloudDataUpdate()` 轻量通知优先 | 组员 60 秒轮询每次下载数 MB 全量 JSON | 通知命中即返回,流量/时间双省;回退兼容老版本数据 |
| 版本断言测试化(动态三端一致) | 每次发版要手改历版测试的版本号 | 发版免改测试,漂移即红灯 |
| `setAttribute` 防御性检查 | 极简 DOM 桩环境无该方法导致 v53 运行时测试崩溃 | 单测环境零脆弱性 |
| 静态版本占位符同步(`sync-local-ver`/`login-ver`) | JS 渲染前短暂显示陈旧版本号误导用户 | 首帧即正确版本 |

---

## 三、仿真测试(272 项全通过)

| 套件 | 用例数 | 覆盖 |
|------|--------|------|
| test_v53_runtime.js | 21 | 基线运行时回归 |
| test_v57_logic.js | 30 | 跨网络逻辑回归 |
| test_v103_fixes.js | 62 | V10.3 六问题回归 |
| test_v104_fixes.js | 46 | V10.4 回归(含本版策略演进断言更新) |
| test_v105_fixes.js | 49 | V10.5 回归 |
| test_v106_fixes.js | 33 | V10.6 回归(管线重构后断言升级) |
| **test_v107_fixes.js(新增)** | **31** | **本版四大问题: A1-A24 静态 + B1-B6 运行时** |

V10.7.0 专项运行时验证( jsdom 真实加载 demo.html 执行):
- B1 `openSideMenu` 角色裁剪: 组长 flex / 组员 none 实测通过;
- B2 `detectPendingLocalMedia`: base64 照片/视频各计 1,云端路径不计;
- B3 调度防抖: 组员被 canEdit() 拦截零定时器,组长 8 秒防抖不立即执行;
- B4 `httpUploadFile` 原生调用 7 实参类型序列 `string,object,object,string,string,function,function`
  mock 捕获验证 + success 回调 JSON 解析闭环;
- B5 无待上云媒体时 `_runAutoSyncAfterSave` 静默返回零云端动作;
- B6 通知命中亮红点且**跳过全量 JSON 下载**(轻量通道实证)。

测试基建加固: localStorage 值 mock(修复 file:// opaque origin SecurityError)、
30 秒看门狗防异步用例挂起静默假通过。

---

## 四、交付物与发布流程

| 产物 | 位置 |
|------|------|
| 应用主体 | `demo.html`(V10.7.0) |
| Cordova 配置 | `config.xml`(versionCode 100700) |
| 版本清单 | `version.json`(下载链接指向 v10.7.0 Release) |
| 专项测试 | `tests/test_v107_fixes.js` |
| 发布文档 | `docs/RELEASE_V1070.md`(本文档) |

**发布流程**(行业高标准,延续 V10.5+ 既定链路):
1. 全量回归(7 套件 272 项)本地绿;
2. 提交推送 main;
3. 打标签 `v10.7.0` 触发 `android-release.yml`: 版本号从 config.xml 派生 →
   Cordova 构建 → vendor/vehicle_images 完整性防御校验 → keystore 解码 →
   zipalign + apksigner v1+v2 签名 → GitHub Release 附 APK 产物 →
   version.json 下载链接自动回写;
4. 真机冒烟: 详见"五、真机验证清单"。

## 五、真机验证清单(发版后执行)

1. **注册默认通过**: 新设备注册 → ≤60 秒自动可登录(无需组长操作),组长端仅收知会通知;
2. **同步根治**: 组长新增含现场拍照车型 → 保存 → 8 秒后自动同步飞书成功(无 onSuccess 报错);
3. **组员感知**: 组员端 ≤60 秒出现"有新数据"红点,拉取后可见新车型与照片;
4. **菜单权限**: 组员登录 → 车型页右上角菜单无"组员管理"项;组长可见;
5. **屏幕适配**: 小屏机(≤360px)/全面屏(刘海)/大屏机(≥412px)各一台,
   顶栏不被状态栏遮挡、底栏不被手势条遮挡、列表可滚动到底;
6. **横屏**: 旋转后内容不被刘海遮挡,布局不溢出。

---

## 六、兼容性与回滚

- **数据兼容**: 云端 `vehicle_sync_data.json`/`approved_users.json` 格式未变;
  `data_update_notice.json` 为新增产物,老版本组长端不写、组员端读不到自动回退全量比对——
  新老版本组长/组员可任意混搭;
- **行为变更**: 本端注册申请不再等待人工审批(需求指定);若需恢复人工审批,
  回滚 `pullPendingFromFeishu()` 中 `status='active'` 两处为 `'pending'` 即可;
- **回滚路径**: APK 回滚安装低版本即回退(本地 IndexedDB 快照向后兼容);
  云端通知文件残留无害,下一轮上传自动覆盖。
