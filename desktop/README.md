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
- `dist/setup.html`: the first-run page.

The page is remote content, so: mpv scripts and ytdl are off, `mpv-command` is limited to `stop` and http(s) `loadfile`,
only the chosen origin may call `shell_ipc`, and mpv never writes a log file against a logged-in origin (it would record
the Cookie header).

## Build
```sh
cargo test --no-default-features --manifest-path src-tauri/Cargo.toml   # address checks
zsh scripts/package-dmg.sh                                              # release/HomeBot-Cinema-<version>-arm64.dmg (+ .sha256)
VERSION=1.2.0 zsh scripts/package-dmg.sh                                # version from a tag
CINEMA_ORIGIN=https://your-host zsh scripts/package-dmg.sh              # private build with the address baked in (skips first run)
```
Needs Rust and macOS. CI does the same on every change here, and attaches the DMG to the GitHub Release when you push a tag
(`git tag v1.2.0 && git push origin v1.2.0`); see `.github/workflows/desktop.yml`.

Development: `scripts/spike.sh` builds and runs a dev build with a file-based test channel (`dev-tools` feature, never in
releases); `spike.sh run setup` starts it on the first-run page with a scratch config folder.

## Known limits
- Apple Silicon only; ad-hoc signed, not notarized; libmpv comes from Homebrew.
- A hidden or minimized window drops frames (audio continues): the player pauses on minimize.
- OpenGL is deprecated on macOS (still works); libmpv has no Metal render API yet.
- Windows and Linux are not started: see `docs/native-apps.md`.
