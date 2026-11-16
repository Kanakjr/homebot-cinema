# Plugin `collections`: Movie collections

Contract: docs/plugins.md. Only what is special here.

- Server: `GET /api/collections/movie/:imdbId` -> `{ collection: { id, name, items: [{ id (IMDb), tmdbId, name, year, released, poster, rating }] } | null }`.
  The lookup is the core TMDB service (`server/tmdb.js` `collectionFor`): IMDb -> TMDB movie -> `belongs_to_collection` ->
  `/collection/{id}` parts -> IMDb ids (cached in `tmdb_ids`). Parts without an IMDb id are left out (Stremio opens titles by
  it); oldest first, unreleased last; a "collection" of one is null.
- Inactive without `TMDB_API_KEY` (shared with `find`).
- UI: slot `metaDetailsSections` (`ui/CollectionRow.js`), movies only, under the description on the title page.
- Tests: `test/collections.nt.js` (fake TMDB).
