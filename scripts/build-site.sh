#!/bin/sh
# Assembles the GitHub Pages site into _site/ (or $1): everything in site/, plus the screenshots, brand icons and the UI font.
# No build tools needed. Preview: sh scripts/build-site.sh /tmp/site && python3 -m http.server -d /tmp/site 8088
set -eu
cd "$(dirname "$0")/.."
OUT="${1:-_site}"
rm -rf "$OUT"
mkdir -p "$OUT/screenshots" "$OUT/brand" "$OUT/fonts"
cp -R site/. "$OUT/"
cp docs/screenshots/*.webp "$OUT/screenshots/"
cp assets/brand/icon.svg "$OUT/brand/"
cp assets/images/apple-touch-icon.png "$OUT/brand/"
cp assets/fonts/PlusJakartaSans.ttf "$OUT/fonts/" 2>/dev/null || true
touch "$OUT/.nojekyll"
echo "site -> $OUT"
