#!/usr/bin/env bash
# ============================================================
# scripts/prepare_pages.sh —— 组装 GitHub Pages 发布目录(单一真源)
# ============================================================
# 为什么抽成脚本: 正常发布(deploy-pages.yml)与按 tag 回滚(rollback.yml)
# 必须发布**同一份**文件清单, 否则回滚后的站点与当时线上不一致。
#
# 用法: bash scripts/prepare_pages.sh <源目录> <输出目录>
#   bash scripts/prepare_pages.sh . _publish          # 正常发布(当前工作区)
#   bash scripts/prepare_pages.sh site _publish       # 回滚(checkout 到旧 tag 的目录)
set -euo pipefail

SRC="${1:-.}"
OUT="${2:-_publish}"

# 输出目录先按"调用者当前目录"转成绝对路径, 否则下面 cd 到源目录后
# 相对路径会落到源目录里(回滚时源目录是 site/, 输出会错位到 site/_publish)
case "$OUT" in
  /*) ;;
  *) OUT="$(pwd)/$OUT" ;;
esac

cd "$SRC"
rm -rf "$OUT"
mkdir -p "$OUT"

cp index.html demo.html manifest.json sw.js feishu-api.js vehicles_data.js version.json "$OUT"/

# 资源库索引(docs/ 不在发布白名单, 故索引放根目录)
[ -f media_library.json ] && cp media_library.json "$OUT"/ || true
# 版本清单: App「历史版本」入口与网页回滚都依赖它
[ -f releases_index.json ] && cp releases_index.json "$OUT"/ || true

cp icon-*.png "$OUT"/ 2>/dev/null || true
[ -f icon.svg ] && cp icon.svg "$OUT"/ || true

cp -r css js vendor vehicle_images "$OUT"/

# web-data 为镜像数据目录(首次同步前可能不存在, 容错跳过)
if [ -d web-data ]; then
  cp -r web-data "$OUT"/
  echo "web-data files:"
  ls -la "$OUT"/web-data/
else
  echo "WARN: web-data 目录不存在(首次同步前属正常, 待 sync-web-data 工作流生成)"
fi

echo "Publish dir contents ($OUT):"
ls -la "$OUT"/
