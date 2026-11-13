'use strict';
// Quality profiles (Sonarr/Radarr style): what a release must satisfy, and how candidates are ranked.
// A profile is plain JSON; evaluate() explains every rejection so the UI can show why.

const { parseStreamInfo } = require('./stream_info');

const RESOLUTIONS = ['4K', '1080p', '720p', '480p'];
const HDR_MODES = ['any', 'prefer', 'require', 'avoid'];
const CODEC_MODES = ['any', 'prefer-hevc', 'prefer-h264', 'avoid-hevc'];
const SIZE_BIAS = ['none', 'larger', 'smaller'];
const SOURCE_RANK = { Remux: 40, BluRay: 30, 'WEB-DL': 25, WEBRip: 15, HDTV: 5, DVD: 0 };
// release groups / tags that are never what anyone wants
const ALWAYS_BANNED = ['hdcam', 'camrip', 'telesync', 'hdts', 'hdtc', '3d', 'sbs', 'hsbs'];

const bad = (message) => Object.assign(new Error(message), { status: 400 });

function num(v, name, { min = 0, max = 100000, allowNull = true } = {}) {
    if (v === null || v === undefined || v === '') {
        if (allowNull) return null;
        throw bad(`${name} is required`);
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} must be between ${min} and ${max}`);
    return n;
}

function words(v, name) {
    if (v === undefined || v === null) return [];
    const arr = Array.isArray(v) ? v : String(v).split(/[,\n]/);
    const out = [...new Set(arr.map((w) => String(w).trim().toLowerCase()).filter(Boolean))];
    if (out.length > 30) throw bad(`${name}: at most 30 keywords`);
    if (out.some((w) => w.length > 40)) throw bad(`${name}: keywords are limited to 40 characters`);
    return out;
}

function sizeRange(v, name) {
    const r = v || {};
    const minGB = num(r.minGB, `${name} min size`, { max: 1000 });
    const maxGB = num(r.maxGB, `${name} max size`, { max: 1000 });
    if (minGB !== null && maxGB !== null && minGB > maxGB) throw bad(`${name}: min size is larger than max size`);
    return { minGB, maxGB };
}

/** Validates and normalises a profile body. Throws a 400 error with a readable message. */
function normalizeProfile(input) {
    const b = input || {};
    const name = String(b.name || '').trim();
    if (!name || name.length > 40) throw bad('Name is required (max 40 characters)');
    const qualities = [...new Set(Array.isArray(b.qualities) ? b.qualities : [])];
    if (!qualities.length || qualities.some((q) => !RESOLUTIONS.includes(q))) throw bad(`Pick at least one quality of: ${RESOLUTIONS.join(', ')}`);
    const hdr = b.hdr || 'any';
    const codec = b.codec || 'any';
    const sizeBias = b.sizeBias || 'none';
    if (!HDR_MODES.includes(hdr)) throw bad('Invalid HDR mode');
    if (!CODEC_MODES.includes(codec)) throw bad('Invalid codec preference');
    if (!SIZE_BIAS.includes(sizeBias)) throw bad('Invalid size preference');
    return {
        name,
        description: String(b.description || '').slice(0, 200),
        qualities,
        // size limits are per quality, like Sonarr/Radarr quality definitions (a 4K minimum must not apply to a 1080p fallback)
        sizes: Object.fromEntries(qualities.map((q) => {
            const per = (b.sizes || {})[q] || {};
            return [q, { movie: sizeRange(per.movie, `${q} movie`), episode: sizeRange(per.episode, `${q} episode`) }];
        })),
        minSeeders: num(b.minSeeders, 'Minimum seeders', { max: 100000, allowNull: false }),
        requiredKeywords: words(b.requiredKeywords, 'Required keywords'),
        bannedKeywords: words(b.bannedKeywords, 'Banned keywords'),
        preferredKeywords: words(b.preferredKeywords, 'Preferred keywords'),
        hdr, codec, sizeBias,
    };
}

const kindOf = (type) => (type === 'movie' ? 'movie' : 'episode');

/** Does this release satisfy the profile, and how good is it? */
function evaluate(profile, info, kind = 'movie') {
    const reasons = [];
    const reject = (r) => reasons.push(r);

    if (info.isCamTagged || (info.isCam && !info.resolution)) reject('CAM / telesync release');
    if (!info.resolution) reject('resolution not stated');
    else if (!profile.qualities.includes(info.resolution)) reject(`${info.resolution} is not allowed by this profile`);

    const range = ((profile.sizes || {})[info.resolution] || {})[kind] || {};
    if (info.sizeGB !== null) {
        if (range.maxGB !== null && range.maxGB !== undefined && info.sizeGB > range.maxGB) reject(`${info.sizeGB} GB is over the ${range.maxGB} GB limit`);
        if (range.minGB !== null && range.minGB !== undefined && info.sizeGB < range.minGB) reject(`${info.sizeGB} GB is under the ${range.minGB} GB minimum`);
    }
    if (info.seeders !== null && info.seeders < profile.minSeeders) reject(`only ${info.seeders} seeders (needs ${profile.minSeeders})`);

    const banned = [...ALWAYS_BANNED, ...profile.bannedKeywords].find((w) => info.text.includes(w));
    if (banned) reject(`contains “${banned}”`);
    if (profile.requiredKeywords.length && !profile.requiredKeywords.some((w) => info.text.includes(w))) {
        reject(`none of the required keywords (${profile.requiredKeywords.join(', ')})`);
    }
    if (profile.hdr === 'require' && !info.hdr) reject('HDR required');
    if (profile.hdr === 'avoid' && info.hdr) reject(`${info.hdr} is excluded by this profile`);

    if (reasons.length) return { accepted: false, score: 0, reasons };

    // ---- ranking among acceptable releases ----
    let score = (profile.qualities.length - profile.qualities.indexOf(info.resolution)) * 1000;
    const notes = [];
    const hits = profile.preferredKeywords.filter((w) => info.text.includes(w));
    if (hits.length) { score += hits.length * 60; notes.push(`preferred: ${hits.join(', ')}`); }
    if (profile.hdr === 'prefer' && info.hdr) { score += 120; notes.push(info.hdr); }
    if (profile.codec === 'prefer-hevc') score += info.codec === 'HEVC' ? 80 : 0;
    else if (profile.codec === 'prefer-h264') score += info.codec === 'H.264' ? 80 : 0;
    else if (profile.codec === 'avoid-hevc' && info.codec === 'HEVC') { score -= 300; notes.push('HEVC (penalised)'); }
    score += SOURCE_RANK[info.source] || 0;
    if (info.seeders !== null) score += Math.min(info.seeders, 300) / 3;
    if (info.sizeGB !== null && profile.sizeBias !== 'none') {
        const top = range.maxGB || 50;
        const f = Math.min(1, info.sizeGB / top);
        score += profile.sizeBias === 'larger' ? f * 60 : (1 - f) * 60;
    }
    return { accepted: true, score: Math.round(score * 10) / 10, reasons: notes };
}

/** Picks the best acceptable stream. `streams` are raw addon streams. */
function pickBest(profile, streams, type) {
    const kind = kindOf(type);
    const results = (streams || []).map((stream, index) => {
        const info = parseStreamInfo(stream);
        return { index, stream, info, ...evaluate(profile, info, kind) };
    });
    const accepted = results.filter((r) => r.accepted).sort((a, b) => b.score - a.score);
    const rejectedSummary = {};
    for (const r of results) {
        if (r.accepted) continue;
        for (const reason of r.reasons) {
            const key = reason.replace(/[\d.]+ ?(GB|seeders)/g, '#$1').replace(/\d+/g, '#');
            rejectedSummary[key] = (rejectedSummary[key] || 0) + 1;
        }
    }
    return { picked: accepted[0] || null, results, acceptedCount: accepted.length, rejectedSummary };
}

// ---- built-in profiles ----
const KW_BANNED = ['hindi dub', 'dubbed', 'korsub', 'hardcoded', 'hc ', 'rus'];
const BUILTIN = [
    {
        key: '4k-ultra',
        config: {
            name: '4K Ultra HD',
            description: 'Best picture and sound. 4K only, HDR / Dolby Vision and remuxes preferred, large files welcome.',
            qualities: ['4K'],
            sizes: { '4K': { movie: { minGB: 8, maxGB: 80 }, episode: { minGB: 1.5, maxGB: 25 } } },
            minSeeders: 10, hdr: 'prefer', codec: 'any', sizeBias: 'larger',
            preferredKeywords: ['remux', 'atmos', 'truehd', 'dv', 'hdr10+'], bannedKeywords: KW_BANNED, requiredKeywords: [],
        },
    },
    {
        key: '4k-efficient',
        config: {
            name: '4K Efficient',
            description: '4K when a sensible HEVC encode exists (under 18 GB per movie), otherwise falls back to 1080p.',
            qualities: ['4K', '1080p'],
            sizes: { '4K': { movie: { minGB: 3, maxGB: 18 }, episode: { minGB: 0.6, maxGB: 6 } }, '1080p': { movie: { minGB: 0.8, maxGB: 8 }, episode: { minGB: 0.2, maxGB: 2.5 } } },
            minSeeders: 10, hdr: 'prefer', codec: 'prefer-hevc', sizeBias: 'smaller',
            preferredKeywords: ['hevc', 'x265', 'web-dl'], bannedKeywords: KW_BANNED, requiredKeywords: [],
        },
    },
    {
        key: 'hd-balanced',
        config: {
            name: 'HD Balanced (1080p + 720p)',
            description: 'The everyday default: 1080p first, 720p if that is all there is. Sensible sizes, healthy seeders.',
            qualities: ['1080p', '720p'],
            sizes: { '1080p': { movie: { minGB: 0.8, maxGB: 12 }, episode: { minGB: 0.2, maxGB: 3 } }, '720p': { movie: { minGB: 0.4, maxGB: 5 }, episode: { minGB: 0.1, maxGB: 1.5 } } },
            minSeeders: 5, hdr: 'any', codec: 'any', sizeBias: 'none',
            preferredKeywords: ['web-dl', 'bluray', 'x265'], bannedKeywords: KW_BANNED, requiredKeywords: [],
        },
    },
    {
        key: 'direct-play',
        config: {
            name: 'Direct Play (browser-safe)',
            description: 'Files a browser plays directly, with no HLS rewrite on the server: H.264 + AAC. No HEVC, HDR, 10-bit, or audio Chrome cannot decode (EAC3 / DD+, Atmos, DTS, TrueHD).',
            qualities: ['1080p', '720p'],
            sizes: { '1080p': { movie: { minGB: 0.8, maxGB: 10 }, episode: { minGB: 0.2, maxGB: 3 } }, '720p': { movie: { minGB: 0.4, maxGB: 4 }, episode: { minGB: 0.1, maxGB: 1.5 } } },
            minSeeders: 5, hdr: 'avoid', codec: 'prefer-h264', sizeBias: 'none',
            preferredKeywords: ['x264', 'aac', 'web-dl'], bannedKeywords: [...KW_BANNED, 'dts', 'truehd', 'eac3', 'e-ac3', 'ddp', 'dd+', 'atmos', '10bit', '10-bit', 'hi10', 'hevc', 'x265'], requiredKeywords: [],
        },
    },
    {
        key: 'space-saver',
        config: {
            name: 'Space Saver',
            description: 'Small files for a full disk: 720p first, compact HEVC encodes (YTS, PSA, …) preferred.',
            qualities: ['720p', '1080p'],
            sizes: { '720p': { movie: { minGB: 0.3, maxGB: 2.5 }, episode: { minGB: 0.08, maxGB: 0.9 } }, '1080p': { movie: { minGB: 0.5, maxGB: 3.5 }, episode: { minGB: 0.15, maxGB: 1.2 } } },
            minSeeders: 3, hdr: 'avoid', codec: 'prefer-hevc', sizeBias: 'smaller',
            preferredKeywords: ['x265', 'hevc', 'yts', 'psa', 'pahe'], bannedKeywords: KW_BANNED, requiredKeywords: [],
        },
    },
];
const DEFAULT_KEY = 'hd-balanced';

module.exports = { RESOLUTIONS, HDR_MODES, CODEC_MODES, SIZE_BIAS, BUILTIN, DEFAULT_KEY, normalizeProfile, evaluate, pickBest, kindOf };
