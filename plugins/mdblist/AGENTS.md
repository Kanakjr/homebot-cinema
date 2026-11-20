# Plugin `mdblist`

Aggregated ratings (Rotten Tomatoes Critics & Audience, Metacritic, IMDb, Letterboxd) from MDBList.
Read `docs/plugins.md` for the contract; this file is only what is special about this plugin.

- Server: `server/index.js` exports `register(ctx)` (sync). Core only through `ctx` and `server/sdk.js`.
- UI: `ui/index.js` exports slot `metaDetailsSections` (`MdblistRow.js`).
- Routes:
  - `GET /api/mdblist/:type/:imdbId` -> `{ id, type, score, tomatoes, popcorn, imdb, metacritic, letterboxd }`
  - `POST /api/mdblist/batch` -> `{ ratings: { [imdbId]: { score, tomatoes, popcorn, imdb, metacritic, letterboxd } } }`
- Tests: `test/*.nt.js` (node:test, run by `pnpm test:server`); uses `server/plugins/testing.js` `fakeCtx`.
- Config: `MDBLIST_API_KEY` (in `data/plugins.json` settings or `.env`).
- Own tables: `ctx.db.migrate([...])`: `mdblist_ratings` table cached for 7 days.
