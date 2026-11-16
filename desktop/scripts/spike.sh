#!/bin/zsh
# Helper for the Tauri + libmpv spike (macOS only). Everything lives in $SPIKE_HOME (default
# $TMPDIR/cinema-spike): build output, the .app wrapper, logs, snapshots.
#
#   spike.sh clip                      make the 10-bit HEVC + AC3 MKV test clip (needs ffmpeg)
#   spike.sh build                     cargo build + assemble/sign CinemaSpike.app
#   spike.sh run [render|child|wid|ui|home] launch; home = baked-in addresses + home mode; ui = real web UI at $SPIKE_URL (storage persists; build with CINEMA_ORIGIN=<same origin>); render = libmpv render API (default), child = mpv's own
#                                      window attached below (send `cmd attach`), wid = --wid (fails)
#   spike.sh cmd <verb> [args]         send a verb to the running app (snap, region, dump, attach, mpv,
#                                      eval, resize, fullscreen, simplefs, reorder, aux, quit)
#   spike.sh snap <name> [snap|region] capture the app's own window -> $SPIKE_HOME/snaps/<name>.png
#   spike.sh status                    last mpv status line from the log
#   spike.sh stop
#
# Needs: brew install rust mpv ffmpeg. The app captures its own windows (no Screen Recording permission
# needed) and is driven through a command file, so the whole thing can run without GUI automation.
set -e
HERE=${0:A:h}; ROOT=${HERE:h}
SPIKE_HOME=${SPIKE_HOME:-${TMPDIR:-/tmp}/cinema-spike}
APP=$SPIKE_HOME/CinemaSpike.app
CLIP=$SPIKE_HOME/hevc10_ac3_test.mkv
export PATH=/opt/homebrew/bin:$PATH
mkdir -p "$SPIKE_HOME/snaps"

case ${1:-} in
clip)
    ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=1920x1080:rate=24,format=yuv420p10le" \
        -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 40 -c:v libx265 -preset ultrafast \
        -x265-params log-level=error -pix_fmt yuv420p10le -tag:v hvc1 -c:a ac3 -b:a 192k "$CLIP"
    echo "$CLIP" ;;
build)
    CARGO_TARGET_DIR=$SPIKE_HOME/target cargo build --manifest-path "$ROOT/src-tauri/Cargo.toml"
    mkdir -p "$APP/Contents/MacOS"
    cp "$SPIKE_HOME/target/debug/cinema-desktop-spike" "$APP/Contents/MacOS/"
    cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>CinemaSpike</string>
<key>CFBundleIdentifier</key><string>dev.homebot.cinema.spike</string>
<key>CFBundleExecutable</key><string>cinema-desktop-spike</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>0.0.1</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
    codesign --force --sign - "$APP" ;;
run)
    mode=${2:-render}
    pkill -f CinemaSpike.app/Contents/MacOS 2>/dev/null || true; sleep 0.7
    : > "$SPIKE_HOME/spike.log"; : > "$SPIKE_HOME/mpv.log"; rm -f "$SPIKE_HOME/cmd"
    extra=(); clip=(--env SPIKE_CLIP="$CLIP"); mpvlog=(--env SPIKE_MPV_LOG="$SPIKE_HOME/mpv.log")
    [[ $mode == render ]] && extra+=(--env SPIKE_RENDER=1)
    [[ $mode == child ]] && extra+=(--env SPIKE_NO_WID=1)
    # ui = the real web UI (SPIKE_URL, default a scratch server on :3102) with the render-API shell, no auto-play
    # home = no SPIKE_URL: the app uses its baked-in addresses and home mode (extra env: CINEMA_HOME_MODE=0 forces public only)
    [[ $mode == home ]] && { clip=(); mpvlog=(); [[ -n ${CINEMA_HOME_MODE:-} ]] && extra+=(--env CINEMA_HOME_MODE="$CINEMA_HOME_MODE"); }
    [[ $mode == ui ]] && { extra+=(--env SPIKE_RENDER=1 --env SPIKE_URL="${SPIKE_URL:?set SPIKE_URL=https://your-host (and build with CINEMA_ORIGIN set to the same origin)}" --env SPIKE_PERSIST=1); clip=(); mpvlog=(); }  # no mpv log in ui mode: it would record the session cookie
    open -n "$APP" --stdout "$SPIKE_HOME/spike.log" --stderr "$SPIKE_HOME/spike.log" \
        "${clip[@]}" --env SPIKE_VO=gpu --env SPIKE_HWDEC=videotoolbox \
        ${mpvlog[@]} --env SPIKE_CMD_FILE="$SPIKE_HOME/cmd" \
        --env SPIKE_SNAP_DIR="$SPIKE_HOME/snaps" "${extra[@]}"
    echo "launched ($mode); log: $SPIKE_HOME/spike.log" ;;
cmd)
    shift; echo "$*" > "$SPIKE_HOME/cmd" ;;
snap)
    n=${2:?name}; mode=${3:-snap}
    rm -f "$SPIKE_HOME/snaps/$n.bgra" "$SPIKE_HOME/snaps/$n.txt"
    echo "$mode $n" > "$SPIKE_HOME/cmd"
    for i in {1..40}; do [[ -f $SPIKE_HOME/snaps/$n.txt ]] && break; sleep 0.25; done
    [[ -f $SPIKE_HOME/snaps/$n.txt ]] || { echo "no snapshot produced"; exit 1; }
    sleep 0.3; sz=$(cat "$SPIKE_HOME/snaps/$n.txt")
    ffmpeg -hide_banner -loglevel error -y -f rawvideo -pix_fmt bgra -s $sz -i "$SPIKE_HOME/snaps/$n.bgra" "$SPIKE_HOME/snaps/$n.png"
    echo "$SPIKE_HOME/snaps/$n.png $sz" ;;
status)
    grep '\[spike\] status' "$SPIKE_HOME/spike.log" | tail -1 ;;
stop)
    pkill -f CinemaSpike.app/Contents/MacOS 2>/dev/null && echo stopped || echo "not running" ;;
*)
    sed -n '2,17p' "$0"; exit 1 ;;
esac
