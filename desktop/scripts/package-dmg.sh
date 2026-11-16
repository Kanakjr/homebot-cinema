#!/bin/zsh
# Build a release app and a DMG for THIS Mac (Apple Silicon, macOS 12+). Quick package, not a portable one:
#   - needs Homebrew's libmpv on the target Mac (`brew install mpv`); it is not bundled
#   - ad-hoc signed only (no Developer ID, not notarized): a DMG you move yourself opens normally; one that was
#     downloaded needs right-click > Open the first time
#   - the web UI origin is baked in at build time (CINEMA_ORIGIN), and dev-only tools are compiled out
#   - home mode: CINEMA_LOCAL_ORIGIN (default http://localhost:3002, or `none`) is the server's direct address;
#     when it answers, the app uses it instead of going out to the internet and back
#
#   CINEMA_ORIGIN=https://your-host desktop/scripts/package-dmg.sh
# Output: desktop/release/HomeBot-Cinema-<version>-arm64.dmg
set -e
HERE=${0:A:h}; ROOT=${HERE:h}; REPO=${ROOT:h}
: "${CINEMA_ORIGIN:?set CINEMA_ORIGIN=https://your-host}"
export PATH=/opt/homebrew/bin:$PATH
export CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}
NAME="HomeBot Cinema"; EXE=HomeBotCinema; ID=dev.homebot.cinema.desktop
VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' "$ROOT/src-tauri/Cargo.toml" | head -1)
OUT=${OUT_DIR:-$ROOT/release}; WORK=${WORK_DIR:-${TMPDIR:-/tmp}/cinema-dmg}

echo "==> release build (dev-tools off) for $CINEMA_ORIGIN (home mode: ${CINEMA_LOCAL_ORIGIN:-http://localhost:3002})"
cargo build --release --no-default-features --manifest-path "$ROOT/src-tauri/Cargo.toml"

echo "==> assemble the app"
rm -rf "$WORK"; app="$WORK/$NAME.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$WORK/AppIcon.iconset"
cp "$CARGO_TARGET_DIR/release/cinema-desktop-spike" "$app/Contents/MacOS/$EXE"
src="$REPO/assets/images/icon_512x512.png"
for sz in 16 32 128 256 512; do
    sips -z $sz $sz "$src" --out "$WORK/AppIcon.iconset/icon_${sz}x${sz}.png" >/dev/null
    sips -z $((sz*2)) $((sz*2)) "$src" --out "$WORK/AppIcon.iconset/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "$WORK/AppIcon.iconset" -o "$app/Contents/Resources/AppIcon.icns"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>$NAME</string>
<key>CFBundleDisplayName</key><string>$NAME</string>
<key>CFBundleIdentifier</key><string>$ID</string>
<key>CFBundleExecutable</key><string>$EXE</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$VERSION</string>
<key>CFBundleVersion</key><string>$VERSION</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>LSApplicationCategoryType</key><string>public.app-category.entertainment</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
echo "==> ad-hoc sign"
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"

echo "==> package the DMG"
stage="$WORK/dmg"; mkdir -p "$stage"
cp -R "$app" "$stage/"; ln -s /Applications "$stage/Applications"
cat > "$stage/READ ME FIRST.txt" <<TXT
$NAME $VERSION (Apple Silicon)

1. Install mpv once (it provides the video player library):   brew install mpv
2. Drag "$NAME" onto Applications, then open it.
3. Sign in to your server when asked. The sign-in is remembered.

If macOS says the app can't be opened, right-click it and choose Open (it is not notarized).
Your sign-in is stored in ~/Library/WebKit/$ID; delete that folder to sign out.
TXT
mkdir -p "$OUT"; dmg="$OUT/HomeBot-Cinema-$VERSION-arm64.dmg"; rm -f "$dmg"
hdiutil create -volname "$NAME" -srcfolder "$stage" -ov -format UDZO "$dmg" >/dev/null
hdiutil verify "$dmg" >/dev/null && echo "verified"
ls -lh "$dmg"
echo "$dmg"
