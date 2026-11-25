# V10.28.0 资源库硬删除版

> 一句话：资源库「移出资源库」拆成软删除（回收站，可恢复）与硬删除（彻底删除）两个平级选项；
> 硬删除只写一条飞书队列，由新增的每 15 分钟工作流把 COS、飞书云盘、GitHub 三处一起清掉，
> 再重建索引把队列状态写回 done。

## 为什么做这一版

- 上一版（10.27.9）给删除加了回收站，解决的是「误删能不能救回来」；
  但「确实不要了、请把云端也清掉」这条路仍然没有 —— 只能先软删，再等人工去三处手动删。
- 照片/视频同时存在 GitHub（仓库照片 + Release 视频资产）、飞书云盘、COS 三处，
  手工清理必然漏，漏了就是长期占空间且索引对不上。
- 客户端不能持有 COS 与 GitHub 的写权限，删除动作必须移到 CI 执行。

## 改了什么

### 1. 两个平级选项，硬删除需二次确认

- 预览与云端条目的按钮统一为「移出资源库」，点开是软删除 / 硬删除两个同级按钮，不设默认值。
- 硬删除弹出二次确认，文案明确「不可恢复」。
- 两种删除都会在回收站留下审计记录：软删除为 `soft`，硬删除为 `hard_delete` + `purged`。

### 2. 清理队列：离线也不会丢删除意图

- 硬删除在本地立刻隐藏资产，同时把待清理项写入 `tcg_media_delete_queue`，
  并合并上传到飞书 `APP数据备份/media_delete_queue.json`。
- 合并规则：按路径幂等；下载→并集→上传；状态优先级 `done > error > pending`；
  同一路径再次硬删除会重置为 `pending`。
- 离线或首次上传失败时，下次进入资源库会自动补交（3 秒防抖，仅组长可写）。

### 3. 后台消费：COS / 飞书 / GitHub 一起清

`scripts/process_media_delete_queue.py` 对每条路径依次：

1. COS 删除（照片 key = 相对路径；视频 key = `media-library/baseline/<Release 资产名>`，404 视为已删除）
2. 飞书云盘删除（`APP数据备份/<vehicle_images|vehicle_videos>/<车型目录>/<文件>`）
3. GitHub：照片 `git rm`；视频删除 `media-videos` Release 资产并清掉直链映射
4. 重建 `media_library.json` 与 `mapping/manifest`
5. 回写队列状态 `done/error`，App 下次拉取即可看到进度

`.github/workflows/media-hard-delete.yml`：每 15 分钟定时 + 手动触发，`concurrency` 串行执行，
有变化才提交回仓库。

### 4. 安全边界

- COS 与 GitHub 写权限只存在于 CI Secrets，客户端只有飞书凭据。
- 脚本路径白名单限定 `vehicle_images/` 与 `vehicle_videos/`，越界直接拒绝。
- 队列回写前会重新下载一次，按路径只更新状态，不覆盖 App 期间新排的请求。

### 5. 运维自检（本版新增）

- `--probe`：对 `_probe/verify-<时间戳>.txt` 做 PUT → HEAD → DELETE → HEAD，
  删除后必须 404 才算通过 —— 证明「删除真的生效」，而不是「对象本来就不存在」。
- `--enqueue PATH`：把路径写进与 App 相同的队列，用于运维补删或链路验证。
- 两者都通过工作流的 `workflow_dispatch` 开关触发，密钥不落本地。

## 升级与兼容

- 无破坏性改动：软删除语义与 10.27.9 一致（只写回收站与墓碑，云端文件保留）。
- 新增仓库 Secrets：`TCG_COS_SECRET_ID` / `TCG_COS_SECRET_KEY`；
  缺失时任务会明确报错并把条目录留在队列里等下轮重试，不会静默丢删除请求。

## 已验证

- 真实硬删 `vehicle_images/_未归类/image28.jpeg`（孤儿图，0 引用）：
  GitHub 照片被删除并自动提交 `chore(media): 硬删除资源并从 COS/飞书/GitHub 同步清理`，
  索引孤儿数 16 → 15，队列回写 `done`。
- COS 全链路探针通过：`PUT 200 → HEAD 200 → DELETE 204 → HEAD 404`。
- 已知边界：COS 桶内目前没有任何照片对象（探针期间抽查 40 张全部 404），
  因此照片的 COS 删除目前走 404 幂等；视频 46/49 已在桶内。补齐照片镜像到 COS 属于后续独立议题。

## 测试

- 新增 `test:v10284-media-hard-delete`（51 断言）：队列合并与幂等、硬删除落地顺序与二次确认、
  UI 软/硬选项、工作流与脚本接线、COS 签名稳定、路径白名单、软删除不退化、轻量 DOM 桩真跑。
