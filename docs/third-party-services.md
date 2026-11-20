# Outside services

What the app talks to besides your own server. Measured 2026-11-16 with a headless browser walking Home, Discover, title pages,
Search, Library, Calendar and Settings (playback not exercised), plus a search of our code and the bundled stremio-core.

## Summary

- **Nothing about accounts, profiles, library or watch history leaves your server.** There is no Stremio login: sign-in is
  Cloudflare Access, sync lives in our SQLite.
- **No calls to Stremio's own API.** The core's worker `fetch` is guarded (`src/worker/fetchGuard.js`): announcements are
  answered locally, every other call to `api.strem.io`, `likes.stremio.com` or `link.stremio.com` is refused.
- **Only your origin is sent**, never a path or query, to outside hosts such as image CDNs and YouTube (`Referrer-Policy: strict-origin-when-cross-origin`). YouTube trailers need it: with `same-origin` the desktop app (WebKit) gets embed error 153.
- **Public catalog services still see what is browsed** (title ids, search terms) and the viewer's IP, like any website.

## Hosts

| Host | Who runs it | Used for | Sees |
|---|---|---|---|
| `v3-cinemeta.strem.io`, `cinemeta-catalogs.strem.io` | Stremio (Cinemeta addon) | Catalogs, title details, search; the server also uses it to match library files, for Sentinel episode lists and for Continue watching "next up" and the Upcoming row (episode lists of the profile's shows, cached 6 h) | Titles browsed and searched; titles parsed from library file names |
| `images.metahub.space`, `live.`/`episodes.metahub.space` | Stremio | Posters, backgrounds, logos | Titles shown |
| `v3-channels.strem.io`, `watchhub.strem.io`, `caching.stremio.net` | Stremio | YouTube channels addon, "where to watch", public-domain catalog | Titles browsed |
| `opensubtitles-v3.strem.io` | Stremio | Subtitles (when listed for a video) | Title and file hash of what is played |
| `anime-kitsu.strem.fun` | Community | Anime catalogs | Catalog requests |
| `api.tmdb.org`, `image.tmdb.org` | TMDB | Smart filters, copilot, movie collections (server-side key) | Filters and titles |
| `api.introdb.app` | IntroDB (community) | `skip` plugin, server-side: intro, recap and credits times when the file has no chapter markers. Asked once per episode or movie when it is played, cached in SQLite. `SKIP_INTRODB_URL=off` turns it off | IMDb id, season and episode of what is played (from the server's IP) |
| `api.mdblist.com` | MDBList (community) | `mdblist` plugin, server-side: Rotten Tomatoes (Tomatometer & Audience), Metacritic, IMDb and Letterboxd ratings. Cached in SQLite. | IMDb ids of titles browsed and title pages opened (from the server's IP) |
| `generativelanguage.googleapis.com`, `api.telegram.org` | Google, Telegram | `ai` and `telegram` plugins, server-side | Copilot prompts (titles only); alert text |
| Your addons and stream sources | You choose | Whatever you add to `data/addons.json` / `STREAM_ADDON_URL` | Their requests |
| `stremio/server` container | Stremio | Streaming and transcoding | Not audited yet |

## If you want to go further

Not planned right now; noted so the work is easy to pick up.
1. **Audit the streaming server**: capture its DNS and connections for a day from a sidecar container in its network
   namespace; make sure `remoteHttps` is off in its settings.
2. **`metadata` plugin**: serve catalogs and title details from TMDB through our server (Stremio addon protocol, IMDb ids,
   cached in SQLite) and use TMDB for library matching, with Cinemeta as the fallback when no key is set. Alternative: run
   the community [AIOMetadata](https://github.com/cedya77/aiometadata) addon.
3. **Artwork proxy**: `/api/art/:kind/:imdbId` from TMDB, cached under `data/`.
4. **`subtitles` plugin**: sidecar `.srt` files from the library first, then OpenSubtitles.com with your own key.

For comparison, [Nuvio](https://github.com/NuvioMedia) (another open-source Stremio-addon client) also keeps Cinemeta and the
Stremio-hosted OpenSubtitles addon by default. It enriches title pages with TMDB directly from the browser, using the user's
key.
