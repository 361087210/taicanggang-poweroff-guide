# Changelog

本文件记录太仓港商品车断电操作标准化指导平台的所有重要变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### V10.14.2 车辆详情页多视频支持 + iOS方案A(PWA网页应用)

#### ✨ 新功能:
- **车辆详情页多视频列表**: 详情页视频区域从单视频卡片改为多视频垂直列表展示,每个视频独立点击播放;区域标题多视频时显示"视频演示(N个)";卡片右上角显示序号标记;第一个视频标题为"断电教学视频",其余为"补充视频N"
- **播放器内视频切换**: 新增`_currentVideoIndex`索引追踪;`switchVideo(direction)`无缝切换上一个/下一个(循环),切换时清理当前视频状态后复用`openVideoPlayer`五源回退链重新加载;播放器顶部显示"视频 1/N"序号+导航按钮(单视频时隐藏)
- **上传回调回到当前索引**: `pickVideoFile`上传完成后`openVideoPlayer(_currentVideoIndex)`回到当前视频而非第一个;`pickVideoFile`文件名取`v.videoPaths[_currentVideoIndex]`而非硬编码`[0]`
- **iOS方案A PWA**: 新增`manifest.json`(应用名称/图标/全屏模式/竖屏/主题色) + `sw.js`(应用壳预缓存+静态资源缓存优先+API网络优先+离线导航降级) + `icon.svg`(512x512矢量图标);`demo.html`注入PWA meta标签(apple-mobile-web-app-capable/status-bar-style/touch-icon/theme-color)+Service Worker注册脚本;iOS Safari打开→添加到主屏幕→全屏图标体验接近原生APP,离线可用

#### 🚩 版本一致性升级 10.14.1 → 10.14.2(versionCode 101402):
- `js/00-bootstrap.js` APP_VERSION / `config.xml` version+versionCode / `version.json` version+versionCode+downloadUrl+releaseNotes / `demo.html` / `tests/test_v1014`+`tests/test_v1015` 版本断言 / `ios-release.yml` workflow_dispatch 默认版本号
- **V10.14.1代码未改动**: 仅版本号断言升级,同步配置出口统一等核心逻辑零变更

### V10.14.1 同步配置出口统一修复(组长组员数据无法同步·组员端"飞书配置不完整"误报根因闭环)

#### 🔴 根因与核心修复:
- **根因**: `js/05-sync.js` 中 `loadFeishuConfig`/`_syncUploadPipeline`/`doSyncDownload`/`checkCloudDataUpdate`/`exportSyncConfig` 五处直接 `JSON.parse(localStorage.getItem('feishu_config'))` 解析配置,绕过了 V10.14.0 建立的 `getFeishuCfg()` 统一出口——组员端本地从未保存过该键,`appSecret` 恒取 `DEFAULT_FEISHU_CONFIG` 空串 → `feishuCfgReady` 恒 false → ①三色横幅误报「未注入同步凭据」;②上传管线被"飞书配置不完整"门禁拦截(组长端依赖构建注入凭据、未在设置页手动保存时同样中招);③组员拉取云端数据被门禁拦截(本次"组长组员数据无法同步"主根因);④60秒轻量通知轮询形同虚设(红点永不亮);⑤导出的同步配置为空
- **修复(五处全部改走 `getFeishuCfg()` 统一出口)**: 优先消费构建期注入秘钥的闭包缓存 `_INJECTED_SECRETS_CACHE`(与 `syncPendingToFeishu` 等8处既有出口对齐),组员零配置场景仍返回完整可用配置;`syncSub/pendingSub/approvedSub/backupSub` 全部子目录字段随统一出口返回(V10.10.0 根因修复②语义保留)
- **安全语义保留**: Secret 输入框仅回显用户手动保存值(注入秘钥只在闭包内存供同步链路使用,不落DOM可读值);`interval` 为用户偏好保留回显;admin 显式保存(`_writer='admin'`)手动值仍优先覆盖注入值(覆盖语义不变)

#### ✅ 版本专项测试(红-绿-红三步验证):
- 新增 `tests/test_v1015_member_sync_gate.js` 专项 50 断言 11 场景(B1-B11: 组长/组员 × 注入/零本地/脏配置 × 上传/拉取/轮询/导出/安全守卫全矩阵);修复前 34 项失败复现 bug,修复后 50/50 通过,git stash 回退修复后测试重新失败(证明测试真实捕捉回归)
- **修复 `test:v107` B6 回归**: fixture 现代化——V10.14.0 起 `getFeishuCfg()` 对组员端只信任 admin 显式写入(或构建期注入)的配置,旧 fixture 无标记写入被安全忽略;补 `_writer:'admin'` 标记后轻量通知通道用例恢复通过(31/31)
- **修复 `test:cross` 真机跨网络 harness(既有缺陷,V10.12.0 秘钥剥离时遗留)**: `makePhone` 未模拟发版 APK 的构建期 `window.__BUILD_SECRETS__` 注入,加载干净源码时模拟手机内 `getFeishuCfg().appSecret` 恒空 → 注册申请/审批回推全部静默拦截(2.3 起 9 项连锁失败,基线复现确认与本次修复无关);harness 补注入后组员注册→云端落盘→组长拉取审批→新设备登录 16/16 全绿
- **修复 `test:logic` 维度4状态污染(既有缺陷)**: 1.4d 用例(设置 `TCG_FEISHU_APP_SECRET` 环境变量时)提前消费 `getFeishuCfg()` 致注入秘钥进入闭包缓存常驻,"默认未注入"三断言(4.1/4.2a/4.2c)失真;维度4前重置闭包缓存等价模拟全新页面加载,有/无环境变量两场景均通过(35/35、34/34)

