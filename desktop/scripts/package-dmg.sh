#!/bin/zsh
# Builds the macOS app and a DMG on THIS Mac (Apple Silicon, macOS 12+). Used by CI (.github/workflows/desktop.yml).
#   - the app asks for your server's address on first run (File > Server > Change Server...), so one build fits every
#     install. Set CINEMA_ORIGIN=https://your-host only for a private build that should skip that screen
#   - needs libmpv on the Mac it runs on (`brew install mpv`); it is not bundled yet
#   - ad-hoc signed only (no Developer ID, not notarized): a downloaded DMG needs right-click > Open the first time
#   - dev-only tools are compiled out
#
#   desktop/scripts/package-dmg.sh                 # version from src-tauri/Cargo.toml
#   VERSION=1.2.0 desktop/scripts/package-dmg.sh   # version from a release tag
# Output: desktop/release/HomeBot-Cinema-<version>-arm64.dmg and a .sha256 next to it
set -e
HERE=${0:A:h}; ROOT=${HERE:h}; REPO=${ROOT:h}
export PATH=/opt/homebrew/bin:$PATH
export CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}
NAME="HomeBot Cinema"; EXE=HomeBotCinema; ID=dev.homebot.cinema.desktop
VERSION=${VERSION:-$(sed -n 's/^version = "\(.*\)"/\1/p' "$ROOT/src-tauri/Cargo.toml" | head -1)}
OUT=${OUT_DIR:-$ROOT/release}; WORK=${WORK_DIR:-${TMPDIR:-/tmp}/cinema-dmg}

# Keep build-machine paths (home folder, cargo registry) out of the binary: they end up in panic messages.
# (the last matching rule wins, so the catch-all comes first)
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$HOME=/home --remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$HOME/.rustup=/rustup --remap-path-prefix=$REPO=/src"
echo "==> release build $VERSION (dev-tools off)${CINEMA_ORIGIN:+, baked origin $CINEMA_ORIGIN}"
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
3. Enter your server's address when asked (the one you open in a browser), then sign in. Both are remembered.
   To switch servers later: Server > Change Server... in the menu bar.

If macOS says the app can't be opened, right-click it and choose Open (it is not notarized yet).
Your sign-in is stored in ~/Library/WebKit/$ID; delete that folder to sign out.
TXT
mkdir -p "$OUT"; dmg="$OUT/HomeBot-Cinema-$VERSION-arm64.dmg"; rm -f "$dmg"
hdiutil create -volname "$NAME" -srcfolder "$stage" -ov -format UDZO "$dmg" >/dev/null
hdiutil verify "$dmg" >/dev/null && echo "verified"
( cd "$OUT" && shasum -a 256 "$(basename "$dmg")" > "$(basename "$dmg").sha256" )
ls -lh "$dmg"
echo "$dmg"
