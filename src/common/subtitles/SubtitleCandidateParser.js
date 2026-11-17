// Copyright (C) 2017-2026 HomeBot Cinema
// Parses incoming SRT and WebVTT candidate subtitle streams and converts
// cue timestamps into a 100 Hz binary voice/text presence vector.

function parseTimestamp(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.trim().replace(',', '.').split(':');
    if (parts.length === 3) {
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
        return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    } else if (parts.length === 1) {
        return parseFloat(parts[0]);
    }
    return 0;
}

function formatVttTimestamp(seconds) {
    const s = Math.max(0, seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = (s % 60).toFixed(3);
    const pad = (n) => String(n).padStart(2, '0');
    const secsPad = secs.padStart(6, '0');
    return `${pad(hrs)}:${pad(mins)}:${secsPad}`;
}

const CUE_REGEX = /((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3})/g;

class SubtitleCandidateParser {
    /**
     * Converts raw SRT or WebVTT content into a 100 Hz binary presence vector.
     * @param {string} text - Raw subtitle content.
     * @param {number} durationSeconds - Window duration in seconds (default 60s).
     * @param {number} startOffsetSeconds - Window start offset in seconds (default 0).
     * @param {number} sampleRate - Sampling rate in Hz (default 100).
     * @returns {Float32Array} Binary presence vector (1.0 = dialogue cue active).
     */
    static parseToPresenceVector(text, durationSeconds = 60, startOffsetSeconds = 0, sampleRate = 100) {
        const totalSamples = Math.floor(durationSeconds * sampleRate);
        const vector = new Float32Array(totalSamples);
        if (!text || typeof text !== 'string') {
            return vector;
        }

        const endWindow = startOffsetSeconds + durationSeconds;
        CUE_REGEX.lastIndex = 0;
        let match;

        while ((match = CUE_REGEX.exec(text)) !== null) {
            const startSec = parseTimestamp(match[1]);
            const endSec = parseTimestamp(match[2]);

            // Check if cue overlaps [startOffsetSeconds, endWindow]
            if (endSec > startOffsetSeconds && startSec < endWindow) {
                const cueRelStart = Math.max(0, startSec - startOffsetSeconds);
                const cueRelEnd = Math.min(durationSeconds, endSec - startOffsetSeconds);

                const startIndex = Math.max(0, Math.floor(cueRelStart * sampleRate));
                const endIndex = Math.min(totalSamples, Math.ceil(cueRelEnd * sampleRate));

                for (let i = startIndex; i < endIndex; i++) {
                    vector[i] = 1.0;
                }
            }
        }

        return vector;
    }

    /**
     * Parses subtitle text into structured cue objects.
     * @param {string} text - Raw SRT or VTT string.
     * @returns {Array<{ start: number, end: number, text: string }>}
     */
    static parseCues(text) {
        const cues = [];
        if (!text || typeof text !== 'string') return cues;

        // Normalize line endings
        const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const blocks = cleanText.split(/\n\n+/);

        for (const block of blocks) {
            const lines = block.trim().split('\n');
            let timeLineIdx = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('-->')) {
                    timeLineIdx = i;
                    break;
                }
            }

            if (timeLineIdx === -1) continue;

            const timeLine = lines[timeLineIdx];
            CUE_REGEX.lastIndex = 0;
            const match = CUE_REGEX.exec(timeLine);
            if (!match) continue;

            const start = parseTimestamp(match[1]);
            const end = parseTimestamp(match[2]);
            const cueText = lines.slice(timeLineIdx + 1).join('\n').trim();

            cues.push({ start, end, text: cueText });
        }

        return cues;
    }

    /**
     * Shifts and optionally scales cue timestamps.
     * @param {Array<{ start: number, end: number, text: string }>} cues
     * @param {number} offsetSeconds - Offset to add (e.g. -2.5s).
     * @param {number} scale - Time scaling factor (e.g. 23.976 / 25.0).
     */
    static shiftCues(cues, offsetSeconds = 0, scale = 1.0) {
        return cues.map((cue) => ({
            start: Math.max(0, cue.start * scale + offsetSeconds),
            end: Math.max(0, cue.end * scale + offsetSeconds),
            text: cue.text
        }));
    }

    /**
     * Serializes cues to standard WebVTT string.
     * @param {Array<{ start: number, end: number, text: string }>} cues
     * @returns {string}
     */
    static serializeToVtt(cues) {
        let vtt = 'WEBVTT\n\n';
        cues.forEach((cue, index) => {
            vtt += `${index + 1}\n`;
            vtt += `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}\n`;
            vtt += `${cue.text}\n\n`;
        });
        return vtt;
    }
}

module.exports = {
    SubtitleCandidateParser,
    parseTimestamp,
    formatVttTimestamp
};
