# Google Drive library (plugin `gdrive`)

The local disk is the landing zone; a cloud drive (Google Drive through rclone, or any network mount) is long-term storage.
Files on the drive show up in the server library next to local ones and can be played. Nothing downloads into the mount.

## Setup

1. **rclone remote.** Run `rclone config` yourself (remote type `drive`, your own OAuth client id; publish the OAuth app so the
   token does not expire after 7 days). Check `rclone about <remote>:` first: the library needs real quota.
2. **Mount it** with `scripts/mount-drive.sh` (`GDRIVE_REMOTE`, `GDRIVE_MOUNT`, optional `GDRIVE_CACHE_DIR` and
   `GDRIVE_CACHE_MAX`, default 60G), for example as a launchd agent from `scripts/com.homebot.gdrive-mount.plist.example`. The
   script creates `.cinema-root` markers on the drive side in `Movies/` and `TV/`.
3. **Prove containers can read it** before you change compose:
   `docker run --rm -v <mount>:/m alpine sh -c 'ls /m && dd if=/m/Movies/<big file> of=/dev/null bs=1M skip=2000 count=20'`.
   If Docker cannot see the host mount, stop here and use an NFS/WebDAV volume instead.
4. **Bind the folders** into the app, the streaming server and Transmission (for example `<mount>/Movies:/GDriveMovies`,
   `<mount>/TV:/GDriveTV`). Set `LIBRARY_EXTRA_MOVIES_DIRS`, `LIBRARY_EXTRA_TV_DIRS` and add the same paths to `MEDIA_ROOTS`.
5. **Switch the plugin on** (`CINEMA_PLUGINS=...,gdrive` or `data/plugins.json`) and restart. `GET /api/gdrive/status` (admin)
   shows each root and whether it is online.

## Tiering (moving watched files to the drive)

An admin calls `POST /api/gdrive/tiering/plan`. It writes `data/plugin-data/gdrive/tiering/Movies.txt` and `TV.txt`. A file is
listed only when all of these hold:
- it is watched (by any profile, or by every profile with `TIERING_WATCHED=all`);
- it is older than `TIERING_MIN_AGE_DAYS` (default 14);
- it is not in the newest season of a monitored show;
- no Transmission torrent holds it. If Transmission cannot be asked, the plan fails and nothing is listed.

Then `DRY_RUN=1 LOCAL_MEDIA=<host media folder> GDRIVE_REMOTE=<remote> scripts/move-to-drive.sh` shows what would move, and
`DRY_RUN=0` moves it. rclone deletes a local copy only after a verified upload. If you want a finished torrent's files to move,
remove the torrent in Transmission first.

## Safety

A drive root counts as online only when it holds `.cinema-root`. While it is offline, the scan skips it and keeps its rows,
`scanTrusted()` is false (so Sentinel does not treat missing files as deleted), and library deletes there answer 503.

## Things to know

- **Blocking listings.** The scan lists the mount synchronously. If rclone hangs, the Node process stalls (streaming and auth
  with it). Keep `--dir-cache-time` long, and only enable the roots once the mount has proven stable.
- **Start order.** If the mount starts after Docker, the containers keep seeing the empty folder underneath: restart them, or
  start the mount before Docker. The marker check turns that into "offline", not data loss.
- **launchd and macOS privacy.** A launchd-started `/bin/bash` can get "Operation not permitted" when listing an external volume (seen on macOS, 2026-11). The mount job and the mover then need Full Disk Access for the shell or rclone binary they run with (System Settings > Privacy & Security > Full Disk Access). Run from a terminal they work without it.
- A moved file keeps its old stream link and download record until the next library rescan.

Not built yet: running the plan on a schedule, async listing with a timeout, a per-file "on Drive" badge, and Sentinel
downloading straight to the drive.
