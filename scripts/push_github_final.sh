#!/bin/bash
# V10.14.0 GitHub端一键推送发布脚本(动态版本,不再硬编码V5.3)
# 【V10.14.0 更新】
#   - TAG/VERSION 从 version.json 动态读取(不再硬编码V5.3)
#   - REPO/APK_PATH/ASSET_NAME 全部可环境变量覆盖,脚本可用于所有版本
#   - 上传前执行 sha256sum,APK+sha256 文件一同作为 Release 资产
#   - 增加 APK不存在/体积异常(0/<5MB/>120MB) 预检
# 用法:
#   export GH_TOKEN=ghp_xxx
#   export GH_REPO=361087210/taicanggang-poweroff-guide
#   bash scripts/push_github_final.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# ------------- 1) 动态版本与配置(Env > version.json > 默认值) -------------
if [ -f version.json ]; then
  NODE_READ_VERSION='try{const v=require("./version.json");console.log(v.version+"|"+(v.downloadUrl||"")+"|"+(v.feishuConfig&&v.feishuConfig.folder||""));}catch(e){console.log("10.14.0||")}'
  INFO=$(node -e "$NODE_READ_VERSION" 2>/dev/null || echo "10.14.0||")
  DEF_VER=$(echo "$INFO" | cut -d'|' -f1)
else
  DEF_VER="10.14.0"
fi

GH_TAG_DEFAULT="v${DEF_VER}"
ASSET_NAME_DEFAULT="tcg_poweroff_v${DEF_VER}.apk"
APK_PATH_DEFAULT="release/${ASSET_NAME_DEFAULT}"
SHA_PATH_DEFAULT="${APK_PATH_DEFAULT}.sha256"

GH_TAG="${GH_TAG:-$GH_TAG_DEFAULT}"
REPO="${GH_REPO:-361087210/taicanggang-poweroff-guide}"
APK_PATH="${APK_PATH:-$APK_PATH_DEFAULT}"
ASSET_NAME="${ASSET_NAME:-$ASSET_NAME_DEFAULT}"
SHA_PATH="${SHA_PATH:-${APK_PATH}.sha256}"
BRANCH="${BRANCH:-main}"
API=https://api.github.com

echo "=========================================="
echo " 太仓港断电指导 — GitHub 发布推送 (V10.14.0 动态版)"
echo "  Repo       : $REPO"
echo "  Branch     : $BRANCH"
echo "  Tag        : $GH_TAG"
echo "  APK Path   : $APK_PATH"
echo "  Asset Name : $ASSET_NAME"
echo "=========================================="

# 前置校验:Token
if [ -z "${GH_TOKEN:-}" ]; then
  echo "[错误] 缺少 GH_TOKEN 环境变量(需 repo 权限的 GitHub Personal Access Token)"
  echo "  用法: GH_TOKEN=ghp_xxx bash scripts/push_github_final.sh"
  exit 1
fi
AUTH="Authorization: Bearer $GH_TOKEN"

# 前置校验:APK 存在 + 体积合理
if [ ! -f "$APK_PATH" ]; then
  echo "[错误] APK 不存在: $APK_PATH"
  echo "  请先运行 scripts/build_android.sh 构建并签名,或设置 APK_PATH=release/xxx.apk"
  exit 1
fi
APK_SIZE=$(stat -c%s "$APK_PATH" 2>/dev/null || stat -f%z "$APK_PATH" 2>/dev/null || echo 0)
if [ "$APK_SIZE" -lt 5242880 ]; then
  echo "[错误] APK 文件过小(<5MB,大小=${APK_SIZE}B),疑似构建失败,拒绝发布"
  exit 1
fi
if [ "$APK_SIZE" -gt 125829120 ]; then
  echo "[警告] APK 文件超过 120MB(${APK_SIZE}B),仍会继续发布;若为错误请 Ctrl+C 终止"
  sleep 3
fi

# ------------- 2) 生成 SHA256 校验文件(若不存在) -------------
if [ ! -f "$SHA_PATH" ]; then
  SHA256SUM_BIN=$(command -v sha256sum || echo "")
  if [ -z "$SHA256SUM_BIN" ]; then
    # macOS fallback
    SHA_HEX=$(shasum -a 256 "$APK_PATH" | awk '{print $1}')
    echo "${SHA_HEX}  ${APK_PATH##*/}" > "$SHA_PATH"
  else
    (cd "$(dirname "$APK_PATH")" && sha256sum "$(basename "$APK_PATH")") > "$SHA_PATH"
  fi
  echo "[准备] 已生成 SHA256 校验文件: $SHA_PATH"
fi
cat "$SHA_PATH"

# ------------- 3) 推送代码 -------------
echo ""
echo "[1/5] 推送 commit 到 ${BRANCH}..."
git push "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" "$BRANCH"

