#!/usr/bin/env bash
# =============================================================================
# build_ios.sh — 太仓港断电指导APP iOS Archive + Export (IPA)构建脚本(V10.14.0)
# -----------------------------------------------------------------------------
# ⚠️ 注意: iOS 签名/证书体系强绑定 Apple Developer 账号 + 付费 Team + 设备UUID
#   注册,不能像 Android 一样靠 keystore 文件自签。本脚本提供 3 种运行形态:
#   A) 本地开发机器(Xcode 15+ 已登录 Apple ID + 自动签名): 直接 cordova prepare +
#      xcodebuild archive → exportarchive (Automatic signing, iOS App Development 证书)
#   B) GitHub Actions CI (macOS-14 runner, 见 .github/workflows/ios-release.yml):
#      通过 BUILD_CERTIFICATE_BASE64 + P12_PASSWORD + PROVISIONING_PROFILE_BASE64 +
#      KEYCHAIN_PASSWORD 这些 Actions secrets 临时安装证书到临时 keychain → 手动签名
#   C) Fastlane match (企业级推荐): match 托管证书/描述文件到 Git 私有仓库,
#      gym 导出 IPA, pilot 上传 TestFlight —— 目前预留,后续 V11.x 再纳入。
# 构建期飞书 Secret 注入: hooks/before_build/01_inject_secrets.js 会读取
#   FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_FOLDER_TOKEN 环境变量注入
#   到 WKWebView 加载的 demo.html 首屏 <script>,保证组员端零配置同步。
#
# 用法:
#   # 开发调试(自动签名)
#   TEAM_ID=ABCDE12345 IOS_SIGNING_STYLE=Automatic bash scripts/build_ios.sh
#   # CI 手动签名(配合 Actions secrets)
#   CODE_SIGN_IDENTITY='Apple Development: Your Name (XXXXXXXX)' \
#   PROVISIONING_PROFILE_SPECIFIER='tcg-poweroff-development' \
#   TEAM_ID=ABCDE12345 IOS_SIGNING_STYLE=Manual bash scripts/build_ios.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[ERR] iOS 构建只能在 macOS 上运行 (当前: $(uname -s))"; exit 2
fi
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "[ERR] xcodebuild 不可用,请安装 Xcode (App Store) 并执行 sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"; exit 2
fi

VER=$(node -p "require('./version.json').version" 2>/dev/null || echo '10.14.0')
VCODE=$(node -p "require('./version.json').versionCode" 2>/dev/null || echo 101400)
TEAM_ID="${TEAM_ID:-}"
IOS_SIGNING_STYLE="${IOS_SIGNING_STYLE:-Automatic}"      # Automatic | Manual
CODE_SIGN_IDENTITY="${CODE_SIGN_IDENTITY:-Apple Development}"
PROVISIONING_PROFILE_SPECIFIER="${PROVISIONING_PROFILE_SPECIFIER:-}"
EXPORT_METHOD="${EXPORT_METHOD:-development}"            # development | app-store | ad-hoc | enterprise
CONFIGURATION="${CONFIGURATION:-Release}"

mkdir -p release
XCODEPROJ="$ROOT_DIR/platforms/ios/HelloCordova.xcodeproj"   # Cordova 默认工程名 HelloCordova
SCHEME="${SCHEME:-HelloCordova}"
ARCHIVE="$ROOT_DIR/release/tcg_poweroff_v${VER}.xcarchive"
EXPORT_DIR="$ROOT_DIR/release/ios_export_v${VER}"
IPA="$EXPORT_DIR/${SCHEME}.ipa"

if [ -z "$TEAM_ID" ]; then
  echo "[WARN] TEAM_ID 未设置 → 无法签名,仅执行 cordova prepare 并停止(供检查工程生成)"
  echo "[STEP] cordova prepare ios (触发 Secret 注入 hook)"
  cordova prepare ios 2>&1 | tail -5
  ls -la "$XCODEPROJ" || true
  exit 0
fi

echo "[Build-iOS] version=$VER  code=$VCODE  TEAM=$TEAM_ID  style=$IOS_SIGNING_STYLE  export=$EXPORT_METHOD"

# --- 1. Cordova 准备 + 注入飞书 Secret ---
echo "[STEP] cordova prepare ios"
cordova prepare ios 2>&1 | tail -5

# --- 2. Archive ---
echo "[STEP] xcodebuild archive (CONFIGURATION=$CONFIGURATION)"
ARCHIVE_CMD=(xcodebuild archive
  -project "$XCODEPROJ"
  -scheme "$SCHEME"
  -configuration "$CONFIGURATION"
  -archivePath "$ARCHIVE"
  -destination "generic/platform=iOS"
  -allowProvisioningUpdates
  DEVELOPMENT_TEAM="$TEAM_ID"
  CODE_SIGN_STYLE="$IOS_SIGNING_STYLE"
  MARKETING_VERSION="$VER"
  CURRENT_PROJECT_VERSION="$VCODE"
)
if [ "$IOS_SIGNING_STYLE" = "Manual" ]; then
  [ -n "$PROVISIONING_PROFILE_SPECIFIER" ] || { echo "[ERR] Manual 签名必须提供 PROVISIONING_PROFILE_SPECIFIER"; exit 2; }
  ARCHIVE_CMD+=(
    CODE_SIGN_IDENTITY="$CODE_SIGN_IDENTITY"
    PROVISIONING_PROFILE_SPECIFIER="$PROVISIONING_PROFILE_SPECIFIER"
  )
fi
"${ARCHIVE_CMD[@]}" 2>&1 | tail -20

# --- 3. ExportOptions.plist 生成 ---
cat > "$ROOT_DIR/release/ExportOptions_${VER}.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>${EXPORT_METHOD}</string>
  <key>teamID</key><string>${TEAM_ID}</string>
  <key>signingStyle</key><string>${IOS_SIGNING_STYLE}</string>
  <key>stripSwiftSymbols</key><true/>
  <key>uploadSymbols</key><false/>
</dict></plist>
PLIST

# --- 4. Export IPA ---
echo "[STEP] xcodebuild -exportArchive"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$ROOT_DIR/release/ExportOptions_${VER}.plist" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates 2>&1 | tail -20

if [ ! -f "$IPA" ]; then
  echo "[ERR] 未导出 IPA, 请查看 export 日志"; ls "$EXPORT_DIR" || true; exit 3
fi

# --- 5. SHA256 + 产物清单 ---
cp "$IPA" "$ROOT_DIR/release/tcg_poweroff_v${VER}.ipa"
FINAL_IPA="$ROOT_DIR/release/tcg_poweroff_v${VER}.ipa"
(cd release && shasum -a 256 "tcg_poweroff_v${VER}.ipa" > "tcg_poweroff_v${VER}.ipa.sha256")

SIZE=$(stat -f%z "$FINAL_IPA" 2>/dev/null || stat -c%s "$FINAL_IPA")
echo ""
echo "================================================================"
echo " iOS V${VER}(${VCODE}) 构建完成"
echo "================================================================"
echo " IPA   : $FINAL_IPA  (${SIZE} bytes)"
echo " SHA256: $(cat "$ROOT_DIR/release/tcg_poweroff_v${VER}.ipa.sha256")"
echo " Archive: $ARCHIVE (含.dSYM 崩溃符号)"
echo "================================================================"
