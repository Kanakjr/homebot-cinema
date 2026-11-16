# Desktop shell spike (Tauri + libmpv, macOS)

Throw-away spike, not part of the product. Question: **can a Tauri window play a file the browser
cannot (10-bit HEVC + AC3 in MKV) with mpv, with our web UI composited on top?**

Tested on Apple Silicon (M4), macOS 26.5, Homebrew `mpv` 0.42.0, Tauri 2.12.5 (WKWebView), with a
synthetic 1080p 10-bit HEVC + AC3 MKV (`scripts/spike.sh clip`).

## Verdict

Three ways to get mpv under a transparent webview on macOS were tried:

| Approach | Result |
|---|---|
| **A. `--wid` = window NSView** (what `tauri-plugin-libmpv` does) | **Does not work.** mpv 0.42 ignores it and opens its own window. This Homebrew build only has the Vulkan-over-Metal (`macvk`) GPU context, no OpenGL `cocoa` one |
| **B. mpv's own window as a child window ordered below** the transparent Tauri window | Works windowed, resized and in simple fullscreen. **Native fullscreen: unverified** (see below). Two windows, flash of a standalone window at start |
| **C. libmpv render API (OpenGL) into an `NSOpenGLLayer` under the web view, same window** | **Works, including native fullscreen** (window-only capture shows video + UI). Needs `src-tauri/src/glview.rs` (~300 lines of unsafe Rust) |

Recommended for macOS: **C**. The main reason is structural: one window, so there is no cross-window
stacking, Space or focus problem to solve. B is a fallback; its native-fullscreen behaviour is not settled.

**About B's native fullscreen.** An early run showed video with no web UI and I called it broken. That was
too strong: that capture was a screen *region* capture, which cannot see a fullscreen Space unless it is the
active Space (it returned only wallpaper for C, which demonstrably has video + UI there). A later run showed
the mpv window in the same fullscreen Space as the Tao window. A `fullScreenAuxiliary` flag made no
visible difference. So: inconclusive, not "broken". Windowed, resize and simple fullscreen all work for B.
The user, who was watching the screen during the fullscreen runs (B and C were both run in native
fullscreen), saw the video and the overlay in fullscreen and noticed no problem in any run, but did not
compare the two modes. If that covers B's fullscreen runs too, B's native fullscreen is probably fine and the
early "video only" result was a capture artifact; I cannot confirm that, so B stays unverified.

## Results for C (render API), `SPIKE_RENDER=1`

