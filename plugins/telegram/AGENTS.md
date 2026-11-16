# Plugin `telegram`: household alerts

Contract: docs/plugins.md. Server: `server/index.js` listens to the core `notify` hook and sends Markdown messages through the Bot API.
Tests: `test/telegram.nt.js` (sending is injected, nothing hits the network).

- Config: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (env or `data/plugins.json` settings.telegram). Inactive without both.
- Never log the token. Emitters: Sentinel (`sentinel.notify(title, text)`); add more by emitting `notify` from core.
