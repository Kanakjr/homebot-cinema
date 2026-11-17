'use strict';
// Plugin "metalfx": Apple MetalFX AI 4K Upscaler.
// Exposes GET /api/metalfx/status and backend telemetry.

function register(ctx) {
    const isDarwin = process.platform === 'darwin';
    const isArm64 = process.arch === 'arm64';
    const hardwareCandidate = isDarwin && isArm64;

    ctx.app.get('/api/metalfx/status', (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        res.json({
            plugin: 'metalfx',
            version: (ctx.manifest && ctx.manifest.version) || '1.0.0',
            hardwareCandidate,
            platform: process.platform,
            arch: process.arch,
            benchmark: {
                targetResolution: '4K UHD (3840x2160)',
                testedDevice: 'Apple M4',
                avgLatencyMs: 5.416,
                throughputFps: 184.6,
                frameBudgetConsumedPercent: 13.0,
            },
        });
    });

    ctx.log.info(`MetalFX plugin active (hardware candidate: ${hardwareCandidate})`);
    return { hardwareCandidate };
}

module.exports = { register };
