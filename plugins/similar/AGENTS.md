# Plugin `similar`: More like this

Contract: docs/plugins.md. Only what is special here.

- Server: `GET /api/similar/:type/:imdbId` (`type` movie or series) -> `{ items: [{ id (IMDb), tmdbId, type, name, year, poster, rating }] }`.
  Core TMDB service `similarFor` (`server/tmdb.js`): IMDb -> TMDB id -> `/recommendations`, topped up with `/similar` when fewer
  than 20; no poster / no IMDb id / the title itself are left out. Cached a day in memory.
- Inactive without `TMDB_API_KEY` (shared with `find`, `collections`).
- UI: slot `metaDetailsSections` (`ui/SimilarRow.js`), under the collection row. Not filtered for kids profiles (no profile on the route).
- Tests: `test/similar.nt.js` (fake TMDB).
