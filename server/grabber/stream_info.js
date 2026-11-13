'use strict';
// Turns an addon stream (the common torrent-addon format: name + title lines) into the facts a quality profile decides on. Pure, no I/O.

const RES = [
    ['4K', /\b(2160p|4k|uhd)\b/i],
    ['1080p', /\b(1080p|1080i)\b/i],
    ['720p', /\b720p\b/i],
    ['480p', /\b(480p|576p)\b/i],
];
const SOURCES = [
    ['Remux', /\bremux\b/i],
    ['BluRay', /\b(blu[ -]?ray|bdrip|brrip|bd25|bd50)\b/i],
    ['WEB-DL', /\b(web[ -]?dl|webdl|amzn|nf|atvp|dsnp|hmax|web)\b/i],
    ['WEBRip', /\bweb[ -]?rip\b/i],
    ['HDTV', /\bhdtv\b/i],
    ['DVD', /\b(dvdrip|dvd)\b/i],
];
const CAM_RE = /\b(cam|camrip|hdcam|telesync|hdts|ts|telecine|tc|hdtc)\b/i;

function sizeFrom(stream, text) {
    const bytes = stream.behaviorHints && Number(stream.behaviorHints.videoSize);
    if (bytes > 0) return Math.round((bytes / 1e9) * 100) / 100;
    const m = /(\d+(?:[.,]\d+)?)\s*(GB|GiB|MB|MiB)\b/i.exec(text);
    if (!m) return null;
    const v = parseFloat(m[1].replace(',', '.'));
    return /^m/i.test(m[2]) ? Math.round((v / 1024) * 100) / 100 : v;
}

function parseStreamInfo(stream) {
    const s = stream || {};
    const text = [s.name, s.title, s.description].filter(Boolean).join('\n');

    let resolution = null;
    for (const [label, re] of RES) { if (re.test(text)) { resolution = label; break; } }

    let source = null;
    for (const [label, re] of SOURCES) { if (re.test(text)) { source = label; break; } }

    let hdr = null;
    if (/\b(dv|dovi|dolby[ .]?vision)\b/i.test(text)) hdr = 'DV';
    else if (/\bhdr10(\+|plus)\b/i.test(text)) hdr = 'HDR10+';
    else if (/\b(hdr10|hdr)\b/i.test(text)) hdr = 'HDR';

    let codec = null;
    if (/\b(hevc|x265|h[ .]?265)\b/i.test(text)) codec = 'HEVC';
    else if (/\bav1\b/i.test(text)) codec = 'AV1';
    else if (/\b(x264|h[ .]?264|avc)\b/i.test(text)) codec = 'H.264';

    const audio = [];
    if (/\batmos\b/i.test(text)) audio.push('Atmos');
    if (/\btrue[ -]?hd\b/i.test(text)) audio.push('TrueHD');
    if (/\bdts(-?hd)?\b/i.test(text)) audio.push('DTS');
    if (/\b(ddp|dd\+|e-?ac-?3)/i.test(text)) audio.push('DD+');
    if (/\b(ac-?3|dd ?5[. ]?1)\b/i.test(text)) audio.push('AC3');
    if (/\baac\b/i.test(text)) audio.push('AAC');

    let seeders = typeof s.seeders === 'number' ? s.seeders : null;
    if (seeders === null) {
        const m = /(?:👤|👥|🌱|seeders?:?|seeds?:?)\s*(\d+)/i.exec(text);
        if (m) seeders = parseInt(m[1], 10);
    }

    return {
        resolution, source, hdr, codec, audio,
        sizeGB: sizeFrom(s, text),
        seeders,
        isCam: CAM_RE.test(text) && !resolution,
        isCamTagged: /\b(camrip|hdcam|telesync|hdts|hdtc)\b/i.test(text),
        text: text.toLowerCase(),
        label: (s.title || s.description || s.name || '').split('\n')[0],
    };
}

module.exports = { parseStreamInfo };
