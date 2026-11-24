# V10.27.6 Pages 部署可靠性版

> 一句话：把"Pages 部署有时候抽风"从**人肉重跑**变成**代码里自动处理** ——
> 部署前等工件元数据可见，首次失败自动重试一次。

## 为什么发这一版

发 v10.27.5 时 Pages 连续 **4 次**部署失败，日志里这两行放在一起看很矛盾：

```
Artifact github-pages has been successfully uploaded! Final size is 15501736 bytes.
Found 0 artifact(s)
##[error]No artifacts named "github-pages" were found for this workflow run.
```

上传明确成功（工件 ID 14916635144、字节数、finalize 都在），两秒后 `deploy-pages`
去列工件却是 0 条。事后用 REST API 查**同一个 run**：

```bash
curl -s .../actions/runs/<run_id>/artifacts?name=github-pages
# total_count: 1
```

工件在。所以这是**工件元数据的秒级可见性延迟**，而 `actions/deploy-pages`
只查一次就报错退出。之前 10:55 那次部署成功，只是因为查询恰好落在可见之后。

这种情况最耗人的地方在于：它看起来像发布失败（红灯），实际站点内容没有任何问题；
每次都要人工判断"这是竞态还是真故障"，再手动 dispatch 一遍。

## 改了什么

`.github/workflows/deploy-pages.yml`：

1. **部署前等待**：新增「等待工件元数据可见」步骤（`sleep 15`），把竞态窗口让过去
2. **首次失败不中断**：`Deploy to GitHub Pages` 加 `continue-on-error: true`
3. **自动重试一次**：`if: steps.deployment.outcome != 'success'` 的独立步骤
   （首次失败发生在"查工件元数据"这一步，尚未创建部署，重试是安全的）
4. **地址兜底**：`environment.url` 优先取重试输出，回落到首次输出

只有"等待 + 重试"都失败才算红 —— 那时确实该人工看了。

## 影响面

- **零业务改动**：站点内容与 10.27.5 完全相同（`_publish` 白名单、产物都没变）
- 单次部署耗时 +15 秒（等待），仅在需要时才多跑一次部署
- `docs/RUNBOOK.md` 补充了这条症状：以后看到 `No artifacts named`，
  先看是不是"上传 success + 部署 failure"，两者同时出现就是已自动处理过的竞态，
  连续两次全红才当故障排查

## 验证

- 全量套件 **78/78** 通过（新增本版 1 套 19 断言）
- `check:version-consistency`：`version=10.27.6, versionCode=102706`
- 本版自身就是验证：tag 推送后由新的部署流程完成发布，线上 `version.json` 应变为 10.27.6

## 发布物

- APK：`tcg_poweroff_v10.27.6.apk`（+ sha256）
- IPA：`tcg_poweroff_v10.27.6_ios.ipa`
- 飞书：`发版产物/v10.27.6/`
