# livesubs: AI subtitles while you watch (prototype)

Whisper transcribes the audio of the stream ahead of the viewer and the player overlay draws the lines.

- `server/engine.js`: one Transcriber per (source, language, translate). ffmpeg reads audio from the viewer's position
  (`-ss`, 16 kHz mono PCM, `aresample=async=1:first_pts=0` pads late-starting audio). First chunk 8 s, then 30 s; a
  sentence cut by the chunk end is held back and redone in the next chunk. One shared Whisper queue, most urgent chunk
  first. Reading pauses `LIVESUBS_MAX_LEAD_SEC` ahead (pipe backpressure); a seek outside what is read restarts ffmpeg.
  Cues are cached per source in `livesubs_cues` (saved when a source goes idle).
- `server/cues.js`: pure helpers (WAV header, segment -> cue tidy-up, commit/merge, VTT). Tested in `test/livesubs.nt.js`.
- `server/whisper.js`: client for whisper.cpp `whisper-server` (`POST /inference`, verbose_json).
- Sources: torrents (`infoHash` + `fileIdx`, read through the streaming server) and library files (`lf_<id>`, must pass
  `isInsideRoots`). Plain URL streams are refused on purpose (the server would fetch any address a client names).
- UI: `ui/LiveSubsOverlay.js` (playerOverlays: open, poll every 2 s = heartbeat, draw the cue), `ui/MenuItem.js`
  (More menu: On / Off), shared switch in `ui/store.js` (localStorage).
- Whisper runs natively on the host for the GPU: `whisper-server -m ggml-large-v3-turbo.bin --vad -vm ggml-silero-*.bin
  --host 127.0.0.1 --port 18765`; the container reaches it at `http://host.docker.internal:18765`. `large-v3-turbo`
  ignores Whisper's translate task, so the UI offers no "Translate to English" yet (the server still accepts
  `translate: true`, cached under its own key): needs `large-v3` or a text-translation pass.

## Prototype measurements (2026-11-25, Mac mini M4, large-v3-turbo + Silero VAD, Metal)
- Whisper: ~2.3 s per 30 s chunk with the model loaded (~13x real time); 3 viewers at once all reached 80 s+ ahead in 40 s.
- Torrent read-ahead (fresh 1080p HEVC episode, strict real-time viewer with no buffer): viewer lag 0.0 s over 3 min,
  transcription 1.5-2 min ahead after 30 s, swarm 2.3-4.2 MB/s. One healthy swarm only (586 seeders, ~10x the file's
  bitrate); a weak swarm and a ~20 Mbps file are untested. In the real web player (headless Chrome) the lines showed in
  sync with steady playback; stalls were not measured there.
- Delay before the first line after opening or seeking: about 3-10 s on its own (first audio byte 2-3 s while the
  torrent seeks); up to ~17 s for a fresh file while three streams share Whisper. A 4 s first chunk saves 1-2 s.
  Library files: 3.5 s.
- Against the release's own English subtitles over ~3 min of dialogue: 11.7% word error rate (reference subtitles
  are condensed, so this overstates errors); timing median +0.00 s, 80% within -2.0..+0.5 s.
- Known gaps: collides with a native subtitle track (both draw bottom centre; `playerOverlays` does not pass the
  selected track, so fixing it needs a new prop = core touchpoint); no translation yet; the odd fragment at chunk joins; plain
  URL streams, Android and the desktop app (mpv) untested; in-container run untested (host Whisper reachable from it).
