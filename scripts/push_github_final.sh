#!/bin/bash
# V5.3 GitHub端一键同步(版本号不变,内容更新)
# 用法: GH_TOKEN=<你的PAT> bash scripts/push_github_final.sh
# 做三件事: ①推送本地commit(已就绪,ef0c77e) ②删除V5.3 Release旧APK资产 ③上传新APK(14.4MB)
set -e
cd "$(dirname "$0")/.."

if [ -z "$GH_TOKEN" ]; then
  echo "缺少 GH_TOKEN 环境变量(需repo权限的GitHub Personal Access Token)"
  echo "用法: GH_TOKEN=ghp_xxx bash scripts/push_github_final.sh"
  exit 1
fi

REPO=361087210/taicanggang-poweroff-guide
AUTH="Authorization: Bearer $GH_TOKEN"
API=https://api.github.com

echo "[1/3] 推送commit到main..."
git push "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" main

echo "[2/3] 查找V5.3 Release旧APK资产..."
ASSET_ID=$(curl -s -H "$AUTH" "$API/repos/$REPO/releases/tags/V5.3" \
  | python3 -c "import json,sys; a=[x for x in json.load(sys.stdin)['assets'] if x['name']=='taicanggang-V5.3.apk']; print(a[0]['id'] if a else '')")
if [ -n "$ASSET_ID" ]; then
  echo "  删除旧资产 #$ASSET_ID..."
  curl -s -X DELETE -H "$AUTH" "$API/repos/$REPO/releases/assets/$ASSET_ID"
fi

echo "[3/3] 上传新APK(14.4MB)..."
UPLOAD_URL=$(curl -s -H "$AUTH" "$API/repos/$REPO/releases/tags/V5.3" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['upload_url'].split('{')[0])")
curl -s -X POST -H "$AUTH" -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary @"release/太仓港断电指导V5.3.apk" \
  "${UPLOAD_URL}?name=taicanggang-V5.3.apk" | python3 -c "import json,sys; d=json.load(sys.stdin); print('  完成:', d.get('browser_download_url') or d)"

echo "GitHub端同步完成 ✔"
