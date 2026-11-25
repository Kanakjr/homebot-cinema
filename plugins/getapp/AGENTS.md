# Plugin `getapp`

Get the app: a download page for the household. Read docs/plugins.md for the contract; this file is only what is special here.

- Page: `GET /api/getapp/` (trailing slash; behind the login gate like every `/api` route). Share that URL with people
  who were added to Cloudflare Access. It lists the installers found in the plugin's data folder and shows setup steps per
  platform (macOS, Android, web).
- Installers are **operator data**, never in git: put them in `data/plugin-data/getapp/` (`*.dmg`, `*.apk`). A private
  desktop build has the install's URL baked in, which is why it lives in `data/`. An optional `screenshot.png` (or `.jpg`)
  there is shown on the page.
- Files: `GET /api/getapp/file/<name>`. Only names from the current listing are served (no paths), as attachments, with
  `Cache-Control: private, no-store` (Cloudflare must not cache them).
- Text stays generic: no household names, hostnames or emails in the page source.
- Tests: `test/getapp.nt.js`.
