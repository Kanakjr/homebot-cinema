# Plugin `nowplaying`: Admin > Now playing

Contract: docs/plugins.md. Only what is special here.

- UI `ui/Reporter.js` (slot `playerOverlays`, renders nothing): heartbeat `POST /api/nowplaying` every 15 s and on play/pause,
  `POST /api/nowplaying/stop` on a new title, on leaving the player and on `pagehide` (fetch `keepalive`, so the profile
  headers go along; `sendBeacon` cannot send them). One random session id per title per tab.
- Transcoding = the page fetched `/hlsv2/` playlists or segments (not `/hlsv2/probe`) in the last 20 s, seen through a
  `PerformanceObserver` on resource timings (hls.js runs on the page). Direct play otherwise.
- Server `server/sessions.js`: memory only (never on disk), 45 s TTL, 50 sessions max, fields validated; `GET /api/nowplaying`
  is admin-only. The login and profile come from the request, never from the body.
- UI `ui/NowPlaying.js`: slot `adminTabs`, polls every 5 s while visible.
- Tests: `test/nowplaying.nt.js` (sessions, routes), `test/nowplaying.spec.js` (reporter helpers).
