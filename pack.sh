#!/bin/bash

# 打包 Jable Collect 插件文件到 dist/ 目录

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST="$SCRIPT_DIR/dist"

rm -rf "$DIST"
mkdir -p "$DIST/images"

FILES=(
  manifest.json
  background.js
  content.js
  content-missav.js
  content-jable-detail.js
  content-jable-detail-hook.js
  popup.html
  popup.js
  options.html
  options.js
  style.css
)

for f in "${FILES[@]}"; do
  cp "$SCRIPT_DIR/$f" "$DIST/$f"
done

cp "$SCRIPT_DIR/images/"*.png "$DIST/images/"

echo "打包完成 → $DIST"
