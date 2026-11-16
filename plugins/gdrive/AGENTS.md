# Plugin `gdrive`: cloud folders as library roots

Contract: docs/plugins.md. Server: `server/index.js` (provides `library.roots`, `GET /api/gdrive/status`, `POST /api/gdrive/tiering/plan`, also
`/api/library/tiering/plan` for old callers), `server/tiering.js` (pure candidate selection). Host scripts: `scripts/` (never run by the app).
Setup for people: `README.md`. Tests: `test/`.

- The safety logic is core (`server/library/library.js`): a cold root is online only with `.cinema-root` (created on the Drive side); offline roots
  are skipped, their rows kept, `scanTrusted()` false (Sentinel will not judge deletions), deletes there answer 503.
- Plan files go to `data/plugin-data/gdrive/tiering/{Movies,TV}.txt`; `scripts/move-to-drive.sh` (dry run by default) moves only listed files.
- The plan fails closed when Transmission cannot be asked. Never move files out from under a torrent.
- Config: `LIBRARY_EXTRA_MOVIES_DIRS`, `LIBRARY_EXTRA_TV_DIRS` (container paths), plus core `MEDIA_ROOTS` so they can be played;
  `TIERING_MIN_AGE_DAYS`, `TIERING_WATCHED`. Host paths belong in `data/LOCAL.md`, never in the repo.
