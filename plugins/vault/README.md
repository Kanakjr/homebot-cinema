# Locked folder (plugin `vault`)

A private folder of videos that only the admin, on the owner profile, can open, with its own passcode. It appears as a
**Locked folder** tile at the end of *Server library*. Inside: folders, thumbnails, search, sort, play, delete, and a
**Lock** button.

What it never does:
- show its videos anywhere else: library, search, Home rows, Continue watching, Calendar, the AI copilot, Watch stats,
  Admin › Now playing, or another device's remote (they see only "Locked folder");
- send anything about them outside your server: thumbnails and lengths come from ffmpeg on the server itself;
- write their names to the activity log.

It hides the files **in the app**. They are not encrypted on disk: anyone who can open the folder on the server itself
can see them.

## Set it up
1. Pick a folder **outside** your movie/TV folders and outside `MEDIA_ROOTS`, and put an empty marker file in it, so an
   unplugged drive is never mistaken for "everything deleted":
   ```sh
   touch /path/to/Locked/.cinema-root
   ```
2. Mount it into the container and tell the plugin where it is (do **not** add it to `MEDIA_ROOTS`):
   ```yaml
   services:
     homebot-cinema:
       volumes:
         - type: bind
           source: /path/to/Locked
           target: /Locked
           bind: { create_host_path: false }   # never create an empty folder when the drive is missing
       environment:
         - VAULT_DIR=/Locked
   ```
3. Switch the plugin on (Admin › Plugins, or `"vault"` in `data/plugins.json`) and restart.
4. As the admin on the owner profile, open *Server library* › **Locked folder** and choose a passcode (at least 6
   characters; only digits gives you a number pad for the TV remote or a game controller).

Settings: `VAULT_DIR` (required), `VAULT_AUTOLOCK_MIN` (default 10 minutes without activity; a video open in the player
keeps it unlocked).

## Forgot the passcode
Five wrong tries lock it for 15 minutes. A forgotten passcode can only be cleared on the server itself:
```sh
docker exec homebot-cinema node plugins/vault/scripts/reset-passcode.js
docker restart homebot-cinema
```
Nothing in the folder is touched; you choose a new passcode the next time you open it.

## Playback
The Mac app plays every format directly. A browser plays .mp4, .m4v and .webm; other formats (.mov, .mpeg, .mkv …) show
"plays in the Mac app". Each video remembers where you stopped, privately.
