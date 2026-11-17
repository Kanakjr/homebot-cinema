# Plugin: metalfx

Real-time Apple MetalFX AI 4K Spatial Super-Resolution for the HomeBot Cinema macOS native desktop app.

## What it does
- Detects macOS native desktop execution environment (`window.__TAURI__`, `window.chrome?.webview`, or `platform.shell`).
- Adds the interactive **4K AI** control button to the bottom-right playback controls bar (`slot playerControls`).
- Adds the interactive **Live GPU Telemetry & Settings** panel overlay (`slot playerOverlays`) with click-outside auto-dismiss.
- Interacts with the native macOS layer (`desktop/src-tauri/src/metal/` and `src/metalview.rs`) via Shell Protocol (`metalfx-set-upscale`, `metalfx-get-status`, and `metalfx-status-changed`).
- Adds a **MetalFX 4K Upscaler** section to Settings (`slot settingsSections`) with hardware detection and benchmark statistics.
- Exposes `GET /api/metalfx/status` for backend status and telemetry.

## Layout
| File | Role |
|---|---|
| `plugin.json` | Plugin manifest (id: `metalfx`) |
| `README.md` | Comprehensive architectural and benchmark documentation |
| `server/index.js` | Server routes (`/api/metalfx/status`) |
| `ui/index.js` | UI slots (`playerControls`, `playerOverlays`, `settingsSections`) |
| `ui/useMetalFx.js` | Hook managing native desktop IPC, live telemetry polling, and state |
| `ui/MetalFxButton.js` | Player control button in the bottom-right bar (`playerControls`) |
| `ui/MetalFxButton.less` | Styling for the 4K AI button and badge |
| `ui/MetalFxStatsOverlay.js` | Interactive toggle & live telemetry overlay panel (`playerOverlays`) |
| `ui/MetalFxStatsOverlay.less`| Glassmorphic styling for telemetry overlay |
| `ui/Settings.js` | Settings section for MetalFX options and benchmark stats (`settingsSections`) |
| `ui/Settings.less` | Settings panel styling |
| `test/metalfx.nt.js` | Backend node:test suite (runs under `pnpm test:server`) |
| `test/metalfx.spec.js` | Frontend Jest test suite (runs under `pnpm test`) |

## Boundaries
- Follows HomeBot Cinema plugin rules: core never imports `plugins/metalfx/*`.
- Server code uses only `ctx` and `server/sdk.js`.
- Never imports other plugins.
