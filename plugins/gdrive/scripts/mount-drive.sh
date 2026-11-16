#!/bin/bash
# Mounts an rclone remote read-mostly with a capped VFS cache. Run by launchd (see com.homebot.gdrive-mount.plist.example).
# Nothing is installed or started by this repo: review, set the variables, then load it yourself.
#   GDRIVE_REMOTE   rclone remote and folder, e.g. gdrive:Media
#   GDRIVE_MOUNT    where to mount it on the host, e.g. /Volumes/Media/gdrive-media
#   GDRIVE_CACHE_DIR, GDRIVE_CACHE_MAX (default 60G)
set -eu
REMOTE="${GDRIVE_REMOTE:?set GDRIVE_REMOTE, e.g. gdrive:Media}"
MOUNT="${GDRIVE_MOUNT:?set GDRIVE_MOUNT, the host folder to mount on}"
CACHE="${GDRIVE_CACHE_DIR:-$HOME/.cache/rclone-vfs}"
CACHE_MAX="${GDRIVE_CACHE_MAX:-60G}"
mkdir -p "$MOUNT" "$CACHE"
# The marker is created on the Drive side (never in the empty mount point), so the app can tell "mounted" from "unmounted".
# Each cold root (Movies/, TV/) carries its own marker because those are the folders bound into the containers.
rclone mkdir "$REMOTE/Movies"
rclone mkdir "$REMOTE/TV"
rclone touch "$REMOTE/Movies/.cinema-root"
rclone touch "$REMOTE/TV/.cinema-root"
exec rclone nfsmount "$REMOTE" "$MOUNT" \
    --vfs-cache-mode full --vfs-cache-max-size "$CACHE_MAX" --cache-dir "$CACHE" \
    --vfs-read-ahead 256M --dir-cache-time 12h --vfs-cache-max-age 72h --read-only=false
