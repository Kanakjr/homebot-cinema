'use strict';
// Live subtitles engine. One Transcriber per (source, language): ffmpeg reads the stream's audio from the viewer's
// position onwards (16 kHz mono PCM), the PCM is cut into chunks (a short first one so text appears quickly, then 30 s),
// and one shared queue sends chunks to Whisper, most urgent first (smallest lead over its viewer's playhead).
// Reading pauses once it is `maxLeadSec` ahead of the playhead (pipe backpressure), and a seek outside what is already
// transcribed restarts ffmpeg at the new position. Finished cues stay cached per source.

const { spawn: nodeSpawn } = require('child_process');
const C = require('./cues');

const BPS = C.BYTES_PER_SEC;

function ffmpegArgs(input, startSec, { audioIndex = 0 } = {}) {
    const http = /^https?:\/\//i.test(input);
    return [
        '-nostdin', '-hide_banner', '-loglevel', 'error',
        ...(http ? ['-reconnect', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '10', '-rw_timeout', '30000000'] : []),
        '-ss', String(Math.max(0, startSec)), '-i', input,
        '-map', `0:a:${audioIndex}?`, '-vn', '-sn', '-dn',
        // pad from the seek point so a late-starting audio stream does not make every cue early
        '-af', 'aresample=async=1:first_pts=0',
        '-ac', '1', '-ar', String(C.SAMPLE_RATE), '-f', 's16le', 'pipe:1',
    ];
}

