# Plugin `remote`: Cast & Remote Control

Push-to-play casting and real-time remote control between devices (e.g. Android phone controlling a Mac Mini desktop app).
Contract: `docs/plugins.md`.

## Architecture & How It Works
- **Server Broker (`server/targets.js`, `server/index.js`):**
  - Manages active Target Screens (receivers) and Controllers (remotes) in memory.
  - No proprietary Google Cast or DIAL hardware required; both devices talk to the HomeBot Cinema Express server.
  - **Receiver SSE (`GET /api/remote/target/events`):** Target screens connect to a persistent SSE stream to receive commands (`play`, `pause`, `seek`, `volume`, `key`, `navigate`, `search`) with sub-50ms latency.
  - **Controller SSE (`GET /api/remote/events`):** Remotes receive real-time target discovery and state updates.
  - Commands are delivered immediately if target is connected; queued in a FIFO buffer if reconnecting.
  - Inactive targets are pruned after 45 s TTL.
- **Client Receiver Bridge (`ui/ReceiverBridge.js`, slot `appOverlays`):**
  - Auto-starts on target screens (default: native macOS desktop app / Mac Mini).
  - Receives `play` commands and navigates to the player route (`#/player/...`) with direct playback.
  - Receives `key` commands and dispatches synthetic KeyboardEvents (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, `Escape`, `Space`, `KeyF`).
  - Intercepts stream clicks on controller devices when connected to a target, pushing playback to the target instead of loading locally.
- **Player Bridge (`ui/PlayerReceiverBridge.js`, slot `playerOverlays`):**
  - Hooks into `Player.js` to provide instant direct seeking (`seekTo`), episode progression (`playNext`), and play/pause.
  - Reports high-precision playback state to `/api/remote/target/state` every 5 s and on state change so remote scrubbers stay synchronized.
- **UI Components:**
  - `ui/CastButton.js` (slot `navButtons`): Cast icon in top bar with active target status dot.
  - `ui/CastMiniBar.js` (slot `appOverlays`): Floating mini-player bar at bottom of screen when casting while browsing on phone.
  - `ui/RemoteSheet.js` (slot `appOverlays`): Slide-over drawer with device picker, media controls, seek slider, volume, and virtual D-pad.
  - `ui/RemoteRoute.js` (slot `routes`, path `#/remote`): Dedicated full-screen TV remote app with keyboard search, showcase artwork, tactile D-pad, and quick launch shortcuts.
  - `ui/Settings.js` (slot `settingsSections`): Settings > Remote & Cast (rename screen, toggle receiver).
  - `ui/MetaDetailsCast.js` (slot `metaDetailsSections`): Quick-cast banner on movie and series pages.
  - `ui/logic.js`: Pure helpers (tested in Jest).

## Routes
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/remote/targets` | List online target screens |
| `POST` | `/api/remote/target/register` | Register / heartbeat screen with device info |
| `POST` | `/api/remote/target/state` | Update now-playing playback status |
| `GET` | `/api/remote/target/events?targetId=` | SSE stream for target screens to receive commands |
| `POST` | `/api/remote/targets/:id/command` | Dispatch command (`play`, `pause`, `seek`, `key`, etc.) |
| `GET` | `/api/remote/events` | SSE stream for controller remotes |
| `DELETE` | `/api/remote/targets/:id` | Remove target |

## Tests
- `test/remote.nt.js`: Backend tests (node:test) covering registration, SSE command push, queuing, state updates, TTL pruning, and route handlers. Run: `pnpm test:server`.
- `test/remote.spec.js`: Frontend unit tests (jest) covering pure logic, time formatting, progress calculation, device detection, and slot registry. Run: `pnpm test`.
