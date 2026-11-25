# Plugins

HomeBot Cinema is a small core (profiles, streaming, downloads, server library, quality profiles, Sentinel) plus optional
plugins. A plugin is one folder: everything about a feature, including its tests and its agent notes, lives in it. Switching
a plugin off removes its routes, its UI and its background work. Core never imports a plugin.

| Plugin | What it adds | Default | Needs |
|---|---|---|---|
| `find` | Smart filters page (`#/find`) and its link on Discover | on | `TMDB_API_KEY` |
| `themes` | Settings > Appearance per profile and ten extra accent colours | on | nothing |
| `skip` | Skip intro / recap / credits buttons in the player, intro and credits marks on the seek bar, auto-skip per profile, Up Next when the credits start | on | nothing (`SKIP_INTRODB_URL=off` for no outside lookups) |
| `nowplaying` | Admin > Now playing (who watches what, direct play or transcoding) and **Watch stats** (`#/stats`): play history kept in the database, hours per day, when you watch, top titles, devices, CSV export | on | nothing |
| `collections` | "Part of the X collection" on movie pages | on | `TMDB_API_KEY` |
| `similar` | "More like this" row (recommended titles, posters and ratings) under the description of movie and series pages | on | `TMDB_API_KEY` |
| `metalfx` | Apple MetalFX AI 4K Upscaler in the player overlay and Settings (macOS native desktop app) | on | macOS Apple Silicon |
| `controllers` | Settings > Controllers for game controllers in the macOS desktop app: layout presets, remapping per button, live tester, connect and battery notices | on | the desktop app (the controller reading is in `desktop/`) |
| `remote` | Push-to-play casting and real-time remote control between devices (e.g. Android phone to Mac Mini) | on | nothing |
| `mdblist` | Rotten Tomatoes (Tomatometer & Audience), Metacritic, IMDb and Letterboxd ratings on movie and series pages | on | `MDBLIST_API_KEY` |
| `getapp` | Signed-in download page (`/api/getapp/`) for the installers in `data/plugin-data/getapp/` (`.dmg`, `.apk`, optional `screenshot.png`), with setup steps per platform | off | nothing |
| `livesubs` | AI subtitles generated live by Whisper for torrents and library files: transcribes ahead of the playhead, draws the lines in the player, More menu switch (prototype) | off | `LIVESUBS_WHISPER_URL` (a whisper.cpp server) |
| `ai` | AI copilot drawer (sparkle button): recommendations, server questions, staged downloads | off | `GEMINI_API_KEY` |
| `telegram` | Household alerts (for example Sentinel queued an episode) to a Telegram chat | off | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| `gdrive` | Mounted cloud folders as extra library roots, plus a plan for moving watched files there | off | `LIBRARY_EXTRA_MOVIES_DIRS` / `LIBRARY_EXTRA_TV_DIRS` |
| `vault` | **Locked folder**: a private folder of videos behind its own passcode, for the admin on the owner profile (tile in Server library, thumbnails, private resume; never in history, search, stats or Now playing) | off | `VAULT_DIR` (outside `MEDIA_ROOTS`) |

## Switching plugins on and off

The first of these that is set decides:

1. **`CINEMA_PLUGINS`** (env): `ai,find,themes`, `all`, `none`, or `all,-gdrive` (`-id` drops one).
2. **`data/plugins.json`**: `{ "enabled": ["ai", "find", "themes", "telegram"] }`. Optional `"disabled": [...]`, and
   `"settings": { "<id>": { "NAME": "value" } }` for plugin settings that you would rather keep out of `.env`.
3. Each plugin's `defaultEnabled` in its `plugin.json`.

Admins can also switch plugins in the app (**Admin > Plugins**, or `POST /api/plugins/:id {"enabled": true}`), which writes `data/plugins.json`. Changes take
effect after a restart. `GET /api/plugins` shows every plugin, whether it is active, and why not ("GEMINI_API_KEY not set",
"requires plugin X", or the load error). A plugin that is switched on but not configured stays inactive and says why. A plugin
that throws while loading is skipped, and the server keeps running.

`data/` is gitignored and is the folder Docker mounts, so your choice survives rebuilds and never reaches GitHub.

## Folder layout

```
plugins/<id>/
  plugin.json        id (= folder name), name, description, version, defaultEnabled, requires: [ids], env: [{ name, required, description }],
                     server: "server/index.js" (default) or null for UI-only plugins
  AGENTS.md          what an agent must know about this plugin only
  README.md          optional: setup for people (scripts, mounts, keys)
  server/index.js    module.exports = { register(ctx) }
  ui/index.js        module.exports = { <slot>: [...] }
  test/*.nt.js       backend tests (node:test), run by `pnpm test:server`
  test/*.spec.js     UI tests (jest), run by `pnpm test`
  scripts/           optional host-side helpers (never run by the app)
```

Start one with `pnpm plugin:new <id> "Name" [--ui] [--no-server]`.

## Server side: `register(ctx)`

`register` runs once at boot, synchronously; start any async work inside it. It returns the plugin's exports, which are
available to plugins that `require` it (`ctx.plugins.get(id)`). To stay inactive, call `return ctx.disable('reason')`.

