// Copyright (C) 2017-2026 HomeBot Cinema
// Orchestrates candidate subtitle fetching, parses cues, executes ultra-fast FFT
// cross-correlation matrix, and selects and retimes the optimal candidate track.

const { AcousticFFTMatcher } = require('./AcousticFFTMatcher');
const { SubtitleCandidateParser } = require('./SubtitleCandidateParser');

class SmartSubtitleSelector {
    /**
     * Evaluates all candidate subtitles against an active audio voice profile.
     * Selects the highest-confidence candidate and calculates the exact millisecond calibration offset.
     *
     * @param {Float32Array} audioProfile - Voice presence array from AudioVADProbe.
     * @param {Array<object>} candidates - Array of subtitle candidate objects.
     * @param {object} [options]
     * @param {number} [options.maxLagSeconds=15] - Maximum search offset (+/- seconds).
     * @param {number} [options.minConfidence=0.75] - Minimum correlation threshold to lock in auto-sync.
     * @param {number} [options.durationSeconds=60] - Probe window duration in seconds.
     * @param {number} [options.startOffsetSeconds=0] - Probe window start offset in seconds.
     * @param {number} [options.fetchTimeoutMs=5000] - Timeout for fetching candidate subtitle files.
     * @param {AbortSignal} [options.signal] - Optional cancellation signal.
     * @returns {Promise<{ bestTrack: object, confidence: number, recommendedOffset: number, isAutoSynced: boolean, allRankings: Array, executionTimeMs: number }>}
     */
    static async rankAndSelect(audioProfile, candidates, options = {}) {
        if (!candidates || candidates.length === 0) {
            return {
                bestTrack: null,
                confidence: 0,
                recommendedOffset: 0,
                isAutoSynced: false,
                allRankings: [],
                executionTimeMs: 0
            };
        }

        const maxLagSeconds = options.maxLagSeconds || 15;
        const minConfidence = typeof options.minConfidence === 'number' ? options.minConfidence : 0.75;
        const durationSeconds = options.durationSeconds || 60;
        const startOffsetSeconds = options.startOffsetSeconds || 0;
        const fetchTimeoutMs = options.fetchTimeoutMs || 5000;

        const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

        // 1. Fetch and parse candidate subtitles in parallel
        const candidatePayloads = await Promise.all(
            candidates.map(async (candidate) => {
                try {
                    let text = '';
                    if (typeof candidate.text === 'string') {
                        text = candidate.text;
                    } else if (typeof candidate.content === 'string') {
                        text = candidate.content;
                    } else if (candidate.buffer instanceof ArrayBuffer) {
                        text = new TextDecoder('utf-8').decode(candidate.buffer);
                    } else {
                        const url = candidate.url || candidate.fallbackUrl;
                        if (!url) {
                            return { candidate, vector: null, error: 'no_url' };
                        }

                        const controller = new AbortController();
                        const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
                        if (options.signal) {
                            options.signal.addEventListener('abort', () => controller.abort(), { once: true });
                        }

                        try {
                            const res = await fetch(url, { signal: controller.signal });
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            text = await res.text();
                        } finally {
                            clearTimeout(timer);
                        }
                    }

                    const vector = SubtitleCandidateParser.parseToPresenceVector(
                        text,
                        durationSeconds,
                        startOffsetSeconds
                    );
                    return { candidate, vector, error: null };
                } catch (err) {
                    return { candidate, vector: null, error: err.message };
                }
            })
        );

        // 2. Prepare subtitle presence vectors for batch FFT correlation
        const validVectors = candidatePayloads.map((p) => p.vector || new Float32Array(0));

        // 3. Ultra-fast FFT cross-correlation matrix across all candidate vectors
        const corrResults = AcousticFFTMatcher.correlateAll(audioProfile, validVectors, maxLagSeconds);

        // 4. Assemble and sort ranking results
        const allRankings = candidatePayloads.map((item, idx) => {
            const corr = corrResults[idx] || { confidence: 0, offsetSeconds: 0 };
            return {
                candidate: item.candidate,
                confidence: item.vector ? corr.confidence : 0,
                offsetSeconds: item.vector ? corr.offsetSeconds : 0,
                error: item.error
            };
        });

        allRankings.sort((a, b) => b.confidence - a.confidence);

        const endTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const executionTimeMs = parseFloat((endTime - startTime).toFixed(2));

        const best = allRankings[0];
        const isReliable = Boolean(best && best.confidence >= minConfidence);

        return {
            bestTrack: isReliable ? best.candidate : candidates[0],
            confidence: best ? best.confidence : 0,
            recommendedOffset: isReliable ? best.offsetSeconds : 0,
            isAutoSynced: isReliable,
            allRankings,
            executionTimeMs
        };
    }

    /**
     * Retimes a subtitle track by applying an offset in milliseconds.
     * @param {object} track
     * @param {number} offsetSeconds
     */
    static retimeTrack(track, offsetSeconds) {
        if (!track) return track;
        return {
            ...track,
            retimedOffsetMs: Math.round(offsetSeconds * 1000)
        };
    }
}

module.exports = {
    SmartSubtitleSelector
};
