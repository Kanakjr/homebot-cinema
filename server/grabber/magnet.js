'use strict';
// Builds a magnet link from an addon stream, whatever shape the addon / stremio-core gave us.

const TRACKERS = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://exodus.desync.com:6969/announce',
];
const HASH_RE = /^[a-f0-9]{40}$/i;

function buildMagnet(stream, displayName = '') {
    const s = stream || {};
    for (const candidate of [s.magnet, s.url]) {
        if (typeof candidate === 'string' && candidate.startsWith('magnet:?xt=urn:btih:')) return candidate;
    }
    if (typeof s.infoHash !== 'string' || !HASH_RE.test(s.infoHash)) return null;
    const trackers = new Set(TRACKERS);
    for (const src of Array.isArray(s.sources) ? s.sources : []) {
        if (typeof src === 'string' && src.startsWith('tracker:')) trackers.add(src.slice(8));
    }
    for (const a of Array.isArray(s.announce) ? s.announce : []) {
        if (typeof a === 'string') trackers.add(a.replace(/^tracker:/, ''));
    }
    const tr = [...trackers].slice(0, 12).map((t) => `&tr=${encodeURIComponent(t)}`).join('');
    return `magnet:?xt=urn:btih:${s.infoHash.toLowerCase()}${displayName ? `&dn=${encodeURIComponent(displayName)}` : ''}${tr}`;
}

module.exports = { buildMagnet };