# ------------- 4) 若该 Tag 的 Release 存在则删除旧 APK / SHA 资产 -------------
echo ""
echo "[2/5] 查找 Release tag=$GH_TAG 的旧资产..."
RELEASE_JSON=$(curl -fsSL -H "$AUTH" "$API/repos/$REPO/releases/tags/$GH_TAG" 2>/dev/null || echo "")
RELEASE_ID=""
UPLOAD_URL=""
if [ -n "$RELEASE_JSON" ]; then
  RELEASE_ID=$(echo "$RELEASE_JSON" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id',''))" 2>/dev/null || echo "")
  UPLOAD_URL=$(echo "$RELEASE_JSON" | python3 -c "import json,sys;u=json.load(sys.stdin).get('upload_url','');print(u.split('{')[0])" 2>/dev/null || echo "")
fi

# 删除与我们新上传同名的旧资产(防止 Release 中出现重复)
delete_asset_if_exists(){
  local name="$1"
  local id
  id=$(echo "$RELEASE_JSON" | python3 -c "import json,sys;a=[x for x in json.load(sys.stdin).get('assets',[]) if x.get('name')=='$name'];print(a[0]['id'] if a else '')" 2>/dev/null || echo "")
  if [ -n "$id" ]; then
    echo "  删除旧资产 [$name] id=$id..."
    curl -fsSL -X DELETE -H "$AUTH" "$API/repos/$REPO/releases/assets/$id" >/dev/null
  fi
}
if [ -n "$RELEASE_ID" ]; then
  delete_asset_if_exists "$ASSET_NAME"
  delete_asset_if_exists "${ASSET_NAME}.sha256"
fi

# ------------- 5) 若 Tag/Release 不存在则创建 -------------
if [ -z "$RELEASE_ID" ]; then
  echo "[3/5] 未找到 Tag=$GH_TAG 的 Release, 自动创建 Draft Release..."
  RELEASE_BODY="## 太仓港断电指导 APP ${GH_TAG}
发布日期: $(date +%Y-%m-%d)
版本: v${DEF_VER}
详见: docs/RELEASE_V$(echo "${DEF_VER}" | tr -d '.').md"
  CREATE_JSON=$(curl -fsSL -X POST -H "$AUTH" -H "Content-Type: application/json" \
    "$API/repos/$REPO/releases" \
    -d "$(python3 -c "import json,sys;print(json.dumps({'tag_name':'$GH_TAG','name':'太仓港断电指导 $GH_TAG','body':'''$RELEASE_BODY''','draft':True,'prerelease':False}))")")
  RELEASE_ID=$(echo "$CREATE_JSON" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  UPLOAD_URL=$(echo "$CREATE_JSON" | python3 -c "import json,sys;u=json.load(sys.stdin).get('upload_url','');print(u.split('{')[0])" 2>/dev/null)
  if [ -z "$RELEASE_ID" ]; then
    echo "[错误] 创建 Release 失败: $CREATE_JSON"
    exit 1
  fi
else
  echo "[3/5] 已存在 Release id=$RELEASE_ID,跳过创建"
fi

# ------------- 6) 上传 APK 与 SHA256 -------------
upload_asset(){
  local path="$1" name="$2" mime="$3"
  echo "  上传 $name ($(stat -c%s "$path" 2>/dev/null || stat -f%z "$path") B)..."
  local resp
  resp=$(curl -fsSL -X POST -H "$AUTH" -H "Content-Type: $mime" \
    --data-binary @"$path" \
    "${UPLOAD_URL}?name=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$name")")
  local url
  url=$(echo "$resp" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('browser_download_url') or d.get('state') or str(d)[:200])" 2>/dev/null || echo "$resp")
  echo "    结果: $url"
}

echo ""
echo "[4/5] 上传 APK + 校验文件到 Release id=$RELEASE_ID..."
upload_asset "$APK_PATH" "$ASSET_NAME" "application/vnd.android.package-archive"
upload_asset "$SHA_PATH" "${ASSET_NAME}.sha256" "text/plain"

# ------------- 7) 取消 Draft(若创建时是 Draft), 便于用户直接下载 -------------
echo ""
echo "[5/5] 发布 Release(从 Draft 改为正式版)..."
curl -fsSL -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  "$API/repos/$REPO/releases/$RELEASE_ID" \
  -d '{"draft":false}' >/dev/null

echo ""
echo "=========================================="
echo "✅ GitHub 端同步完成!"
echo "  Release : https://github.com/$REPO/releases/tag/$GH_TAG"
echo "  APK     : $ASSET_NAME ($((APK_SIZE/1024/1024)) MB)"
echo "  SHA256  : ${ASSET_NAME}.sha256"
echo "=========================================="
