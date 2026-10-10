# 飞书云盘资源重建说明（本地离线资产）

> 来源：飞书云盘项目资源 → 重建为仓库内本地文件，使应用可离线/本地优先加载。
> 关联计划：`C:\Users\36108\.workbuddy\plans\toasty-cascade-turing-nndTcNSc.md`

## 1. 资源来源（飞书开放平台 API）
- 鉴权：`POST /open-apis/auth/v3/app_access_token/internal` 换 `tenant_access_token`（APP_ID / APP_SECRET 仅存于本机脚本常量，未入库）。
- 列目录：`GET /open-apis/drive/explorer/v2/folder/{folderToken}/children`（分页）。
- 下载：`GET /open-apis/drive/v1/files/{fileToken}/download`（流式 1MB 分块，3 次重试，幂等跳过已存在文件）。

### 文件夹 Token
| 用途 | folderToken |
| --- | --- |
| 车型图片 vehicle_images | `Wehwf8utKlvy22dkRsdcxGJUnSs` |
| 车型视频 vehicle_videos | `B9dffqFLrlfw6ldmJuEc0cXBnOb` |
| 发布包 release（历史版本） | `KqfnfaZQmlB7Ixd1F3Jcu1u1n9d` 等 |

## 2. 重建方式
- **图片**：直接下载，按云盘原名落盘到 `vehicle_images/`。
- **视频**：云盘以分卷 `.part001`–`.part012` 存储；按 base 名分组、数字后缀升序流式拼接为 `.mp4`，并校验 `ftyp` 头（`head[4:8]==b"ftyp"`）。合并后无孤儿 `.part` 残留。
- **大二进制策略**：`vehicle_videos/`、`release/**/*.apk`、`release/**/*.ipa` 已写入 `.gitignore`，仅本地离线使用，不入库；图片体积小，入库。

## 3. 当前落地结果（已对账）
- `vehicle_images/`：**199 张**有效 JPEG/PNG（云盘 201 条目中 2 个为同名重复项，唯一名 199 = 本地 199，0 缺失）。
- `vehicle_videos/`：**24 个 .mp4**（3 独立 + 21 组分卷合并），约 2.74 GB，0 孤儿 `.part`，0 坏头。
- `release/`：历史发布包（最新 v10.19.3 / v10.17.1 含 apk/ipa/sha256/version.json + v5.7/v5.8 apk + V4.0），按 .gitignore 排除二进制。
- `docs/vehicle_media_mapping.json`：73 车型、178 照片引用、64 视频引用；照片引用本地缺失 0。

## 4. 验证标准（已通过）
- 本地 `python -m http.server` 起服务：`vehicle_images/*.jpeg` → `200 image/jpeg`；`vehicle_videos/*.mp4` → `200 video/mp4`；缺失资源 → `404`。
- 视频 `ftyp` 头校验全部通过。

## 5. 同步脚本
`scripts/sync_feishu_assets.py`（argparse）：
- `--phase images|videos|apks|docs|manifest`：分阶段增量同步。
- `--force`：强制覆盖已存在文件。
- `--top N`：仅处理前 N 条（调试用）。
- `scripts/feishu_assets_manifest.json`：由 `--phase manifest` 生成（云盘文件名 + token 映射）。

重跑：`python scripts/sync_feishu_assets.py --phase images` 等。

## 6. 待办 / 风险提示
- **飞书 App Secret 已从脚本移除**：现由环境变量 `FEISHU_APP_SECRET` 注入（`scripts/sync_feishu_assets.py` 不再含明文）。但 `origin/main` 历史（`docs/DEVELOPMENT.md`、`tests/test_v536_feishu_sync.js`）仍含明文，**必须去飞书开放平台重置该 appSecret**——仅靠改本地无法消除已泄露的远程历史。
- **本地资源优先回退（待确认）**：当前 `demo.html`/`feishu-api.js` 运行时经飞书云 API 拉取媒体。建议在媒体解析处增加「先试 `./vehicle_images|vehicle_videos/<name>`，失败再回退飞书云」逻辑，使离线/弱网可用。该改动涉及活跃 PWA 代码，需你确认后再落地。
- 视频/发布包为本地资产，换机或 CI 需重新 `python scripts/sync_feishu_assets.py --phase videos --force` 重建。
