'use strict';
// Pure helpers for live subtitles: PCM -> WAV, Whisper segments -> tidy cues, committing chunk results.
// Times are seconds on the media timeline.

const SAMPLE_RATE = 16000;
const BYTES_PER_SEC = SAMPLE_RATE * 2; // s16le mono

const MAX_LINE = 42;
const MAX_LINES = 2;
const MIN_CUE = 1.0;
const MAX_CUE = 6.0;

/** A 16-bit mono PCM buffer wrapped in a WAV header (what whisper-server accepts). */
function wavFromPcm(pcm, sampleRate = SAMPLE_RATE) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // PCM chunk size
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28); // byte rate
    header.writeUInt16LE(2, 32); // block align
    header.writeUInt16LE(16, 34); // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

// Whisper's usual inventions over silence and music, and sound-effect captions we do not want as dialogue
const NOISE_ONLY = /^[\s\p{P}♪♫]*$/u;
const BRACKETED = /^\s*[[(（【][^\])）】]*[\])）】]\s*$/;
const HALLUCINATIONS = new Set([
    'you', 'thank you', 'thank you.', 'thanks for watching', 'thanks for watching!', 'thank you for watching',
    'thank you for watching.', 'please subscribe', 'bye', 'bye.', 'subtitles by the amara.org community',
]);

function cleanText(text) {
    // Whisper marks a change of speaker with a leading "- "; on a line of its own it is noise
    return String(text || '').replace(/\s+/g, ' ').trim().replace(/^-\s+/, '');
}

function isNoise(text, seg = {}) {
    if (!text || NOISE_ONLY.test(text) || BRACKETED.test(text)) return true;
    // "Thank you." / "Bye." are real dialogue too: drop them only when Whisper is not sure anyone spoke
    if (HALLUCINATIONS.has(text.toLowerCase()) && !(Number(seg.no_speech_prob) < 0.3)) return true;
    // confident "no speech" with a weak transcript: almost always invented
    if (Number(seg.no_speech_prob) > 0.6 && Number(seg.avg_logprob) < -0.8) return true;
    return false;
}

/** Break text into lines of at most `max` characters, on word boundaries. */
function wrapLines(text, max = MAX_LINE) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
        if (line && (line.length + 1 + w.length) > max) {
            lines.push(line);
            line = w;
        } else {
            line = line ? `${line} ${w}` : w;
        }
    }
    if (line) lines.push(line);
    return lines;
}

/** How long a line of `chars` characters needs on screen (about 15 characters a second, clamped). */
function readingTime(chars) {
    return Math.min(MAX_CUE, Math.max(MIN_CUE, 0.6 + chars * 0.065));
}

/**
 * Whisper verbose_json segments of one chunk -> cues on the media timeline.
 * Segment starts are good; ends often stretch over the silence that follows (VAD), so a cue is held for its reading
 * time at most. Long segments are split into cues of at most two lines, sharing the segment's time.
 */
function segmentsToCues(segments, offset = 0) {
    const cues = [];
    for (const seg of segments || []) {
        const text = cleanText(seg.text);
        if (isNoise(text, seg)) continue;
        const start = offset + Number(seg.start || 0);
        const end = offset + Number(seg.end || 0);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        const lines = wrapLines(text);
        const groups = [];
        for (let i = 0; i < lines.length; i += MAX_LINES) groups.push(lines.slice(i, i + MAX_LINES));
        const total = groups.reduce((n, g) => n + g.join(' ').length, 0) || 1;
        let t = start;
        for (const g of groups) {
            const share = (end - start) * (g.join(' ').length / total);
            const cueEnd = Math.min(t + share, t + readingTime(g.join(' ').length));
            cues.push({ start: round(t), end: round(Math.max(cueEnd, t + Math.min(MIN_CUE, share))), text: g.join('\n') });
            t += share;
        }
    }
    return cues;
}

/**
 * Decide what to keep from one transcribed chunk [chunkStart, chunkEnd].
 * Whisper cuts the last sentence of a chunk mid-word, so unless the audio ended (eof) a segment that runs into the last
 * `tail` seconds is held back and transcribed again at the start of the next chunk.
 * Returns { segments: segments to commit, next: where the next chunk starts }.
 */
function commitChunk(segments, { chunkStart, chunkEnd, eof = false, tail = 1.5, minAdvance = 5 }) {
    const segs = (segments || []).filter((s) => Number.isFinite(Number(s.start)) && Number.isFinite(Number(s.end)));
    if (eof || !segs.length) return { segments: segs, next: eof ? chunkEnd : Math.max(chunkStart, chunkEnd - 1) };
    const last = segs[segs.length - 1];
    const lastEnd = chunkStart + Number(last.end);
    const lastStart = chunkStart + Number(last.start);
    if (lastEnd >= chunkEnd - tail && lastStart >= chunkStart + minAdvance) {
        return { segments: segs.slice(0, -1), next: lastStart };
    }
    return { segments: segs, next: Math.max(lastEnd, chunkEnd - 1) };
}

/**
 * Add new cues to a sorted list. Cues that start before `after` (already covered by earlier chunks) are dropped,
 * which removes the duplicates the 1 s chunk overlap produces.
 */
function mergeCues(list, add, after = -Infinity) {
    const fresh = add.filter((c) => c.start >= after - 0.2);
    if (!fresh.length) return list;
    const out = list.concat(fresh).sort((a, b) => a.start - b.start);
    // drop exact repeats (same text within 1 s): the overlap can transcribe one line twice
    return out.filter((c, i) => i === 0 || !(c.text === out[i - 1].text && c.start - out[i - 1].start < 1));
}

/** Cues that overlap [from, to]. */
function cuesBetween(list, from, to) {
    return list.filter((c) => c.end >= from && c.start <= to);
}

/** Covered ranges: add [a, b] and merge neighbours closer than `gap` seconds. */
function addRange(ranges, a, b, gap = 2) {
    const all = ranges.concat([[a, b]]).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const r of all) {
        const last = out[out.length - 1];
        if (last && r[0] <= last[1] + gap) last[1] = Math.max(last[1], r[1]);
        else out.push([r[0], r[1]]);
    }
    return out;
}

function covered(ranges, t) {
    return ranges.some(([a, b]) => t >= a && t <= b);
}

/** Cues as WebVTT (for a download or a later "real" subtitle track). */
function toVtt(list) {
    const ts = (s) => {
        const ms = Math.max(0, Math.round(s * 1000));
        const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
        const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
        const sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
        return `${h}:${m}:${sec}.${String(ms % 1000).padStart(3, '0')}`;
    };
    return `WEBVTT\n\n${list.map((c) => `${ts(c.start)} --> ${ts(c.end)}\n${c.text}`).join('\n\n')}\n`;
}

const round = (x) => Math.round(x * 1000) / 1000;

module.exports = {
    SAMPLE_RATE, BYTES_PER_SEC, wavFromPcm, cleanText, isNoise, wrapLines, readingTime, segmentsToCues, commitChunk,
    mergeCues, cuesBetween, addRange, covered, toVtt,
};
