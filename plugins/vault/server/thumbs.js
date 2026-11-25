'use strict';
// Thumbnails for the Locked folder, made on this server only (nothing is looked up online): the same-name cover image
// when a video has one, else one frame grabbed with ffmpeg. ffprobe also gives the duration. Files: <dataDir>/thumbs/<id>.jpg.
// A request for a missing thumbnail jumps the queue; the rest are made in the background, two at a time.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { resolveInside, sidecarImage } = require('./media');

const SCALE = 'scale=480:-2';

function execFileP(cmd, args, { timeout = 30000 } = {}) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout || ''))));
    });
}

function createThumbs({ dir, store, run = execFileP, concurrency = 2, waitMs = 20000, log = console }) {
    fs.mkdirSync(dir, { recursive: true });
    const fileOf = (id) => path.join(dir, `${Number(id)}.jpg`);
    const jobs = new Map(); // id -> promise (made or failed)
    const urgent = [];
    let background = [];
    let active = 0;
    let stopped = false;

    async function probeDuration(src) {
        try {
            const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', src], { timeout: 20000 });
            const s = Number(String(out).trim());
            return Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : null;
        } catch (_) {
            return null;
        }
    }

    async function make(row) {
        const src = resolveInside(store.root, row.rel_path);
        if (!src) throw new Error('missing');
        const durationMs = await probeDuration(src);
        const out = fileOf(row.id);
        const tmp = `${out}.tmp.jpg`;
        const side = sidecarImage(src);
        const grab = (at) => run('ffmpeg', ['-y', '-v', 'error', '-ss', at.toFixed(2), '-i', src, '-frames:v', '1', '-vf', SCALE, '-q:v', '5', tmp], { timeout: 30000 });
        try {
            if (side) {
                await run('ffmpeg', ['-y', '-v', 'error', '-i', side, '-frames:v', '1', '-vf', SCALE, '-q:v', '5', tmp], { timeout: 20000 });
            } else {
                // 10% in (at most a minute) skips black intros; very short or odd files fall back to the first frame
                const at = durationMs ? Math.min((durationMs / 1000) * 0.1, 60) : 1;
                try {
                    await grab(at);
                    if (!fs.existsSync(tmp)) throw new Error('no frame');
                } catch (_) {
                    await grab(0);
                }
            }
            if (!fs.existsSync(tmp)) throw new Error('no frame');
            fs.renameSync(tmp, out);
            store.setThumb(row.id, 1, durationMs);
        } catch (e) {
            try { fs.rmSync(tmp, { force: true }); } catch (_) { /* nothing to clean */ }
            store.setThumb(row.id, -1, durationMs);
            throw e;
        }
    }

    function start(id) {
        if (jobs.has(id)) return jobs.get(id);
        let done;
        const p = new Promise((resolve) => { done = resolve; });
        jobs.set(id, p);
        const row = store.get(id);
        const task = async () => {
            try {
                if (row) await make(row);
            } catch (e) {
                log.warn(`thumbnail failed for file ${id}: ${e.message}`);
            } finally {
                jobs.delete(id);
                done(fs.existsSync(fileOf(id)));
            }
        };
        return { p, task };
    }

    function pump() {
        while (!stopped && active < concurrency) {
            let next = urgent.shift();
            if (!next) {
                if (!background.length) background = store.pendingThumbs(20).map((r) => r.id).filter((id) => !jobs.has(id));
                const id = background.shift();
                if (id === undefined) return;
                const s = start(id);
                if (!s.task) continue; // already running
                next = s.task;
            }
            active += 1;
            Promise.resolve(next()).finally(() => {
                active -= 1;
                pump();
            });
        }
    }

    /** Path of the thumbnail, made now if needed (waits up to waitMs); null when it cannot be made. */
    async function ensure(id) {
        const out = fileOf(id);
        if (fs.existsSync(out)) return out;
        const row = store.get(id);
        if (!row || row.thumb_state < 0) return null;
        const s = start(id);
        if (s.task) {
            urgent.push(s.task);
            pump();
        }
        const ok = await Promise.race([s.p || s, new Promise((r) => setTimeout(() => r(false), waitMs))]);
        return ok && fs.existsSync(out) ? out : null;
    }

    const remove = (id) => { try { fs.rmSync(fileOf(id), { force: true }); } catch (_) { /* already gone */ } };

    return {
        ensure,
        remove,
        /** Make every missing thumbnail in the background. */
        fill: () => { stopped = false; pump(); },
        stop: () => { stopped = true; },
        file: fileOf,
    };
}

module.exports = { createThumbs, execFileP };