#### 🚩 版本一致性升级 10.14.0 → 10.14.1(versionCode 101401):
- `js/00-bootstrap.js` APP_VERSION / `config.xml` version+versionCode / `version.json` version+versionCode+downloadUrl+releaseNotes(6条) / `demo.html` sync-local-ver 静态默认值 / `tests/test_v1014` 版本断言与sandbox stub / `package.json` 新增 test:v1015 并入 test:all / `ci.yml` 追加 V10.14.1 专项 step / `ios-release.yml` workflow_dispatch 默认版本号
- **全量回归 16 套件 0 FAIL**(带真实飞书凭据): V53运行时21 + V57逻辑35 + **V57跨网络真机16** + V103-V109 + V1010分片18 + V1011镜像6 + V1013复杂度68 + V1014零配置49 + **V1015出口统一50(新增)**

### iOS发版流水线基建修复(tag v10.14.0 触发后暴露的三处环境级缺陷, 不涉及APP业务代码)
- **修复1(macOS grep兼容)**: `ios-release.yml` 版本解析 `grep -oP`(GNU扩展)在 macOS BSD grep 下报 `invalid option -- P` 导致 APP_VERSION 空串; 改用 `sed -nE` BSD/GNU双兼容写法 + 空版本号显式阻断
- **修复2(Xcode版本随镜像演进)**: `XCODE_VERSION` 固定 `15.4` 已从 macos-latest 镜像移除(现仅 26.x), `setup-xcode` 报 `Could not find Xcode version`; 改用 `latest-stable` 随镜像演进不再过期
- **修复3(scheme误选框架库+产物路径漂移)**: Cordova 工程 scheme 列表含 `Cordova`/`CordovaLib`(框架库)与应用本体三项, 旧探测恒取首项导致仅构建框架(1 target)且产物落入 DerivedData, `Collect IPA` 找不到产物 exit 1; 升级为「config.xml `<name>` 精确匹配 + `^Cordova` 前缀排除」双保险探测, xcodebuild 追加 `-derivedDataPath build/dd` 固定产物路径, Collect IPA 三级回退搜索
- **修复4(插件源码与新SDK兼容)**: `cordova-plugin-advanced-http@3.3.1` 内置 AFNetworking 直接 `#import <netinet6/in6.h>`, 该头文件自 iOS 26.5 SDK 起为私有模块头, 编译报 `Use of private header from outside its module`; 构建步骤内在 cordova build(prepare 重拷源码)之后、xcodebuild 编译之前插入外科手术式补丁删除该冗余 import(`<netinet/in.h>` 已传递包含, 语义等价)
- 附带: workflow_dispatch 默认版本号 10.13.0 → 10.14.0

### 发版产物飞书双通道分发工具链(补齐"GitHub Release + 飞书云空间"双端产物同步能力)
- 新增 `scripts/sync_release_to_feishu.py`: 发版产物(APK/IPA/SHA256/发版说明)一键同步到飞书 `APP数据备份/发版产物/v{version}/`, 与 `push_github_final.sh` 构成双通道分发(组员可在飞书端直接下载官方签名安装包, 规避 GitHub 直链国内可达性问题); 版本号/folderToken 从 version.json 动态读取; 目录列举用 `GET /drive/v1/files?folder_token=` 查询参数形态(APP端生产验证); ≤16MB `upload_all`、>16MB 分片上传(upload_prepare/upload_part/upload_finish, 500MB上限); 220ms QPS门控 + 1061021事务过期整段重传 + 1061045频控退避(与APP端 feishu-api.js 完全对齐); 同名文件先删后传保证幂等; 终验重新列举目录全量核对
- **修复5(backup脚本列目录端点)**: `backup_to_feishu.py` `list_children` 原用 `GET /drive/v1/files/{token}/children` 路径形态, 该应用调用恒返回 404(脚本一旦运行即失败); 改为与APP端一致的查询参数形态并补 `has_more/page_token` 分页
- V10.14.0 五件产物(APK/APK.sha256/IPA/IPA.sha256/RELEASE_V10140.md)已实际同步至飞书并完成云端回下载 SHA256 端到端校验一致

## [10.14.0] - 2026-09-04

### 组员零配置同步修复版(组长-组员镜像数据一致性 + 双端同步脚本治理 + 签名构建基建补齐)

#### 🔴 核心修复(三大问题 闭环解决):
- **修复A(秘钥闭包永久化)**: 新增脚本作用域私有闭包 `_INJECTED_SECRETS_CACHE`；构建期注入的 `window.__BUILD_SECRETS__` 首次读取即浅克隆写入闭包缓存、立即 delete window 引用，后续所有调用直接返回闭包缓存；组员清localStorage、WebView杀进程/APP重启、OTA热更新 全路径下appSecret不再丢失(彻底解决组员「清缓存后必须找管理员抄配置」的高频运维工单)
- **修复B(镜像同步双通道决策)**: `doSyncDownload` 从单一 `cloudTs > lastSyncTs` 判新升级为 timestamp OR ID集合差集 双条件OR组合；覆盖「同秒上传+删除」「Android时区漂移/NTP时钟回拨」「新安装组员首次同步空ID集」3类真机盲区，保证删除传播100%；同时保留空云端熔断(云端=0台、本地>0台时跳过镜像，防组长上传中断误清空组员本地数据)
- **修复C(组员零配置横幅+深度防御写入过滤)**: `loadFeishuConfig` 三色横幅状态机——①成员+有注入→✅绿色横幅内置提示+三输入框readonly灰化disabled+同步间隔disabled+保存配置按钮隐藏；②成员+无注入→⚠️琥珀色警示横幅「请下载公司官方签名安装包」；③组长/未登录→🛠蓝色管理员说明横幅(可编辑)；`saveFeishuConfig` 成员态直接return+showToast拒绝,管理员写入强制携带 `_writer:'admin'` 写入标记；`getFeishuCfg pick()` 成员端忽略 localStorage 无admin标记的历史垃圾升级配置(只信任注入缓存/admin显式保存值)，杜绝V5.x→V10.x跨版本升级脏配置污染

