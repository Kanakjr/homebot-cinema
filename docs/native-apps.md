# Native apps (plan)

The web app (installable as a PWA) stays the main client. Native desktop apps add one thing a browser cannot do: **play files
as they are** (HEVC/AV1 in MKV, Dolby/DTS audio, several audio tracks, embedded subtitles) without a server transcode. That
means faster starts, no washed-out HDR, and no MKV-to-MP4 copies on disk.

## Design (same on every OS)
- **Tauri 2** window whose web view loads your own server, so every web feature and plugin works unchanged.
- **libmpv** renders video under the transparent web view in the same window. The web player's controls drive mpv through
  the "shell" bridge that upstream Stremio's desktop app also uses. The player skips the server probe and transcode.
- **Home mode**: when the server answers on the local network, use it directly instead of going through Cloudflare.
- The server address is a first-run setting, so one download works for every install.

## Status
| Platform | Web view + video | State |
|---|---|---|
| macOS (Apple Silicon) | WKWebView + libmpv OpenGL render API, VideoToolbox decode | **In `desktop/`**: first-run server screen, direct play, home mode, DMG built and published by CI |
| Windows 10/11 | WebView2 + libmpv (D3D11) | Not started |
| Linux | WebKitGTK + libmpv (EGL) | Not started |
| Mobile | | PWA for now |

## Roadmap
1. ~~Merge the macOS app into `desktop/`; server address setting~~ done. Still to do: media keys, pause on minimize.
2. macOS signing and notarization; bundle libmpv in the app.
3. Windows port and signed installer; Linux AppImage, then Flatpak.
4. ~~GitHub Actions builds on each tag, attached to a GitHub Release~~ done for macOS (`.github/workflows/desktop.yml`); add Windows/Linux jobs with their ports. In-app updates (`tauri-plugin-updater`) later.
5. The website's download section links to the latest release (done for macOS).

## Watch out for
- **Licences**: the project is GPL-2.0; ship mpv/FFmpeg licence texts and a source offer with every binary.
- **Sign-in**: mpv needs the Cloudflare Access cookie as a request header; never let mpv write a log file against the
  logged-in origin (it would record the cookie).
- A hidden or minimized window drops frames; pause on minimize.
- OpenGL is deprecated on macOS (still works); libmpv has no Metal backend yet.
