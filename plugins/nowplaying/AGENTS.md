# Plugin `nowplaying`: Admin > Now playing and Watch stats

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

## Watch history and stats (Tautulli-style)
- `server/history.js`: table `nowplaying_plays` (plugin migration), one row per play (session = one title in one tab), upserted on
  every heartbeat and on stop, so a closed tab loses at most 15 s. Kept once it has **30 s of real watching**: `sessions.js` adds
  the time since the previous heartbeat only when that one was playing (gap capped at 65 s, session TTL 75 s). A play counts as
  transcoding if any heartbeat did. Retention `NOWPLAYING_KEEP_DAYS` (default 730, 0 = forever), pruned daily.
- Routes (`server/index.js`): `GET /api/stats/summary?days=7|30|90|365&tz=<Date#getTimezoneOffset()>&profile=<id|all>`,
  `/api/stats/history?q=&limit=&offset=&profile=`, `/api/stats/history.csv`. **Scope:** admins may pick any profile or everyone;
  anyone else always gets the profile they are using (the `profile` parameter is ignored, `profiles` ranking is empty).
- Days, the hour x weekday grid and streaks are computed in the viewer's time zone (`tz`); the server never guesses it.
- UI: `ui/StatsPage.js` (route `#/stats`, top-bar button, and Admin > Watch stats) draws plain SVG/CSS charts in the profile accent
  (one hue: magnitude, not identity); helpers in `ui/statsLogic.js`. CSV is fetched with the profile headers and saved via a blob.
- The player passes `showName` (not `name`: `<PluginSlot name=...>` is the slot name, and `tests/pluginHost.spec.js` guards it).
- Tests: `test/history.nt.js` (watch time, 30 s rule, summary, CSV, scope), `test/stats.spec.js`.