function createEngine({
    whisper, spawn = nodeSpawn, ffmpeg = 'ffmpeg', log = console, now = Date.now,
    maxLeadSec = 150, chunkSec = 30, firstChunkSec = 8, idleMs = 90 * 1000, store = null,
}) {
    const transcribers = new Map(); // key -> Transcriber
    let whisperBusy = false;
    let pumpScheduled = false;

    class Transcriber {
        constructor({ key, input, language, translate, audioIndex }) {
            Object.assign(this, { key, input, language: language || 'auto', translate: !!translate, audioIndex: audioIndex || 0 });
            const saved = store && store.load(key);
            this.cues = saved ? saved.cues : [];
            this.ranges = saved ? saved.ranges : [];
            this.detected = saved ? saved.language : null;
            this.reader = null;
            this.playhead = 0;
            this.lastSeen = now();
            this.error = null;
            this.stats = { chunks: 0, whisperMs: 0, audioSec: 0, startedAt: now(), firstCueAt: null, restarts: 0 };
        }

        head() {
            const r = this.reader;
            return r ? r.bufStart + r.buf.length / BPS : this.playhead;
        }

        /** First time at or after t that has not been transcribed yet. */
        uncoveredFrom(t) {
            for (const [a, b] of this.ranges) if (t >= a - 0.5 && t <= b) return b;
            return t;
        }

        touch(pos) {
            this.lastSeen = now();
            if (Number.isFinite(pos) && pos >= 0) this.playhead = pos;
            const target = this.uncoveredFrom(this.playhead);
            if (target - this.playhead > maxLeadSec) return this.backpressure();
            const r = this.reader;
            if (!r || r.dead || target < r.bufStart - 2 || target > this.head() + 20) {
                this.restart(target);
            } else {
                // a short jump forward inside what is already read: skip the audio the viewer jumped over
                if (target > r.next + 5) {
                    r.next = target;
                    r.first = true;
                }
                this.backpressure();
            }
            return undefined;
        }

        restart(at) {
            this.stopReader();
            const start = Math.max(0, at - 1);
            const proc = spawn(ffmpeg, ffmpegArgs(this.input, start, { audioIndex: this.audioIndex }), { stdio: ['ignore', 'pipe', 'pipe'] });
            const r = { proc, start, bufStart: start, buf: Buffer.alloc(0), next: start, first: true, eof: false, dead: false, paused: false, stderr: '' };
            this.reader = r;
            this.stats.restarts += 1;
            proc.stdout.on('data', (d) => {
                if (this.reader !== r) return;
                r.buf = r.buf.length ? Buffer.concat([r.buf, d]) : d;
                this.backpressure();
                schedulePump();
            });
            proc.stderr.on('data', (d) => { r.stderr = (r.stderr + d).slice(-2000); });
            proc.on('error', (e) => { r.dead = true; this.error = `ffmpeg: ${e.message}`; });
            proc.on('close', (code) => {
                r.eof = true;
                if (code && this.reader === r && !r.killed) {
                    this.error = `ffmpeg exited ${code}: ${r.stderr.trim().split('\n').pop() || ''}`.trim();
                    log.warn(`livesubs ${this.key}: ${this.error}`);
                }
                schedulePump();
            });
        }

        stopReader() {
            const r = this.reader;
            if (!r) return;
            r.dead = true;
            r.killed = true;
            try { r.proc.kill('SIGKILL'); } catch { /* gone */ }
            this.reader = null;
        }

        backpressure() {
            const r = this.reader;
            if (!r || r.eof) return;
            const lead = this.head() - this.playhead;
            if (!r.paused && lead > maxLeadSec) {
                r.paused = true;
                r.proc.stdout.pause();
            } else if (r.paused && lead < maxLeadSec - 30) {
                r.paused = false;
                r.proc.stdout.resume();
            }
        }

        /** The next chunk to send to Whisper, or null. */
        readyJob() {
            const r = this.reader;
            if (!r || r.dead && !r.eof) return null;
            const need = r.first ? firstChunkSec : chunkSec;
            const have = this.head() - r.next;
            if (have >= need || (r.eof && have > 0.5)) {
                const end = Math.min(r.next + need, this.head());
                return { t: this, reader: r, start: r.next, end, eof: r.eof && end >= this.head() - 0.01 };
            }
            return null;
        }

        sliceWav(job) {
            const r = job.reader;
            const from = Math.max(0, Math.floor((job.start - r.bufStart) * C.SAMPLE_RATE) * 2);
            const to = Math.min(r.buf.length, Math.floor((job.end - r.bufStart) * C.SAMPLE_RATE) * 2);
            return C.wavFromPcm(r.buf.subarray(from, to));
        }

        commit(job, segments) {
            const r = job.reader;
            const { segments: keep, next } = C.commitChunk(segments, { chunkStart: job.start, chunkEnd: job.end, eof: job.eof });
            const cues = C.segmentsToCues(keep, job.start);
            const before = this.cues.length;
            this.cues = C.mergeCues(this.cues, cues, r.committedEnd === undefined ? -Infinity : r.committedEnd);
            if (this.cues.length > before && this.stats.firstCueAt === null) this.stats.firstCueAt = now();
            this.ranges = C.addRange(this.ranges, job.start, next);
            r.committedEnd = next;
            r.first = false;
            r.next = next;
            // free the audio we no longer need
            const drop = Math.floor((next - r.bufStart) * C.SAMPLE_RATE) * 2;
            if (drop > 0) {
                r.buf = r.buf.subarray(Math.min(drop, r.buf.length));
                r.bufStart += drop / BPS;
            }
            if (job.eof) this.stopReader();
            this.backpressure();
        }

        status() {
            const r = this.reader;
            const ahead = this.uncoveredFrom(this.playhead);
            return {
                state: this.error ? 'error' : (r ? (r.paused ? 'ahead' : 'working') : 'idle'),
                error: this.error,
                language: this.detected,
                transcribedUntil: round(ahead),
                lead: round(ahead - this.playhead),
                buffered: r ? round(this.head() - this.playhead) : 0,
                chunks: this.stats.chunks,
                speed: this.stats.whisperMs ? round(this.stats.audioSec / (this.stats.whisperMs / 1000)) : null,
                firstCueMs: this.stats.firstCueAt === null ? null : this.stats.firstCueAt - this.stats.startedAt,
            };
        }
    }

    function schedulePump() {
        if (pumpScheduled) return;
        pumpScheduled = true;
        setImmediate(() => { pumpScheduled = false; pump(); });
    }

    async function pump() {
        if (whisperBusy) return;
        let best = null;
        for (const t of transcribers.values()) {
            const job = t.readyJob();
            if (job && (!best || (job.start - t.playhead) < (best.start - best.t.playhead))) best = job;
        }
        if (!best) return;
        whisperBusy = true;
        const t = best.t;
        const started = now();
        try {
            const wav = t.sliceWav(best);
            // detect the language on the first chunk, then keep it (per-chunk detection flips on music and short lines)
            const res = await whisper.transcribe(wav, { language: t.detected || t.language, translate: t.translate });
            if (!t.detected && t.language === 'auto' && res.language) t.detected = res.language;
            if (t.language !== 'auto') t.detected = t.language;
            t.stats.chunks += 1;
            t.stats.whisperMs += now() - started;
            t.stats.audioSec += best.end - best.start;
            if (t.reader === best.reader) t.commit(best, res.segments);
            t.error = null;
        } catch (e) {
            t.error = `whisper: ${e.message}`;
            log.warn(`livesubs ${t.key}: ${t.error}`);
            whisperBusy = false;
            setTimeout(schedulePump, 3000);
            return;
        }
        whisperBusy = false;
        schedulePump();
    }

    function open({ key, input, language, translate, audioIndex, position }) {
        let t = transcribers.get(key);
        if (!t) {
            t = new Transcriber({ key, input, language, translate, audioIndex });
            transcribers.set(key, t);
        }
        t.touch(position);
        schedulePump();
        return t;
    }

    function get(key) {
        return transcribers.get(key) || null;
    }

    /** A viewer switched AI subtitles off or left: stop reading now and keep the text. Another viewer of the same
     * source restarts reading with its next poll. */
    function release(key) {
        const t = transcribers.get(key);
        if (!t) return false;
        t.stopReader();
        if (store) store.save(key, { cues: t.cues, ranges: t.ranges, language: t.detected });
        return true;
    }

    function sweep() {
        for (const [key, t] of transcribers) {
            const idle = now() - t.lastSeen;
            if (idle > idleMs && t.reader) {
                t.stopReader();
                if (store) store.save(key, { cues: t.cues, ranges: t.ranges, language: t.detected });
            }
            if (idle > 30 * 60 * 1000) transcribers.delete(key);
        }
    }
    const timer = setInterval(sweep, 15000);
    timer.unref();

    function close() {
        clearInterval(timer);
        for (const t of transcribers.values()) t.stopReader();
    }

    return { open, get, release, sweep, close, transcribers };
}

const round = (x) => Math.round(x * 10) / 10;

module.exports = { createEngine, ffmpegArgs };
