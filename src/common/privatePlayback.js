// Copyright (C) 2017-2026 HomeBot Cinema
// Private playback (the Locked folder): a stream whose URL carries `cinema_private=1`. Anything that would record or
// show what is playing elsewhere checks this and stays quiet: watch stats / Now playing (nowplaying plugin), the state
// a TV reports to remotes (remote plugin). The player itself only ever shows the stream name "Locked folder".

function hasPrivateFlag(url) {
    if (typeof url !== 'string' || !url) return false;
    try {
        return new URL(url, 'http://localhost').searchParams.get('cinema_private') === '1';
    } catch (_) {
        return /[?&]cinema_private=1(?:&|$)/.test(url);
    }
}

/** True for playback that must leave no trace: { streamUrl } or { stream: { url } } from the player props. */
function isPrivatePlayback({ stream, streamUrl } = {}) {
    return hasPrivateFlag(streamUrl) || hasPrivateFlag(stream && typeof stream === 'object' ? stream.url : null);
}

module.exports = { isPrivatePlayback, hasPrivateFlag };
