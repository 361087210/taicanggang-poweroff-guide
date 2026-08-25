# V10.6.0 开发文档 — 文档真实化 + 数据闭环版

> 版本: 10.6.0 (versionCode 100600) | 基线: V10.5.0 | 状态: 已交付
> 定位: 修复导出文档不可用、跨网络申请干扰、备份语义错位、新增数据无法同步四大根因问题,
> 并在不破坏既有功能的前提下完成代码质量优化与全量回归。

---

## 一、问题根因分析与修复方案

### 问题1: Word文档无法打开 + PDF中文乱码 ★最高优先级

**现象**: 数据详情页/批量导出的 Word 无法打开,PDF 文字乱码。

**根因诊断**(双重独立根因):
1. **Word**: 旧版主链路 `html-docx-js` 产出的是 MHTML 伪 docx——桌面 Word 可容错解析,
   但手机端 WPS/Office 按 OOXML ZIP 规范解析直接报"文件已损坏";降级链 HTML Blob + `.doc`
   后缀在手机端同样无法识别。
2. **PDF**: jsPDF 内置 Helvetica/Times 字体不含 CJK 字形,中文全部渲染为乱码方块。

**修复方案**:
| 格式 | 新链路 | 原理 | 降级保底 |
|------|--------|------|---------|
| Word | `generateDocxOOXML()` 自研真 OOXML 生成器 | 标准 ZIP 包([Content_Types].xml/_rels/word/document.xml/styles.xml),复用既有 `_zipWrite`;中文按字体名引用微软雅黑(`w:hint="eastAsia"`),由打开端本地字体渲染,天然无乱码;照片 DrawingML 内嵌(EMU=px×9525) | htmlDocx MHTML → HTML Blob 预览 |
| PDF | `generatePDFCanvas()` DOM→html2canvas→A4图像分页→jsPDF | 中文经 DOM 渲染为像素图像注入 PDF,从原理上杜绝字形缺失;新增 `vendor/html2canvas.min.js` 本地化打包(离线可用) | `generatePDFLegacy()` 文本链路 |

**关键设计**: 抽取 `_buildExportHtml()` 统一导出模板——Word 降级链与 PDF 画布链同源同构,
内容一致性由构造保证。

### 问题2: 跨网络组员反复申请注册且显示在组长端

**现象**: 跨网络组员每更新一次重新申请注册,申请堆积在组长端。

**根因**: 跨网络端无本应用注册标识,每次更新以"新申请"身份落盘云端;组长端旧版仅做
静默审批计数,申请仍进入待审列表与通知。

**修复方案**(完全隐形三件套):
1. **即时激活**: 识别 `source!=='tcg-cordova'` 即赋 `status='active'+hidden=true+crossPlatform=true`;
2. **全UI过滤**: 组员列表、待审列表统一 `!u.hidden&&!u.crossPlatform` 过滤,通知/Toast/同步日志零触达,仅 `console` 留痕可审计;
3. **即消费即删**: 处理完立即 `deletePendingFileFromFeishu()` 删除云端申请文件,杜绝反复消费与目录堆积。

本端申请(`source='tcg-cordova'`)人工审批流程保持不变。

### 问题3: 本地备份误调起分享控件

**根因**: 旧版本地备份复用 `shareFile()`——该函数职责是"分享到第三方",必然调起系统分享面板,与"仅保存在本地对应文件夹"语义冲突。

**修复**: 新增 `saveBlobToLocalFolder()` 直存通道:
- Cordova 环境: 权限申请(`_ensureSavePermission`,Android 11+免申请)→目录解析(`_resolveSaveDestDir`,公共 Download/太仓港断电指导 优先,不可写降级 App 外部目录)→`FileWriter` 直写;
- 浏览器预览: `a[download]` 触发下载,语义等价;
- `doBackup()` local 分支改走直存通道,成功提示具体目录,失败明确报错。

### 问题4: 新增车型数据(含照片)无法同步飞书/组员拉不到 ★数据闭环

**根因诊断**(双重独立根因):
1. **内存态数据**: `VEHICLES` 是内嵌 const 内存数组,新增/编辑/删除从不落盘——重启即回退内置数据,组长新增数据下次打开即丢,自然"无法同步";组员拉取后同样只存内存。
2. **base64 直传膨胀**: 现场照片以 base64 存于 `photoPaths`,旧版整体 JSON 化上传——单张 2-5MB,两三张即膨胀 10MB+,飞书上传超时必败。

