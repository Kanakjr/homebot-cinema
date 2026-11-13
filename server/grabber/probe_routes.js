'use strict';
// POST /api/streams/probe { streams: [{ infoHash, fileIdx }] }  (max 6)  ->  { results: { <infoHash>: { verdict, bytes, ms, peers, unchoked } } }
// Open to every login: it only starts torrents the user could start by pressing Play anyway.

const { HASH_RE } = require('./swarm_probe');

function registerProbeRoutes(app, { probeMany }) {
    app.post('/api/streams/probe', async (req, res) => {
        const list = req.body && req.body.streams;
        if (!Array.isArray(list) || list.length === 0 || list.length > 6) return res.status(400).json({ error: 'streams must be 1 to 6 items' });
        const items = list
            .map((s) => ({ infoHash: String((s && s.infoHash) || ''), fileIdx: Number.isInteger(s && s.fileIdx) ? s.fileIdx : null }))
            .filter((s) => HASH_RE.test(s.infoHash));
        if (items.length === 0) return res.status(400).json({ error: 'no valid infoHash' });
        try {
            res.json({ results: await probeMany(items) });
        } catch (e) {
            console.error('[Probe]', e);
            res.status(500).json({ error: 'probe_failed' });
        }
    });
}

module.exports = { registerProbeRoutes };
