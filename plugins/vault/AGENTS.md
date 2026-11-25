# Plugin `vault`: Locked folder

Contract: docs/plugins.md. This file is only what is special about this plugin. Setup for people: `README.md`.

A folder of private videos (`VAULT_DIR`, e.g. `/Locked`) behind its own passcode, for the **admin login on the unlocked
owner profile** only. It is a folder + thumbnail gallery with its **own index**, never part of the core library.

## Invariants (do not break)
- `VAULT_DIR` never overlaps `MEDIA_ROOTS` or a library root (`ctx.services.library.allowedRoots()`): `register` disables
  the plugin otherwise. That is what keeps core routes (library, search, calendar, copilot, `/api/downloads/stream/<path>`)
  from ever listing or serving these files. Never add the vault to the core library tables.
- Every `/api/vault/*` response is `Cache-Control: private, no-store`, and `stream`/`thumb` URLs never end in a media or
  image extension (Cloudflare caches by extension).
- No names in the activity log (`audit(..., null)`), no outside lookups (thumbnails and durations come from local
  ffmpeg/ffprobe), no watch history: playback uses the bare player route named "Locked folder" with `cinema_private=1` in
  the URL; `src/common/privatePlayback.js` makes `nowplaying` skip it and `remote` report no title.

## Server (`server/`)
- `secrets.js`: scrypt passcode (6–64 chars; digits-only = number pad), 5 wrong tries → 15 min lockout (stored in
  `vault_config`, survives restarts). Sessions are memory only (restart = locked), bound to the login email, die after
  `VAULT_AUTOLOCK_MIN` idle (default 10) or 12 h. Grants (`?g=`) are per file + login + session, 6 h; they die with the session.
- `store.js`: tables `vault_config`, `vault_files` (rel_path, folder, name, size, mtime, duration_ms, thumb_state 0/1/-1),
  `vault_progress`. Scan = walk `VAULT_DIR` (videos only, ≥ 50 KB, no hidden/`._` files). Online needs the `.cinema-root`
  marker; offline or an unlistable sub-folder never drops rows.
- `thumbs.js`: same-name cover image, else a frame 10% in (max 60 s), `scale=480:-2`, at low CPU priority; on-demand
  requests jump the queue; background fill, 2 at a time; failures are remembered (`thumb_state = -1`). Stored on the locked
  drive itself in `VAULT_DIR/.cinema-thumbs/` (hidden, so the scan skips it; created only while the drive is online), never
  in `data/`, which backups may copy to the cloud. File names do live in `cinema.db` (`vault_files`).
- `routes.js`: `status`, `setup`, `unlock`, `lock`, `browse?folder=&q=&sort=`, `thumb/:id?vt=`, `link/:id`,
  `stream/:id?g=` (login + grant only: mpv in the Mac app carries just `CF_Authorization`), `progress/:id` (grant auth,
  so the player works after a reload), `DELETE files/:id` (also removes same-name text sidecars: .json/.info.json/.nfo/.srt/.vtt/.description; never images, which can be photos of their own), `rescan`.
- `scripts/reset-passcode.js`: host-only reset (`docker exec homebot-cinema node plugins/vault/scripts/reset-passcode.js`).

## UI (`ui/`)
- `serverLibraryTiles` → `VaultTile.js` (only when `isAdmin()` and `/api/vault/status` answers).
- `routes` `/vault?f=<folder>` → `VaultRoute.js` (+ `Passcode.js`). The token lives in `vaultState.js` memory only; any
  401 `vault_locked` forgets it. Client auto-lock after `autolockMin` without input on the page.
- `playerOverlays` → `ResumeOverlay.js`: resume (> 30 s, < 95%) and save every 15 s (60 s while paused, which keeps the
  session alive while a video is open).
- Browsers play mp4/m4v/webm; other formats only in the Mac app (`window.qt`), no transcoding.

## Tests
`test/vault.nt.js` (secrets, index, thumbnails, routes incl. no login / other login / Lock / lockout / delete),
`test/vault.spec.js` (UI logic, private playback flag, slots).
