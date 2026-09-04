#!/usr/bin/env bash
# =============================================================================
# build_android.sh — 太仓港断电指导APP Android 签名构建流水线(V10.14.0)
# 职责: 环境自检 → Cordova 清理+准备(before_build hook 注入Secret) → build release
#      → zipalign + apksigner v1/v2/v3签名 → sha256校验 → 输出到release/
# 安全性: 签名秘钥不进入源码;签名阶段独立于构建阶段;未配置keystore仅产出unsigned APK
# 用法:
#   # 方式1: 本地构建(需本机安装cordova + android sdk + 自有keystore)
#   export ANDROID_SDK_ROOT=/opt/android-sdk
#   export KEYSTORE_FILE=~/tcg-release.keystore
#   export KEYSTORE_ALIAS=tcg_release
#   export KEYSTORE_PASS='YourStrongPassword'
#   # (可选) 构建期注入飞书秘钥,组员安装即同步
#   export FEISHU_APP_ID='cli_xxxxxxxxxxxx'
#   export FEISHU_APP_SECRET='xxxxxxxxxxxxxxxxxxxxxxxx'
#   export FEISHU_FOLDER_TOKEN='nodcnGA95g93RhIUSdCeTkhKlQc'
#   bash scripts/build_android.sh
#
#   # 方式2: GitHub Actions 调用(secrets → env vars)
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ---- 1. 版本号(优先级: env > version.json 默认值) ----
if [ -f version.json ]; then
  VER=$(node -p "require('./version.json').version" 2>/dev/null || echo '10.14.0')
  VCODE=$(node -p "require('./version.json').versionCode" 2>/dev/null || echo 101400)
else
  VER="${APP_VERSION:-10.14.0}"
  VCODE="${VERSION_CODE:-101400}"
fi
echo "[Build] version=$VER  versionCode=$VCODE"

# ---- 2. 环境检查 ----
check_cmd() { command -v "$1" >/dev/null 2>&1; }
if ! check_cmd node;    then echo "[ERR] node 未安装"; exit 2; fi
if ! check_cmd cordova; then echo "[ERR] cordova 未安装(npm i -g cordova@12)"; exit 2; fi
if [ -z "${ANDROID_SDK_ROOT:-}" ] && [ -z "${ANDROID_HOME:-}" ]; then
  export ANDROID_SDK_ROOT="${ANDROID_HOME:-$HOME/Android/Sdk}"
  echo "[WARN] ANDROID_SDK_ROOT未显式设置,回退到 $ANDROID_SDK_ROOT"
fi
export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"

# Build-tools 解析: 优先 ANDROID_BUILD_TOOLS_VER,否则 glob 最新版本
BT_DIR="$ANDROID_SDK_ROOT/build-tools"
if [ -n "${ANDROID_BUILD_TOOLS_VER:-}" ] && [ -d "$BT_DIR/$ANDROID_BUILD_TOOLS_VER" ]; then
  BT="$BT_DIR/$ANDROID_BUILD_TOOLS_VER"
else
  BT=$(find "$BT_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -V | tail -n 1)
  if [ -z "$BT" ] || [ ! -d "$BT_DIR/$BT" ]; then echo "[ERR] 未找到Android build-tools,请安装SDK build-tools 33+"; exit 2; fi
  BT="$BT_DIR/$BT"
fi
echo "[Build] 使用 build-tools: $BT"
mkdir -p release

# ---- 3. Cordova 清理+准备(hook注入飞书Secret) ----
echo "[Build] cordova clean"
cordova clean android
echo "[Build] cordova prepare android (触发 hooks/before_build/01_inject_secrets.js)"
cordova prepare android 2>&1 | tail -5

# ---- 4. 编译 Release 包 ----
echo "[Build] cordova build android --release"
cordova build android --release 2>&1 | tail -20

UNSIGNED_APK="$ROOT_DIR/platforms/android/app/build/outputs/apk/release/app-release-unsigned.apk"
if [ ! -f "$UNSIGNED_APK" ]; then echo "[ERR] Release 编译未产出APK,请检查日志"; ls -la "$ROOT_DIR/platforms/android/app/build/outputs/apk/release/" 2>/dev/null || true; exit 3; fi
ALIGNED_APK="$ROOT_DIR/platforms/android/app/build/outputs/apk/release/app-release-aligned.apk"
SIGNED_APK="$ROOT_DIR/release/tcg_poweroff_v${VER}.apk"
SHA_FILE="${SIGNED_APK}.sha256"

# ---- 5. 签名(未配置keystore时跳过并保留unsigned) ----
if [ -z "${KEYSTORE_FILE:-}" ] || [ ! -f "$KEYSTORE_FILE" ]; then
  echo "[WARN] KEYSTORE_FILE未设置或文件不存在 → 跳过签名,仅输出unsigned APK"
  cp "$UNSIGNED_APK" "$ROOT_DIR/release/tcg_poweroff_v${VER}-unsigned.apk"
  (cd release && sha256sum "tcg_poweroff_v${VER}-unsigned.apk" > "tcg_poweroff_v${VER}-unsigned.apk.sha256")
  echo "[Build-Done] unsigned apk: $ROOT_DIR/release/tcg_poweroff_v${VER}-unsigned.apk"
  echo "[SHA  ] $(cat "$ROOT_DIR/release/tcg_poweroff_v${VER}-unsigned.apk.sha256")"
  exit 0
fi
if [ -z "${KEYSTORE_ALIAS:-}" ] || [ -z "${KEYSTORE_PASS:-}" ]; then
  echo "[ERR] KEYSTORE_FILE已提供但缺少KEYSTORE_ALIAS或KEYSTORE_PASS环境变量"; exit 2
fi

# zipalign (4字节对齐)
"$BT/zipalign" -f -p 4 "$UNSIGNED_APK" "$ALIGNED_APK"
# v1+v2+v3 签名(Pixel 7+ 要求v2/v3;旧设备兼容v1)
"$BT/apksigner" sign \
  --ks "$KEYSTORE_FILE" \
  --ks-key-alias "$KEYSTORE_ALIAS" \
  --ks-pass "pass:${KEYSTORE_PASS}" \
  --key-pass "pass:${KEYSTORE_PASS}" \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$SIGNED_APK" "$ALIGNED_APK"
# 签名自校验
"$BT/apksigner" verify --verbose --print-certs "$SIGNED_APK" > "${SIGNED_APK}.verify.txt"
echo "[Build] 签名校验结果:$(head -2 "${SIGNED_APK}.verify.txt" | tr '\n' '|')"

# ---- 6. SHA-256 生成 ----
(cd release && sha256sum "tcg_poweroff_v${VER}.apk" > "tcg_poweroff_v${VER}.apk.sha256")
# macOS 兼容
if [ ! -s "$SHA_FILE" ] && check_cmd shasum; then
  (cd release && shasum -a 256 "tcg_poweroff_v${VER}.apk" > "tcg_poweroff_v${VER}.apk.sha256")
fi

# ---- 7. 产物清单输出 ----
SIZE=$(stat -c%s "$SIGNED_APK" 2>/dev/null || stat -f%z "$SIGNED_APK")
echo ""
echo "================================================================"
echo " Android V${VER}(${VCODE}) 构建成功"
echo "================================================================"
echo " APK   : $SIGNED_APK  (${SIZE} bytes)"
echo " SHA256: $SHA_FILE"
echo "         $(cat "$SHA_FILE")"
echo " 校验  : ${SIGNED_APK}.verify.txt"
echo "================================================================"
