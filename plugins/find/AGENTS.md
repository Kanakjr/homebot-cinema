# Plugin `find`: smart filters

Contract: docs/plugins.md. Server: `server/routes.js` (`GET /api/find`, `/api/find/options`, filter parsing). UI: `ui/FindRoute.js` + `Find.js`
(slot `routes` at `/find`), `ui/SmartFiltersLink.js` (slot `discoverActions`). Tests: `test/find.nt.js`, `tests/findPresets.spec.js` (presets).

- **Smart filters** (`#/find`): TMDB `discover` (rating, votes, genre, language, runtime, year, "streaming on X in <region>") mapped to IMDb ids. Needs `TMDB_API_KEY`; region `WATCH_REGION` (default IN). Uses `api.tmdb.org` because some ISPs reset TLS to `api.themoviedb.org`. TMDB ratings differ slightly from IMDb.
- The TMDB client is core (`server/tmdb.js`, `ctx.services.tmdb`) because the ai plugin uses it too.
- UI: minimal pill bar + Advanced panel; right-hand info panel like Discover (hover/focus a poster), phones get a bottom sheet; grouped
  Quick picks in `ui/presets.js`; default is 200+ votes so 1-vote 10.0 titles do not top the list.
