# 太仓港停电指南 APP 迭代计划

## 已交付 V10.6.0（当前）

### 六大问题收口（详见 docs/RELEASE_V1060.md）
- [x] 问题1: Word真OOXML生成器(ZIP标准包)+html2canvas中文PDF画布链路——文档真实可打开,中文零乱码
- [x] 问题2: 跨网络组员申请完全隐形(即时激活+全UI过滤+即消费即删+仅console留痕)
- [x] 问题3: 本地备份直存通道saveBlobToLocalFolder——不再调起分享控件
- [x] 问题4: IndexedDB全量快照持久化+照片分离上传(哈希幂等)——新增数据真实同步飞书,组员可拉取
- [x] 问题5: 飞书同名旧档清理脚本(dry-run安全)+真机冒烟验证方案(12项矩阵)
- [x] 问题6: 版本10.6.0三处一致+241项全量回归零失败

## 已交付 V10.5.0

### 分享真实化+缓存留存
- [x] 分享链路反转: Cordova原生插件优先(文件落盘→file://→Intent.ACTION_SEND真实附件)
- [x] canShare({files})硬校验,杜绝文本-only盲调降级
- [x] 缓存视频/文档「保存到本地」: 公共Download目录+全版本权限适配
- [x] 死代码清理: modal-share静态占位面板移除

## 历史版本

### 已交付 V5.7

### 四大问题根治
- [x] 文档分享：vendor 导出库与车辆图片完整打包进 APK
- [x] 返回键逻辑：编辑保存/登录/登出/弹层六级路由修正
- [x] 飞书备份分仓：同步数据/注册申请/审批结果/备份文件独立子文件夹
- [x] 跨网络注册审批：组员秒传云端 + 组长轮询 + 审批结果云端秒同步
- [x] 导出照片预取 20 秒超时保护；文件 token 缓存失效自动重试自愈

### CI 签名构建根治（V5.4 以来全链路修复）
- [x] `KEYSTORE_BASE64` 自动解码签名
- [x] Manifest merger 冲突根治 / FileProvider 资源补齐 / zipalign 全路径
- [x] 插件版本锁定（dialogs 2.0.2、x-socialsharing 6.0.4）、移除 qrscanner
- [x] `contents:write` 权限声明（Create Release 403 修复）

## 已交付 V5.3.6

### 核心改进
- [x] FeishuDataLayer 统一封装层
- [x] 车型/用户数据双向同步（Bitable）
- [x] 全量备份与恢复（云文档 JSON 快照）
- [x] 审批流完整化（创建/查询/状态同步）
- [x] 应用内直装更新（file-opener2）
- [x] Android 13+ 通知权限适配
- [x] 组长审批提醒升级为状态栏通知
- [x] config.xml content src 修正
- [x] 存储权限 maxSdkVersion 放宽

## 规划 V5.8（短期，见 docs/V5.8迭代计划.html）

### P0（2026-09 中旬）
- [ ] 数据同步冲突解决：rev 修订号 + 三方合并（两阶段提交）
- [ ] 注册审批推送实时化：飞书事件订阅替代 60 秒轮询（保留轮询降级）
- [ ] Secret 服务端化：云函数代理，APP 仅持设备码

### P1
- [ ] 飞书原生审批流对接（模板/状态机/通知）
- [ ] 工程化：demo.html 拆分模块化构建（Vite/TS）
- [ ] 存储层升级：localStorage → SQLite
- [ ] APK 加固与 SSL Pinning

### P2
- [ ] 崩溃与行为可观测性（错误上报飞书多维表格）
- [ ] 视频离线包与预加载策略
- [ ] 深色模式与适老化
