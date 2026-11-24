# V10.27.8 发版同步韧性版

> 一句话：上传时遇到空响应 / 网关 5xx 不再让整个同步进程崩掉 —— 换成可重试的失败，重试 2 次。

## 怎么发现的

v10.27.7 发版时，Android 那条 `Sync Release to Feishu` 红了：

```
飞书认证成功 · 版本 v10.27.7
  目标: APP数据备份/发版产物/v10.27.7/
Traceback (most recent call last):
  File "scripts/sync_release_both_roots.py", line 38, in sync_to_root
    d = upload_file(token, ver_folder, path)
  File "scripts/sync_release_to_feishu.py", line 178, in upload_all_once
    return resp.json()
requests.exceptions.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
```

`Expecting value: line 1 column 1` 的意思是：**响应体是空的**。上传请求被网关中断了，
但代码直接 `.json()`，于是一次网络抖动 = 整个同步进程以异常退出。

同一次发布的另一条（iOS 触发）跑成功了，所以飞书目录最终是完整的 ——
可这次运气好，不代表下次也是。

## 改了什么

`scripts/sync_release_to_feishu.py`：

1. **`safe_json(resp, what)`**：把非 JSON 响应转成带 `http=` 与响应片段的普通异常。
   以后日志会直接说清是网关还是鉴权，而不是一句 `JSONDecodeError`
2. **单请求上传重试 2 次**：`upload_all_once`（≤16MB，APK 15.7MB 正好走这条）
   对空响应 / 5xx 重试，两次都失败才抛，并附最后一次原因
3. **`post_json()`**：`upload_prepare` / `upload_finish`（分片上传，IPA 17.8MB 走这条）
   也用同一套安全解析

## 影响面

- 失败语义更准：偶发一次抖动 → 自动重试（日志有 `[WARN] 第 N 次失败`），不再需要人工重跑
- 真故障不会被吞：两次都失败仍然抛异常、workflow 照旧红灯
- 飞书目录的最终状态不受影响（覆盖式上传，幂等）

## 验证

- 全量套件 **80/80** 通过（新增本版 1 套 20 断言）
- `check:version-consistency`：`version=10.27.8, versionCode=102708`
- 本版发版即实战：Android + iOS 两条 `Sync Release to Feishu` 串行执行（v10.27.7 加的
  concurrency 生效），目录保持每个版本 4 件、每件唯一
