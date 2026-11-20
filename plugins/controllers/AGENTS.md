# Plugin `controllers`

UI-only plugin for game controllers in the macOS desktop app.
- **Settings > Controllers:** connected controllers with battery level, layout preset, a remap menu per button and per stick, and a live highlight of the button being pressed.
- **Toasts:** "connected" and "battery low" notices.

In a normal browser the section shows only a hint, because `window.__cinemaPad` does not exist there.

## Where the work happens (not in this folder)
- **`desktop/src-tauri/src/gamepad/gamepad_bridge.m`:** reads controllers through Apple's GameController framework.
  - It polls at 60 Hz on the main queue rather than using valueChangedHandler, because WebKit's own gamepad provider shares the process.
  - It keeps the Xbox/Home button for the app.
  - Battery reads as unknown until the controller reports it.
- **`desktop/src-tauri/src/gamepad.rs`:** pushes changes into the page with `window.__cinemaPad.update({ pads })`.
  - It also re-sends once a second while a controller is connected.
  - Each pad carries `since` (Unix ms when it connected).
- **`desktop/src-tauri/src/gamepad_shim.js`:** injected at document start.
  - **Mapping:** turns presses into actions, using the layout presets `tv` (default) and `stremio`.
  - **Key presses:** sends synthetic key presses with `keyCode` (arrows, Enter, Escape/Backspace, player letters J/L/S/C/A/I/M/F). Select also clicks the focused element when no handler took the Enter.
  - **Shell signals:** play/pause and next episode use the shell `media-key` signal.
  - **Gamepad API:** serves `navigator.getGamepads()` and the gamepad events from the native state, and keeps WebKit's own Gamepad API idle.
  - **Saved layout:** stored per origin in `localStorage` key `cinema.controller.v1`.
  - **Tests:** `tests/gamepadShim.spec.js` (jest).

## `window.__cinemaPad`
- `getState()` returns `{ pads: [{ slot, id, buttons[18], axes[4], battery, charging, connectedAt, pressed }], config, bindings, capturing }`.
- `subscribe(fn)` returns an unsubscribe function.
- Config: `getConfig()`, `setConfig(cfg)`, `resetConfig()`.
- `capture(fn)` sends the next press to `fn(input, slot)` instead of its action.
- Constants: `INPUTS`, `INPUT_LABELS`, `STICKS`, `STICK_LABELS`, `STICK_MODES`, `ACTIONS`, `PRESETS`.

## Files
| Path | Purpose |
|---|---|
| `ui/index.js` | Slots: `settingsSections` (`controllers`), `appOverlays` (`controllers-toasts`) |
| `ui/Settings.js`, `ui/Settings.less` | The Controllers section |
| `ui/Toasts.js` | Connect and low-battery toasts. It announces only controllers that connected less than 10 s ago (`justConnected`), so a page reload does not toast |
| `ui/usePad.js` | Subscribes to `window.__cinemaPad`, at most one render per animation frame |
| `ui/logic.js` | Pure helpers, tested in `test/controllers.spec.js` |

Tests: `npx jest --roots plugins --testPathPattern controllers`.
