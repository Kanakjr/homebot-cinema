# Contributing to HomeBot Cinema

Thanks for helping. HomeBot Cinema is a fork of [Stremio Web](https://github.com/Stremio/stremio-web) with its own Node/Express
backend, so there are two halves: the React UI in `src/` and the server in `http_server.js` and `server/`.
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
  node --disable-warning=ExperimentalWarning http_server.js        # http://localhost:8080
```

`pnpm start` runs only the webpack dev server (UI hot reload) and has no backend.

## Pull requests

- Keep each pull request to one change and fix the root cause with the smallest practical change.
- Every backend change comes with a test in `server/test/*.nt.js`; keep both test suites green and lint no worse than today.
- Match the surrounding style: backend is CommonJS with 4-space indent, no new dependencies without a real need.
- Never commit secrets, tokens, private addon URLs, `data/` contents or `.env`. Use the `.example` files as templates.
- Do not add artwork or media you do not have the right to share (posters, avatars, screenshots of copyrighted material).

## Translations

Only English is bundled; other languages load on demand from the
[`stremio-translations`](https://github.com/Stremio/stremio-translations) package.
