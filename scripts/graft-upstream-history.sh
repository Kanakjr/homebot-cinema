#!/bin/sh
# Re-parents a branch's history onto upstream stremio-web, so `git merge upstream/development` works (docs/upstream-sync.md).
#   scripts/graft-upstream-history.sh [source-branch=main] [new-branch=graft/<source>] [base=upstream-base]
# Same trees, messages, authors and dates; only the root commit gains the upstream base as its parent. Touches no existing
# branch and pushes nothing. Merge commits are not supported (the public history is linear).
set -eu
SRC="${1:-main}"
DST="${2:-graft/$SRC}"
BASE="${3:-upstream-base}"
git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || { echo "missing $BASE: see docs/upstream-sync.md (one-time setup)"; exit 2; }
git rev-parse --verify --quiet "refs/heads/$DST" >/dev/null && { echo "branch $DST already exists"; exit 1; }
if [ -n "$(git rev-list --min-parents=2 "$SRC")" ]; then echo "$SRC has merge commits: not supported"; exit 1; fi
parent=$(git rev-parse "$BASE^{commit}")
for c in $(git rev-list --reverse "$SRC"); do
    tree=$(git rev-parse "$c^{tree}")
    parent=$(
        GIT_AUTHOR_NAME="$(git log -1 --format=%an "$c")" GIT_AUTHOR_EMAIL="$(git log -1 --format=%ae "$c")" GIT_AUTHOR_DATE="$(git log -1 --format=%aD "$c")" \
        GIT_COMMITTER_NAME="$(git log -1 --format=%cn "$c")" GIT_COMMITTER_EMAIL="$(git log -1 --format=%ce "$c")" GIT_COMMITTER_DATE="$(git log -1 --format=%cD "$c")" \
        git log -1 --format=%B "$c" | git commit-tree "$tree" -p "$parent"
    )
done
git branch "$DST" "$parent"
if git diff --quiet "$SRC" "$DST"; then echo "OK: $DST has the same tree as $SRC, on top of $BASE ($(git rev-parse --short "$BASE"))"; else echo "tree mismatch!"; exit 1; fi
echo "Check: git log --oneline -3 $DST ; git merge-base $DST upstream/development"
echo "Publish (maintainer decision, rewrites history): git push --force-with-lease origin $DST:main"