#### 📚 文档与发版说明补齐:
- 新增 `docs/RELEASE_V10120.md`(8K级详细版:单向收敛+九模块拆分+Secret构建期注入+导航栈封装+嵌套深度降压+CSS抽取+XSS全量转义+NPM无npm自举+CI基建9维度完整交付说明+对应版本测试矩阵)
- 新增 `docs/RELEASE_V10130.md`(8K级详细版: A3四刀切/渲染业务分离/State守卫/XSS绊线 4大交付能力+68专项+变更文件清单)
- 新增 `docs/RELEASE_V10140.md`(本版本8K级详细交付说明)
- 新增 `docs/DEVLOG_V10140.md`(V10.14开发决策日志:5类问题根因分析表+修复对比矩阵+16文件修改级摘要+≈454断言全绿测试矩阵+5项遗留风险与缓解)
- 新增 `docs/ITERATION_PLAN.md` V11.x 五Phase路线图 + 三项核心建议(后端选型升级/APK热更新/原生加固)

#### 🔧 双端同步脚本过期值治理(从硬编码到参数化优先级链):
- `scripts/backup_to_feishu.py` 完全重写: folderToken = `OS环境变量FEISHU_FOLDER_TOKEN` > `version.json.feishuConfig.folder` > 正确公开默认值 `nodcnGA95g93RhIUSdCeTkhKlQc`(替换V5.3硬编码过期值 `WdXUfZPkClI1audQxIYc90XRnWc`)；自动从version.json读取版本号；飞书Drive目录与APP端对齐为6个子目录(同步数据/注册申请/审批结果/备份文件/vehicle_images/vehicle_videos,缺失则递归get_or_create创建)；新增凭据环境变量预检(缺 env 友好错误提示不抛 stack)
- `scripts/push_github_final.sh` 完全参数化: `GH_TAG APK_PATH REPO ASSET_NAME BRANCH` 全部 `环境变量 > version.json > 默认值` 优先级链；APK预检 5MB≤size≤120MB(太小直接阻断,太大warn 3s确认)；sha256sum自动生成(APK同目录.sha256)；GitHub发布五步：推送分支 → 删除旧tag下APK/SHA同名资产 → Auto Draft Release → 上传APK+SHA → PATCH Draft→正式发布(引用 docs/RELEASE_Vxxx.md 作为Release Body)

#### 🤖 行业标准构建/CI/签名基建补齐:
- 新增 `scripts/build_android.sh`: 环境自检(ANDROID_SDK/KEYSTORE/CORDOVA/NODE)→ cordova clean/prepare(触发Secret注入hook) → build release → zipalign 4字节对齐 → apksigner v1+v2+v3 三模签名 → apksigner verify 自校验 → SHA-256 生成 → release/ 产物清单；缺keystore时自动回退输出unsigned APK(兼容CI首跑)；版本号从version.json动态读取,无需手改脚本
- 新增 `scripts/build_ios.sh`: TEAM_ID / Automatic / Manual 签名三态；TEAM_ID缺失仅 cordova prepare 停止(工程检查形态)；xcodebuild archive → ExportOptions.plist 生成 → xcodebuild -exportArchive；IPA/SHA/xcarchive(.dSYM符号) 统一到 release/；三种签名路径注释占位：本地自动签名/GitHub Actions证书base64注入秘钥链/Fastlane match+gym+pilot企业推荐
- `.github/workflows/android-release.yml` 现有内联签名流程后追加「Generate APK SHA-256 Checksum」step；Upload artifact/Create Release files 均数组化同时上传 `APK + .apk.sha256`；新增 body_path 注释引用 RELEASE_Vxx.md(取消注释即可直接拼 Release Note 详情)
- `.github/workflows/ci.yml` 追加 V10.14 专项 step(npm run test:v1014)；上传校验摘要新增 版本号/V10.14 通过失败统计 两行输出
- **🚑CI阻断解除(发版流水线修复)**: `scripts/gen_media_mapping.js` `loadVehicles()` 由单点 `indexOf('const VEHICLES=')` 升级为正则双格式兼容 `/(?:const\s+VEHICLES\s*=|window\.VEHICLES\s*=)/`——`sync_feishu_local.js` 云端同步重写 `vehicles_data.js` 后声明格式变为 `window.VEHICLES = [`,旧解析直接抛「未找到声明」导致 main 与发版分支 CI「映射表一致性校验」连续失败(2026-09-01起3次)；修复后映射表 73 条记录再生成并校验通过,记录本身无漂移(仅解析崩溃)
- **📚4文档成套**: 新增 `docs/ROOT_CAUSE_V10140.md`(4根因证据链) + `docs/SOLUTIONS_V10140.md`(4问题×5方案选型矩阵) + `docs/TEST_REPORT_V10140.md`(454断言矩阵+基建验证+CR结论) + 更新 `docs/RELEASE_V10140.md`(交付清单/发版流程§8)

#### ✅ Clean Code 代码审查:
- **空Catch治理**: 合计补充 17 处关键路径 空catch日志——同步关键路径10处(05-sync.js)区分 console.debug(预期失败/新旧位置回退)/console.warn(API异常/列表失败)；localStorage配额满(00-bootstrap.js)；震动设备不支持(06-media.js)；OTA 三个版本源 回退失败(07-cache.js)。全部禁止裸 `catch(e){}` 或纯注释
- **复杂业务JSDoc**: `doSyncDownload` 追加完整JSDoc，解释 timestamp+ID差集双通道 决策必要性来源于 3 类真机盲区+空云端熔断
- **长函数检查**: `doSyncDownload` 实际 91 行(<150阈值)，无需拆分

#### ✅ 版本专项测试:
- 新增 `tests/test_v1014_zero_config_member.js` 真机级 Mock 10 场景 49 断言(Z1闭包注入/Z6闭包私有性/Z7清缓存幂等/Z2琥珀横幅/Z3绿色横幅+readonly/Z4蓝色管理员横幅/Z8三色class状态机/Z9成员save深度防御+组长admin写入/Z10历史脏配置覆盖防御/Z5镜像决策6子场景)
- 基建兼容修复:`tests/e2e_harness.js DEMO_BLOCKS` 首项追加 `_INJECTED_SECRETS_CACHE`(V10.14新引入声明必须前置于getFeishuCfg注入,否则旧V1011/v1013基于harness的测试崩溃)；`tests/test_v1013_a3.js` G组版本一致性从硬编码10.13.0改为三端全等动态断言；`tests/test_v104_fixes.js` A28同步屏版本与demo.html静态默认值从v10.13.0→v10.14.0
- **全量回归≈454断言 0 FAIL**：V53运行时21 + V57逻辑34 + V103六大62 + V104十维46 + V105批量49 + V106导出33 + V107防抖31 + V108回退20 + V109视频17 + V1010分片18 + V1011镜像6 + V1013复杂度68 + V1014零配置49 = 合计454断言/0失败。test:cross需真实飞书Secret跳过(预期)

