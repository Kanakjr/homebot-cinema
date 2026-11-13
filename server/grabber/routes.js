'use strict';
// Grabber API: quality profiles + "grab the best release for this profile".
// Reading profiles and grabbing is open to every login; changing profiles is admin-only.

const { evaluate, pickBest, kindOf, RESOLUTIONS } = require('./quality');
const { parseStreamInfo } = require('./stream_info');
const { chooseRelease, queueRelease } = require('./grab');

const MAX_STREAMS = 800;
// only the fields that matter; never forward arbitrary client objects further than the parser
const cleanStream = (s) => ({
    name: String((s && s.name) || '').slice(0, 300),
    title: String((s && (s.title || s.description)) || '').slice(0, 1200),
    description: String((s && s.description) || '').slice(0, 1200),
    infoHash: s && typeof s.infoHash === 'string' ? s.infoHash : undefined,
    fileIdx: s && Number.isInteger(s.fileIdx) ? s.fileIdx : undefined,
    url: s && typeof s.url === 'string' && s.url.startsWith('magnet:') ? s.url : undefined,
    magnet: s && typeof s.magnet === 'string' && s.magnet.startsWith('magnet:') ? s.magnet : undefined,
    sources: Array.isArray(s && s.sources) ? s.sources.filter((x) => typeof x === 'string').slice(0, 20) : undefined,
    announce: Array.isArray(s && s.announce) ? s.announce.filter((x) => typeof x === 'string').slice(0, 20) : undefined,
    seeders: s && typeof s.seeders === 'number' ? s.seeders : undefined,
    behaviorHints: s && s.behaviorHints && typeof s.behaviorHints === 'object' ? { videoSize: Number(s.behaviorHints.videoSize) || undefined } : undefined,
});

function registerGrabberRoutes(app, { store, requireAdmin, downloadsManager, db, probeMany }) {
    const fail = (res, e) => {
        const status = e.status || 500;
        if (status >= 500) console.error('[Grabber]', e);
        res.status(status).json({ error: e.message || 'error' });
    };
    const streamsOf = (body) => {
        const arr = body && body.streams;
        if (!Array.isArray(arr)) throw Object.assign(new Error('streams must be an array'), { status: 400 });
        if (arr.length > MAX_STREAMS) throw Object.assign(new Error(`at most ${MAX_STREAMS} streams`), { status: 400 });
        return arr.map(cleanStream);
    };

    app.get('/api/grabber/profiles', (_req, res) => res.json({ profiles: store.list(), resolutions: RESOLUTIONS }));

    app.post('/api/grabber/profiles', requireAdmin, (req, res) => {
        try {
            const p = store.create(req.body);
            db.audit(req.login.email, null, 'quality.create', { id: p.id, name: p.name });
            res.status(201).json(p);
        } catch (e) { fail(res, e); }
    });
    app.put('/api/grabber/profiles/:id(\\d+)', requireAdmin, (req, res) => {
        try {
            const p = store.update(req.params.id, req.body);
            db.audit(req.login.email, null, 'quality.update', { id: p.id, name: p.name });
            res.json(p);
        } catch (e) { fail(res, e); }
    });
    app.delete('/api/grabber/profiles/:id(\\d+)', requireAdmin, (req, res) => {
        try {
            store.remove(req.params.id);
            db.audit(req.login.email, null, 'quality.delete', { id: Number(req.params.id) });
            res.json({ success: true });
        } catch (e) { fail(res, e); }
    });
    app.post('/api/grabber/profiles/:id(\\d+)/reset', requireAdmin, (req, res) => {
        try { res.json(store.reset(req.params.id)); } catch (e) { fail(res, e); }
    });
    app.put('/api/grabber/default', requireAdmin, (req, res) => {
        try {
            store.setDefault(req.body && req.body.profileId);
            db.audit(req.login.email, null, 'quality.default', { id: req.body.profileId });
            res.json({ success: true });
        } catch (e) { fail(res, e); }
    });

    // How would these streams fare under a profile? (marks "best match" in the stream list)
    app.post('/api/grabber/preview', (req, res) => {
        try {
            const profile = store.resolve(req.body && req.body.profileId);
            const r = pickBest(profile.config, streamsOf(req.body), req.body.type);
            res.json({
                profile: { id: profile.id, name: profile.name },
                best: r.picked ? r.picked.index : null,
                acceptedCount: r.acceptedCount,
                results: r.results.map((x) => ({ index: x.index, accepted: x.accepted, score: x.score, reasons: x.reasons })),
            });
        } catch (e) { fail(res, e); }
    });

    // Admin tool: paste a release name and see why a profile would take or refuse it.
    app.post('/api/grabber/test', requireAdmin, (req, res) => {
        try {
            const b = req.body || {};
            const profile = store.resolve(b.profileId);
            const stream = cleanStream({ name: '', title: String(b.release || ''), seeders: b.seeders === '' || b.seeders === undefined ? undefined : Number(b.seeders) });
            if (b.sizeGB !== '' && b.sizeGB !== undefined && Number(b.sizeGB) > 0) stream.behaviorHints = { videoSize: Number(b.sizeGB) * 1e9 };
            const info = parseStreamInfo(stream);
            const out = {};
            for (const kind of ['movie', 'episode']) out[kind] = evaluate(profile.config, info, kind);
            res.json({ profile: { id: profile.id, name: profile.name }, parsed: { ...info, text: undefined }, ...out });
        } catch (e) { fail(res, e); }
    });

    // Pick the best release for a profile and queue it.
    app.post('/api/grabber/grab', async (req, res) => {
        try {
            const b = req.body || {};
            const meta = b.meta || {};
            if (meta.type !== 'movie' && meta.type !== 'series') return res.status(400).json({ error: 'meta.type must be movie or series' });
            const profile = store.resolve(b.profileId);
            const streams = streamsOf(b);
            const { r, swarm } = await chooseRelease({ profile, streams, type: meta.type, probeMany, force: b.force });
            const record = await queueRelease({ picked: r.picked, meta, profile, downloadsManager, db, login: req.login });
            res.json({
                success: true,
                profile: { id: profile.id, name: profile.name },
                picked: { label: r.picked.info.label, resolution: r.picked.info.resolution, sizeGB: r.picked.info.sizeGB, seeders: r.picked.info.seeders, score: r.picked.score, notes: r.picked.reasons },
                swarm, considered: streams.length, acceptedCount: r.acceptedCount, record,
            });
        } catch (e) {
            if (e.body) return res.status(e.status).json(e.body);
            fail(res, e);
        }
    });
}

module.exports = { registerGrabberRoutes, cleanStream, kindOf };
