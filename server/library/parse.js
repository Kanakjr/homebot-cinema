'use strict';
// Release-name parsing for the server library. Pure functions, no I/O.
//   parseName('Silo (2023) - S01E03 - Machines (1080p ATVP WEB-DL x265 t3nzin).mp4')
//     -> { title: 'Silo', year: 2023, season: 1, episode: 3, resolution: '1080p', source: 'WEB-DL', codec: 'x265' }

const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|mov|webm|ts)$/i;
const isVideoFile = (name) => VIDEO_EXT.test(name);

const RES_RE = /\b(2160p|4k|uhd|1080p|1080i|720p|576p|480p)\b/i;
const SRC_RE = /\b(web[ -]?dl|webrip|web|blu[ -]?ray|bdrip|brrip|hdrip|dvdrip|hdtv|hdcam|camrip|cam|telesync|hdts|ts|remux|amzn|nf|atvp|dsnp|hmax)\b/i;
const CODEC_RE = /\b(x265|hevc|h[ .]?265|x264|h[ .]?264|avc|av1|xvid)\b/i;
const EP_RES = [
    /\bS(\d{1,2})[ ._-]?EP?(\d{1,3})\b/i,
    /\b(\d{1,2})x(\d{2,3})\b/i,
    /\bSeason[ ._-]?(\d{1,2})[ ._-]*(?:Episode|Ep)[ ._-]?(\d{1,3})\b/i,
];
const SEASON_RES = [/\bSeason[ ._-]?(\d{1,2})\b/i, /\bS(\d{1,2})\b(?!E)/i];
const YEAR_RE = /(?:^|[\s([.\-_])((?:19|20)\d{2})(?=$|[\s)\].\-_])/g;

function normalizeSeparators(s) {
    // A dot between two non-space characters is a separator ("Silo.S03E01", "Star.Wars The ..."),
    // a dot followed by a space belongs to the title ("Dr. STONE").
    return s.replace(/_/g, ' ').replace(/(?<=\S)\.(?=\S)/g, ' ').replace(/\s+/g, ' ').trim();
}

const cleanTitle = (t) => t.replace(/[\s\-–—_.([{+]+$/g, '').replace(/^[\s\-–—_.)\]}]+/, '').trim();

function normTitle(t) {
    return String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseName(raw) {
    let s = String(raw || '').replace(VIDEO_EXT, '');
    s = s.replace(/\[[^\]]*\]\s*$/g, ' '); // trailing [EZTVx.to] / [MW] groups
    s = normalizeSeparators(s);

    let ep = null;
    for (const re of EP_RES) {
        const m = re.exec(s);
        if (m && (!ep || m.index < ep.index)) ep = { index: m.index, season: Number(m[1]), episode: Number(m[2]) };
    }
    let season = ep ? ep.season : null;
    let seasonIdx = ep ? ep.index : -1;
    if (!ep) {
        for (const re of SEASON_RES) {
            const m = re.exec(s);
            if (m && (seasonIdx < 0 || m.index < seasonIdx)) { season = Number(m[1]); seasonIdx = m.index; }
        }
    }

    let year = null;
    let yearIdx = -1;
    YEAR_RE.lastIndex = 0;
    for (let m = YEAR_RE.exec(s); m; m = YEAR_RE.exec(s)) {
        const at = m.index + m[0].indexOf(m[1]);
        if (at > 0) { year = Number(m[1]); yearIdx = m.index; break; }
    }

    const res = RES_RE.exec(s);
    const src = SRC_RE.exec(s);
    const codec = CODEC_RE.exec(s);

    // The title ends at the first release marker.
    const cuts = [yearIdx, seasonIdx, res && res.index, src && src.index, codec && codec.index].filter((i) => typeof i === 'number' && i > 0);
    const end = cuts.length ? Math.min(...cuts) : s.length;
    const title = cleanTitle(s.slice(0, end));

    const canon = (v) => (v ? v.toUpperCase().replace(/[ ]/g, '-') : null);
    const resolution = res ? (/^(4k|uhd)$/i.test(res[1]) ? '2160p' : res[1].toLowerCase()) : null;
    return {
        title: title || null,
        year,
        season,
        episode: ep ? ep.episode : null,
        resolution,
        source: src ? canon(src[1]) : null,
        codec: codec ? codec[1].toLowerCase().replace(/[ .]/g, '').replace('h265', 'hevc').replace('h264', 'x264') : null,
    };
}

// Combine the parse of the file name with the parse of the folder(s) above it.
// Folder names usually carry the clean show/movie title; file names carry season/episode.
function parseMediaPath(relPath, type) {
    const parts = relPath.split('/').filter(Boolean);
    const file = parts[parts.length - 1];
    const dirs = parts.slice(0, -1);
    const f = parseName(file);
    const top = dirs.length ? parseName(dirs[0]) : null;

    let title = null;
    let year = f.year;
    if (type === 'series') {
        title = (top && top.title) || f.title;
        year = (top && top.year) || f.year;
    } else {
        // Movie: a folder named "Title (Year)" wins over a messy file name inside it.
        title = (top && top.title && (top.year || !f.title)) ? top.title : (f.title || (top && top.title));
        year = f.year || (top && top.year) || null;
    }

    // season/episode: file name first, then any parent folder ("Season 3", "S03")
    let { season, episode } = f;
    if (season == null) {
        for (const d of dirs) {
            const p = parseName(d);
            if (p.season != null) { season = p.season; break; }
        }
    }
    return {
        title,
        year,
        season,
        episode,
        resolution: f.resolution || (top && top.resolution) || null,
        source: f.source || (top && top.source) || null,
        codec: f.codec || (top && top.codec) || null,
    };
}

module.exports = { parseName, parseMediaPath, normTitle, isVideoFile, VIDEO_EXT };
