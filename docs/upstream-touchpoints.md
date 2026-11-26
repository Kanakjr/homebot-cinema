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

Measured 2026-11-26: 120 code, config and doc files modified, 61 branding images replaced, 10 upstream files removed. A trial merge of
upstream `development` (43 commits ahead of beta.42) is described in docs/upstream-sync.md.

## Modified

| File | Lines changed | Why |
|---|---|---|
| `http_server.js` | 632 | Our backend entry (upstream has a tiny static server here). Core wiring only; features live in server/ and plugins/. |
| `src/routes/MetaDetails/StreamsList/Stream/styles.less` | 327 | Same; Phase 2: all hard-coded #F27A24 → --primary-accent-color/rgb tokens; accent-foreground text on play and hover buttons; 4K badge colour. |
| `src/routes/MetaDetails/StreamsList/StreamsList.js` | 279 | Quality-profile sort, swarm health, Save button (fork identity); Direct filter; "1 addon is still loading" (singular). |
| `README.md` | 316 | Project README. |
| `src/routes/MetaDetails/StreamsList/Stream/Stream.js` | 137 | Release details, swarm badge. |
| `src/routes/Player/Player.js` | 238 | Server library playback, HUD notices, external player links; slot playerOverlays (incl. `subtitlesOn`, `subtitleSource`), plugin subtitle sources (`usePluginSubtitleSources`), Up Next at the credits start and seek-bar marks a plugin reports (skip intro); Escape closes an open menu/drawer before leaving the player; one Audio & subtitles panel (`AudioSubtitlesMenu`); clean YouTube-style `0–9` / `Home` / `End` jumps and deduplicated `J`/`L` & `,`/`.` hotkeys. |
| `src/routes/Player/Error/Error.js` | 125 | Decode plain and zlib (`eAEB...`) stream hashes for Copy stream URL / external player links; gate external-player hint on resolved URL. |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | 97 | Fork issue template. |
| `src/index.html` | 94 | Boot screen and meta tags (branding); `referrer` meta (strict-origin-when-cross-origin). |
| `src/App/App.js` | 165 | Streaming server URL fixed to the origin; slot appOverlays; NewOnServer toaster; addons loader; number keys follow the sidebar (`common/navTabs.js`) outside `#/player`; Phase 3: shell-navigate handler (Go menu, Settings ⌘,, Search ⌘F) & fullscreen sync; "/" focuses search. |
| `.gitignore` | 34 | Secrets, data/, local notes. |
| `src/index.js` | 71 | Boot: plugin list, profile gate, SSO isolation before rendering; our English wording (`common/stringOverrides.js`). |
| `CONTRIBUTING.md` | 72 | Fork contributing guide. |
| `src/components/NavBar/HorizontalNavBar/NavMenu/NavMenuContent.js` | 64 | Profile switch, sign out, dashboard link. |
| `src/routes/Calendar/Calendar.tsx` | 85 | On-server / auto-download markers; Month/Agenda switch. |
| `src/routes/MetaDetails/MetaDetails.js` | 76 | MediaDownloadBar (downloads + Sentinel); slot metaDetailsSections under the description (collections). |
| `src/App/useInterfaceScale.ts` | 55 | Default zoom 90%. |
| `src/routes/Settings/General/User/User.tsx` | 56 | SSO identity instead of a Stremio account ("Signed in" line). |
| `manifest.json` | 41 | PWA name, icons, colours (branding). |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | 38 | Fork issue template. |
| `src/routes/MetaDetails/styles.less` | 94 | Download bar layout. |
| `src/routes/Settings/General/General.tsx` | 52 | Dashboard link; Stremio-account features (data export, calendar subscription, Trakt) hidden behind `STREMIO_ACCOUNT_FEATURES`. |
| `src/routes/Player/Error/styles.less` | 38 | Same; Phase 2: accent-foreground text on accent-fill buttons, tokens for translucent oranges. |
| `src/router/routerPaths.tsx` | 30 | Core routes (/downloads, /admin, /server) + slot routes. |
| `src/components/NavBar/HorizontalNavBar/HorizontalNavBar.js` | 32 | Brand mark, profile avatar, slot navButtons; Phase 3: data-tauri-drag-region. |
| `src/components/NavBar/VerticalNavBar/NavTabButton/styles.less` | 66 | New-on-server badge; inactive-icon opacity 0.35→0.55; compact mobile bottom-bar spacing. |
| `webpack.config.js` | 30 | Build id, hls.js config swap, colour aliases; worker entry is `src/worker/index.js` (blocks Stremio's API); five system images left out of the offline cache (private `data/art/` override). |
| `src/routes/Board/Board.js` | 82 | Hero carousel, continue-watching cards with time left and next up (server/upnext.js), Upcoming row; per-profile row hide/reorder/dedupe (`rowPrefs.js`, `RowsEditor.js`). |
| `src/routes/Board/StreamingServerWarning/StreamingServerWarning.tsx` | 16 | No "install the streaming server" link to stremio.com: the server is part of this install. |
| `src/components/Scale/Scale.tsx` | 24 | Zoom slider by choice. |
| `src/App/styles.less` | 40 | Branding; Phase 2: :root token defaults (--secondary/tertiary/quaternary-accent-color unified to primary; --primary-accent-rgb, --accent-foreground-color, --accent-thumb-color); Phase 3: --mac-traffic-lights-inset for data-shell=macos and data-fullscreen. |
| `src/App/WebUpdateScreen/WebUpdateScreen.tsx` | 22 | No update banner. |
| `src/routes/Calendar/Episode/Episode.less` | 18 | Markers. |
| `src/routes/Library/Placeholder/Placeholder.tsx` | 15 | No Stremio sign-in prompt; Phase 2: accent token for title colour. |
| `src/routes/Library/styles.less` | 20 | Same. |
| `src/routes/Discover/styles.less` | 15 | Pill style for discoverActions. |
| `package.json` | 19 | Name, scripts (test:server, plugin:new, scan-translations --roots tests), lint covers plugins/. |
| `src/routes/MetaDetails/StreamsList/styles.less` | 14 | Same. |
| `src/components/MainNavBars/MainNavBars.tsx` | 33 | Core tabs (Downloads, Server, Admin), from `common/navTabs.js`; Phase 2: scroll-edge state (scrolled class on HorizontalNavBar, reset on route change). |
| `src/routes/Player/Indicator/Indicator.less` | 13 | Same; Phase 2: accent tokens for border and glow. |
| `src/routes/Player/Indicator/Indicator.tsx` | 16 | HUD notices (show transient `hudNotice` on first call and repeat calls). |
| `src/components/NavBar/HorizontalNavBar/styles.less` | 83 | Avatar styles; Phase 3: traffic-lights padding-left inset transition. |
| `Dockerfile` | 12 | Adds the server, plugins and ffmpeg. |
| `src/routes/Calendar/Selector/Selector.less` | 11 | Markers. |
| `src/components/NavBar/VerticalNavBar/NavTabButton/NavTabButton.js` | 11 | Badge for new on server. |
| `.github/dependabot.yml` | 11 | Fork dependabot settings. |
| `src/router/Routes.tsx` | 10 | No intro/login screen (SSO). |
| `src/common/Platform/Platform.tsx` | 10 | Safer external links. |
| `.dockerignore` | 11 | Build context. |
| `src/routes/Settings/Settings.tsx` | 117 | Slot settingsSections; scroll-spy highlights the section in the upper third of the view, same offset basis as the menu click. |
| `src/routes/Search/Search.js` | 145 | Prepend and badge local library results (matched and unmatched) via `mergeServerResults`; "No results for …" empty state. |
| `src/routes/Search/styles.less` | 13 | Same (hint line). |
| `src/routes/Calendar/Episode/Episode.tsx` | 11 | Markers. |
| `src/routes/Settings/Menu/Menu.tsx` | 52 | Slot settingsSections (menu entries); `role`/`aria-current` on the section buttons. |
| `src/routes/Calendar/Selector/Selector.tsx` | 10 | Markers. |
| `src/common/Shortcuts/shortcuts.json` | 10 | Extra shortcuts; number keys 1–7. |
| `src/routes/Library/Library.js` | 17 | Switch to server library. |
| `src/routes/index.js` | 6 | Core route components (Downloads, ServerLibrary, Admin). |
| `src/routes/Player/useVideo.js` | 11 | HUD notice state (sequence-tagged so identical notices re-trigger). |
| `src/core/createTransport.ts` | 6 | Analytics disabled. |
| `src/common/interfaceScale.ts` | 6 | Zoom default. |
| `src/common/CONSTANTS.js` | 6 | Zoom choices. |
| `src/router/useGoBack.ts` | 9 | Back goes through the real history when there is any (upstream replaced the entry with the origin, leaving it twice in the history). |
| `src/router/getBackFallback.ts` | 6 | Fallback for MetaDetails returns root '/' directly rather than staying on the same title page when videoId is present. |
| `src/routes/Player/ControlBar/ControlBar.js` | 210 | Small control changes; passes seek-bar marks to SeekBar; slot playerControls; one Audio & subtitles button. |
| `src/routes/Player/useSubtitles.ts` | 370 | Dynamic acoustic subtitle matcher: probes audio voice envelope, runs batch FFT correlation matrix, auto-selects & retimes best add-on subtitle; fixed toggleSubtitles hotkey 'c'. |
| `src/routes/Player/useSubtitles.d.ts` | 13 | Types for autoSyncInfo and onTriggerAutoSync in SubtitlesMenuProps and UseSubtitlesResult. |
| `src/routes/Player/SubtitlesMenu/SubtitlesMenu.js` | 67 | Header auto-sync trigger button for external subtitles and matched badge binding; plugin subtitle sources (slot subtitleSources) as rows under OFF. |
| `src/routes/Player/SubtitlesMenu/styles.less` | 30 | Header auto-sync button styling and width adjustments. |
| `src/routes/Player/SubtitlesMenu/SubtitleVariant/SubtitleVariant.tsx` | 10 | Displays matched badge for auto-synced subtitle variant. |
| `src/routes/Player/SubtitlesMenu/SubtitleVariant/SubtitleVariant.less` | 13 | Styling for matched badge pill on variant item. |
| `src/routes/Player/ControlBar/SeekBar/SeekBar.js` | 39 | Intro / credits marks on the track and their label in the hover time (`markers`). |
| `src/routes/Player/ControlBar/SeekBar/styles.less` | 26 | Same. |
| `src/components/Slider/Slider.js` | 19 | Phase 5: `role="slider"`, `aria-label` (`label` prop), `aria-valuemin/max/now`, focusable. |
| `src/components/Slider/styles.less` | 5 | Phase 5: the boost gradient starts with the profile accent (it was white); the warm ramp marks boost above 100%. |
| `src/routes/Player/ControlBar/VolumeSlider/styles.less` | 4 | Phase 5: accent fill up to 100% volume. |
| `src/routes/Player/ControlBar/VolumeSlider/VolumeSlider.js` | 1 | Phase 5: accessible name ("Volume") for the slider. |
| `src/routes/Player/AudioMenu/AudioMenu.tsx` | 62 | Phase 5: rich audio track labels distinguishing multiple tracks of the same language with codec and channels. |
| `src/routes/Player/Buffering/Buffering.tsx` | 48 | Phase 5: loading spinner and status label ("Connecting...", "Buffering X%"). |
| `src/routes/Player/Buffering/Buffering.less` | 74 | Phase 5: styling for buffering spinner and frosted status badge. |
| `src/routes/Player/ControlBar/styles.less` | 6 | Phase 5: tactile active state on control buttons. |
| `src/routes/Player/OptionsMenu/OptionsMenu.js` | 51 | Phase 5: admin-only magnet link, aspect ratio, network statistics and keyboard shortcuts options; slot `playerMenuItems` (MetalFX 4K AI entry). |
| `src/routes/Player/SideDrawer/SideDrawer.tsx` | 12 | Phase 5: live watch progress on currently playing episode. |
| `src/routes/Player/styles.less` | 16 | Phase 5: click-to-dismiss scrim for episodes drawer and pointer-events pass-through on background/buffering layers. |
| `src/components/MetaPreview/MetaPreview.js` | 244 | Small fix; Phase 2: text title shown until logo URL loads (tracked per URL to avoid blank frames on item switch). |
| `src/routes/Settings/Streaming/Streaming.tsx` | 20 | Server URL list hidden (`SERVER_URL_EDITING`): the app always uses its own origin. Server settings read-only for non-admins. |
| `src/routes/Settings/Interface/useInterfaceOptions.ts` | 3 | Zoom choices. |
| `src/components/UpdateBanner/UpdateBanner.less` | 3 | Hidden banner. |
| `src/routes/Discover/Discover.js` | 6 | Slot discoverActions. |
| `src/components/NavBar/VerticalNavBar/VerticalNavBar.js` | 4 | Core tabs. |
| `src/App/WebUpdateScreen/useServiceWorkerUpdater.ts` | 2 | Apply SW update on next load. |
| `src/App/SearchParamsHandler.js` | 1 | Small fix. |
| `assets/favicons/favicon.ico` | 0 | Branding. |

<!-- Phase 2: Visual system (tokens) - new upstream file edits -->
| `src/components/Toggle/Toggle.less` | 2 | Phase 2: toggle thumb uses --accent-thumb-color (stays visible on very light accents like White). |
| `src/components/MainNavBars/MainNavBars.less` | 9 | Phase 2: .scrolled class adds translucent background, hairline border and shadow once the page is scrolled. |
| `src/components/MetaPreview/styles.less` | 143 | Phase 2: .logo-pending hides logo out of sight while text title shows (image still loads). |
| `src/components/ModalDialog/styles.less` | 4 | Phase 2: accent-foreground text on accent-fill action buttons. |
| `src/components/Chips/Chip/Chip.less` | 2 | Phase 2: active chip uses --accent-foreground-color for legible text on any accent. |
| `src/components/Video/styles.less` | 48 | Phase 2: air-date opacity raised from 0.44 to 0.65 (small text needs 4.5:1); upcoming flag text uses --accent-foreground-color. |
| `src/routes/Calendar/Table/Cell/Cell.less` | 9 | Phase 2: today dot text uses --accent-foreground-color on --secondary-accent-color background. |
| `src/routes/Settings/Menu/Menu.less` | 51 | Phase 2: version-info opacity 0.3→0.6 (was 2.3:1, now passes 4.5:1). |
| `src/routes/Settings/Player/Player.tsx` | 22 | Phase 3: hide external player when shell is active, hide duplicate Nvidia GPU toggle on macOS, sublabel explaining background playback restriction. |
| `src/routes/Settings/components/Option/Option.tsx` | 7 | Phase 3: support optional sublabel and title tooltip for setting options. |

<!-- Phase 4: Play-first title pages and 1-click playback -->
| `src/components/Video/Video.js` | 22 | Phase 4: renders Next up badge on current unwatched/in-progress episode and displays episode runtime tag. |
| `src/routes/Board/styles.less` | 52 | Landscape card aspect ratio & Customize rows button; offset bottom streaming-server warning past sidebar rail. |
| `src/routes/MetaDetails/VideosList/VideosList.js` | 67 | Phase 4: episode watch progress tracking, runtime pass-through, next-up episode detection. |
| `src/common/useTranslate.js` | 4 | Phase 7: catalog rows read "Popular · Movies" instead of "Popular - Movie" (English movie/series only). |
| `src/components/NavBar/VerticalNavBar/styles.less` | 39 | Settings and Admin pinned to bottom of desktop rail; icons-only rail in short windows; keep all mobile bottom-bar tabs aligned and visible. |
| `src/routes/Calendar/Calendar.less` | 45 | Phase 6: compact page header; Phase 7: Month/Agenda switch. |
| `src/routes/Calendar/List/List.tsx` | 49 | Agenda opens at today; `className` prop; non-blank empty state when a month has no episodes. |
| `src/routes/Calendar/Table/Cell/Cell.tsx` | 8 | Phase 7: days before today are dimmed. |
| `src/routes/Settings/General/User/User.less` | 11 | Phase 6: Switch profile / Sign out buttons in the Account pane. |
| `src/routes/Settings/Settings.less` | 12 | Phase 6: readable max width for the pane. |
| `src/routes/Settings/constants.ts` | 1 | Phase 6: `ABOUT` section id. |
| `src/components/MetaItem/styles.less` | 26 | Phase 7: small year/type line under the title (`subtitle`, Search top results). |
| `src/components/LibItem/LibItem.js` | 10 | Context menu: pass explicit id/_id to MetaItem for right-click actions. |
| `src/components/MetaItem/MetaItem.js` | 81 | Context menu: right-click menu with Instant Play, Add/Remove Library, Mark Watched/Unwatched, Details, Copy Link. |
| `eslint.config.mjs` | 2 | `no-alert`: the macOS app's web view answers `confirm()`/`prompt()` with "cancel" at once, so UI code uses `src/common/dialogs.js`. |
| `.github/workflows/pages.yml` | 56 | Builds and publishes project site to GitHub Pages. |
| `src/routes/Board/StreamingServerWarning/StreamingServerWarning.less` | 14 | High-contrast warning surface and button styling (>= 4.5:1). |
| `src/routes/Calendar/List/List.less` | 20 | Agenda empty-state spacing and typography. |

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

System artwork and placeholders (`docs/mascot-art.md`, `scripts/brand/render-placeholders.py`):

- `assets/images/anonymous.png`
- `assets/images/calendar_placeholder.png`
- `assets/images/default_avatar.png`
- `assets/images/empty.png`
- `assets/images/library_placeholder.png`

## Removed

- `assets/screenshots/metadetails.png` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `assets/screenshots/discover.png` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `assets/screenshots/board_wide.webp` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `assets/screenshots/board_narrow.webp` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `assets/screenshots/board.png` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.well-known/apple-app-site-association` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.github/workflows/release.yml` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.github/workflows/pages_cleanup.yml` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.github/workflows/build.yml` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.github/workflows/auto_assign.yml` (upstream release/workflow/app-id/screenshots, not ours to publish)
