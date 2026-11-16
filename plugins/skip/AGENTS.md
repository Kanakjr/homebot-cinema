# Plugin `skip`: Skip intro / recap / credits

Contract: docs/plugins.md. This file is only what is special about this plugin.

- **Server** (`server/`): `GET /api/skip/segments?videoId=tt…[:S:E][&file=lf_<library file id>]` ->
  `{ segments: [{ type, start, end, source }], introdb }`, times in **seconds**. Types: `intro`, `recap`, `credits`, `postcredits`.
  - Sources, best first per type: chapter markers in a server library file (`ffprobe -show_chapters`, only for `lf_<n>` ids
    resolved through `ctx.services.library.filePath` and `ctx.sdk.isInsideRoots`), then IntroDB (`api.introdb.app/segments`).
  - IntroDB is asked on demand only (its terms forbid crawling), cached in `skip_segments` (found: 7 days, empty: 1 day,
    errors: never). Only the IMDb id, season and episode leave the server. `SKIP_INTRODB_URL=off` turns it off.
  - Credits never run into a post-credits scene (`trimCreditsBeforeScene`); implausible lengths are dropped (`validSegment`).
- **UI** (`ui/`): slot `playerOverlays` (`SkipOverlay.js`) and `settingsSections` (`Settings.js`).
  - The player speaks **milliseconds**; `ui/logic.js` `toPlayerSegments` is the only conversion, and drops/clamps segments
    that do not fit this file (community times may be for another cut).
  - Per-profile prefs in `profile.settings.skip = { autoIntro, autoRecap, upNextAtCredits }` (not in stremio-core settings:
    `DEFAULT_SETTINGS` must stay complete). Always save the whole `skip` object (the server merges one level deep).
  - Auto-skip only within 3 s of a segment's start, once per playback, with Undo. Credits that run to the end of an episode
    become "Next episode" (`playNext`), because seeking to the very end makes the player leave.
  - `reportCreditsStart(ms)` opens the core Up Next popup at the credits start, only when they start in the last 10 minutes
    and the second half (`creditsStart`). The player ties the hint to the current stream.
- **Core touchpoint**: `src/routes/Player/Player.js` renders the slot and ORs `creditsStarted` into `nextVideoPopupOpen`
  (listed in docs/upstream-touchpoints.md).
- Tests: `test/skip.nt.js` (server, fake IntroDB and ffprobe), `test/skip.spec.js` (timing logic).
- Not done yet: segment marks on the seek bar; anime (AniSkip needs MAL ids); submitting times back to IntroDB.
