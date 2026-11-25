'use strict';
// File types of the Locked folder and a small HTTP range server for its files. Responses are never cacheable
// (`private, no-store`) and its URLs never end in a media extension, so a CDN never keeps a copy.

const fs = require('fs');
const path = require('path');

const VIDEO = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', mpg: 'video/mpeg', mpeg: 'video/mpeg', ts: 'video/mp2t', wmv: 'video/x-ms-wmv', flv: 'video/x-flv', '3gp': 'video/3gpp' };
// what a browser <video> plays by itself; the rest play in the Mac app (mpv)
const WEB_PLAYABLE = new Set(['mp4', 'm4v', 'webm']);
const IMAGE = ['jpg', 'jpeg', 'png', 'webp'];
const MIN_BYTES = 50 * 1024; // smaller "videos" are broken downloads or placeholders

const extOf = (name) => path.extname(String(name || '')).slice(1).toLowerCase();
const isVideo = (name) => Object.prototype.hasOwnProperty.call(VIDEO, extOf(name));
const webPlayable = (name) => WEB_PLAYABLE.has(extOf(name));
const under = (p, root) => p === root || p.startsWith(root + path.sep);

/** The real path of rel inside root, or null when it is missing or escapes root (symlinks, ".."). */
function resolveInside(root, rel) {
    try {
        const realRoot = fs.realpathSync(root);
        const real = fs.realpathSync(path.join(root, rel));
        return under(real, realRoot) ? real : null;
    } catch (_) {
        return null;
    }
}

/** Same-name images next to a video (cover art some downloaders save), best first. */
function sidecarImage(file) {
    const base = file.slice(0, file.length - path.extname(file).length);
    for (const ext of IMAGE) {
        for (const e of [ext, ext.toUpperCase()]) {
            const p = `${base}.${e}`;
            if (fs.existsSync(p)) return p;
        }
    }
    return null;
}

/** Streams a file with HTTP Range support. */
function sendFile(req, res, file, contentType) {
    let st;
    try {
        st = fs.statSync(file);
    } catch (_) {
        return res.status(404).json({ error: 'not_found' });
    }
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Type', contentType || 'application/octet-stream');
    res.set('Accept-Ranges', 'bytes');
    res.set('X-Content-Type-Options', 'nosniff');
    const size = st.size;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
    if (!m || (m[1] === '' && m[2] === '')) {
        res.set('Content-Length', String(size));
        if (req.method === 'HEAD') return res.status(200).end();
        res.status(200);
        return pipe(fs.createReadStream(file), res);
    }
    let start;
    let end;
    if (m[1] === '') { // suffix range: the last N bytes
        start = Math.max(0, size - Number(m[2]));
        end = size - 1;
    } else {
        start = Number(m[1]);
        end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (!(start <= end) || start >= size) {
        res.set('Content-Range', `bytes */${size}`);
        return res.status(416).end();
    }
    res.status(206);
    res.set('Content-Range', `bytes ${start}-${end}/${size}`);
    res.set('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') return res.end();
    return pipe(fs.createReadStream(file, { start, end }), res);
}

function pipe(stream, res) {
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
}

module.exports = { VIDEO, IMAGE, MIN_BYTES, extOf, isVideo, webPlayable, resolveInside, sidecarImage, sendFile, under };
