# Upstream touchpoints

Every file that exists in upstream stremio-web (`v5.0.0-beta.42`) and that this fork changes or removes. Everything else we
add lives in new files (`server/`, `plugins/`, `src/plugins/`, our own routes and components), which upstream never touches,
so they never conflict on a merge.

Rules:
- Prefer a new file or a plugin over editing an upstream file. If a feature needs a place in an upstream screen, add a **slot**
  once (`src/plugins/host.js`) and contribute to it from a plugin.
- A new edit to an upstream file must be added to this list in the same change, with the reason. `pnpm check:upstream` fails
  on any modified upstream file that is not listed here (it needs the `upstream-base` tag: see docs/upstream-sync.md).
- Keep edits small and marked (`// HomeBot:` comments help the next merge).

Measured 2026-11-16 (after the plugin move): 68 code, config and doc files modified, 55 branding images replaced, 11 upstream files removed. A trial merge of
upstream `development` (43 commits ahead of beta.42) is described in docs/upstream-sync.md.

## Modified

| File | Lines changed | Why |
|---|---|---|
| `http_server.js` | 562 | Our backend entry (upstream has a tiny static server here). Core wiring only; features live in server/ and plugins/. |
| `src/routes/MetaDetails/StreamsList/Stream/styles.less` | 327 | Same. |
| `src/routes/MetaDetails/StreamsList/StreamsList.js` | 277 | Quality-profile sort, swarm health, Save button (fork identity); Direct filter. |
| `README.md` | 253 | Project README. |
| `src/routes/MetaDetails/StreamsList/Stream/Stream.js` | 140 | Release details, swarm badge. |
| `src/routes/Player/Player.js` | 181 | Server library playback, HUD notices, external player links; slot playerOverlays, Up Next at the credits start and seek-bar marks a plugin reports (skip intro). |
| `src/routes/Player/Error/Error.js` | 115 | Copy stream URL / open in external player. |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | 97 | Fork issue template. |
| `src/index.html` | 95 | Boot screen and meta tags (branding); `referrer` meta (same-origin). |
| `src/App/App.js` | 85 | Streaming server URL fixed to the origin; slot appOverlays; NewOnServer toaster; addons loader. |
| `.gitignore` | 77 | Secrets, data/, local notes. |
| `src/index.js` | 71 | Boot: plugin list, profile gate, SSO isolation before rendering. |
| `CONTRIBUTING.md` | 68 | Fork contributing guide. |
| `src/components/NavBar/HorizontalNavBar/NavMenu/NavMenuContent.js` | 64 | Profile switch, sign out, dashboard link. |
| `src/routes/Calendar/Calendar.tsx` | 63 | On-server / auto-download markers. |
| `src/routes/MetaDetails/MetaDetails.js` | 72 | MediaDownloadBar (downloads + Sentinel); slot metaDetailsSections under the description (collections). |
| `src/App/useInterfaceScale.ts` | 55 | Default zoom 90%. |
| `src/routes/Settings/General/User/User.tsx` | 50 | SSO identity instead of a Stremio account. |
| `manifest.json` | 41 | PWA name, icons, colours (branding). |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | 38 | Fork issue template. |
| `src/routes/MetaDetails/styles.less` | 37 | Download bar layout. |
| `src/routes/Settings/General/General.tsx` | 45 | Dashboard link; Stremio-account features (data export, calendar subscription, Trakt) hidden behind `STREMIO_ACCOUNT_FEATURES`. |
| `src/routes/Player/Error/styles.less` | 32 | Same. |
| `src/router/routerPaths.tsx` | 30 | Core routes (/downloads, /admin, /server) + slot routes. |
| `src/components/NavBar/HorizontalNavBar/HorizontalNavBar.js` | 30 | Brand mark, profile avatar, slot navButtons. |
| `src/components/NavBar/VerticalNavBar/NavTabButton/styles.less` | 27 | Badge. |
| `webpack.config.js` | 28 | Build id, hls.js config swap, colour aliases; worker entry is `src/worker/index.js` (blocks Stremio's API). |
| `src/routes/Board/Board.js` | 44 | Hero carousel, continue-watching cards with time left and next up (server/upnext.js), Upcoming row. |
| `src/routes/Board/StreamingServerWarning/StreamingServerWarning.tsx` | 15 | No "install the streaming server" link to stremio.com: the server is part of this install. |
| `src/components/Scale/Scale.tsx` | 24 | Zoom slider by choice. |
| `src/App/styles.less` | 24 | Branding. |
| `src/App/WebUpdateScreen/WebUpdateScreen.tsx` | 22 | No update banner. |
| `src/routes/Calendar/Episode/Episode.less` | 18 | Markers. |
| `src/routes/Library/Placeholder/Placeholder.tsx` | 17 | No Stremio sign-in prompt. |
| `src/routes/Library/styles.less` | 15 | Same. |
| `src/routes/Discover/styles.less` | 15 | Pill style for discoverActions. |
| `package.json` | 15 | Name, scripts (test:server, plugin:new), lint covers plugins/. |
| `src/routes/MetaDetails/StreamsList/styles.less` | 14 | Same. |
| `src/components/MainNavBars/MainNavBars.tsx` | 14 | Core tabs (Downloads, Server, Admin). |
| `src/routes/Player/Indicator/Indicator.less` | 13 | Same. |
| `src/routes/Player/Indicator/Indicator.tsx` | 12 | HUD notices. |
| `src/components/NavBar/HorizontalNavBar/styles.less` | 12 | Avatar styles. |
| `Dockerfile` | 12 | Adds the server, plugins and ffmpeg. |
| `src/routes/Calendar/Selector/Selector.less` | 11 | Markers. |
| `src/components/NavBar/VerticalNavBar/NavTabButton/NavTabButton.js` | 11 | Badge for new on server. |
| `.github/dependabot.yml` | 11 | Fork dependabot settings. |
| `src/router/Routes.tsx` | 10 | No intro/login screen (SSO). |
| `src/common/Platform/Platform.tsx` | 10 | Safer external links. |
| `.dockerignore` | 10 | Build context. |
| `src/routes/Settings/Settings.tsx` | 9 | Slot settingsSections. |
| `src/routes/Calendar/Episode/Episode.tsx` | 9 | Markers. |
| `src/routes/Settings/Menu/Menu.tsx` | 8 | Slot settingsSections (menu entries). |
| `src/routes/Calendar/Selector/Selector.tsx` | 8 | Markers. |
| `src/common/Shortcuts/shortcuts.json` | 8 | Extra shortcuts. |
| `src/routes/Library/Library.js` | 7 | Switch to server library. |
| `src/routes/index.js` | 6 | Core route components (Downloads, ServerLibrary, Admin). |
| `src/routes/Player/useVideo.js` | 6 | HUD notice state. |
| `src/core/createTransport.ts` | 6 | Analytics disabled. |
| `src/common/interfaceScale.ts` | 6 | Zoom default. |
| `src/common/CONSTANTS.js` | 6 | Zoom choices. |
| `src/routes/Player/ControlBar/ControlBar.js` | 8 | Small control changes; passes seek-bar marks to SeekBar. |
| `src/routes/Player/ControlBar/SeekBar/SeekBar.js` | 30 | Intro / credits marks on the track and their label in the hover time (`markers`). |
| `src/routes/Player/ControlBar/SeekBar/styles.less` | 23 | Same. |
| `src/components/MetaPreview/MetaPreview.js` | 4 | Small fix. |
| `src/routes/Settings/Streaming/Streaming.tsx` | 17 | Server URL list hidden (`SERVER_URL_EDITING`): the app always uses its own origin. Server settings read-only for non-admins. |
| `src/routes/Settings/Interface/useInterfaceOptions.ts` | 3 | Zoom choices. |
| `src/components/UpdateBanner/UpdateBanner.less` | 3 | Hidden banner. |
| `src/routes/Discover/Discover.js` | 2 | Slot discoverActions. |
| `src/components/NavBar/VerticalNavBar/VerticalNavBar.js` | 2 | Core tabs. |
| `src/App/WebUpdateScreen/useServiceWorkerUpdater.ts` | 2 | Apply SW update on next load. |
| `src/App/SearchParamsHandler.js` | 1 | Small fix. |
| `assets/favicons/favicon.ico` | 0 | Branding. |

## Replaced images (branding: `scripts/brand/build.js` regenerates them)

All of `assets/images/splash/*` (iOS splash screens), plus:

- `assets/images/icon.png`
- `assets/images/icon_196x196.png`
- `assets/images/icon_512x512.png`
- `assets/images/logo.png`
- `assets/images/maskable_icon.png`
- `assets/images/maskable_icon_196x196.png`
- `assets/images/maskable_icon_512x512.png`
- `assets/images/monochrome_icon_512x512.png`
- `assets/images/stremio_symbol.png`

## Removed

- `assets/screenshots/metadetails.png` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `assets/screenshots/discover.png` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `assets/screenshots/board_wide.webp` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `assets/screenshots/board_narrow.webp` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `assets/screenshots/board.png` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.well-known/apple-app-site-association` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.github/workflows/release.yml` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.github/workflows/pages_cleanup.yml` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.github/workflows/pages.yml` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.github/workflows/build.yml` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.github/workflows/auto_assign.yml` (upstream release/workflow/app-id/screenshots, not ours to publish)
