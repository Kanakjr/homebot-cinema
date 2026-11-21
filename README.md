<div align="center">

<img src="assets/images/icon_196x196.png" width="96" alt="HomeBot Cinema logo">

# HomeBot Cinema

**A private, self-hosted media hub for the whole household.**
A profile for everyone, your own server library, downloads to your own disk, new episodes fetched automatically,
smart discovery, and an AI copilot that only suggests: you press the button.

[![License: GPL-2.0](https://img.shields.io/badge/license-GPL--2.0-7b5bf5)](LICENSE.md)
[![Node 22+](https://img.shields.io/badge/node-22%2B-3c873a)](.nvmrc)
[![Docker](https://img.shields.io/badge/docker-compose-2496ed)](docker-compose.example.yml)
[![Built on Stremio Web](https://img.shields.io/badge/built%20on-Stremio%20Web-8a5bf5)](https://github.com/Stremio/stremio-web)

**[Website](https://kanakjr.github.io/homebot-cinema/)** · [Demo video](https://youtu.be/aCRXjZhj_kQ) · [The story](https://kanakjr.github.io/homebot-cinema/story.html) · [Plugins](docs/plugins.md) · [Docs](docs/)

<img src="docs/screenshots/home.webp" alt="HomeBot Cinema home screen" width="100%">

</div>

## Watch the demo

[![HomeBot Cinema demo: a private Netflix for the whole family, on YouTube](https://img.youtube.com/vi/aCRXjZhj_kQ/maxresdefault.jpg)](https://youtu.be/aCRXjZhj_kQ)

A tour of profiles, Smart filters, the AI copilot, downloads and Sentinel. ▶ [Watch on YouTube](https://youtu.be/aCRXjZhj_kQ)

## What is it?

HomeBot Cinema is a fork of [Stremio Web](https://github.com/Stremio/stremio-web) turned into a small media server for a
family or a flat share. The familiar Stremio player and addon catalogs are still there; around them it adds the things a
household needs: separate profiles with their own watch history, a library of what is on your server, downloads that land
on your own disk, shows that keep themselves up to date, and a copilot you can ask what to watch tonight.

It runs on a machine you own (a Mac mini, a NAS, a mini PC), is reached through [Cloudflare Access](https://www.cloudflare.com/zero-trust/products/access/)
so only the people you invite can sign in, and keeps everything (profiles, history, library, settings) in one SQLite
file and one folder you can back up.

> HomeBot Cinema is an independent project. It is **not affiliated with or endorsed by Stremio** or Smart Code OOD.
> See [Responsible use](#responsible-use) and [Credits](#credits--licenses).

## Features

### For the household
- **Profiles for everyone** (up to 8): a "Who's watching?" screen, avatars, an optional PIN, and a **kids** profile.
  Each profile has its own library, Continue watching, watch progress and settings.
- **Home hero banner** and rows built from your addons, with *Continue watching* that follows each profile, plus search across all of them.
- **Smart filters** (`Discover > Smart filters`): find titles by rating, votes, genre, language, runtime, year and
  "on a streaming service in your country", powered by [TMDB](https://www.themoviedb.org). 40 ready-made quick picks
  (charts, genres, languages, short on time), a hover info panel, and a kid-safe mode.
- **Phone friendly and installable** as a PWA; interface zoom (default 90%); a clean full-screen layout on small screens.
- **Native companion apps**:
  - **macOS app** ([`desktop/`](desktop/)): Tauri 2 + libmpv direct playback (no transcoding), home LAN streaming, Apple GameController gamepad support, and macOS Now Playing media keys / Control Center bridge.
  - **Android app** ([`android/`](android/)): Kotlin + Jetpack Compose companion app with Media3 (ExoPlayer) hardware decoding, snap Continue Watching, and real-time remote control / cast integration ([`remote` plugin](plugins/remote/)).

### AI copilot
<img src="docs/screenshots/copilot-mobile.webp" alt="The AI copilot on a phone, suggesting titles as poster cards" align="right" width="30%">

Click the sparkle button in the top bar and ask: *"something light under two hours"*, *"what did I leave unfinished?"*,
*"is season 3 on the server?"*, *"download this in 1080p"*, *"keep this show updated"*.

- Powered by Google Gemini with a short, live summary of the profile (titles only: **no names, emails or PINs**) and a
  fixed set of tools: TMDB search and details, your server library, downloads and watch history.
- **It can only stage.** A download (one movie or episode, best live release for your quality profile) or a monitor
  (admins only) appears as a card with *Confirm* and *Cancel*. Nothing starts until you confirm, only the login and
  profile that staged it can confirm, and it expires after 10 minutes.
- Guarded against claiming things it did not do, against inventing titles (cards only show titles a tool returned), and
  rate limited per login. Kids profiles get child-friendly results and cannot stage anything.
- Needs a `GEMINI_API_KEY`; hidden for everyone but admins until it is set.

<br clear="right">

### Your server
- **Downloads to your own disk** through Transmission, with **quality profiles** (4K Ultra HD, 4K Efficient,
  HD Balanced, Direct Play, Space Saver, or your own) that set resolution, size limits and keywords, and a **swarm check**
  that tells you whether a release has live peers before you start it.
- **Sentinel** keeps shows up to date: monitor a series for *new episodes only*, chosen *seasons*, or *all* of it. It
  picks the best release under the show's quality profile, remembers what you deleted so it never re-downloads it, and can
  alert you on Telegram.
- **Server library**: scans your movie and TV folders, matches titles, plays straight from the server, badges what is
  new, and marks episodes on the Calendar.
- **Player**: HLS with a deep buffer (90 to 240 s ahead), HEVC re-encoded to H.264 for smooth playback, subtitles from
  addons, and signed, expiring links for external players such as VLC.
- **Skip intro, recap and credits** (plugin `skip`): a Skip button when their times are known (chapter markers in your
  files, otherwise the community [IntroDB](https://introdb.app)), optional auto-skip per profile, and Up Next as soon as the
  credits start. Intro and credits show as marks on the seek bar.
- **Continue watching** shows the time left, or *Next up* after the furthest episode you watched; an **Upcoming** row lists
  episodes of your shows airing in the next two weeks.
- **Admin > Now playing**: who is watching what, on which device, and whether it plays directly or is transcoded.
- **Watch stats** (`#/stats`, Tautulli-style): every play of 30 seconds or more is kept in your own database, with hours per
  day, when you watch, most-watched titles, devices, direct play vs transcoding, streaks, a searchable history and CSV export.
  Admins see any profile or the whole household; everyone else sees only their own.
- **Admin panel**: overview, people, activity log and quality profiles.
- **Live updates** (server-sent events) so downloads and the library refresh without reloading, and a daily database
  snapshot (the last 7 are kept).

## Screenshots

### Discover, Smart Filters & Universal Ratings

| | |
|:---:|:---:|
| ![Smart filters: streaming service, rating, runtime and genres](docs/screenshots/smart-filters.webp) | ![Discover: catalog grid with universal ratings](docs/screenshots/discover.webp) |
| **Smart filters**: browse by provider, rating, runtime & year | **Discover**: catalog grid with Rotten Tomatoes, Metacritic & IMDb |
| ![Search across all configured addons](docs/screenshots/search.webp) | ![Smart filters quick picks menu](docs/screenshots/quick-picks.webp) |
| **Search**: unified results across all catalog addons | **40 quick picks**: charts, streaming hubs, genres & languages |

### Titles, Series Sentinel & Server Library

| | |
|:---:|:---:|
| ![Movie details with stream quality sorting, ratings and server status](docs/screenshots/title-page.webp) | ![Series details with Sentinel auto-download monitoring and episode picker](docs/screenshots/series-details.webp) |
| **Movie details**: streams sorted by quality profile & server status | **Series details**: Sentinel episode monitoring & season picker |
| ![Server library: on-server titles with watched badges](docs/screenshots/library.webp) | ![Release calendar with on-server episode indicators](docs/screenshots/calendar.webp) |
| **Server library**: separate for every household profile | **Calendar**: upcoming episode releases with server markers |

### Playback, Apple MetalFX 4K AI Upscaling & Audio

| | |
|:---:|:---:|
| ![Apple MetalFX 4K AI Upscaler HUD telemetry in macOS desktop player](docs/screenshots/player-metalfx.webp) | ![Audio and subtitle track selector with Atmos 7.1 and PGS SDH](docs/screenshots/player-audio-subtitles.webp) |
| **MetalFX 4K AI Upscaler**: 1080p to 4K super-resolution on Apple Silicon GPU | **Audio & subtitles**: multi-track Dolby Atmos 7.1, TrueHD and PGS SDH |

![The player with deep buffer, seekbar chapters and subtitles](docs/screenshots/player.webp)

**The player**: deep HLS buffer (90–240s), chapter markers, skip intro/credits, and signed expiring links.

### Server Management, Watch Stats & Household Profiles

| | |
|:---:|:---:|
| ![Admin overview: storage, library, downloads and Sentinel](docs/screenshots/admin-overview.webp) | ![Admin Plugins manager with all 13 plugins](docs/screenshots/admin-plugins.webp) |
| **Admin overview**: storage metrics, downloads, Sentinel status | **Admin Plugins manager**: toggle, configure and audit all plugins |
| ![Watch stats: streaks, daily hours, device breakdown](docs/screenshots/watch-stats.webp) | ![Appearance settings: theme accent colours and AMOLED black](docs/screenshots/settings.webp) |
| **Watch stats** (`#/stats`): Tautulli-style streaks and history | **Appearance settings**: accent palettes, AMOLED black & corner radius |
| ![Who's watching household profile selector](docs/screenshots/profiles.webp) | ![AI Copilot drawer with conversational recommendations](docs/screenshots/copilot.webp) |
| **Household profiles**: avatars, private history and optional PIN | **AI Copilot**: conversational recommendations & staged downloads |

## How it fits together

```mermaid
flowchart LR
    B["Browser<br>React UI + stremio-core (WASM)"] -->|HTTPS| CF["Cloudflare Access<br>(sign-in)"]
    CF --> A["HomeBot Cinema<br>Node / Express"]
    A --> DB[("SQLite<br>profiles, library,<br>history, audit")]
    A --> SS["Stremio streaming server<br>HLS and torrents"]
    A --> TR["Transmission<br>downloads to your disk"]
    A -.-> TM["TMDB<br>(Smart filters)"]
    A -.-> GM["Gemini<br>(AI copilot)"]
    B --> AD["Stremio addons<br>catalogs, metadata, streams"]
```

Dotted lines are optional. The UI is Stremio Web (React); the brains of discovery and playback still live in
[stremio-core](https://github.com/Stremio/stremio-core) compiled to WebAssembly. Everything household-specific is in
`http_server.js` and `server/`; [`AGENTS.md`](AGENTS.md) is the map of the code.

## Quick start

You need Docker with Compose, a folder for movies and one for shows.

```sh
git clone https://github.com/Kanakjr/homebot-cinema.git && cd homebot-cinema

cp .env.example .env                              # 1. fill in the values (see Configuration)
cp data/addons.example.json data/addons.json      # 2. the addons your household sees
cp docker-compose.example.yml docker-compose.yml  # 3. point ./media/Movies and ./media/TV at your folders

docker compose up -d --build                      # 4. first build takes a few minutes
```

Then open <http://localhost:3002>, pick or create a profile, and you are in.

**Signing in.** On a real server, put the app behind Cloudflare Access (a Cloudflare Tunnel plus an Access application)
and set `CF_TEAM_DOMAIN`, `CF_ACCESS_AUD` and `ADMIN_EMAILS` in `.env`: the app verifies Cloudflare's signed token on
every request and refuses everything otherwise. To try it on your own computer, uncomment the two *local trial* lines in
`docker-compose.yml` (`NODE_ENV=development`, `DEV_EMAIL=you@example.com`). They let anyone who can reach the port in as an
admin, so never use them on a server other people can reach.

**Addons.** `data/addons.json` is the list every profile gets (same format as a Stremio addon collection: a
`transportUrl` and the addon's `manifest`). The example ships metadata, subtitle and public-domain addons only. Which
sources you add is up to you.

**Optional, but nice:** a free [TMDB key](https://www.themoviedb.org/settings/api) turns on Smart filters, and a
[Gemini key](https://aistudio.google.com/apikey) plus `CINEMA_PLUGINS=all` (or the `ai` plugin) turns on the copilot.

## Plugins

The core is profiles, streaming, downloads, the server library, quality profiles and Sentinel. Everything else is a plugin
you switch on or off, so you run only what you want:

| Plugin | Adds | Default |
|---|---|---|
| `find` | Smart filters (TMDB) | on |
| `themes` | Appearance settings and extra accent colours | on |
| `skip` | Skip intro, recap and credits in the player, marks on the seek bar; Up Next when the credits start | on |
| `nowplaying` | Admin > Now playing, and Watch stats: play history, charts, CSV (kept on your server) | on |
| `collections` | "Part of the X collection" on movie pages (TMDB) | on |
| `similar` | "More like this" row on movie and series pages (TMDB recommendations) | on |
| `metalfx` | 4K AI upscale button and live GPU stats in the macOS desktop app (Apple MetalFX); inert in the browser | on |
| `controllers` | Settings > Controllers for game controllers in the macOS desktop app: presets, remapping, battery notices | on |
| `remote` | Push-to-play casting and real-time remote control between household devices (e.g. phone to Mac Mini) | on |
| `mdblist` | Rotten Tomatoes, Metacritic, IMDb and Letterboxd ratings on title pages and poster cards | on |
| `ai` | The AI copilot (Gemini) | off |
| `telegram` | Alerts to a Telegram chat | off |
| `gdrive` | Google Drive (rclone) folders as extra library roots | off |

Pick them with `CINEMA_PLUGINS=find,themes,ai` or in `data/plugins.json`; admins see what is on, and why something is not,
at `/api/plugins`. Writing your own: [docs/plugins.md](docs/plugins.md) (`pnpm plugin:new my-plugin`).

## Configuration

All settings are environment variables; [`.env.example`](.env.example) has every one with a comment.

| Variable | What it does |
|---|---|
| `CF_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Cloudflare Access team and application audience used to verify logins. Without them the server answers 503 |
| `ADMIN_EMAILS` | Comma-separated logins that are admins (admin is a login, not a profile) |
| `OWNER_PROFILE_NAME` | Name of the profile created for the first login |
| `STREMIO_SERVER_HOST/PORT`, `TRANSMISSION_HOST/PORT` | Where the streaming server and Transmission are (defaults match the example compose) |
| `LIBRARY_MOVIES_DIR`, `LIBRARY_TV_DIR` | Media folders as seen inside the container |
| `STREAM_ADDON_URL` | The Stremio stream addon Sentinel and the copilot ask for releases (base URL or install link). **No default**: without it they find nothing |
| `TMDB_API_KEY`, `WATCH_REGION` | Smart filters, and the country whose streaming catalogs are searched (two letters, any case; default `IN`) |
| `CINEMA_PLUGINS` | Which plugins run (`all`, `none`, a list, `-id`); otherwise `data/plugins.json`, otherwise each plugin's default |
| `MDBLIST_API_KEY` | Plugin `mdblist`: Rotten Tomatoes, Metacritic, IMDb and Letterboxd ratings |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Plugin `ai`: the AI copilot |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Plugin `telegram`: alerts |
| `LIBRARY_EXTRA_MOVIES_DIRS`, `LIBRARY_EXTRA_TV_DIRS` | Plugin `gdrive`: cloud folders as extra library roots ([setup](plugins/gdrive/README.md)) |
| `PUBLIC_HOSTS`, `DASHBOARD_URL` | Optional: extra browser-facing hostnames, and a link to a companion dashboard |
| `HLS_FORCE_H264` | `0` stops forcing H.264 on HLS transcodes |

## Development

Node.js 22+ and [pnpm](https://pnpm.io) 11+.

```sh
pnpm install
pnpm build            # UI -> build/
pnpm test             # UI tests (jest)
pnpm test:server      # backend tests (node:test), core and plugins
pnpm lint
pnpm plugin:new <id>  # scaffold a plugin
pnpm check:upstream   # upstream stremio-web files we change are all documented
```

Keeping up with upstream stremio-web: [docs/upstream-sync.md](docs/upstream-sync.md).

Run the whole app with a dev login (only on your own machine):

```sh
pnpm test:server      # once: caches express + jose into .cache/
NODE_PATH=$PWD/.cache/server-deps/node_modules NODE_ENV=development DEV_EMAIL=you@example.com ADMIN_EMAILS=you@example.com \
  CINEMA_PLUGINS=all CINEMA_DATA_DIR=/tmp/cinema-data node --disable-warning=ExperimentalWarning http_server.js   # http://localhost:8080
```

`pnpm start` runs only the webpack dev server (hot reload, no backend). See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security and privacy

- **Fails closed.** No valid Cloudflare Access token means no API access. The dev login only works with `NODE_ENV=development`.
- **Your data stays with you.** Profiles, history and settings live in `data/` on your machine; nothing about your account,
  library or history is sent to Stremio or anyone else. The app does use public services for catalogs and artwork (Stremio's
  Cinemeta and image CDN, the addons you list, TMDB and Gemini if enabled), which see the titles you browse. Every outside
  host, and the plan to need fewer: [docs/third-party-services.md](docs/third-party-services.md).
- **The copilot sees titles only**, never emails, profile names or PINs, and can only *stage* actions you confirm.
- Stream links for external players are **signed and expire**; media paths must live inside your configured library
  folders; stream responses are never cached.
- Secrets live in `.env` and `data/`, both git-ignored. Please report vulnerabilities privately through GitHub's
  *Report a vulnerability* feature rather than a public issue.

## Responsible use

HomeBot Cinema does not host, index, provide or recommend any media. It is a client for the sources you configure
(Stremio-compatible addons, your own files) and a manager for your own server. **You** decide what to point it at, and you
are responsible for following the laws, licenses and terms of service that apply where you live and to the services and
content you use. Use it for media you have the right to access.

## Credits and licenses

- Built on [**Stremio Web**](https://github.com/Stremio/stremio-web) by Smart Code OOD (GPL-2.0), together with
  [stremio-core](https://github.com/Stremio/stremio-core), [stremio-video](https://github.com/Stremio/stremio-video) and
  [stremio-translations](https://github.com/Stremio/stremio-translations). "Stremio" is a trademark of its owner; this
  project is not endorsed by it.
- Discovery data and images come from [TMDB](https://www.themoviedb.org): *this product uses the TMDB API but is not
  endorsed or certified by TMDB.* Recommendations use [Google Gemini](https://ai.google.dev).
- The logo, brand assets and profile avatars are original artwork made for this project
  ([`scripts/brand`](scripts/brand)).
- Posters, backdrops and descriptions shown in the app come from the addons and services you configure and belong to
  their respective owners.

Released under the **GNU General Public License v2.0**, like the project it is based on. See [LICENSE.md](LICENSE.md).
Copyright © 2017-2026 Smart Code OOD and the HomeBot Cinema contributors.