**修复方案**:
1. **IndexedDB 持久化层**(选 IndexedDB 而非 localStorage: 照片数据流可达数 MB,5MB 配额必爆):
   - 库 `tcg_poweroff` / 仓 `vehicles` / 键 `user_data`,全量快照覆盖写;
   - 四个变更钩子: 新增/编辑保存、删除、照片路径替换后、同步合并后(`totalChanges>0`);
   - 启动时序: `loadPersistedVehicles()` 先于渲染恢复快照(异步 IIFE 包裹,首启无快照毫秒级直通);
   - 可靠性: 读写失败仅 console 告警,绝不阻塞主流程。
2. **照片分离上传** `syncUploadVehiclePhotos()`:
   - 上传前扫描 `data:image/` 前缀照片→`_normalizePhotoForUpload` 降采样归一 JPEG(长边1280);
   - 单独上传至云端 `APP数据备份/vehicle_images` 目录;
   - 文件名幂等: `user_v{车辆id}_p{序号}_{内容djb2哈希}.jpeg`——云端同名即跳过,零冗余副本;
   - `photoPaths` 原位替换为 `vehicle_images/xxx.jpeg`(与内置数据同构),组员拉取走既有 `imgFromFeishuCloud` 展示链,照片自然可见;
   - 同步补齐 `size/brandId` 字段(旧版漏传致尺寸/品牌索引丢失)。

### 问题5: 飞书产物区同名旧档 + 真机冒烟

- 新增 `scripts/cleanup_feishu_duplicates.py`: 扫描产物区按名分组,每组保留最新(修改时间),
  默认 dry-run 预览,`--apply` 才真删;删除强制携带 `?type=file`(飞书接口静默失败陷阱)。
- 新增 `docs/SMOKE_TEST_V1060.md` 真机冒烟方案: 12 项验证矩阵,覆盖
  **分享 PDF 至微信确认可打开**、**Android 10 与 11+ 各验一次保存到下载目录**、
  Word 打开、数据闭环、跨端隐形等;关键项失败阻断发版。

---

## 二、代码质量优化清单

| 项 | 内容 | 收益 |
|----|------|------|
| 依赖本地化 | html2canvas 打包进 `vendor/`(6个离线库) | 中文PDF离线可用,零CDN依赖 |
| 模板复用 | `_buildExportHtml` 抽取,Word/PDF同源 | 消除双份内容构造漂移 |
| 函数职责单一化 | `saveBlobToLocalFolder` 与 `shareFile` 分离 | 保存/分享语义不再互相污染 |
| 幂等设计 | 照片哈希文件名+云端同名跳过;持久化覆盖写 | 重复操作零副作用零冗余流量 |
| 静默降级 | 持久化/照片上传失败仅告警不阻塞 | 单点故障不拖垮主流程 |
| 注释工程 | 每处修复带根因/方案/边界三段式注释 | 可审计可追溯 |

## 三、测试矩阵与结果

| 套件 | 覆盖 | 结果 |
|------|------|------|
| `tests/test_v106_fixes.js` | V10.6.0 六大问题专项(26静态+7运行时) | 33/33 ✅ |
| `tests/test_v105_fixes.js` | V10.5.0 分享链路+缓存保存 | 49/49 ✅ |
| `tests/test_v104_fixes.js` | V10.4.0 cordova桥接+播放标记+全屏 | 46/46 ✅ |
| `tests/test_v103_fixes.js` | V10.3.0 六大问题 | 62/62 ✅ |
| `tests/test_v57_logic.js` | 核心逻辑(导航/导出/混淆/分仓) | 30/30 ✅ |
| `tests/test_v53_runtime.js` | 运行时仿真 | 21/21 ✅ |
| `scripts/validate_web_assets.js` | 资产完整性 | ✅ |

**合计 241+ 项检查全部通过,零回归。**

运行时仿真亮点: `generateDocxOOXML` 在 jsdom 中真实产出 8KB 标准 ZIP(PK 魔数+正确
OOXML MIME);持久化层在无 IndexedDB 环境优雅降级验证。

## 四、发布流程(行业高标准)

1. **代码冻结** → 全量回归(上表)→ 资产校验
2. **提交规范**: 语义化 commit + tag `v10.6.0`
3. **CI 构建**: GitHub Actions 自动签名构建 APK(KEYSTORE_BASE64 解码→cordova build→jarsigner→zipalign)
4. **双端分发**: GitHub Release + 飞书产物区(`scripts/sync_feishu.py` 自动替换旧档)
5. **发版后**: 飞书同名旧档清理(dry-run→apply)+ 真机冒烟(`docs/SMOKE_TEST_V1060.md`)

## 五、已知边界与下版本跟进

- PDF 画布链路在极老 WebView(无 canvas)自动回退文本链路(中文仍可能乱码,属环境限制);
- 照片分离上传失败的照片保留本地 base64,下轮同步自动重试;
- 建议后续版本引入增量同步(当前全量快照,数据量增大后优化)。
