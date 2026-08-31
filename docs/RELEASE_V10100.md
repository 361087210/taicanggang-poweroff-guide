# V10.10.0 飞书大文件分片同步版 发布文档

| 项目 | 内容 |
|---|---|
| 版本 | 10.10.0(versionCode 101000) |
| 发布日期 | 2026-08-31 |
| 一句话总结 | 彻底修复新车型(含随机名称文字/图片/视频)经飞书同步组长组员数据失败,接入飞书官方分片上传突破20MB限制 |
| 关联文档 | `docs/ROOT_CAUSE_V10100.md`(根因) · `docs/SOLUTIONS_V10100.md`(方案对比) · `docs/TEST_REPORT_V10100.md`(测试报告) |

---

## 一、修复内容

### 1. 根因修复: 官方分片上传三件套(核心)

飞书 `upload_all` 接口单文件硬上限20MB,现场拍摄视频普遍10-50MB——超限视频上传必败(`1061043 file size beyond limit`),失败视频 base64 滞留 `videoPaths` → 同步JSON膨胀至数十MB → 整条上传管线中断 → 组员端永远拉不到新车型数据。

V10.10.0 接入飞书官方分片上传三件套(与 upload_all 同一权限域):

```
① upload_prepare  预上传 → 返回upload_id/block_size(固定4MB)/block_num
② upload_part     逐片上传 → multipart表单(upload_id/seq/size/checksum/file)
③ upload_finish   完成上传 → 返回file_token,云端落盘
```

**智能上传路由** `httpUploadFileSmart()` 统一全部上传入口:

- ≤16MB 走 `upload_all`(单次调用省配额);
- >16MB 走分片三件套(16MB阈值预留4MB安全余量,规避multipart表单头边界);
- `upload_all` 返回 `1061043` 时自动升级分片重试,双保险;
- 单文件上限500MB,超限明确拒绝而非推上云端。

### 2. 可靠性设计

| 机制 | 说明 |
|---|---|
| Adler-32分片校验和 | 官方支持,防弱网位翻转 |
| 每片3次重试+指数退避 | 500/网络抖动自动救回 |
| 1061045频控自动退避 | 贴官方5QPS限制飞行 |
| 1061021事务过期重传 | 自动重新prepare整段重传一次 |
| QPS门控 | 所有上传类调用串行且间隔≥220ms |

### 3. 随机名称防护

`_sanitizeFeishuFileName()` 统一清洗文件名: 控制字符删除、`\/:*?"<>|` 转下划线、emoji删除、连续下划线折叠、首尾 `._` 空白去除、超长截断至150字符且保扩展名、空名兜底时间戳名。智能上传入口统一调用(幂等,合法名原样通过),杜绝 `1061109` 合规拒绝。

### 4. 同步守卫与诊断

- **JSON体积预检**: 媒体分离后同步JSON应<1MB;若仍>16MB说明有base64媒体分离失败滞留,直接诊断性失败(携带残留项计数),避免把巨大JSON推上云端导致组员端下载超时(旧版静默上传的隐性故障链);
- **失败计数透传**: 管线返回 `photoFailed/videoFailed/pendingMedia`,不再吞掉部分失败;
- **cfg补齐syncSub**: `_syncUploadPipeline`/`doSyncDownload`/`checkCloudDataUpdate` 三处补齐,同步数据稳定落入"APP数据备份/同步数据"子目录,不再被迁移清理误删。

### 5. FeishuDataLayer(feishu-api.js)同构升级

`driveUploadFileMultipart()` 与 demo.html 主实现同构,修复双解包缺陷(`request()` 已解包返回 `data.data`,旧版误按完整响应检查 `prep.code` 恒为 undefined 导致分片上传必然抛"预上传失败: 无响应")。

## 二、继承能力

- V10.9.2: 分级列表修复+性能优化;
- V10.9.1: 组员端导入备份(离线兜底通道);
- V10.9.0: 视频分离上传+下载超时保护;
- V10.8.0: multipart正确序列化;
- V10.6.0: 照片分离上传+数据分仓。

## 三、测试与验证

- 主E2E真机模拟测试 **18/18 通过**(含21MB大视频组长→组员完整闭环、弱网重试、事务过期重传、随机名称压力、JSON体积守卫);
- 候选方案逐个真机模拟对比 **9/9 通过**(7套独立方案+1套组合+最优解闭环);
- 历史回归 **17/17 通过**,无功能退化;
- 详见 `docs/TEST_REPORT_V10100.md`。

## 四、变更文件清单

| 文件 | 变更 |
|---|---|
| `demo.html` | 分片上传模块/智能路由/文件名清洗/QPS门控/体积守卫/cfg补齐/版本号 |
| `feishu-api.js` | driveUploadFileMultipart 分片上传+双解包修复 |
| `config.xml` | version 10.10.0 / android-versionCode 101000 |
| `version.json` | 版本/发布说明/下载地址 |
| `tests/mock_feishu_server.js` | 新增: 飞书云空间API高保真模拟器 |
| `tests/e2e_harness.js` | 新增: 真机模拟沙箱(提取器+桩) |
| `tests/test_v1010_sync_e2e.js` | 新增: 18项主E2E测试 |
| `tests/test_v1010_solutions_comparison.js` | 新增: 方案逐个对比测试 |
| `docs/ROOT_CAUSE_V10100.md` | 新增: 根因分析报告 |
| `docs/SOLUTIONS_V10100.md` | 新增: 方案穷举对比 |
| `docs/TEST_REPORT_V10100.md` | 新增: 测试报告 |
| `CHANGELOG.md` | 追加 10.10.0 条目 |

## 五、升级指引

1. 组长端与组员端均需升级至 V10.10.0(APK: `version.json` downloadUrl);
2. 升级后首次同步: 组长端点击"上传同步",历史滞留的大视频将自动走分片通道补传;
3. 若历史数据中存在旧版残留的巨大同步JSON,组员端拉取时按下载超时保护提示重试即可;
4. 离线兜底通道(导入备份)保留,供无网络场景应急。
