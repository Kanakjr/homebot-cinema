# Contributing to HomeBot Cinema

Thanks for helping. HomeBot Cinema is a fork of [Stremio Web](https://github.com/Stremio/stremio-web) with its own Node/Express
backend: the React UI in `src/`, the server in `http_server.js` and `server/`, and optional features in `plugins/`.
[`AGENTS.md`](AGENTS.md) is the map of the code, the key behaviours and the house rules; read it first.

## Set up

Node.js 22+ and pnpm 11+.

```sh
pnpm install
pnpm build                 # UI -> build/
pnpm test                  # UI/unit tests (jest)
pnpm test:server           # backend tests (node:test); installs express + jose into .cache/ once
pnpm lint
```

Run the whole app locally with a dev login (never use these settings on a server that others can reach):

```sh
pnpm test:server                         # once, makes sure express/jose are cached
NODE_PATH=$PWD/.cache/server-deps/node_modules NODE_ENV=development DEV_EMAIL=you@example.com ADMIN_EMAILS=you@example.com \
  CINEMA_DATA_DIR=/tmp/cinema-data CINEMA_PLUGINS=all node --disable-warning=ExperimentalWarning http_server.js   # http://localhost:8080
```

`pnpm start` runs only the webpack dev server (UI hot reload) and has no backend.

## Pull requests

- Keep each pull request to one change and fix the root cause with the smallest practical change.
- **A new optional feature is a plugin** (`pnpm plugin:new <id>`, see [docs/plugins.md](docs/plugins.md)), not an edit to core.
- Prefer new files over edits to upstream stremio-web files; list any such edit in
  [docs/upstream-touchpoints.md](docs/upstream-touchpoints.md) (`pnpm check:upstream`).
- Every backend change comes with a `*.nt.js` test; keep both test suites green and lint at 0 errors.
- Match the surrounding style: backend is CommonJS with 4-space indent, no new dependencies without a real need.
- Never commit secrets, tokens, private addon URLs, `data/` contents or `.env`. Use the `.example` files as templates.
- Never add stream sources (scraper or indexer addons, piracy sites, release-group names): sources are each operator's choice.
- Do not add artwork or media you do not have the right to share (posters, avatars, screenshots of copyrighted material).

## Translations

Only English is bundled; other languages load on demand from the
[`stremio-translations`](https://github.com/Stremio/stremio-translations) package.
