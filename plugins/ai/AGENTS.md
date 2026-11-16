# Plugin `ai`: AI copilot

Contract: docs/plugins.md. Server: `server/` (Gemini REST client, brief, tools, agent loop, staging, routes `/api/ai/*`).
UI: `ui/` (sparkle button via slot `navButtons`, drawer via `appOverlays`, shared state `copilotState.js`). Tests: `test/`.

- **AI copilot** (sparkle button, drawer on the right): Gemini with tools and a live brief each turn. **It can only STAGE** a download (one movie/episode, best live release for a quality profile) or a monitor (admin only); the user presses Confirm on the card (`POST /api/ai/staged/:id/confirm`, owner login + profile only, 10 min expiry, 409 if not pending). Never let it claim something started without a successful stage tool (`agent.js` guard). Brief and tools use titles only, never emails/profile names; `present_titles` only accepts ids a tool returned this turn or the brief listed; kids profiles get a kid-safe TMDB subset (`kidSafe`), no server titles, no staging. Rate limit 30 turns/10 min and 200/day per login. Needs `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`); hidden for non-admins when unset.
- Files: `gemini.js` REST client, `brief.js` per-profile brief (titles only; history from `sdk.parseHistory`), `tools.js` (TMDB find/search/details through
  `ctx.services.tmdb`, server library, downloads, watch history, `present_titles`, `stage_download`, `stage_monitor`), `staging.js` (in-memory staged
  actions, 10 min), `agent.js` (loop, `MAX_ROUNDS` 6, false-claim guard), `routes.js` (rate limit), `index.js` (`register(ctx)`).
- Shared pick-and-queue code is core: `sdk.chooseRelease` / `sdk.queueRelease` (same as the Save button and Sentinel).
- Config: `GEMINI_API_KEY`, `GEMINI_MODEL` (env or `data/plugins.json` settings.ai). TMDB features need core `TMDB_API_KEY`.
