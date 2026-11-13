# HomeBot Cinema — agent guide

Self-hosted, multi-user media app: a **stremio-web fork** (React, `src/`) plus our own **Node/Express backend** (`http_server.js`, `server/`).
Streams torrents via the Stremio streaming server, downloads to the owner's disk via Transmission, and auto-fetches new episodes (Sentinel).
Read this file instead of exploring the repo; open only the files named here.

## Hard rules
- **Never commit or print secrets**: Telegram token, Cloudflare tokens/AUD, API keys, `data/stream_secret.key`, `data/addons.json` (may contain personal addon URLs), `.env`. Use `.env.example` / `data/addons.example.json` as templates.
- **Do not deploy without telling the user first** (restart = ~10 s outage). Do not touch Transmission torrents. Do not work around permission denials.
- Never test sensitive paths via the public hostname (Cloudflare caches responses); use `localhost:3002`.
- Auth fails closed. `DEV_EMAIL` only works with `NODE_ENV=development`.
- Keep stream responses `Cache-Control: private, no-store`. Media file paths must pass `server/media_paths.js` `isInsideRoots`.

## Layout
| Path | What |
|---|---|
| `http_server.js` | Express entry: auth, proxy to streaming server, stream/download routes, wiring of all modules |
| `server/auth.js` | Cloudflare Access JWT verification (jose), `requireLogin/requireAdmin`, `ADMIN_EMAILS` |
| `server/db.js` | SQLite (`node:sqlite`) at `data/cinema.db`, migrations v1–v3, `audit()` |
| `server/profiles.js`, `profile_routes.js` | Household profiles (max 8, optional PIN, avatars from `server/avatars/`), `/api/sync/*` |
| `server/library/` | `parse.js` (filenames), `library.js` (scan/match/delete, `scanTrusted()`), `routes.js` |
| `server/grabber/` | `quality.js` (profiles, `pickBest`/`evaluate`), `stream_info.js`, `magnet.js`, `store.js`, `routes.js` (`/api/grabber/*`), `swarm_probe.js` + `probe_routes.js` (`/api/streams/probe`) |
| `server/sentinel.js`, `sentinel_state.js` | Auto-download monitored shows (release candidates come from the stream addon in `STREAM_ADDON_URL`; none is built in). Per-show **scope** (`new` / `seasons` / `all`; default `new`; old entries without one = `all`); reconciliation of deleted episodes (`skippedEpisodes`, 24 h grace) |
| `server/smart/` | `tmdb.js` (TMDB discover client, SQLite `tmdb_ids` cache, key stays server-side), `routes.js` (`GET /api/find`, `/api/find/options`) |
| `server/ai/` | AI copilot (Gemini, GrowwTrader-style): `gemini.js` REST client, `brief.js` per-profile brief (titles only), `tools.js` (TMDB find/search/details, server library, downloads, watch history, `present_titles`, `stage_download`, `stage_monitor`), `staging.js` (in-memory staged actions, 10 min), `agent.js` (loop, `MAX_ROUNDS` 6, false-claim guard), `routes.js` (`/api/ai/*`, rate limit), `index.js` wiring. `server/grabber/grab.js` is the shared pick-and-queue code |
| `server/events.js`, `snapshots.js` | SSE hub `GET /api/events` (downloads/library/sentinel hints + Transmission watcher); daily `VACUUM INTO data/snapshots/` (keeps 7) |
| `server/downloads_manager.js`, `transmission.js` | Download records (`downloads.json`), Transmission RPC, ffmpeg remux |
| `server/proxy_rewrite.js` | Rewrites the hosts the browser used (the request's own host + optional `PUBLIC_HOSTS`) to internal ones in proxied URLs; `forceH264ForHls` (env `HLS_FORCE_H264=0` disables) |
| `server/streamlinks.js` | HMAC-signed stream links `/api/downloads/link/:id` -> `.../video.mp4/?exp&sig` (trailing slash required: Cloudflare drops queries on `.mp4`) |
| `server/admin_routes.js` | Admin API (overview, people, activity) |
| `server/test/*.nt.js` | Backend tests (node:test) |
| `src/common/` | `profileManager.js`, `profileGate.js`, `ssoManager.js` (per-profile storage; complete `DEFAULT_SETTINGS` required or core crashes), `qualityProfile.js`, `serverApi.js`, `theme.js` |
| `src/routes/` | `Board` (Home hero; no "recently added" row, the user did not want it), `MetaDetails` (+`StreamsList`, `MediaDownloadBar`: collapsed slim line by default, state remembered, Sentinel season picker inside), `ServerLibrary`, `Downloads` (activity + Sentinel), `Copilot` is a component (`src/components/Copilot`, state in `src/common/copilotState.js`, sparkle button in `HorizontalNavBar`), `Find` (smart filters at `#/find`, linked from Discover: minimal pill bar + Advanced panel; right-hand info panel like Discover: hover/focus a poster to fill it, phones get a bottom sheet; grouped Quick picks live in `Find/presets.js`, checked by `tests/findPresets.spec.js`; default is 200+ votes so 1-vote 10.0 titles do not top the list), `Settings/Appearance`, `Calendar` (on-server / auto-download markers), `Admin`, `Library`, `Player` |
| `src/common/` (added) | `useServerEvents.js` (shared EventSource, polling fallback), `newOnServer.js` (Library badge + toast), `i18nLanguages.js` (only en-US is bundled; other languages load on demand) |
| `src/components/ProfilePicker`, `PageHeader`, `ContinueWatchingCard` | Nuvio-style UI pieces |
| `data/` | Runtime state, **gitignored** except `addons.example.json` |
| `docs/screenshots/` | README images (names listed in its README) |
| `scripts/brand/` | One-off generators: `build.js` (icons, splash), `make-avatars.js` (preset profile avatars, original artwork) |

## Key behaviours
- **Profiles are household-wide**; admin is a *login* (email in `ADMIN_EMAILS`), not a profile.
- **Quality profiles** (built-in: 4K Ultra HD, 4K Efficient, HD Balanced = default, Direct Play, Space Saver). Per-quality size limits; `pickBest` returns reasons. Stream list always sorts best-first.
- **Swarm probe**: reads 512 KB from a random mid-file offset + peer stats -> good/slow/dead/unknown (cached 5 min, max 6 per request). Dead swarms are demoted in UI; grab/Sentinel pick the best non-dead (`chooseLive`), `/api/grabber/grab` returns 422 `no_live_swarm` unless `force`.
- **AI copilot** (sparkle button, drawer on the right): Gemini with tools and a live brief each turn. **It can only STAGE** a download (one movie/episode, best live release for a quality profile) or a monitor (admin only); the user presses Confirm on the card (`POST /api/ai/staged/:id/confirm`, owner login + profile only, 10 min expiry, 409 if not pending). Never let it claim something started without a successful stage tool (`agent.js` guard). Brief and tools use titles only, never emails/profile names; `present_titles` only accepts ids a tool returned this turn or the brief listed; kids profiles get a kid-safe TMDB subset (`kidSafe`), no server titles, no staging. Rate limit 30 turns/10 min and 200/day per login. Needs `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`); hidden for non-admins when unset.
- **Addons and sources**: every profile gets the list in `data/addons.json` (served by `/api/addons`; `AutoAddonsLoader` installs what a profile is missing from it). The bundled `src/common/defaultAddons.json` and `data/addons.example.json` are only a fallback/template and carry metadata, subtitle and public-domain addons, no torrent scrapers. Where Sentinel and the copilot look for releases is the operator's choice (`STREAM_ADDON_URL`).
- **Profile avatars**: `server/avatars/*.png` are original artwork (`scripts/brand/make-avatars.js`). Older checkouts may still hold character images; they are git-ignored and must never be committed.
- **Smart filters** (`#/find`): TMDB `discover` (rating, votes, genre, language, runtime, year, "streaming on X in <region>") mapped to IMDb ids. Needs `TMDB_API_KEY`; region `WATCH_REGION` (default IN). Uses `api.tmdb.org` because some ISPs reset TLS to `api.themoviedb.org`. TMDB ratings differ slightly from IMDb.
- **Sentinel**: per-show `profileId`; new downloads go to `/TV/<Show>/Season NN`; episodes deleted from disk move to `skippedEpisodes` and are never re-fetched until `POST /api/sentinel/redownload`.
- **Player buffer**: HLS playback keeps ~90-240 s ahead (`src/common/hlsConfig.js` replaces the library's config via a webpack `NormalModuleReplacementPlugin`; upstream was 50 s / 60 MB). Direct MP4 playback is Chrome-managed: measured ~21 s ahead for a 2 Mbps file, not configurable from the page. Torrent data is cached server-side (`cacheSize` 10 GB in the Stremio server settings), independent of the browser buffer.
- **Interface zoom**: default 90% (choices 70-175 in `src/common/interfaceScaleOptions.js`; the Settings slider moves by choice, not by a fixed step). `useInterfaceScale` moves profiles still on the old default (100) to 90 once per profile (localStorage marker `homebot_zoom_default_90:<scope>`), after the core's own first-run rewrite has settled. Reset shortcut returns to 90.
- **Branding**: the mark is a house with a play button cut out (orange-to-gold). Sources `assets/brand/*.svg`; `scripts/brand/build.js` (one-off, needs puppeteer-core + Chrome) regenerates favicons, PWA/maskable/monochrome/apple-touch icons, `logo.png`/`stremio_symbol.png` and all iOS splash images. In-app: `src/components/BrandMark` (nav logo, profile gate lockup); `src/index.html` has a static boot screen inside `#app` (React replaces it) plus meta tags; `manifest.json` uses black theme/background.
- **Home hero**: titles chosen by `src/routes/Board/HeroCarousel/pickHeroItems.js` (mix of the first 4 loaded catalogs, round-robin; movies/series with IMDb id only; skips watched and Continue-watching titles; max 8). The carousel has round see-through prev/next buttons, arrow keys, swipe, pause on hover/keyboard focus/hidden tab, and drops slides whose backdrop fails to load.
- **No update banner**: `src/App/WebUpdateScreen` renders nothing for the "new version available" prompt (the user got it after every deploy). A waiting service-worker update applies on the next page load (brief splash).
- **HLS**: HEVC is forced to H.264 re-encode (stalls otherwise). Stremio server has no HW accel, `transcodeConcurrency` 2.

## Commands
```bash
pnpm i                      # deps
npx webpack --mode production   # build UI (~12 s) -> build/
pnpm lint                   # eslint (known pre-existing errors in Stream.js propTypes, ssoManager.js)
pnpm test:server            # backend tests (installs express+jose into .cache/ once); UI helper test: npx jest tests/serverPlayerPath.spec.js
# deploy (the compose file is yours, see docker-compose.example.yml): tell the user first
docker compose up -d --build homebot-cinema
```
Fast dev loop: build UI, copy `http_server.js`+`server/` to a scratch dir, run with `NODE_ENV=development DEV_EMAIL=<admin> ADMIN_EMAILS=<admin>`, drive with headless Chrome (puppeteer-core). Clear the service worker in the test browser; delete the Chrome profile afterwards (it holds cookies).

## Config (env; see `.env.example`)
`CF_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS`, `OWNER_PROFILE_NAME`, `TELEGRAM_BOT_TOKEN/CHAT_ID`, `STREMIO_SERVER_HOST/PORT`, `TRANSMISSION_HOST/PORT`, `LIBRARY_MOVIES_DIR`, `LIBRARY_TV_DIR`, `HLS_FORCE_H264`, `DEFAULT_TRACKERS`, `TMDB_API_KEY`, `WATCH_REGION`, `TMDB_API_BASE` (optional), `GEMINI_API_KEY`, `GEMINI_MODEL` (optional).
Also `STREAM_ADDON_URL` (stream addon for Sentinel/copilot, no default), `PUBLIC_HOSTS` (extra browser-facing hosts) and `DASHBOARD_URL` (optional menu link, https only). The sign-out link comes from `CF_TEAM_DOMAIN` through `/api/me`. One public hostname only (the app uses `window.location.origin`).

## Known open items
- Download quotas are stored, not enforced (decided not to build).
- Backups: `data/snapshots/` holds a daily `VACUUM INTO` copy of the database (keeps 7); back up `data/` off the machine too.
- Headless test browsers report no window focus, so the download bar never syncs: use CDP `Emulation.setFocusEmulationEnabled`.
- Library scan results are only trusted when roots exist and the scan succeeded (`scanTrusted`).

## Conventions
- Backend CommonJS, 4-space indent, no new deps without need (Dockerfile installs only `express@4 jose@5` for the server).
- Add a `server/test/*.nt.js` test with every backend change; keep all green.
- Prefer editing existing modules; wire new routes in `http_server.js`.
