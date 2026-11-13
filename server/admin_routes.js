'use strict';
// Admin dashboard API. Everything under /api/admin requires an admin login (ADMIN_EMAILS).

function registerAdminRoutes(app, { db, auth, library, downloadsManager, sentinel, streamingStats }) {
    const raw = db.raw;
    app.use('/api/admin', auth.requireAdmin);

    app.get('/api/admin/overview', async (_req, res) => {
        try {
            const lib = library.list({ sort: 'size' });
            const dl = await downloadsManager.listDownloads().catch(() => ({ active: [], completed: [] }));
            const monitored = sentinel.getMonitored();
            const stats = await streamingStats().catch(() => null);
            res.json({
                storage: downloadsManager.getDiskStats(),
                library: {
                    titles: lib.counts.all, movies: lib.counts.movie, series: lib.counts.series, unmatched: lib.counts.unmatched,
                    totalBytes: lib.items.reduce((a, i) => a + i.totalSize, 0),
                    fileCount: lib.items.reduce((a, i) => a + i.fileCount, 0),
                    biggest: lib.items.slice(0, 10).map((i) => ({ id: i.id, title: i.title, type: i.type, totalSize: i.totalSize, poster: i.poster })),
                    scan: library.status,
                },
                downloads: {
                    active: (dl.active || []).length,
                    completed: (dl.completed || []).length,
                    activeList: (dl.active || []).map((d) => ({ id: d.id, title: d.title, progress: d.progress, rateDownload: d.rateDownload, status: d.status })),
                },
                sentinel: { monitoredShows: Array.isArray(monitored) ? monitored.length : Object.keys(monitored || {}).length },
                streaming: stats,
                people: {
                    logins: raw.prepare('SELECT COUNT(*) c FROM logins').get().c,
                    profiles: raw.prepare('SELECT COUNT(*) c FROM profiles').get().c,
                },
            });
        } catch (e) {
            console.error('[Admin] overview failed:', e);
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/admin/logins', (_req, res) => {
        res.json(raw.prepare('SELECT email, first_seen firstSeen, last_seen lastSeen, disabled, quota_gb quotaGb FROM logins ORDER BY last_seen DESC').all()
            .map((l) => ({ ...l, disabled: !!l.disabled, isAdmin: auth.isAdminEmail(l.email) })));
    });

    app.patch('/api/admin/logins/:email', (req, res) => {
        const email = String(req.params.email).toLowerCase();
        const row = raw.prepare('SELECT * FROM logins WHERE email = ?').get(email);
        if (!row) return res.status(404).json({ error: 'not_found' });
        const b = req.body || {};
        if (b.disabled !== undefined && auth.isAdminEmail(email)) return res.status(409).json({ error: 'cannot_disable_admin' });
        let quota = row.quota_gb;
        if (b.quotaGb !== undefined) {
            if (b.quotaGb === null || b.quotaGb === '') quota = null;
            else if (Number.isFinite(Number(b.quotaGb)) && Number(b.quotaGb) >= 0 && Number(b.quotaGb) <= 100000) quota = Number(b.quotaGb);
            else return res.status(400).json({ error: 'invalid_quota' });
        }
        raw.prepare('UPDATE logins SET disabled = ?, quota_gb = ? WHERE email = ?').run(b.disabled === undefined ? row.disabled : (b.disabled ? 1 : 0), quota, email);
        db.audit(req.login.email, null, 'login.update', { email, disabled: b.disabled, quotaGb: b.quotaGb });
        res.json({ success: true });
    });

    app.get('/api/admin/audit', (req, res) => {
        const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
        res.json(raw.prepare('SELECT id, ts, email, profile_id profileId, action, payload FROM audit_log ORDER BY id DESC LIMIT ?').all(limit)
            .map((r) => ({ ...r, payload: r.payload ? (() => { try { return JSON.parse(r.payload); } catch (_) { return r.payload; } })() : null })));
    });
}

module.exports = { registerAdminRoutes };
