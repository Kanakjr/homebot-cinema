# Staying in sync with upstream stremio-web

HomeBot Cinema is a fork of [Stremio/stremio-web](https://github.com/Stremio/stremio-web). The UI base is tag `v5.0.0-beta.42`.

## One-time setup in a clone

```bash
git remote add upstream https://github.com/Stremio/stremio-web.git
git config remote.upstream.pushurl DISABLED     # never push to upstream by accident
git config remote.upstream.tagOpt --no-tags     # keep upstream tags out of ours
git fetch upstream development
git fetch upstream refs/tags/v5.0.0-beta.42:refs/tags/upstream-base
```

`upstream-base` is the upstream commit our tree started from. `pnpm check:upstream` compares against it.

## Shared history

Git can only do a real three-way merge when our history contains upstream's. Our public history started as one squashed
commit, so it has no common ancestor with upstream. The fix is to re-parent that first commit onto `upstream-base` once. This
rewrites `main`, so it is a maintainer decision (see "History graft" below). Until then, upstream changes have to be ported by
hand.

With shared history, a trial merge of upstream's 43 newer commits (411 files) merges every other file by itself.

## The next merge (trial run, 2026-11-16, after the plugin move)

Merging `upstream/development` into the grafted history leaves 20 files to resolve:
- **9 content conflicts, 15 hunks in all**: `package.json`, `src/index.js`, `src/App/App.js`, `HorizontalNavBar.js`,
  `Scale.tsx`, `UpdateBanner.less`, `Board.js`, `Settings.tsx`, `Settings/Menu/Menu.tsx`. Most are small: keep both sides,
  then put our slot lines back.
- **9 files upstream deleted or rewrote that we changed** (`MetaDetails.js` and its styles, the whole `StreamsList` +
  `Stream` folder, `Settings/General/General.tsx`, `User.tsx`, `MetaPreview.js`). Upstream restructured the title page and
  General settings. Our changes there (quality sort, swarm badges, the download bar, SSO identity, dashboard link) have to be
  re-applied to the new files. This is the real work of that merge. Do it as its own PR, and consider moving the
  download bar into a `metaPanels` slot while you are there.
- **2 workflows** we removed and upstream changed (`.github/workflows/build.yml`, `release.yml`): keep them removed.

## Merging upstream

```bash
git fetch upstream development
git switch -c sync/upstream-$(date +%Y%m%d)
git merge upstream/development
#   conflicts are only in files listed in docs/upstream-touchpoints.md
pnpm i && pnpm test && pnpm test:server && pnpm lint && npx webpack --mode production
pnpm check:upstream upstream/development   # any new touchpoints?
```

Then open a PR. After the merge, move the tag: `git tag -f upstream-base upstream/development`.

What makes conflicts rare:
- New features go in `plugins/` or in new files, never inline in upstream files.
- Upstream files get small, marked edits: slots (`<PluginSlot name=...>`), not feature code.
- `docs/upstream-touchpoints.md` lists each touched upstream file and why, so the person (or agent) resolving a conflict knows
  what our side of the edit is for.

## History graft

`scripts/graft-upstream-history.sh` builds a new branch (`graft/main`) whose first commit has `upstream-base` as its parent and
otherwise the same trees and messages as `main`. It does not touch `main` and does not push. After checking it (same tree as
`main`: `git diff main graft/main` is empty), a maintainer replaces `main` with it:

```bash
git push --force-with-lease origin graft/main:main
```

Everyone with a clone then runs `git fetch && git reset --hard origin/main` (or re-clones). Only graft from the public `main`,
never from a private or backup branch.
