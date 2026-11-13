'use strict';
// Daily consistent copy of cinema.db (VACUUM INTO). A tar/rsync of a live WAL database can be torn;
// these snapshots are complete single-file databases that the HomeServer backup picks up with data/.

const fs = require('fs');
const path = require('path');

const NAME_RE = /^cinema-(\d{8})\.db$/;
const stamp = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

function createSnapshots({ raw, dir, keep = 7, now = () => new Date(), log = console }) {
    const list = () => {
        try { return fs.readdirSync(dir).filter((f) => NAME_RE.test(f)).sort(); } catch (_) { return []; }
    };
    // one per calendar day (UTC)
    const due = () => {
        const all = list();
        return !all.length || NAME_RE.exec(all[all.length - 1])[1] !== stamp(now());
    };
    function snapshot() {
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `cinema-${stamp(now())}.db`);
        const tmp = `${file}.tmp`;
        fs.rmSync(tmp, { force: true });
        raw.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
        fs.renameSync(tmp, file);
        const all = list();
        for (const f of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, f), { force: true });
        return file;
    }
    function tick() {
        try {
            if (due()) log.log('[Snapshots] wrote', path.basename(snapshot()));
        } catch (e) {
            log.error('[Snapshots] failed:', e.message);
        }
    }
    function start(intervalMs = 60 * 60 * 1000) {
        tick();
        const t = setInterval(tick, intervalMs);
        if (t.unref) t.unref();
        return () => clearInterval(t);
    }
    return { snapshot, due, list, tick, start };
}

module.exports = { createSnapshots };
