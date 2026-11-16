# Plugin `themes`: Appearance and accent colours (UI only)

Contract: docs/plugins.md. No server code (`"server": null`). UI: `ui/Appearance.js` (slot `settingsSections`, a forwardRef Settings `Section`),
`ui/accents.js` (slot `accents`). Tests: `test/themes.spec.js`.

- Core keeps the theme engine and the brand palette (`src/common/theme.js`: Amber, Gold, `applyTheme`, `getAccents()`). Without this plugin every
  profile uses the brand look and the profile editor offers only the core accents.
- Settings are per household profile (`accent`, `settings.amoled`, `settings.cornerRadius`), saved through `profileManager.updateProfile`.
- A theme pack is another plugin that exports `accents` (keys must not clash with core ones; colours `#rrggbb`).
