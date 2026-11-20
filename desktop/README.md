# HomeBot Cinema desktop app (macOS)

A Tauri window that opens **your** HomeBot Cinema server, with libmpv drawing the video underneath the web UI. It plays files
as they are (HEVC, AV1, Dolby/DTS audio, embedded subtitles) instead of asking the server to transcode.

## Use it
1. Download the `.dmg` from the [latest release](https://github.com/Kanakjr/homebot-cinema/releases/latest) (Apple Silicon, macOS 12+).
2. `brew install mpv` once (provides libmpv; not bundled yet).
3. Drag the app to Applications. It is not notarized yet: right-click → Open the first time.
4. Enter your server's address when asked, then sign in. Both are remembered.
   Menu bar → **Server → Change Server…** switches servers.

Optional second field: a **home-network address** (for example `http://localhost:3002` or `http://192.168.1.20:3002`). When
it answers, the app uses it directly instead of going out through the internet and back. Plain `http` is accepted only for
local addresses; everything else must be `https`.

## How it works
- `src-tauri/src/main.rs`: window, menu, first-run flow. `server.rs`: the chosen server (`server.json` in the app's config
  folder), address checks, and the permission for that one origin to call the shell bridge.
- `shell.rs` + `shell_shim.js`: the "shell" protocol the web player already speaks. `window.qt` is defined so the player skips
  the server probe/transcode and hands mpv the original stream (`?direct=1` on same-origin media URLs).
- `mpv.rs` + `glview.rs`: libmpv bound at run time; frames rendered into a layer beneath the transparent web view, so
  fullscreen and resizing work in one window.
- `home.rs`: home mode (switches between the public and the home-network address, handing the sign-in across).
- `gamepad.rs` + `gamepad/gamepad_bridge.m` + `gamepad_shim.js`: game controllers (Xbox, PlayStation, MFi, Siri Remote).
  - **Reading:** done natively with Apple's GameController framework, polled at 60 Hz. Input arrives only while the app is in front.
  - **Mapping:** the shim turns presses into the key presses and shell media keys the web UI already understands, using a layout people can change in Settings > Controllers (plugin `controllers`).
  - **Gamepad API:** the shim serves `navigator.getGamepads()` for the web UI's own gamepad support. WebKit's built-in Gamepad API stays idle, because it would deliver every press twice.
- `nowplaying.rs` + `nowplaying/nowplaying_bridge.m`: system "Now Playing" integration.
  - Registers the app with macOS `MPNowPlayingInfoCenter` and `MPRemoteCommandCenter` while video plays.
  - Routes hardware media keys (Play/Pause, Previous/Next track, Seek), AirPods stem squeezes, Touch Bar scrubbers, and Control Center media widgets directly to mpv and the web player instead of hijacking Music.app.
- `dist/setup.html`: the first-run page.

The page is remote content, so: mpv scripts and ytdl are off, `mpv-command` is limited to `stop` and http(s) `loadfile`,
only the chosen origin may call `shell_ipc`, and mpv never writes a log file against a logged-in origin (it would record
the Cookie header).

## Build
```sh
cargo test --no-default-features --manifest-path src-tauri/Cargo.toml   # address checks

# 1. Public release build (shows setup wizard on first run to prompt user for server):
zsh scripts/package-dmg.sh                                              # release/HomeBot-Cinema-<version>-arm64.dmg (+ .sha256)
VERSION=1.2.0 zsh scripts/package-dmg.sh                                # version from a tag

# 2. Private/household build (bakes in public and local URLs, skips first-run wizard):
# First, rebuild frontend assets if UI or plugins changed:
npx webpack --mode production
# Package with both public HTTPS origin and optional local LAN origin:
CINEMA_ORIGIN=https://your-host CINEMA_LOCAL_ORIGIN=http://localhost:3002 zsh scripts/package-dmg.sh
```

### Build Environment Flags
- **`CINEMA_ORIGIN`**: Public HTTPS address (e.g. `https://cinema.example.com`). When omitted, defaults to `https://cinema.example.com`, which deliberately presents the "Connect to your server" setup wizard on first run. Baking this in skips the setup screen and registers the origin for `shell_ipc` in `capabilities/remote.json`.
- **`CINEMA_LOCAL_ORIGIN`**: Direct home-network address (defaults to `http://localhost:3002`). When reachable, the desktop app talks directly to this local address instead of routing video streams through Cloudflare. Pass `none` to disable home mode.
- **Frontend bundling**: Always run `npx webpack --mode production` before packaging if any web files or UI plugins (`plugins/*/ui/`) have been created or modified, ensuring the server or bundled assets include all plugin chunks.
- For this specific installation's exact URLs and build command, see `data/LOCAL.md`.

Needs Rust and macOS. CI does the same on every change here, and attaches the DMG to the GitHub Release when you push a tag
(`git tag v1.2.0 && git push origin v1.2.0`); see `.github/workflows/desktop.yml`.

Development: `scripts/spike.sh` builds and runs a dev build with a file-based test channel (`dev-tools` feature, never in
releases); `spike.sh run setup` starts it on the first-run page with a scratch config folder.

## Known limits
- Apple Silicon only; ad-hoc signed, not notarized; libmpv comes from Homebrew.
- A hidden or minimized window drops frames (audio continues): the player pauses on minimize.
- OpenGL is deprecated on macOS (still works); libmpv has no Metal render API yet.
- Windows and Linux are not started: see `docs/native-apps.md`.
