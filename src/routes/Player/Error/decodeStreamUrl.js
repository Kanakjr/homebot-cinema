// Copyright (C) 2017-2026 HomeBot Cinema
// Decode `#/player/<encoded>` hashes (plain base64 JSON and zlib/deflate base64 payloads like `eAEB...`).

function extractEncodedStream(hash) {
    if (typeof hash !== 'string') return null;
    const match = hash.match(/#\/player\/([^/?#]+)/);
    if (!match || !match[1]) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch (_) {
        return match[1];
    }
}

function decodeBase64Bytes(b64) {
    const normalized = String(b64).replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
    const raw = normalized + pad;
    if (typeof atob === 'function') {
        const bin = atob(raw);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }
    return Uint8Array.from(Buffer.from(raw, 'base64'));
}

function parseStreamUrlFromText(text) {
    try {
        const decoded = JSON.parse(text);
        return decoded && typeof decoded.url === 'string' && decoded.url ? decoded.url : null;
    } catch (_) {
        return null;
    }
}

async function decompressBytes(bytes, format) {
    if (typeof DecompressionStream !== 'function' || typeof Response !== 'function') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Response(stream).text();
}

function decodeStreamUrlSync(hash) {
    const encoded = extractEncodedStream(hash);
    if (!encoded) return null;
    try {
        const bytes = decodeBase64Bytes(encoded);
        const text = typeof TextDecoder === 'function'
            ? new TextDecoder().decode(bytes)
            : Buffer.from(bytes).toString('utf8');
        return parseStreamUrlFromText(text);
    } catch (_) {
        return null;
    }
}

async function decodeStreamUrl(hash) {
    const encoded = extractEncodedStream(hash);
    if (!encoded) return null;
    let bytes;
    try {
        bytes = decodeBase64Bytes(encoded);
    } catch (_) {
        return null;
    }
    const text = typeof TextDecoder === 'function'
        ? new TextDecoder().decode(bytes)
        : Buffer.from(bytes).toString('utf8');
    const direct = parseStreamUrlFromText(text);
    if (direct) return direct;

    for (const format of ['deflate', 'deflate-raw']) {
        try {
            const inflated = await decompressBytes(bytes, format);
            if (inflated) {
                const url = parseStreamUrlFromText(inflated);
                if (url) return url;
            }
        } catch (_) {
            // Try next format or give up gracefully
        }
    }
    return null;
}

module.exports = {
    extractEncodedStream,
    decodeBase64Bytes,
    decodeStreamUrlSync,
    decodeStreamUrl,
};