#### 🚩 版本四处一致性(appId/versionCode):
- `js/00-bootstrap.js` APP_VERSION 常量 = 10.14.0
- `config.xml` version/versionCode = 10.14.0 / 101400
- `version.json` version/versionCode/downloadUrl(→V10.14.0 release URL) + releaseNotes[] 推8项V10.14.0详细条目 + 修复 releaseNotes 数组中JSON语法错误(缺失逗号/截断)
- `demo.html` 同步屏本地版本静态默认 id=sync-local-ver → v10.14.0(运行时仍会被JS重写为常量APP_VERSION,静态模板默认值仅用于jsdom测试A28)

## [10.13.0] - 2026-09-01

### 复杂度治理版(方案A Phase A3)

- **四刀切(A3-1)**: `pullPendingFromFeishu` 165行单函数 → `fetchPendingFromCloud`(①网络IO) / `applyApprovalRules`(②审批规则) / `writePendingsToStorage`(③持久化) / `refreshMemberUI`(④渲染+通知) 四个单一职责函数，主流程为编排薄壳；失败自愈路径(缓存失效重试)同步收敛到同一编排，消除主/自愈双份内联逻辑
- **渲染/业务分离(A3-2)**: `renderVehicleList` 拆出 `filterVehicles`(纯数据过滤,无DOM/state依赖,可独立单测) 与 `renderVehicleCards`(纯DOM拼装,输入已过滤list,输出html字符串)；平铺/树形两种视图的过滤与渲染职责彻底解耦
- **状态守卫(A3-3)**: 新增 `State` 门面 API — `vehicles/users` 只读副本(外部改动不污染内部数组)、`addVehicle/updateVehicle/removeVehicle/pushVehicle/replaceVehicles/addUser/removeUser` 受控写入口(含必填兜底/拼音/持久化收敛)；`promoteToLeader()` 直接抛错，杜绝前端提权(用户角色只能由组长审批或云端同步产生)；`saveVehicle/confirmDeleteVehicle/02-auth注册/07-cache成员增删` 等写入点全部收敛到 State
- **XSS绊线(A3-4)**: 开发模式(非Cordova)安装 `innerHTML` 注入绊线 — 拦截 `<script` 标签注入与 `javascript:` 伪协议两类明确风险片段，默认 `console.warn` 留痕不阻断(兼容117处内联事件合法形态)，`window.__XSS_GUARD_STRICT__=true` 严格模式直接抛错阻断(供测试与安全审计)；生产APK零开销零行为差异
- **版本对齐(A3-5)**: `version.json`(10.13.0/101300)、`config.xml`(version+android-versionCode)、`APP_VERSION` 三处同步
- **测试(A3-6)**: 新增 `tests/test_v1013_a3.js` 专项(静态结构/State守卫行为/渲染分离纯函数性/审批规则四刀切/XSS绊线/版本一致性)；`package.json` 新增 `test:v1013`，`test:all` 扩展至 V53~V1013；CI 新增 V10.13 step
- **测试基建收口(修复A2/A3遗留)**: `e2e_harness.js` 新增共享 `inlineDeferScripts`(js/*.js defer内联回原时序)与 `inlineStylesheets`(css/app.css内联回原文)，修复 V53运行时/V103~V109/V57跨网络 9个旧测试读不到拆分后源码的问题(V53曾整体崩溃"VEHICLES is not defined")；`DEMO_BLOCKS` 补注入 `State`(修复A3后 doSyncDownload 走State API导致 V1010/V1011 E2E 镜像同步全挂)；`demo.html` 同步屏本地版本号静态兜底 v10.11.0→v10.13.0；V106 A11/A18/A23、V103 A17、V109 A2 断言更新为A3等价形态；V108 A16 与 V1010 E1 版本断言从硬编码改为三端动态一致(发版免改测试)。全量回归 V53/V57logic/V57cross/V103~V109/V1010/V1011/V1013 全绿(0失败)

## [10.12.0] - 2026-09-01

### 渐进式重构版(方案A)

- **单向收敛(核心 A1-1)**: 飞书上传双轨 → 单例化统一。旧版 `demo.html` (含220ms QPS门控+1061021事务过期二次prepare重传+Cordova http.ponyfills双栈+1061109文件名清洗) 与 `feishu-api.js`(仅fetch且无可靠性特性) 长期功能漂移，本次把 demo 完整实现下沉到 `FeishuAPI.driveUploadFile/driveUploadFileMultipart`，新增 `FeishuAPI.httpUploadFile(params)/httpUploadFileMultipart(params)` 与 demo 同签名兼容入口，demo 内 189 行大实现改为 2 行薄壳委托，从架构上杜绝后续双真源回归
- **导航栈封装(q4 §七-4)**: `navHistory` 11 处散点直操作 → `navPush/navPop/navReset/navRemove/navTop` 五个封装函数，集中内置登录族不入栈、连续重复去重(防御性)、栈深度上限 20、特定页面残留移除，彻底根治 goBack 多层连跳/返回编辑页错乱
- **XSS 用户字段全转义(q3 §七-3)**: `renderVehicleCard`/`renderVehicleList`(含 recent-section+分级列表 brandMap/seriesMap)/`_renderVehicleDetail`(车辆详情所有模板)/`openEditVehicle`(编辑页表单 value/textarea) 等用户可见关键 innerHTML 路径，全部对 `v.display/v.powerType/v.position/v.size/v.brand/v.series/v.config/s.name/s.en/s.note/s.step/s.keyFrame/s.keyContainer/u.name 等` 包裹 `esc()` 5 字符转义
- **降低嵌套深度(q2 §七-2)**: `fetchFeishuPhotoDataURL` 原 5 层 if 箭形嵌套 + Cordova/Promise 回调共 8 层，抽出 `_feishuDownloadBlob(token,fileToken,mimeType)`(12行 Cordova/fetch 双栈下载) 与 `_feishuLocatePhotoFile(token,dataFolder,fileName)`(dataFiles→imgFolder→target 三级卫语句)，重写为 2 层卫语句 + try/catch 单 if，最大嵌套 ≤ 4 层
- **测试 & CI 补齐(q1 §七-1)**: `package.json` 新增 `test:v106`~`test:v1011` 脚本(含 v1010 solutions+sync 双组合)，`test:all` 扩展为 V53~V1011 全量；`.github/workflows/ci.yml` 在 V105 step 后追加 V106~V1011 六个 step
- **不变量保证(方案A核心原则)**: 全局 241 个函数名保留、117 处 onclick 零改动、`showScreen/goBack/doLogin/hashPassword/esc/saveUsers/...` 全部签名兼容，可回滚
- **A1-2 ✓ Secret 构建时注入(防反编译还原硬编码)**：从 demo.html 移除唯一真密文 `_FS_XOR_KEY + _fsDec(hex_cipher)` + `DEFAULT_FEISHU_CONFIG.appSecret` 声明；重写 `getFeishuCfg()` 优先级 `window.__BUILD_SECRETS__`(读后立即 delete，用完即焚) → localStorage 用户保存值 → 回退公开 DEFAULT(仅 appId/folder，version.json 已公开这对非机密)。新增 `scripts/inject_build_secrets.js`(模式 `--check`/写入 `</head>` 前幂等重入/`--strip` 清理) + Cordova 钩子 `hooks/before_build/01_inject_secrets.js`(失败直接 abort 构建)。CI：`ci.yml` 新增 "Secret注入基线校验" step(Fork PR 无 Secret → `FEISHU_STRICT=0` 降级不阻断)；`android-release.yml` Verify assets 后新增 "Inject Feishu build secrets" step(严格模式缺 env 直接失败，防发空 Secret 版本)。校验端：`validate_web_assets.js` 升级为新 3 态合规(注入脚本存在+getFeishuCfg引用&delete__BUILD_SECRETS__+DEFAULT字面量无appSecret声明行 → 通过)；`test_v57_logic.js` 旧"解码32位"断言升级为四条正向安全基线(1.4无硬编码/1.4b_fsDec不存在/1.4c getFeishuCfg双语句存在/1.4d 若提供env则注入归并优先级验证)；`e2e_harness.js` DEMO_BLOCKS 移除已不存在的 `_FS_XOR_KEY/_fsDec`
- **A2-1 ✓ CSS 抽取解耦**：demo.html L34-L245 内联 211 行 CSS 完整提取至 `css/app.css`；demo.html 内联替换为 `<link rel="stylesheet" href="css/app.css">`；`android-release.yml` Prepare build environment step 新增 `cp -r css tcg_app/www/css`(保证 APK 内含 css 目录生效)
- **A2-2/A2-3 ✓ 主 Script 九模块连续拆分 + demo.html 骨架化**：主 script 6570 行(L603-L7172)按依赖拓扑切为 9 个 defer 模块(边界零 gap/零 overlap，全量代码覆盖)— 00-bootstrap.js(拼音+品牌车辆数据+用户密码工具+飞书Cfg/HTTP/上传三兄弟/缓存索引+APP_VERSION/esc, 1200行) → 01-state.js(state对象/navHistory五层封装/路由常量+_activateScreen/showScreen/goBack, 144行) → 02-auth.js(注册审批登录找回, 177行) → 03-vehicles.js(品牌渲染/搜索筛选/车辆列表详情编辑保存/分享, 806行) → 04-export.js(Excel+zip压缩/Word OOXML/PDF canvas+legacy/批量折叠导出, 1201行) → 05-sync.js(审批轮询/成员守护/备份/JSON上传下载/doSyncUpload+Download/导入导出配置/同步日志, 1522行) → 06-media.js(图片查看/视频播放器/飞书云端图片视频/户外模式/模态框与硬件反馈, 724行) → 07-cache.js(缓存管理器/组员增删改/密码变更/校验工具/showToast/通知/版本更新与APK下载, 633行) → 08-main.js(Android backbutton/migrateLegacyMedia/deviceready入口/顶层side-effects, 163行)。demo.html 移除 <script> 6570 行内联大代码，紧接现有 `<script src="feishu-api.js">`（同步加载，保证 FeishuAPI 先于 defer 就绪）后顺序写入 9 行 `<script defer src="js/0x-xxx.js"></script>`。不变量：241 个全局函数名/签名 100% 保留、117 处 onclick 裸调用零改动、所有声明为顶层 function(自然挂 window，不包 IIFE 闭包)
- **A2-4 ✓ 测试基建 A2 兼容**：`tests/e2e_harness.js` 新增 `loadCombinedSource()`(demo.html 源码 + js/*.js 排序后拼接 → 统一注入 extractNamedBlock 沙箱)；`tests/test_v57_logic.js` 新增 `inlineDeferScripts()`(检测到 <script defer src=js/> → 内联回 <script> 并移至 `</body>` 前还原原始执行时序；内联内容做 HTML-tokenizer 净化：字面 `</script`/`<!--` 替换为 JS 语义等价的 `<\/script`/`<\!--`，防注释说明文字截断脚本块)；维度4 旧断言升级为 V10.12 基线(4.1 默认配置非Secret字段全备+无硬编码Secret；4.2a 默认未注入→feishuCfgReady=false 安全拦截；4.2b 模拟构建注入→立即就绪；4.2c 注入Secret用完即焚)；`scripts/validate_web_assets.js` 新增 `loadDemoPlusJs()` → 关键能力标记/Secret合规形态 3 态判断 统一扫 demo+js；`tests/test_v1010_sync_e2e.js` E1 版本断言升级为扫描 demo.html + js/* 组合字符串(APP_VERSION 常量现落在 00-bootstrap.js)
- **A2-5 ✓ 本地无 npm 环境引导工具**：开发机仅有裸 node.exe(无 npm/corepack/python)，新增 `scripts/bootstrap_npm.js`(Node 内置 https+zlib+最小 ustar/pax/GNU长名 tar 解包器，从 npmmirror/npmjs 下载官方 npm tarball 自解包到 `scripts/.npm-vendor/`)，使本地可运行 `node scripts\.npm-vendor\npm\bin\npm-cli.js install jsdom`；jsdom 已装至根 node_modules(V57 34/34 全绿验证)；`.npm-vendor/.npm-scratch/node_modules` 均不入库(gitignore)且凭证扫描排除

## [10.11.0] - 2026-08-31

### 镜像同步版(删除传播修复)

- **修复(根因)**: 组长删除车型后组员端不同步删除 — 旧版 `doSyncDownload()` 拉取合并只做**正向差集**(云端新增追加/同ID覆盖),**反向差集**(云端已删除的车型)永久滞留组员本地,导致两端车型数量越差越大;历史遗留证据: 旧版 `localIds` 声明后从未使用,即"删除同步从未实现"
- **镜像对齐**: 云端为唯一真源,拉取后本地与云端**完全对齐** — 新增/更新/删除全量传播,组长组员车型数量严格一致(`本地 = 云端` 镜像语义)
- **删除传播核心**: 本地存在但云端已无的ID → 移除;`VEHICLES` 数组**原地替换**(`length=0` + `push`),持久化与渲染闭包持有的引用不失效
- **防误清空**: 云端车辆数为0但本地有数据时视为异常,拒绝镜像同步,保护组员本地数据不被空数据覆盖
- **同步提示**: 完成通知升级为「新增N条 更新N条 删除N条」,删改明细一目了然;云端无更新时显示「数据已是最新」并跳过镜像,避免误删组员本地导入的备份数据
- **测试**: 镜像同步专项6用例(删除传播/增删改混合/幂等性/空云端防御/删除计数提示/多轮压力) + V10.10.0历史回归18用例,全部通过(0失败)

## [10.10.0] - 2026-08-31

### 飞书大文件分片同步版

- **修复(根因①)**: 新车型(含随机名称文字/图片/视频)经飞书同步组长组员数据失败 — 飞书 `upload_all` 接口单文件硬上限20MB,现场视频10-50MB必败(`1061043 file size beyond limit`),失败视频 base64 滞留 `videoPaths` → 同步JSON膨胀至数十MB → 整条管线中断 → 组员端永远拉不到新数据;接入飞书官方分片上传三件套(`upload_prepare`/`upload_part`/`upload_finish`),4MB定长分片+Adler-32校验,支持500MB大视频
- **新增**: 智能上传路由 `httpUploadFileSmart()` — ≤16MB走upload_all,>16MB走分片,`1061043`自动升级分片重试双保险
- **可靠性**: 每片3次重试+指数退避;`1061045`频控自动退避;`1061021`事务过期自动重新prepare整段重传;QPS门控串行220ms间隔(贴官方5QPS限制)
- **修复(根因②)**: 随机名称防护 — `_sanitizeFeishuFileName()` 清洗控制字符/非法符/emoji/超长名,杜绝 `1061109` 合规拒绝
- **修复(根因③)**: `_syncUploadPipeline`/`doSyncDownload`/`checkCloudDataUpdate` 三处 cfg 补齐 `syncSub`,同步数据稳定落入"同步数据"子目录,不再被迁移清理误删
- **守卫**: 同步JSON体积预检,残留base64媒体诊断性失败而非静默上传;管线返回媒体失败计数(`photoFailed`/`videoFailed`/`pendingMedia`)不再吞掉部分失败
- **修复(feishu-api.js)**: `driveUploadFileMultipart` 双解包缺陷 — `request()` 已解包返回,旧版误按完整响应检查 `prep.code` 导致分片上传必然抛"预上传失败: 无响应"
- **测试**: 真机模拟E2E 18用例 + 方案逐个对比9用例 + 历史回归17用例,全部通过(0失败);新增高保真飞书Mock服务器与真机模拟沙箱测试基建
- **文档**: `docs/ROOT_CAUSE_V10100.md` 根因报告 / `docs/SOLUTIONS_V10100.md` 7+2套方案穷举对比 / `docs/TEST_REPORT_V10100.md` 测试报告 / `docs/RELEASE_V10100.md` 发布文档

## [10.9.2] - 2026-08-27

### 分级列表修复 + 性能优化版

- **修复(问题1)**: 车型页分级列表不显示新增车型 — 自定义品牌(brandId 不在 BRANDS 中)的车辆在分级视图中无处归属直接"消失";修复方案:分级列表新增「其他品牌」分组收纳自定义品牌车辆,品牌标签栏新增「其他(N)」筛选入口,编辑车辆改品牌后 `brandId` 同步更新(此前编辑只改 `brand` 名称不改分组 ID)
- **性能优化**: 品牌标签栏从 O(n×m) 嵌套 filter 改为一次遍历统计;分级列表从多次 filter 改为 `brandId+series` 两级 Map 预分组;搜索输入增加 150ms 防抖,避免每次按键全量重绘 DOM

## [10.9.1] - 2026-08-27

### 组员端导入备份功能版

- **新增(问题3)**: 组员端数据同步页增加「导入备份 — 从本地恢复」功能 — 选择 `cloud_sync_config.json` 备份文件 → 智能合并(同 ID 覆盖/新增追加) → 二次确认 → 持久化到本地;支持三种格式兼容:标准 `sync_config_backup`/旧版 `vehicle_poweroff_backup`/裸车辆数组
- **权限设计**: 组长/组员均可使用导入备份 — 导入为本地数据恢复操作,不涉及上云,因此组员端(只读角色)也开放;上传至飞书仍仅限组长
- **安全防护**: 文件大小限制(50MB)+格式校验(JSON parse)+二次确认弹窗+导入结果统计(新增/覆盖数)+同步日志记录

## [10.9.0] - 2026-08-26

### 视频分离上传 + UI适配修复版

- **修复(问题1根因)**: 组员端收到通知但拉取数据失败 — V10.6.0 仅分离了照片 base64,视频仍以 `data:video/;base64,` 留在 `videoPaths`,单段视频 base64 编码后常达 10-50MB,JSON 膨胀至数十 MB 导致飞书下载接口超时/`JSON.parse` 在移动端 WebView 内存受限下 OOM 崩溃;V10.9.0 实现 `syncUploadVehicleVideos()` 函数,上传前把 `data:video` base64 分离 → 转 Blob → 单独上传至云端 `APP数据备份/vehicle_videos` 目录 → `videoPaths` 原位替换为云端相对路径(与内置数据同构) → JSON 只含轻量路径;幂等设计:文件名 = 车辆 id + 序号 + 内容哈希,重复上传命中云端同名文件即跳过
- **修复(问题1健壮性)**: 所有飞书文件下载路径(主同步数据/注册申请/自愈分支)增加超时保护 — 原生 HTTP 路径增加 `timeout` 参数(60-120 秒),`fetch` 路径增加 `AbortController`(60-120 秒),防止弱网下永久挂起;下载失败提供清晰超时提示而非模糊错误
- **修复(问题2-1)**: 数据页顶端标题和返回按键显示不全 — CSS 覆写将 `pt-12` 的 `padding-top` 从 48px 降到 `safe-top+12px`,Android WebView 的 `safe-area-inset-top` 恒为 0 导致仅 12px(不够);修正为 `safe-top+48px`
- **修复(问题2-2)**: 数据同步下方按钮显示不完整 — CSS 覆写将 `pb-24` 的 `padding-bottom` 从 96px 降到 `safe-bottom+24px`,Android 上仅 24px < 底部导航 64px;修正为 `safe-bottom+96px`
- **修复(问题2-3)**: 云端数据同步中心从右往左滑动有大片留白 — `.scroll-y` 仅有 `overflow-y:auto` 缺少 `overflow-x:hidden`,部分 Android WebView(含红米 K70 Pro Android 16)将 `overflow-x:visible` 解析为 `auto`;增加 `overflow-x:hidden`
- **测试**: V10.9.0 全链路同步管线测试 32 用例(0 失败) — 覆盖视频分离上传逻辑/JSON 体积缩减/下载超时保护/全链路同步流程/边界条件/CSS UI 适配/数据完整性/端到端同步模拟
- **文档**: `docs/RELEASE_V1090.md` 完整开发文档

## [10.8.0] - 2026-08-26

### 云同步根治 + 注册审核回退版

- **修复(问题1根因)**: 云同步失败 `{"code":1061002,"msg":"params error."}` — `cordova-plugin-advanced-http` 的 `uploadFile()` 将飞书必填参数(file_name/parent_type/parent_node/size)序列化为 URL 查询串,而飞书 `upload_all` API 要求这些参数作为 `multipart/form-data` 体中的表单字段;V10.8.0 改用 `sendRequest()` + `serializer:'multipart'` + `FormData`,所有参数(含文件 Blob)由插件 multipart 序列化器通过 `FormData.entries()` 遍历,完整构造符合飞书 API 要求的 multipart 体;优先使用插件 ponyfill `FormData` 兼容老旧 WebView;移除 `writeBlobToCache` 临时文件依赖(Blob 直传)
- **修复(问题2)**: 注册审核回退至 V10.6.0 策略 — 本端申请恢复 `pending` 态等待组长人工审批;移除 `autoApproveLegacyPendingUsers` 历史迁移函数(空操作);注册文案恢复"请等待组长审核";仅保留跨网络组员自动通过 + hidden 隐形 + 即消费即删(V10.6.0 策略不变)
- **继承 V10.7.0**: 保存即自动同步(8 秒防抖 + 未上云媒体检测)、组员端菜单权限收紧(canEdit 裁剪)、全界面自适应(viewport-fit=cover + 100dvh + 六维断点)
- **继承 V10.6.0**: 真实 Word/PDF 导出(OOXML + 画布中文)、跨网络申请隐形通过、IndexedDB 持久化、照片分离上传
- **测试**: V10.8.0 专项测试 20 用例 + 全量回归 241 用例(0 失败)
- **文档**: `docs/RELEASE_V1080.md` 完整开发文档

## [5.8.0] - 2026-08-24

### 导出分享方案对齐（基准：安装包 V1.8 React/Capacitor 版）

逆向安装包 `assets/public` 导出/分享链路（分享函数 `Us(blob, filename, title?)` + Excel/CSV/JSON 生成函数），车辆详情与数据中心两处导出全面对齐：

- **单车 Excel 四工作表**：车辆信息（项目/内容两列，缺失字段"未填写"兜底）/ 断电步骤（序号/说明/注意事项）/ 媒体资源（图片逐行、视频逐条）/ 备注；列宽规格与安装包一致（16/60、10/60/40、12/80、80）
- **批量 Excel 汇总+详情**：汇总表（标题/导出时间/记录总数 + 11 列标准表头）+ 前 10 辆"项目/内容"详情子表，子表名取显示名前 20 字符、空兜底"未命名"
- **CSV 规范**：11 列标准表头（含钥匙-框架/钥匙-集装箱/步骤数）+ UTF-8 BOM + CRLF 行尾 + `text/csv;charset=utf-8`，Windows Excel 直接双击打开不乱码
- **JSON 元信息结构**：批量导出为 `{appVersion, backupAt, vehicles, users}`（非裸数组），接收方可识别来源与时间
- **文件命名对齐**：单车 `{显示名}_断电指南.{docx|pdf|xlsx}`；批量 `vehicle_poweroff_export_{ts}.csv` / `vehicle_poweroff_export_{n}_{ts}.{xlsx|pdf}` / `车辆断电指南_批量_{n}_{ts}.docx`；备份 `vehicle_poweroff_backup_{ts}.json`；配置 `cloud_sync_config.json`（固定名，两端互认）
- **分享标题策略**：原生分享面板 `dialogTitle:"选择保存或分享方式"`，标题缺省回退为文件名（对齐安装包 `title:n||t`）；仅批量 JSON 显式传"车辆断电数据导出"

### 新增

- 数据中心"分享备份"一键通道：全量数据 JSON 经系统分享面板直接发微信/钉钉，组员换机/无公网场景免飞书
- 全部导出按钮 Loading 互斥保护 + 导出中禁用防重复提交；导出成功自动清空选择集（对齐安装包行为）
- 导出分享对齐测试套件 53 项（`tests/test_v58_export_align.js`：静态 26 + jsdom 运行时 27），覆盖 Excel 工作表结构/CSV 编码/JSON 载荷/文件命名/Loading 互斥/空 catch 治理

### 修复

- 单车 Excel 媒体资源表视频由合并单行改为逐条一行（对齐安装包结构）
- 空兜底文案统一：媒体"无"、步骤"暂无步骤"、备注"无"

## [5.7.0] - 2026-08-23

### 修复（四大问题根治）

- **文档分享**：CI 构建此前遗漏 `vendor/` 导出库与 `vehicle_images/` 车辆图片，导致 APK 内 Word/PDF/Excel 生成失效；现已完整打包，恢复 V5.3 级别的文档分享体验
- **返回键逻辑**：编辑保存后不再退回编辑表单；登录页返回键正确触发双击退出；登出/注册后返回键不再退回已登录界面；弹层/查看器打开时返回键逐层关闭
- **飞书备份与更新**：内置默认凭证（混淆存储）开箱即用；数据分仓：同步数据/注册申请/审批结果/备份文件各自独立子文件夹，与项目交付产物彻底分离
- **跨网络注册审批**：组员申请秒传云端；组长 60 秒轮询、切回 APP 即拉取；审批结果云端秒同步；组员新设备登录自动发现云端账号

### 新增

- 文档导出照片预取 20 秒超时保护：云端照片不可达时导出无图文档而非卡死
- 文件 token 缓存失效自动重试自愈（换飞书应用/云端文件夹重建场景）

### 工程化

- CI 签名构建全链路修复：`KEYSTORE_BASE64` 自动解码签名（V5.4 以来构建失败根因）、Manifest merger 冲突根治、FileProvider `file_paths.xml` 补齐、zipalign 改用 SDK build-tools 全路径、`contents:write` 权限声明（Create Release 403）
- `cordova-plugin-dialogs` 固定 2.0.2（3.0.0 构建崩溃）
- `x-socialsharing` 6.0.7 → 6.0.4（npm 不存在 6.0.7 导致构建崩溃）
- 移除 `qrscanner` 插件（AGP8 不兼容），patch 脚本增加防御性 gradle 清洗
- 校验脚本支持 V5.7 `_fsDec` 混淆 Secret 合规形态

### 安全

- 默认飞书 App Secret 以 `_fsDec` 混淆存储（V5.7 开箱即用、非明文合规），仍可在设置页覆盖

## [5.6.0] - 2026-08-23

- 升级版本号至 V5.6（内部迭代基线）
- 更新 README 版本标注

## [5.4.0] - 2026-08-23

### 安全加固

- **密码哈希化**：所有本地密码改为 SHA-256 + 随机盐值（`salt$hash` 格式）存储
- **自动迁移**：启动时幂等升级明文旧密码为哈希格式；首次登录自动升级，零用户感知
- **云端去密码**：上传飞书的 `approved_users.json` / `pending_reg_*.json` 均不含密码字段
- **凭证清理**：从 `demo.html` / `feishu-api.js` 移除硬编码凭证

## [5.3.6] - 2026-08-22

- FeishuDataLayer 统一封装层；车型/用户数据双向同步（Bitable）
- 全量备份与恢复（云文档 JSON 快照，保留最近 10 个）
- 审批流完整化（创建/查询/状态同步）
- 应用内直装更新（file-opener2）；Android 13+ 通知权限适配
- 组长审批提醒升级为状态栏通知；`config.xml` content src 修正
- CI 双流水线（校验 + Release 构建）上线

## [5.3.5] - 2026-08-22

- 教学视频 GitHub Release 直链秒开（buildNumber=7）
- 飞书产物区双端同步落地：REST 直连修复 unsafe file path

## [5.3.1] - 2026-08-21

- 飞书 App Secret 从默认配置移除，代码库零明文凭证
- 签名 keystore/APK 移出 git 跟踪；构建脚本密码环境变量化
- CI 凭证泄露扫描关卡上线

## [5.3.0] - 2026-08-20

- 数据分仓：项目产物与用户数据物理隔离
- 原生 HTTP 通道（advanced-http）修复真机飞书 CORS 静默失败
- 文件分享三级策略；MIME 自动修正
- 旧照片数据自动迁移（`images/` → `vehicle_images/`）
- 视频四源回退链 + 组长上传通道（≤20MB → 飞书云端）
- Android 硬件返回键六级路由
- 离线化：Tailwind/SheetJS/jsPDF/html-docx 全部本地化进 APK

## [4.0.0] - 2026-06-15

- 账号系统与角色权限（组长/组员）

[5.8.0]: https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/v5.8
[5.7.0]: https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/v5.7
[5.6.0]: https://github.com/361087210/taicanggang-poweroff-guide
[5.4.0]: https://github.com/361087210/taicanggang-poweroff-guide
[5.3.6]: https://github.com/361087210/taicanggang-poweroff-guide
[5.3.5]: https://github.com/361087210/taicanggang-poweroff-guide
[5.3.1]: https://github.com/361087210/taicanggang-poweroff-guide
[5.3.0]: https://github.com/361087210/taicanggang-poweroff-guide
[4.0.0]: https://github.com/361087210/taicanggang-poweroff-guide
