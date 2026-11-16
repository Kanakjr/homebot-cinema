#!/bin/bash
# Tiering mover: local Movies/TV -> the drive, never into the mount. Run it by hand (or from launchd) after the app wrote the plan.
#   DRY_RUN=1 ./move-to-drive.sh   (default: prints what would move, changes nothing)
#   DRY_RUN=0 ./move-to-drive.sh   (does it)
# WHAT moves is decided by the app (POST /api/gdrive/tiering/plan writes data/plugin-data/gdrive/tiering/{Movies,TV}.txt): watched,
# older than TIERING_MIN_AGE_DAYS, not the newest season of a monitored show, not referenced by any Transmission torrent.
# This script moves only those listed files. rclone move deletes the local copy only after a verified upload.
#   LOCAL_MEDIA   host folder that holds Movies/ and TV/ (required)
#   GDRIVE_REMOTE rclone remote and folder, e.g. gdrive:Media (required)
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
LOCAL="${LOCAL_MEDIA:?set LOCAL_MEDIA, the host folder holding Movies/ and TV/}"
REMOTE="${GDRIVE_REMOTE:?set GDRIVE_REMOTE, e.g. gdrive:Media}"
PLAN_DIR="${TIERING_PLAN_DIR:-$HERE/../../../data/plugin-data/gdrive/tiering}"
DRY_RUN="${DRY_RUN:-1}"
LOCK="${TMPDIR:-/tmp}/gdrive-mover.lock"
if ! mkdir "$LOCK" 2>/dev/null; then echo "mover already running"; exit 0; fi
trap 'rmdir "$LOCK"' EXIT
# stop gracefully before Google's ~750 GB/day upload cap; the next run resumes
FLAGS=(--delete-empty-src-dirs --max-transfer 600G --cutoff-mode soft --transfers 2 --drive-chunk-size 128M)
[ "$DRY_RUN" = "0" ] || FLAGS+=(--dry-run)
for kind in Movies TV; do
    LIST="$PLAN_DIR/$kind.txt"
    [ -s "$LIST" ] || { echo "$kind: nothing planned"; continue; }
    # sidecar files (subs/nfo) next to a planned video are left behind on purpose: only listed paths move
    rclone move "$LOCAL/$kind" "$REMOTE/$kind" --files-from "$LIST" "${FLAGS[@]}" -v
done
