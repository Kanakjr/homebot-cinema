# Screenshots

The images the main [README](../../README.md) shows. They are real captures of a running instance (WebP, about 2200 px wide),
cropped to the app itself.

| File | Shows |
|---|---|
| `home.webp` | Home: hero banner and catalog rows |
| `discover.webp` | Discover with the info panel |
| `smart-filters.webp`, `quick-picks.webp` | Smart filters, and the quick picks menu |
| `search.webp` | Search across all addons |
| `title-page.webp` | A title page: server status, quality profile, *Save to server*, *Auto-download episodes* |
| `downloads.webp` | Downloads: storage, active, Sentinel, recently completed |
| `quality-profiles.webp`, `admin-overview.webp` | Admin: quality profiles and the overview cards |
| `library.webp`, `calendar.webp` | Your library, and the calendar of upcoming episodes |
| `player.webp` | The player |
| `copilot-mobile.webp` | The AI copilot on a phone |

## Adding or replacing a screenshot

- Crop out the browser's address bar and tabs (they show your hostname and account), and any hover-link tooltip at the bottom.
- Look at the whole image before committing: no emails, tokens, private addon names or URLs, and no stream lists with release
  names or source names.
- Profile pictures: use the avatars in `server/avatars/` (original artwork). Do not publish character or actor images.
- Save as WebP (quality about 88) to keep the repository small: `cwebp -q 88 in.png -o out.webp`.
- Only publish artwork you have the right to share. Posters shown by the app belong to their owners.
