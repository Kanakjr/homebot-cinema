// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "metalfx": Pure logic functions for stream analysis and MetalFX state.

function analyzeStream(stream) {
    if (!stream) {
        return { is1080p: false, is720p: false, isNative4K: false, canUpscale: false };
    }
    const text = [
        stream.name,
        stream.title,
        stream.description,
        stream.behaviorHints && stream.behaviorHints.bingeGroup,
        stream.tag,
    ].filter(Boolean).join(' ').toLowerCase();

    const isNative4K = /\b(4k|2160p|uhd)\b/.test(text);
    const is720p = /\b(720p)\b/.test(text);
    const is1080p = /\b(1080p|fhd)\b/.test(text) || (!isNative4K && !is720p);
    const canUpscale = !isNative4K;

    return { is1080p, is720p, isNative4K, canUpscale };
}

function formatPillTitle(active, streamAnalysis) {
    if (streamAnalysis.isNative4K) {
        return 'Stream is native 4K UHD. MetalFX upscaling is automatically bypassed.';
    }
    if (active) {
        return 'Apple MetalFX 4K AI Upscaling: ON (1080p -> 4K UHD Neural Upscale). Click to disable.';
    }
    return 'Apple MetalFX 4K AI Upscaling: OFF. Click to enable 4K AI Upscaling.';
}

module.exports = {
    analyzeStream,
    formatPillTitle,
};
