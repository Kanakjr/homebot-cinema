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
| `src/routes/MetaDetails/StreamsList/Stream/styles.less` | 345 | Same; Phase 2: all hard-coded #F27A24 → --primary-accent-color/rgb tokens; accent-foreground text on play and hover buttons; 4K badge colour. |
| `src/routes/MetaDetails/StreamsList/StreamsList.js` | 277 | Quality-profile sort, swarm health, Save button (fork identity); Direct filter; "1 addon is still loading" (singular). |
| `README.md` | 253 | Project README. |
| `src/routes/MetaDetails/StreamsList/Stream/Stream.js` | 140 | Release details, swarm badge. |
| `src/routes/Player/Player.js` | 181 | Server library playback, HUD notices, external player links; slot playerOverlays, Up Next at the credits start and seek-bar marks a plugin reports (skip intro); Escape closes an open menu/drawer before leaving the player. |
| `src/routes/Player/Error/Error.js` | 115 | Copy stream URL / open in external player. |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | 97 | Fork issue template. |
| `src/index.html` | 95 | Boot screen and meta tags (branding); `referrer` meta (strict-origin-when-cross-origin). |
| `src/App/App.js` | 115 | Streaming server URL fixed to the origin; slot appOverlays; NewOnServer toaster; addons loader; number keys follow the sidebar (`common/navTabs.js`); Phase 3: shell-navigate handler (Go menu, Settings ⌘,, Search ⌘F) & fullscreen sync. |
| `.gitignore` | 77 | Secrets, data/, local notes. |
| `src/index.js` | 71 | Boot: plugin list, profile gate, SSO isolation before rendering; our English wording (`common/stringOverrides.js`). |
| `CONTRIBUTING.md` | 68 | Fork contributing guide. |
| `src/components/NavBar/HorizontalNavBar/NavMenu/NavMenuContent.js` | 64 | Profile switch, sign out, dashboard link. |
| `src/routes/Calendar/Calendar.tsx` | 63 | On-server / auto-download markers. |
| `src/routes/MetaDetails/MetaDetails.js` | 72 | MediaDownloadBar (downloads + Sentinel); slot metaDetailsSections under the description (collections). |
| `src/App/useInterfaceScale.ts` | 55 | Default zoom 90%. |
| `src/routes/Settings/General/User/User.tsx` | 51 | SSO identity instead of a Stremio account ("Signed in" line). |
| `manifest.json` | 41 | PWA name, icons, colours (branding). |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | 38 | Fork issue template. |
| `src/routes/MetaDetails/styles.less` | 37 | Download bar layout. |
| `src/routes/Settings/General/General.tsx` | 45 | Dashboard link; Stremio-account features (data export, calendar subscription, Trakt) hidden behind `STREMIO_ACCOUNT_FEATURES`. |
| `src/routes/Player/Error/styles.less` | 44 | Same; Phase 2: accent-foreground text on accent-fill buttons, tokens for translucent oranges. |
| `src/router/routerPaths.tsx` | 30 | Core routes (/downloads, /admin, /server) + slot routes. |
| `src/components/NavBar/HorizontalNavBar/HorizontalNavBar.js` | 32 | Brand mark, profile avatar, slot navButtons; Phase 3: data-tauri-drag-region. |
| `src/components/NavBar/VerticalNavBar/NavTabButton/styles.less` | 29 | Badge; Phase 2: inactive-icon opacity 0.35→0.55 (3:1 non-text minimum). |
| `webpack.config.js` | 30 | Build id, hls.js config swap, colour aliases; worker entry is `src/worker/index.js` (blocks Stremio's API); five system images left out of the offline cache (private `data/art/` override). |
| `src/routes/Board/Board.js` | 44 | Hero carousel, continue-watching cards with time left and next up (server/upnext.js), Upcoming row. |
| `src/routes/Board/StreamingServerWarning/StreamingServerWarning.tsx` | 15 | No "install the streaming server" link to stremio.com: the server is part of this install. |
| `src/components/Scale/Scale.tsx` | 24 | Zoom slider by choice. |
| `src/App/styles.less` | 45 | Branding; Phase 2: :root token defaults (--secondary/tertiary/quaternary-accent-color unified to primary; --primary-accent-rgb, --accent-foreground-color, --accent-thumb-color); Phase 3: --mac-traffic-lights-inset for data-shell=macos and data-fullscreen. |
| `src/App/WebUpdateScreen/WebUpdateScreen.tsx` | 22 | No update banner. |
| `src/routes/Calendar/Episode/Episode.less` | 18 | Markers. |
| `src/routes/Library/Placeholder/Placeholder.tsx` | 18 | No Stremio sign-in prompt; Phase 2: accent token for title colour. |
| `src/routes/Library/styles.less` | 15 | Same. |
| `src/routes/Discover/styles.less` | 15 | Pill style for discoverActions. |
| `package.json` | 15 | Name, scripts (test:server, plugin:new), lint covers plugins/. |
| `src/routes/MetaDetails/StreamsList/styles.less` | 14 | Same. |
| `src/components/MainNavBars/MainNavBars.tsx` | 33 | Core tabs (Downloads, Server, Admin), from `common/navTabs.js`; Phase 2: scroll-edge state (scrolled class on HorizontalNavBar, reset on route change). |
| `src/routes/Player/Indicator/Indicator.less` | 15 | Same; Phase 2: accent tokens for border and glow. |
| `src/routes/Player/Indicator/Indicator.tsx` | 12 | HUD notices. |
| `src/components/NavBar/HorizontalNavBar/styles.less` | 16 | Avatar styles; Phase 3: traffic-lights padding-left inset transition. |
| `Dockerfile` | 12 | Adds the server, plugins and ffmpeg. |
| `src/routes/Calendar/Selector/Selector.less` | 11 | Markers. |
| `src/components/NavBar/VerticalNavBar/NavTabButton/NavTabButton.js` | 11 | Badge for new on server. |
| `.github/dependabot.yml` | 11 | Fork dependabot settings. |
| `src/router/Routes.tsx` | 10 | No intro/login screen (SSO). |
| `src/common/Platform/Platform.tsx` | 10 | Safer external links. |
| `.dockerignore` | 10 | Build context. |
| `src/routes/Settings/Settings.tsx` | 15 | Slot settingsSections; scroll-spy highlights the section in the upper third of the view, same offset basis as the menu click. |
| `src/routes/Search/Search.js` | 15 | "No results for …" message instead of an empty page. |
| `src/routes/Search/styles.less` | 8 | Same (hint line). |
| `src/routes/Calendar/Episode/Episode.tsx` | 9 | Markers. |
| `src/routes/Settings/Menu/Menu.tsx` | 19 | Slot settingsSections (menu entries); `role`/`aria-current` on the section buttons. |
| `src/routes/Calendar/Selector/Selector.tsx` | 8 | Markers. |
| `src/common/Shortcuts/shortcuts.json` | 10 | Extra shortcuts; number keys 1–7. |
| `src/routes/Library/Library.js` | 7 | Switch to server library. |
| `src/routes/index.js` | 6 | Core route components (Downloads, ServerLibrary, Admin). |
| `src/routes/Player/useVideo.js` | 6 | HUD notice state. |
| `src/core/createTransport.ts` | 6 | Analytics disabled. |
| `src/common/interfaceScale.ts` | 6 | Zoom default. |
| `src/common/CONSTANTS.js` | 6 | Zoom choices. |
| `src/router/useGoBack.ts` | 9 | Back goes through the real history when there is any (upstream replaced the entry with the origin, leaving it twice in the history). |
| `src/router/getBackFallback.ts` | 5 | Fallback for MetaDetails returns root '/' directly rather than staying on the same title page when videoId is present. |
| `src/routes/Player/ControlBar/ControlBar.js` | 11 | Small control changes; passes seek-bar marks to SeekBar; slot playerControls. |
| `src/routes/Player/useSubtitles.ts` | 367 | Dynamic acoustic subtitle matcher: probes audio voice envelope, runs batch FFT correlation matrix, auto-selects & retimes best add-on subtitle; fixed toggleSubtitles hotkey 'c'. |
| `src/routes/Player/useSubtitles.d.ts` | 13 | Types for autoSyncInfo and onTriggerAutoSync in SubtitlesMenuProps and UseSubtitlesResult. |
| `src/routes/Player/SubtitlesMenu/SubtitlesMenu.js` | 25 | Header auto-sync trigger button for external subtitles and matched badge binding. |
| `src/routes/Player/SubtitlesMenu/styles.less` | 30 | Header auto-sync button styling and width adjustments. |
| `src/routes/Player/SubtitlesMenu/SubtitleVariant/SubtitleVariant.tsx` | 4 | Displays matched badge for auto-synced subtitle variant. |
| `src/routes/Player/SubtitlesMenu/SubtitleVariant/SubtitleVariant.less` | 13 | Styling for matched badge pill on variant item. |
| `src/routes/Player/ControlBar/SeekBar/SeekBar.js` | 30 | Intro / credits marks on the track and their label in the hover time (`markers`). |
| `src/routes/Player/ControlBar/SeekBar/styles.less` | 23 | Same. |
| `src/components/Slider/Slider.js` | 10 | Phase 5: accessibility attributes (role="slider", aria-valuemin, aria-valuemax, aria-valuenow, aria-disabled). |
| `src/components/Slider/styles.less` | 5 | Phase 5: volume slider uses primary accent fill for normal levels (0-100%). |
| `src/routes/Player/AudioMenu/AudioMenu.tsx` | 15 | Phase 5: rich audio track labels distinguishing multiple tracks of the same language with codec and channels. |
| `src/routes/Player/Buffering/Buffering.tsx` | 20 | Phase 5: loading spinner and status label ("Connecting...", "Buffering X%"). |
| `src/routes/Player/Buffering/Buffering.less` | 50 | Phase 5: styling for buffering spinner and frosted status badge. |
| `src/routes/Player/ControlBar/VolumeSlider/styles.less` | 15 | Phase 5: primary accent fill for volume track and thumb. |
| `src/routes/Player/ControlBar/styles.less` | 10 | Phase 5: tactile active state on control buttons. |
| `src/routes/Player/OptionsMenu/OptionsMenu.js` | 35 | Phase 5: admin-only magnet link, aspect ratio, network statistics and keyboard shortcuts options. |
| `src/routes/Player/SideDrawer/SideDrawer.tsx` | 15 | Phase 5: live watch progress on currently playing episode. |
| `src/routes/Player/styles.less` | 20 | Phase 5: click-to-dismiss scrim for episodes drawer and pointer-events pass-through on background/buffering layers. |
| `src/components/MetaPreview/MetaPreview.js` | 15 | Small fix; Phase 2: text title shown until logo URL loads (tracked per URL to avoid blank frames on item switch). |
| `src/routes/Settings/Streaming/Streaming.tsx` | 17 | Server URL list hidden (`SERVER_URL_EDITING`): the app always uses its own origin. Server settings read-only for non-admins. |
| `src/routes/Settings/Interface/useInterfaceOptions.ts` | 3 | Zoom choices. |
| `src/components/UpdateBanner/UpdateBanner.less` | 3 | Hidden banner. |
| `src/routes/Discover/Discover.js` | 2 | Slot discoverActions. |
| `src/components/NavBar/VerticalNavBar/VerticalNavBar.js` | 2 | Core tabs. |
| `src/App/WebUpdateScreen/useServiceWorkerUpdater.ts` | 2 | Apply SW update on next load. |
| `src/App/SearchParamsHandler.js` | 1 | Small fix. |
| `assets/favicons/favicon.ico` | 0 | Branding. |

<!-- Phase 2: Visual system (tokens) - new upstream file edits -->
| `src/components/Toggle/Toggle.less` | 42 | Phase 2: toggle thumb uses --accent-thumb-color (stays visible on very light accents like White). |
| `src/routes/Board/HeroCarousel/HeroCarousel.js` | 55 | Phase 2: backdrop shimmer while loading; text title shown until logo loads; logo state tracked (loading/ok/failed). |
| `src/routes/Board/HeroCarousel/styles.less` | 110 | Phase 2: loading shimmer keyframe; backdrop fade-in; logo-pending hidden-but-loading state. |
| `src/components/MainNavBars/MainNavBars.less` | 46 | Phase 2: .scrolled class adds translucent background, hairline border and shadow once the page is scrolled. |
| `src/components/MetaPreview/styles.less` | 220 | Phase 2: .logo-pending hides logo out of sight while text title shows (image still loads). |
| `src/components/ModalDialog/styles.less` | 135 | Phase 2: accent-foreground text on accent-fill action buttons. |
| `src/components/Chips/Chip/Chip.less` | 50 | Phase 2: active chip uses --accent-foreground-color for legible text on any accent. |
| `src/components/Video/styles.less` | 290 | Phase 2: air-date opacity raised from 0.44 to 0.65 (small text needs 4.5:1); upcoming flag text uses --accent-foreground-color. |
| `src/routes/Calendar/Table/Cell/Cell.less` | 160 | Phase 2: today dot text uses --accent-foreground-color on --secondary-accent-color background. |
| `src/routes/Player/ShortcutsModal/ShortcutsModal.less` | 185 | Phase 2: hard-coded #F27A24 → tokens; kbd key uses neutral foreground instead of #FFD700. |
| `src/routes/Settings/Menu/Menu.less` | 55 | Phase 2: version-info opacity 0.3→0.6 (was 2.3:1, now passes 4.5:1). |
| `src/routes/Settings/Player/Player.tsx` | 20 | Phase 3: hide external player when shell is active, hide duplicate Nvidia GPU toggle on macOS, sublabel explaining background playback restriction. |
| `src/routes/Settings/components/Option/Option.tsx` | 7 | Phase 3: support optional sublabel and title tooltip for setting options. |

<!-- Phase 4: Play-first title pages and 1-click playback -->
| `src/components/Video/Video.js` | 22 | Phase 4: renders Next up badge on current unwatched/in-progress episode and displays episode runtime tag. |
| `src/routes/Board/styles.less` | 12 | Phase 4: max-width 1/4 constraint on board-row-landscape cards to maintain 16:9 aspect ratio and alignment with Upcoming row. |
| `src/routes/MetaDetails/VideosList/VideosList.js` | 67 | Phase 4: episode watch progress tracking, runtime pass-through, next-up episode detection. |
| `src/components/LibItem/LibItem.js` | 2 | Context menu: pass explicit id/_id to MetaItem for right-click actions. |
| `src/components/MetaItem/MetaItem.js` | 30 | Context menu: right-click menu with Instant Play, Add/Remove Library, Mark Watched/Unwatched, Details, Copy Link. |

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
- `.github/workflows/pages.yml` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.github/workflows/build.yml` (upstream release/workflow/app-id/screenshots, not ours to publish)
- `.github/workflows/auto_assign.yml` (upstream release/workflow/app-id/screenshots, not ours to publish)