| Check | Result |
|---|---|
| Single window | Yes: only the Tao window (plus macOS's own fullscreen toolbar window) |
| Hardware decode | `hwdec-current=videotoolbox`, 10-bit HEVC. Needed a **4.1 core-profile GL context**; the layer's default is GL 2.1, where mpv logs "need >= OpenGL 3.0 for core rectangle texture support" and falls back to software decode |
| Video + web UI together | Yes. Translucent, blurred web UI over video; real window-server capture |
| Orientation | Upright with `FLIP_Y=1` |
| JS overlay -> Tauri command -> mpv (pause) | Works (clicks simulated from JS) |
| Resize while paused | Works, verified as a real re-render: resizing paused playback to 500x700 logged a new draw at 500x700, black letterbox bars measured above and below the video (a stretched stale frame would not have bars) |
| **Native macOS fullscreen** | **Works** with a window-only capture: video and UI pixels both present, single Tao window (+ the system's own fullscreen toolbar window). Also seen by eye: the user watched the fullscreen runs on screen and saw the video with the web UI overlay on top (they did not compare modes, so this cannot be pinned on C alone; see B below). My `isOnActiveSpace` readings said the window was not on the active Space even though it was visible to the user, so treat that reading as unreliable |
| Dropped frames, same clip, same window size | 0 over ~18 s in both C (2 runs) and B (1 run) |
| App-process CPU (`top -pid`) | about 15% in both. This counts only the app process (mpv decode + render, JS bridge); WKWebView's WebContent/GPU processes and WindowServer compositing are **not** included, so it is not total system cost |

Caveats observed:
- **Hidden or minimized window = dropped frames (reproduced).** While the window was hidden, frame drops
  accumulated at about 15/s (107 in 7 s); minimized, 87 in 6 s; they stop when it is shown again and the web UI
  is intact afterwards. A Core Animation layer in an invisible window is not drawn, so mpv sees no redraws and
  drops. That is also what the single early "bad run" (95 drops in 6 s, no web UI in the capture) was.
  Audio keeps playing. Benign for viewing; it matches the existing `pauseOnMinimize` setting
  (`src/routes/Player/Player.js`, uses `platform.shell.state.windowClosed/windowHidden`), so the shell should
  emit `win-visibility-changed` / `win-state-changed` for it.
- Rendering happens on the main thread from the layer's draw callback (`BLOCK_FOR_TARGET_TIME=0`, so it never
  sleeps there). `asynchronous = YES` would move it to Core Animation's thread; not tried.
- One `INVALID_FRAMEBUFFER_OPERATION` GL error at the very first draw (FBO 0 before the layer's own FBO
  exists); harmless so far.
- mpv logs `GL_*_swap_control extension missing`, so no display-sync; 24p judder not evaluated.
- OpenGL is deprecated by Apple (still present on macOS 26.5). Metal is not an option: libmpv's render
  API has only OpenGL, software and D3D11 backends.

## End-to-end with the real UI on production (`spike.sh run ui`)

Real login (Cloudflare Access email OTP inside the app), a real profile, real library title
("a test film") via `/api/downloads/stream/<id>/video.mp4`. Real mouse clicks and key presses unless noted.

**Which file was actually played.** The title has an original `.mkv` (AV1 + Opus 7.1 + embedded subtitles,
2.2 GB). Until the server fix below was live, every play was something else: my first play (plain `video.mp4` URL)
was the server's live ffmpeg remux, which also started a background faststart remux that wrote a 1.5 GB `.mp4`
sibling; every later play was that MP4 (**AV1 + AAC 2ch, no subtitles**; mpv logged `mov,mp4`). My `raw=1`
attempts never reached the server at all (see the Cloudflare note below). After the fix, mpv plays the real MKV
(`file-format mkv`, Opus 7.1, embedded subtitles rendered), see "Direct play on production".

| Check | Result |
|---|---|
| Cloudflare Access login inside the WKWebView | Works with the email one-time code; the session cookie persists across restarts (persistent web view storage) |
| Shell handshake from the real page (`INIT`, `app-ready`) | Works. **Only starts after a profile is chosen** (the picker renders before the app's shell provider mounts), so no `[shell]` log lines on the picker is normal |
| Remote-origin IPC | Needs an **app manifest** (`build.rs` `AppManifest::commands`) plus a capability with `remote.urls` granting only `allow-shell-ipc`; otherwise `shell_ipc not allowed. Plugin not found` |
| Playback | AV1 1920x960 + AAC 2ch (the server-made MP4 copy) hardware-decoded (VideoToolbox), real picture under the real player controls, duration 02:16:53 |
| Click-to-pause, Play button | Works (`pause=yes/no` reach mpv) |
| Seek bar | Works (click at 50% -> `time-pos=4106.77`, scene on screen within seconds) |
| Volume | Works (`volume=61.04`) |
| Audio / subtitles menus | Real track list from mpv (`track-list` node -> JSON); subtitle language list from the UI |
| Resume position | `loadfile ... replace -1 start=+4137` accepted (needs `mpv-version` as `0.42.0`, not `mpv v0.42.0`) |
| Native fullscreen in and out (`f`) | Works; UI tracks state from `win-visibility-changed`. Own-window capture shows the film fullscreen with correct letterbox |
| Leave the Player (Esc / back) | Works: `mpv-command stop`, `end-file stop`, page opaque again |
| End of file | Works: `mpv end-file eof` -> the UI leaves the Player by itself |
| Frame drops | 0 while visible. Drops accumulate at ~15/s only while the window is not on the active Space (e.g. the fullscreen Space when another Space is shown); they stop when it is visible again |

Things found along the way:
- **Server-side remux gets in the way of direct play.** The UI asks for `.../video.mp4`; for an MKV/AVI with no
  MP4 sibling the server live-remuxes to fragmented MP4 with ffmpeg (no duration in mpv, every seek restarts
  ffmpeg), and it starts a background faststart remux that writes a new file. With an MP4 sibling it serves the
  sibling instead of the original. Fix (`server/downloads_manager.js`): `?direct=1` serves the original file as
  stored (Range support, inline, no sibling swap, no background remux, no live remux; still confined to the media
  roots). Tests: `server/test/downloads_direct.nt.js` (5 tests; the 3 direct-play ones fail on the old code), full
  backend suite 192/192. The shell (`shell.rs`) adds `direct=1` to same-origin `/api/downloads/stream/` URLs at
  mpv's `loadfile`, not in the web UI: the UI stores the stream URL with watch progress, so a `direct=1` URL
  stored from the desktop app would break continue-watching in a browser.
- **Cloudflare drops the query string on `.mp4` URLs unless the path ends with a slash** (AGENTS.md,
  `server/streamlinks.js`). So `video.mp4?direct=1` never reached the server (and neither did my earlier `raw=1`);
  the shell sends `video.mp4/?direct=1`. The Express route matches both forms.
- **Cookie hand-off to mpv works.** For same-origin streams the shell reads `CF_Authorization` from the web view
  (`cookies_for_url`, HttpOnly included) and sets mpv's `http-header-fields`; other hosts get nothing.
- **Safety allowlist.** The page is remote content, so `mpv-command` is limited to `stop` and http(s)
  `loadfile` (+ `start=+N`), `mpv-set-prop` to the properties ShellVideo uses, mpv scripts and ytdl are off, and IPC
  is granted only to the one origin in `CINEMA_ORIGIN`. Stream URLs are redacted in logs.
- Side effects on production (all from normal app behaviour, triggered by these tests): watch progress for the
  the chosen profile's progress was written and the film reached its end (probably marked watched); the server created
  an `.mp4` sibling (about 1.5 GB) next to the MKV in the media folder (finished, nothing deleted).
- **Logging.** mpv's `--log-file` records everything (it ignores `msg-level`), including the `Cookie` header handed to
  it, i.e. a live 24 h session. It happened twice into the local scratch `mpv.log` (never the repo); both times
  it was deleted. A first "fix" (lower `msg-level`) did not work. UI mode now never passes a log file
  (`main.rs`, `spike.sh`), and the log stayed at 0 bytes in the final production run. Never enable mpv log files
  against a logged-in remote origin.
- The app's persistent web storage (login session, 24 h) lives in `~/Library/WebKit/dev.homebot.cinema.spike`,
  `~/Library/Caches/dev.homebot.cinema.spike` and `~/Library/HTTPStorages/dev.homebot.cinema.spike.binarycookies`.
- `shell_shim.js` still carries debug code (`window.__shellLog`, a `chrome.webview` getter that records reads);
  remove it before anything beyond a spike.

## Direct play on production (verified)

Deployed as a **hot patch of one file** into the running container (not a rebuild), because the running image is
not what the repo contains: it was built on 2026-11-13 and differs from git HEAD in `http_server.js`,
`server/grabber/stream_info.js`, `server/net_defaults.js`, `server/profiles.js`, `server/proxy_rewrite.js`,
`server/sentinel.js` and the profile avatar images (the repo ships original artwork). A rebuild from this repo, or
from the main checkout, would change all of that. Hot patch: back up the running file, `docker cp` the patched
`server/downloads_manager.js` in, `docker restart homebot-cinema` (about 10 s outage; site, `/api/me` 401 and
`/streaming` all fine afterwards). It is lost if the container is recreated or rebuilt unless the same change is in
the source that gets built. The running original was byte-identical to git HEAD's version.

Rollback: `git show HEAD:server/downloads_manager.js > /tmp/dm.js && docker cp /tmp/dm.js
homebot-cinema:/var/www/stremio-web/server/downloads_manager.js && docker restart homebot-cinema`.

Result with the real UI, real clicks, production login: mpv plays the original MKV (`file-format mkv`, AV1 hardware
decoded, **Opus 7.1**, duration 02:16:53 known from the start), seeking to the middle works (position 1:08:30,
3 dropped frames at the jump), embedded subtitles are rendered by mpv, the server logged no remux, and the mpv log
file stayed empty. The server change is its own commit on this branch (`Add ?direct=1 ...`), so it can be cherry-picked on its own.

## No server transcode in the app (`window.qt` in the shim)

Upstream stremio-video wraps ShellVideo in `withStreamingServer` too. Unless `window.qt` exists (the old Qt shell)
it asks the streaming server to probe every stream (`/hlsv2/probe`, seconds on a cold torrent) and, when the file
has embedded subtitles, two or more audio tracks, HEVC, DTS and so on, sends it through an HLS transcode that mpv
then plays. Measured on production with a plain H.264 + AAC torrent: probe, then `/hlsv2/<id>/master.m3u8`. The
transcode also re-encodes HEVC to H.264 without tone-mapping, which is what makes HDR look washed out.

`shell_shim.js` now defines `window.qt = {}` (nothing else in the production bundle reads it), so the UI hands mpv
the stream as is. Same title and stream afterwards: no `/hlsv2/` request at all, the server sees `GET /<hash>/0`,
`start latency: 135 ms`. This needs no server or UI deploy. HDR check: a synthetic HDR10 clip (BT.2020 / PQ, made
from SMPTE bars) next to the same picture in SDR: through the app's render layer the bar colours match within a few
levels (for example 191 vs 181-189), nothing washed out. Not tested: real Dolby Vision profile 5 (needs a sample)
and HLG.

## Not tested

- Selecting among several audio tracks (the film has one), external/addon subtitles (ShellVideo only handles embedded tracks), media keys, Cast, window dragging
- Torrent streams through `/streaming/...` (the cookie hand-off is the same mechanism, but only `/api/downloads/stream` was played), and the Access session expiring mid-playback (24 h)
- HDR / Dolby Vision (C's `NSOpenGLLayer` path was only run as SDR; mpv's Vulkan path, as used by B, may handle HDR better, untested), 4K, audio passthrough
- Real mouse clicks (computer-use screen recording was not granted; clicks were simulated from JS)
- Window dragging across displays / scale-factor changes, Spaces, multiple monitors, ProMotion
- The plugin's own prebuilt `libmpv-wrapper` binary (not run: third-party binary). Only the same `--wid` mechanism was tested
- Windows / Linux (`--wid` embedding may still be fine there)

## Run it

```bash
brew install rust mpv ffmpeg
cd desktop
./scripts/spike.sh clip              # test clip
CINEMA_ORIGIN=https://your-host ./scripts/spike.sh build   # builds into $TMPDIR/cinema-spike (or $SPIKE_HOME)
./scripts/spike.sh run render        # or: child | wid | ui (needs SPIKE_URL=https://your-host)
./scripts/spike.sh snap shot1        # PNG of the app's own window (no Screen Recording permission needed)
./scripts/spike.sh cmd fullscreen on # drive it: snap region attach dump mpv eval resize fullscreen simplefs quit
./scripts/spike.sh status
```

## Quick DMG (Apple Silicon, for the Mac it was built on)

```bash
CINEMA_ORIGIN=https://your-host ./scripts/package-dmg.sh   # -> release/HomeBot-Cinema-<version>-arm64.dmg
```

A release build (cargo feature `dev-tools` off: the file-based command channel, snapshots and the `SPIKE_*` test
knobs are compiled out), an ad-hoc signed `HomeBot Cinema.app` with the repo's brand icon, and a DMG with an
Applications shortcut. It launches by double-click with no environment: it loads the origin baked in at build time
(`CINEMA_ORIGIN`), uses the render-API player, and keeps its web storage (sign-in) between launches.

Limits: libmpv is **not** bundled (the target Mac needs `brew install mpv`; without it the app shows an alert);
ad-hoc signed and not notarized (a DMG you move yourself opens normally, a downloaded one needs right-click > Open);
arm64 only; the origin is fixed at build time; media keys and Cast are not wired. The sign-in lives in
`~/Library/WebKit/dev.homebot.cinema.desktop`. A portable build would need libmpv and its dependencies bundled
(and the GPL implications of that), a Developer ID signature and notarization.

## Home mode (use the server directly when it is on this network)

The app starts on `CINEMA_LOCAL_ORIGIN` (default `http://localhost:3002`) when it answers, otherwise on the public
`CINEMA_ORIGIN`. Public path: Mac -> internet -> Cloudflare -> tunnel -> back to the same Mac (measured about
0.35-0.6 s per request at Cloudflare's edge alone, and the video uses the home upload link). Local path: 2-15 ms.

The server verifies only the signed Cloudflare Access token (header or `CF_Authorization` cookie), not the address a
request comes from. So: sign in once on the public address as before; `home.rs` then gives the same token to the local
address and switches to it. Unreachable local server, missing/expired token, or the UI's "sign out" link (which only
exists at Cloudflare's edge) send the window back to the public address. It never switches mid-playback.

Findings while building it:
- WKWebView accepts a cookie injected through its cookie API for `localhost` but **does not send it**, and wry cannot
  even match cookies for IP-address hosts (`url.domain()` is None). The working way is for the page to set the cookie
  itself (`document.cookie`, an ordinary host-only cookie). Trade-off: that copy is not HttpOnly, so the local page's own
  scripts can read it (at the public address it is HttpOnly). It is the user's own token, short-lived, same machine.
- A first version that re-injected every 3 s reloaded the page in a loop; hand-overs are now limited to 2 attempts per page
  load, after which the app stays on the public address for the run.
- Verified with the dev build: page origin `http://localhost:3002`, `/api/me` 401 -> 200 in about 10 ms, real profiles load.
  The packaged app does one hand-over and then stays quiet.
- Per-origin web storage: the remembered profile and UI settings are separate for the local and public addresses
  (library, progress and profiles live on the server and are shared).
- Settings: build with `CINEMA_LOCAL_ORIGIN=none` to turn it off, or run with `CINEMA_HOME_MODE=0` to force the public
  address. A home-network address (`http://192.168...`) also works; the app allows plain HTTP to local addresses.
- The shell logs `[shell] start latency: N ms from loadfile to first playback position (via <host>)` for each play, to
  compare the two paths. **Not measured yet** (the media disk mounts inside the containers went stale, see below).

## What a real shell must do (from `src/common/Platform/shell/useShell.ts` and stremio-video's ShellVideo)

1. Inject a `chrome.webview` look-alike (`postMessage`, `addEventListener('message')`) at document start,
   because `useShell.ts` reads it once at import time.
2. Answer the INIT handshake with `transport.properties` (`shellVersion`, ...).
3. Map `mpv-command` (`loadfile`, `stop`), `mpv-set-prop`, `mpv-observe-prop` to libmpv and send back
   `mpv-prop-change`, `mpv-event-ended`, `mpv-event-video-ready`.
4. Draw the video behind a transparent webview (this spike, approach C). While rendering happens on the main
   thread, **no other libmpv call (commands, set/observe property, event loop) may run on the main thread**,
   or render.h's deadlock rule bites. Tauri/wry IPC handlers run on the main thread, so the `chrome.webview`
   handler must forward to a worker (or render on Core Animation's thread with `asynchronous = YES`).
   Keep Tauri commands that touch mpv `async`, as in this spike.
   Also send `win-visibility-changed` / `win-state-changed` so `pauseOnMinimize` works.
5. Give mpv a way to authenticate to `/streaming/...` (cookie copy into `http-header-fields`, or a signed
   link scheme like `server/streamlinks.js`; Cloudflare service tokens do not work with `server/auth.js`
   as written, it needs an email in the JWT).
