// Copyright (C) 2017-2026 HomeBot Cinema
// hls.js settings for transcoded (HLS) playback. Replaces @stremio/stremio-video's HTMLVideo/hlsConfig at build time
// (see webpack.config.js). Upstream keeps ~50 s ahead (80 s max) and hls.js caps the buffer at 60 MB, so a hiccup in
// the server's live transcode or a slow swarm stalls playback quickly. We keep about two minutes ahead instead.
//
// How hls.js uses these: the target length is max(8 * maxBufferSize / bitrate, maxBufferLength), never above
// maxMaxBufferLength. Chrome limits one video SourceBuffer to roughly 150 MB, so maxBufferSize stays under that.
//   about 8 Mbps  -> ~120 s ahead (~120 MB)       about 4 Mbps -> ~240 s       about 12 Mbps -> 90 s (~135 MB)

const upstream = require('@stremio/stremio-video/src/HTMLVideo/hlsConfig');

module.exports = {
    ...upstream,
    maxBufferLength: 90,
    maxMaxBufferLength: 240,
    maxBufferSize: 120 * 1000 * 1000,
    backBufferLength: 30
};
