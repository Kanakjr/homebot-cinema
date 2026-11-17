# HomeBot Cinema: agent guide

Self-hosted household media app: a **stremio-web fork** (React, `src/`) plus our **Node/Express backend** (`http_server.js`,
`server/`). Streams through the Stremio streaming server, downloads via Transmission, auto-fetches episodes (Sentinel).
Optional features are **plugins** (`plugins/<id>/`, each with its own `AGENTS.md`; contract in `docs/plugins.md`).
Read this file instead of exploring; open only the files named here.

**Private install notes:** if `data/LOCAL.md` exists in the main checkout (from a worktree:
`$(git rev-parse --git-common-dir)/../data/LOCAL.md`), read it. Never copy it into tracked files.

## Hard rules
- **No secrets in git or output**: `.env`, API keys, Cloudflare tokens/AUD, `data/` (all gitignored; templates: `.env.example`, `data/addons.example.json`).
- **No stream sources in git**: no scraper/indexer URLs, piracy sites or release-group names (`server/test/content_guard.nt.js`).
  Sources are operator data: `data/addons.json`, `STREAM_ADDON_URL`, quality profiles in the DB.
- **No calls to Stremio's own API**: the core worker's `fetch` is guarded (`src/worker/fetchGuard.js`); `Referrer-Policy: strict-origin-when-cross-origin` (YouTube trailers fail in WebKit with `same-origin`).
  Outside hosts: `docs/third-party-services.md`.
- **Plugin boundaries** (`server/test/boundaries.nt.js`): core never imports `plugins/*`; plugin server code uses only `ctx` and
  `server/sdk.js`; plugins never import each other. New optional features start as plugins.
- **Upstream files**: prefer new files and slots; list every edit to an upstream stremio-web file in `docs/upstream-touchpoints.md` (`pnpm check:upstream`).
- **Deploys** restart the app (~10 s outage): tell the user first. Do not touch Transmission torrents.
- Auth fails closed; `DEV_EMAIL` works only with `NODE_ENV=development`. Test sensitive paths on `localhost`, never the public
  hostname (Cloudflare caches). Stream responses stay `Cache-Control: private, no-store`; media paths must pass `isInsideRoots`.

