'use strict';
// The player talks to the streaming server through this app's public hostname, and passes that same hostname back
// to the server inside query parameters (mediaURL=, videoUrl=). The streaming server cannot fetch our public
// hostname (Cloudflare Access would answer with a login page), so those URLs are rewritten to the internal ones.
// Which hostnames count as "ours" is passed in (see hostPatterns): nothing is hardcoded.

const PARAMS = '(?:mediaURL|videoUrl)';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Hosts the browser reaches this app on, e.g. "cinema.example.com" or "192.168.1.20:3002". The caller passes the host of the
// request itself (that is what the player puts into mediaURL=) plus the optional PUBLIC_HOSTS list. Anything that is not a
// plain host[:port] is ignored, and a host only matches as a whole (cinema.example.com.evil.net is left alone).
function hostPatterns(hosts) {
    const list = [...new Set((hosts || []).map((h) => String(h || '').trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+(:\d{1,5})?$/.test(h)))];
    if (!list.length) return null;
    return {
        enc: `(?:${list.map((h) => escapeRe(h.replace(':', '%3A'))).join('|')})(?![\\w.-])`,
        plain: `(?:${list.map(escapeRe).join('|')})(?![\\w.-])`,
    };
}

function rewriteUpstreamPath(path, { self = 'homebot-cinema:8080', streaming = '127.0.0.1:11470', hosts = [] } = {}) {
    const selfEnc = encodeURIComponent(`http://${self}`);
    const streamingEnc = encodeURIComponent(`http://${streaming}`);
    const h = hostPatterns(hosts);
    let out = path;
    // our public hostnames -> this app, reachable inside Docker without Cloudflare Access
    if (h) {
        out = out
            .replace(new RegExp(`(${PARAMS})=https?%3A%2F%2F${h.enc}`, 'gi'), (_, p) => `${p}=${selfEnc}`)
            .replace(new RegExp(`(${PARAMS})=https?://${h.plain}`, 'gi'), (_, p) => `${p}=http://${self}`);
    }
    return out
        // torrent streams live on the streaming server itself: read them there, not via this proxy
        .replace(new RegExp(`(${PARAMS}=)${escapeRe(selfEnc)}%2F(?:streaming%2F)?([0-9a-fA-F]{40})`, 'gi'), (_, p, hash) => `${p}${streamingEnc}%2F${hash}`)
        .replace(new RegExp(`(${PARAMS}=)http://${escapeRe(self)}/(?:streaming/)?([0-9a-fA-F]{40})`, 'gi'), (_, p, hash) => `${p}http://${streaming}/${hash}`);
}

// The browser tells the streaming server which video codecs it can play. When HEVC is on the list the server COPIES
// HEVC video into HLS segments cut at the file's own (irregular, open-GOP) keyframes. That leaves 0.1-0.3 s holes
// in the timeline at segment boundaries and the player freezes for ~2 s on each one (measured: 2 gaps in 10 segments).
// Advertising H.264 only makes the server re-encode HEVC to H.264: clean 4 s segments, no gaps, ~5x faster than
// real time here. H.264 sources are still copied untouched.
const HEVC_PARAM = /^videoCodecs=(?:h265|hevc|hvc1|hev1|h\.265)$/i;

function forceH264ForHls(path) {
    if (!/^\/hlsv2\//.test(path)) return path;
    const i = path.indexOf('?');
    if (i < 0) return path;
    const kept = path.slice(i + 1).split('&').filter((kv) => !HEVC_PARAM.test(kv));
    if (!kept.some((kv) => /^videoCodecs=h264$/i.test(kv))) kept.push('videoCodecs=h264');
    return `${path.slice(0, i)}?${kept.join('&')}`;
}

module.exports = { rewriteUpstreamPath, forceH264ForHls, hostPatterns };
