// Copyright (C) 2017-2026 HomeBot Cinema
// Robust stream parser for smart filtering & badge metadata

function parseStream(stream) {
    if (!stream) return null;

    const name = String(stream.name || stream.addonName || '');
    const desc = String(stream.description || '');
    const title = String(stream.title || '');
    const combined = `${name}\n${desc}\n${title}`;

    // 1. Resolution
    let resolution = null;
    if (/\b(4k|2160p|uhd)\b/i.test(combined)) {
        resolution = '4K';
    } else if (/\b(1080p|fhd)\b/i.test(combined)) {
        resolution = '1080p';
    } else if (/\b(720p|hd)\b/i.test(combined)) {
        resolution = '720p';
    } else if (/\b(480p|sd)\b/i.test(combined)) {
        resolution = '480p';
    } else if (/\b(cam|hdcam|telesync|ts|tc|telecine|camrip)\b/i.test(combined)) {
        resolution = 'CAM';
    }

    // 2. CAM rip detection
    const isCam = resolution === 'CAM' || /\b(cam|hdcam|telesync|ts|telecine|tc|camrip)\b/i.test(combined);

    // 3. Quality source
    let quality = null;
    if (/\bremux\b/i.test(combined)) {
        quality = 'Remux';
    } else if (/\b(bluray|bdrip|brrip)\b/i.test(combined)) {
        quality = 'BluRay';
    } else if (/\bweb-?dl\b/i.test(combined)) {
        quality = 'WEB-DL';
    } else if (/\bweb-?rip\b/i.test(combined)) {
        quality = 'WEBRip';
    } else if (/\bhdtv\b/i.test(combined)) {
        quality = 'HDTV';
    } else if (isCam) {
        quality = 'CAM';
    }

    // 4. HDR / Dolby Vision
    let hdr = null;
    if (/\b(dv|dovi|dolby\s*vision)\b/i.test(combined)) {
        hdr = 'DV';
    } else if (/\bhdr10\+/i.test(combined)) {
        hdr = 'HDR10+';
    } else if (/\bhdr\b/i.test(combined)) {
        hdr = 'HDR';
    }

    // 4b. Video codec
    let codec = null;
    if (/\b(hevc|x265|h[ .]?265)\b/i.test(combined)) {
        codec = 'HEVC';
    } else if (/\bav1\b/i.test(combined)) {
        codec = 'AV1';
    } else if (/\b(x264|h[ .]?264|avc)\b/i.test(combined)) {
        codec = 'H.264';
    }

    // 5. Audio format
    let audio = null;
    if (/\batmos\b/i.test(combined)) {
        audio = 'Atmos';
    } else if (/\btruehd\b/i.test(combined)) {
        audio = 'TrueHD';
    } else if (/\bdts(-hd)?\b/i.test(combined)) {
        audio = 'DTS';
    } else if (/\b7\.1\b/i.test(combined)) {
        audio = '7.1';
    } else if (/\b5\.1\b/i.test(combined)) {
        audio = '5.1';
    }

    // 6. Size in GB
    let sizeGB = null;
    let sizeLabel = null;
    const sizeMatch = combined.match(/(?:💾\s*|size:\s*|\[)?(\d+(?:\.\d+)?)\s*(GB|GiB|MB|MiB)/i);
    if (sizeMatch) {
        const val = parseFloat(sizeMatch[1]);
        const unit = sizeMatch[2].toUpperCase();
        if (unit.startsWith('M')) {
            sizeGB = Math.round((val / 1024) * 100) / 100;
            sizeLabel = `${Math.round(val)} MB`;
        } else {
            sizeGB = val;
            sizeLabel = `${val} GB`;
        }
    }

    // 7. Seeders and Leechers
    let seeders = null;
    let leechers = null;

    if (typeof stream.seeders === 'number') {
        seeders = stream.seeders;
    }
    if (typeof stream.peers === 'number') {
        leechers = stream.peers;
    }

    if (seeders === null) {
        // Pattern: 👤 251 / 14 or 👤 251 / ⬇️ 14 or S: 120 L: 14 or 120 seeds / 14 leechers
        const seedLeechMatch = combined.match(/(?:👤|👥|🌱|seeds?:?|\bS:?)\s*(\d+)\s*(?:\/|\s*\|\s*|\s*,\s*|\s*⬇️\s*|\s+L:?|\s+leech(?:ers)?:?|\s+peers?:?)\s*(\d+)/i);
        if (seedLeechMatch) {
            seeders = parseInt(seedLeechMatch[1], 10);
            leechers = parseInt(seedLeechMatch[2], 10);
        } else {
            const seedMatch = combined.match(/(?:👤|👥|🌱|seeds?:\s*|\bS:\s*)\s*(\d+)/i);
            if (seedMatch) {
                seeders = parseInt(seedMatch[1], 10);
            }
            const leechMatch = combined.match(/(?:leech(?:ers)?:?\s*|\bL:\s*|⬇️\s*)(\d+)/i);
            if (leechMatch) {
                leechers = parseInt(leechMatch[1], 10);
            }
        }
    }

    return {
        resolution,
        quality,
        hdr,
        codec,
        audio,
        sizeGB,
        sizeLabel,
        seeders,
        leechers,
        isCam,
        rawTitle: title || desc,
        rawName: name,
    };
}

module.exports = { parseStream };