## Layout
| Path | What |
|---|---|
| `http_server.js` | Entry: auth gate, streaming-server proxy, download/stream routes, core wiring, plugin loading |
| `server/plugins/` | `loader.js` (discovery, `CINEMA_PLUGINS` > `data/plugins.json` > defaults, failure isolation), `context.js` (`ctx`), `hooks.js`, `routes.js` (`/api/plugins`), `testing.js` (`fakeCtx`) |
| `server/sdk.js` | The only core module plugin code may require (also `ctx.sdk`) |
| `server/auth.js`, `db.js` | Cloudflare Access JWT; SQLite (`data/cinema.db`, migrations, `audit()`, `migratePlugin`) |
| `server/profiles.js`, `profile_routes.js` | Household profiles (max 8, PIN, avatars), `/api/sync/*` |
| `server/library/` | Filename parsing, scan/match/delete, `scanTrusted()`, extra "cold" roots (online only with `.cinema-root`, never pruned offline) |
| `server/tmdb.js`, `watch_history.js` | TMDB client (key server-side, `tmdb_ids` cache, `collectionFor`); per-profile watch history |
| `server/upnext.js` | Continue watching "next up" after the furthest episode watched (decodes core's watched bitfield against Cinemeta), Upcoming row |
| `server/grabber/` | Quality profiles (`pickBest`), stream info, magnets, swarm probe (`/api/streams/probe`), `/api/grabber/*` |
| `server/sentinel*.js` | Auto-download monitored shows: scope `new`/`seasons`/`all`, deleted episodes never re-fetched |
| `server/downloads_manager.js`, `transmission.js` | Download records, Transmission RPC, ffmpeg remux |
| `server/events.js`, `snapshots.js` | SSE hints (`/api/events`); daily DB snapshot (keeps 7) |
| `server/proxy_rewrite.js`, `streamlinks.js` | Host rewriting for proxied URLs, HEVC→H.264 for HLS; signed stream links (`.../video.mp4/?exp&sig`, trailing slash on purpose) |
| `plugins/` | `ai`, `find`, `themes`, `skip`, `nowplaying`, `collections`, `similar`, `metalfx`, `telegram`, `gdrive` |
| `src/plugins/` | UI plugin host: registry, `slot()`, `<PluginSlot>` |
| `src/worker/` | Core worker entry with the Stremio API fetch guard |
| `src/common/` | `ssoManager.js` (per-profile storage; complete `DEFAULT_SETTINGS` or the core crashes), `profileManager.js`, `profileGate.js`, `serverApi.js`, `theme.js`, `useServerEvents.js`, `newOnServer.js` |
| `src/routes/` | Our routes: `ServerLibrary`, `Downloads`, `Admin` (incl. Plugins tab); upstream routes with small edits |
| `scripts/` | `new-plugin.js`, `upstream-check.js`, `graft-upstream-history.sh`, `build-site.sh`, `brand/` (icons, avatars) |
| `site/` | GitHub Pages website (`.github/workflows/pages.yml`) |
| `desktop/` | macOS app (Tauri + libmpv); `git tag vX.Y.Z` builds the DMG and attaches it to a GitHub Release (`.github/workflows/desktop.yml`, docs in `desktop/README.md`) |

## Behaviours worth knowing
- Profiles are household-wide; admin is a login (`ADMIN_EMAILS`), not a profile. Streaming-server settings (cache, transcoding)
  are household-wide too: `POST /settings` is admin-only, and Settings › Streaming is read-only for everyone else.
- Streams always sort best-first by the quality profile; dead swarms are demoted; grab returns 422 `no_live_swarm` unless `force`.
- Every profile gets the addons in `data/addons.json` (`/api/addons`, `AutoAddonsLoader`). Bundled defaults carry only metadata, subtitle and public-domain addons.
- Direct play: `GET /api/downloads/stream/:id?direct=1` serves the file as stored (no MP4 swap or remux) for the desktop app's mpv;
  through Cloudflare use `.../video.mp4/?direct=1` (trailing slash).
- Player: HLS buffer 90–240 s (`src/common/hlsConfig.js` via webpack replacement); HEVC forced to H.264 for HLS.
- Interface zoom defaults to 90%. No "new version" banner: updates apply on the next load.
- Home hero: `src/routes/Board/HeroCarousel/pickHeroItems.js`. No "recently added" row by design. Continue watching cards show
  time left, or "Next up" after the furthest episode watched (core itself keeps a finished episode at ~0%); the Upcoming row
  lists the profile's shows airing in the next 14 days (`server/upnext.js`).
- System artwork (empty states, default/signed-out avatar, library/calendar placeholders): the captain mascot, `docs/mascot-art.md`
  (`scripts/brand/process-mascot.py`). An install can override them privately with `data/art/<name>.png`.
- Branding sources: `assets/brand/*.svg`; `scripts/brand/build.js` regenerates icons and splash images.
- Avatars: preset avatars live in `server/avatars/`. An install's own set in `data/avatar-presets/` (gitignored) replaces them
  (`resolvePresetDir` in `server/profiles.js`).

## Commands
```bash
pnpm i
npx webpack --mode production    # UI -> build/ (~12 s)
pnpm test                        # UI (jest: tests/, plugins/*/test/*.spec.js)
pnpm test:server                 # backend (node:test: server/test, plugins/*/test)
pnpm lint                        # src/ and plugins/, 0 errors expected
pnpm plugin:new <id> "Name"      # scaffold a plugin
pnpm check:upstream              # needs the upstream-base tag (docs/upstream-sync.md)
# Desktop app:
zsh desktop/scripts/package-dmg.sh                     # public build (first-run setup wizard)
CINEMA_ORIGIN=<url> CINEMA_LOCAL_ORIGIN=<local> zsh desktop/scripts/package-dmg.sh  # private build (URLs baked in; see data/LOCAL.md)
```
Dev run: `CINEMA_DATA_DIR=<scratch> PORT=3099 NODE_ENV=development DEV_EMAIL=<admin> ADMIN_EMAILS=<admin> CINEMA_PLUGINS=all node http_server.js`
(`NODE_PATH=.cache/server-deps/node_modules` after one `pnpm test:server`). Headless browsers report no window focus: use CDP
`Emulation.setFocusEmulationEnabled` for focus-dependent syncs.

## Config
Core env (see `.env.example`): `CF_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS`, `OWNER_PROFILE_NAME`, `CINEMA_PLUGINS`,
`CINEMA_DATA_DIR`, `STREMIO_SERVER_HOST/PORT`, `TRANSMISSION_HOST/PORT`, `LIBRARY_MOVIES_DIR`, `LIBRARY_TV_DIR`, `MEDIA_ROOTS`,
`STREAM_ADDON_URL`, `TMDB_API_KEY`, `WATCH_REGION`, `PUBLIC_HOSTS`, `DASHBOARD_URL`, `HLS_FORCE_H264`, `DEFAULT_TRACKERS`.
Plugin settings are listed in each `plugin.json`.

## Conventions
- Backend CommonJS, 4-space indent; no new server deps without need (the image installs only `express@4` and `jose@5`).
- Every backend change comes with a `*.nt.js` test; keep everything green.
- Download quotas are stored but not enforced (by decision).
