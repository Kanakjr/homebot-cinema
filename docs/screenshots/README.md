# Screenshots

The images the main [README](../../README.md) and [GitHub Pages website](https://kanakjr.github.io/homebot-cinema/) show. They are real captures of a running instance (WebP, about 2200 px wide), cropped to the app itself.

| File | Shows |
|---|---|
| `home.webp` | Home screen: hero banner carousel, Continue watching and Upcoming rows |
| `profiles.webp` | Who's Watching: household profile picker with avatars and kids mode |
| `discover.webp` | Discover catalog grid with universal ratings (Rotten Tomatoes, Metacritic, IMDb) |
| `smart-filters.webp` | Smart filters: streaming service, rating slider, runtime, year, genre |
| `quick-picks.webp` | Smart filters: quick picks menu of curated charts and genres |
| `search.webp` | Unified search across all configured addon catalogs |
| `title-page.webp` / `movie-details.webp` | Movie details: streams sorted by quality profile, ratings, server status |
| `series-details.webp` | Series details: Sentinel auto-download monitoring and episode picker |
| `player.webp` | Video player: playback controls, seekbar chapter markers, stream info |
| `player-metalfx.webp` | Apple MetalFX AI 4K Upscaler HUD telemetry (macOS desktop app) |
| `player-audio-subtitles.webp` | Audio and subtitle track selector (Dolby Atmos 7.1, PGS SDH) |
| `library.webp` | Server library: on-server movies and series with watched badges |
| `calendar.webp` | Calendar: upcoming episode release schedule with on-server markers |
| `downloads.webp` | Downloads: storage capacity, active torrents, Sentinel monitor status |
| `admin-overview.webp` | Admin overview: storage metrics, library maintenance, Sentinel, people |
| `admin-plugins.webp` | Admin Plugins manager: toggling, settings and status for all 13 plugins |
| `watch-stats.webp` | Watch stats (#/stats): hours per day, streaks, top devices, hourly charts |
| `settings.webp` | Appearance settings: accent color palette, AMOLED black, corner radius |
| `copilot.webp` | AI Copilot drawer: conversational recommendations and staged download cards |
| `copilot-mobile.webp` | AI Copilot on mobile view with compact recommendation cards |

## Adding or replacing a screenshot

- Crop out the browser's address bar and tabs (they show your hostname and account), and any hover-link tooltip at the bottom.
- Look at the whole image before committing: no emails, tokens, private addon names or URLs, and no stream lists with release names or source names.
- Profile pictures: use the avatars in `server/avatars/` (original artwork). Do not publish character or actor images.
- Save as WebP (quality about 86) to keep the repository small: `cwebp -q 86 in.png -o out.webp`.
- Only publish artwork you have the right to share. Posters shown by the app belong to their owners.