| `ctx.` | What |
|---|---|
| `id`, `manifest`, `root` | This plugin |
| `app` | The express app. Routes go under `/api/<something>`; every `/api` route is already behind the login gate |
| `auth.requireLogin` / `requireAdmin` / `requireProfile` | Middleware. `requireProfile` also checks the active household profile (and its PIN) |
| `db.raw`, `db.audit(email, profileId, action, payload)` | SQLite (node:sqlite) and the audit log |
| `db.migrate([sql, ...])` | Own tables, versioned per plugin (`plugin_schema`). Append-only; prefix tables with the plugin id |
| `hooks.on(event, fn)` / `hooks.provide(name, fn)` | Extension points, below |
| `events.emit(type)` | Live-update hint to open pages (SSE `/api/events`) |
| `sdk` | `server/sdk.js` (below) |
| `services.*` | `library`, `downloads`, `sentinel`, `quality`, `probeMany`, `tmdb`, `region`, `streamLinks` |
| `config.get(NAME, default)`, `list`, `bool`, `int` | Env first, then `data/plugins.json` `settings.<id>` |
| `dataDir()` | `data/plugin-data/<id>/`, created on first call |
| `log.info/warn/error` | Tagged `[plugin:<id>]` |

Pure helpers come from **`server/sdk.js`** (also available as **`ctx.sdk`**), the only core file a plugin's server code may
`require`. Private plugins in `data/plugins/` must use `ctx.sdk`, because no relative path reaches core from there: `chooseRelease`,
`queueRelease`, `cleanStream`, `normalizeScope`, `scopeLabel`, `kidSafe`, `TMDB_MAX_PAGE`, `parseHistory`, `profileHistory`,
`isInsideRoots`, `mediaRoots`. Need something else? Add it to the SDK in the same change.

### Hooks (`server/plugins/hooks.js`)

| Hook | Kind | Payload / return |
|---|---|---|
| `notify` | event | `{ source, title, text }`. Sentinel emits it; `telegram` forwards it |
| `library.roots` | provider | return `{ movie: [dir], series: [dir] }`. Extra "cold" roots; each must hold `.cinema-root` to count as online. Offline roots are never pruned, and deletes there answer 503 |

Unknown hook names throw, so a typo fails fast. To add a hook, add one line to `HOOKS` plus the core call site, and list it
here.

## UI side: slots (`src/plugins/host.js`)

`ui/index.js` exports arrays per slot. Use `React.lazy(() => import('./X'))` for components, so a plugin that is off costs
nothing. Each contribution renders inside an error boundary: a crashing plugin hides itself and the app keeps working.

| Slot | Item | Where it shows |
|---|---|---|
| `routes` | `{ path, view (1-3), Component }` | Router (before the catch-all) |
| `appOverlays` | `{ id, Component }` | Always mounted (drawers, toasters) |
| `navButtons` | `{ id, order, Component({ className, iconClassName }) }` | Top bar, left of the profile menu |
| `discoverActions` | `{ id, Component({ className }) }` | Discover header |
| `playerOverlays` | `{ id, Component(props) }`: `title`, `showName`, `type`, `metaId`, `videoId`, `poster`, `stream`, `streamUrl`, `subtitlesOn` (a real subtitle track is shown), `timeMs`, `durationMs` (ms), `paused`, `live`, `controlsHidden`, `menusOpen`, `hasNextVideo`, `seekTo(ms)`, `playNext()`, `reportCreditsStart(ms \| null)`, `reportMarks([{ start, end, label }] \| null)` | Player, above the control bar, below popups and menus |
| `playerControls` | `{ id, Component({ stream }) }` | Player bottom-right control bar, with playback buttons |
| `playerMenuItems` | `{ id, Component({ stream, Option, closeMenu }) }`: render `<Option icon label onClick />` rows | Player "More" menu, after the built-in options |
| `settingsSections` | `{ id, label, Component }` (forwardRef to a Settings `Section`) | Settings, after General, with a menu entry |
| `adminTabs` | `{ id, label, order, Component({ onError }) }` | Admin, tabs after Overview |
| `metaDetailsSections` | `{ id, Component({ type, id, videoId, meta }) }` | Title page, under the description |
| `accents` | `{ key, label, color, secondary }` | Accent palette (profile editor, Appearance) |
| `serverLibraryTiles` | `{ id, Component({ admin }) }` | Server library, after the title grid (e.g. the Locked folder tile) |

Import core UI through the `stremio/...` alias (`stremio/components`, `stremio/common/serverApi`, ...). Never import another
plugin's files.

To add a slot: add the name to `SLOTS`, render it in the core file, and list it here and in docs/upstream-touchpoints.md.
Slots are how we keep upstream files stable: a feature gets a place in a screen once, and after that it changes only its own
folder.

## Private plugins

A folder in `data/plugins/<id>/` with the same layout is loaded too (server side only, since the UI is compiled into the
image). Use it for things that only make sense in your own house. It is gitignored. A repo plugin with the same id wins.

## Rules (enforced by tests)

- Core (`server/`, `http_server.js`, `src/` outside `src/plugins`) never imports `plugins/*`. See `server/test/boundaries.nt.js`.
- Plugin server code imports core only through `server/sdk.js`. Plugins never import each other.
- Every plugin has `plugin.json`, `AGENTS.md` and at least one test.
- The server boots and serves core with **no plugins** and with **all plugins** (`server/test/boot.nt.js`).
- No stream sources in the repo (`server/test/content_guard.nt.js`): plugins use whatever `STREAM_ADDON_URL` or
  `data/addons.json` the operator set up.

## Debugging

- `GET /api/plugins` as an admin: active or not, reason, load error, which env settings are present.
- Server log lines start with `[plugins]` (loader) or `[plugin:<id>]` (the plugin's own `ctx.log`).
- Browser console: `[plugins] <id> crashed in <slot>` when a UI contribution throws.
- Run one plugin's tests: `NODE_PATH=.cache/server-deps/node_modules node --test plugins/<id>/test/*.nt.js` (after one
  `pnpm test:server`, which installs the server dependencies).
- Bisect: `CINEMA_PLUGINS=none`, then add plugins back one at a time.
