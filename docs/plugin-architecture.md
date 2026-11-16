# Architecture: small core, plugins, close to upstream

How-to guides: [plugins.md](plugins.md), [upstream-sync.md](upstream-sync.md), [upstream-touchpoints.md](upstream-touchpoints.md).

## Goals
1. Anyone can run a small core; extras (AI, Google Drive, themes, alerts, a future watch tracker) are opt-in.
2. An install picks its plugins in its own `data/`, not in a separate code base.
3. New upstream stremio-web work arrives with `git merge`, not a hand port.
4. One feature = one folder, so an agent or contributor reads only that.

## Decisions

| Topic | Decision |
|---|---|
| Plugin | A folder `plugins/<id>/`: `plugin.json`, `AGENTS.md`, `server/`, `ui/`, `test/` |
| Server contract | Synchronous `register(ctx)`; core reached only through `ctx` and `server/sdk.js` |
| Extension points | Server hooks (`notify`, `library.roots`); UI slots (`routes`, `appOverlays`, `navButtons`, `discoverActions`, `settingsSections`, `accents`). Unknown names throw |
| UI loading | Compiled in, switched at runtime by `/api/plugins`; lazy chunks; each inside an error boundary |
| Choosing plugins | `CINEMA_PLUGINS` > `data/plugins.json` > `defaultEnabled`; Admin › Plugins writes the file |
| Failure | Missing config: inactive with a reason. Throwing: reported and skipped. The server keeps running |
| Core | Auth, profiles, streaming proxy, downloads, server library, quality profiles, swarm probe, Sentinel, admin, TMDB client |
| Plugins | `ai`, `find`, `themes`, `telegram`, `gdrive` |
| Not pluggable | The stream list and player changes: they are what this fork is, so they stay core and documented |
| Upstream | Shared history with stremio-web (`scripts/graft-upstream-history.sh`), edits to upstream files kept small and listed |

## Content sources stay out of git

The repo ships no scrapers, piracy sites, release-group names or personal addon URLs. Which sources an install uses is its
own data: `data/addons.json`, `STREAM_ADDON_URL`, quality profiles in the database. `data/` is gitignored and is the folder
Docker mounts, so an existing install keeps working with nothing to install, and a fresh clone gets clean defaults.
`data/LOCAL.md` holds private notes for agents. `server/test/content_guard.nt.js` enforces the rule.

## Guardrails
- `server/test/boundaries.nt.js`: core never imports plugins; plugins use only `ctx`/`server/sdk.js` and never each other.
- `server/test/boot.nt.js`: the real server starts with no plugins and with all of them.
- `pnpm check:upstream`: every changed upstream file is listed.
