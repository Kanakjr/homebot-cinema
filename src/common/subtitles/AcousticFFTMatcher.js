// Copyright (C) 2017-2026 HomeBot Cinema
// Pure JavaScript ultra-fast 1D FFT cross-correlation engine for subtitle synchronization.
// Wiener-Khinchin theorem + Pearson correlation normalization. Zero external dependencies.

class FastFFT {
    constructor(n) {
        this.n = n;
        this.bitRev = new Uint32Array(n);
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            this.bitRev[i] = j;
        }
        this.sinTable = new Float32Array(n);
        this.cosTable = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const th = (-2 * Math.PI * i) / n;
            this.cosTable[i] = Math.cos(th);
            this.sinTable[i] = Math.sin(th);
        }
    }

    transform(re, im, inv = false) {
        const n = this.n;
        const bitRev = this.bitRev;
        const cosTable = this.cosTable;
        const sinTable = this.sinTable;

        for (let i = 0; i < n; i++) {
            const j = bitRev[i];
            if (i < j) {
                const tr = re[i]; re[i] = re[j]; re[j] = tr;
                const ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }

        const sign = inv ? -1 : 1;
        for (let len = 2; len <= n; len <<= 1) {
            const half = len >> 1;
            const step = n / len;
            for (let i = 0; i < n; i += len) {
                for (let j = 0; j < half; j++) {
                    const tableIdx = j * step;
                    const wRe = cosTable[tableIdx];
                    const wIm = sign * sinTable[tableIdx];
                    const idx1 = i + j;
                    const idx2 = idx1 + half;
                    const r2 = re[idx2], i2 = im[idx2];
                    const vRe = r2 * wRe - i2 * wIm;
                    const vIm = r2 * wIm + i2 * wRe;
                    const uRe = re[idx1], uIm = im[idx1];
                    re[idx1] = uRe + vRe;
                    im[idx1] = uIm + vIm;
                    re[idx2] = uRe - vRe;
                    im[idx2] = uIm - vIm;
                }
            }
        }

        if (inv) {
            const invN = 1 / n;
            for (let i = 0; i < n; i++) {
                re[i] *= invN;
                im[i] *= invN;
            }
        }
    }
}

const fftCache = new Map();
function getFFT(n) {
    let instance = fftCache.get(n);
    if (!instance) {
        instance = new FastFFT(n);
        fftCache.set(n, instance);
    }
    return instance;
}

function nextPowerOf2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
}

class AcousticFFTMatcher {
    /**
     * Computes optimal time delay and correlation confidence between audio and subtitle presence vectors.
     * @param {Float32Array|Array<number>} audioPresence - Voice presence envelope [0..1] at 100 Hz.
     * @param {Float32Array|Array<number>} subPresence - Binary subtitle presence [0, 1] at 100 Hz.
     * @param {number} maxLagSeconds - Search window (+/- seconds, default 15s).
     * @param {number} sampleRate - Sampling rate in Hz (default 100).
     * @returns {{ confidence: number, offsetSeconds: number }}
     */
    static correlate(audioPresence, subPresence, maxLagSeconds = 15, sampleRate = 100) {
        const results = AcousticFFTMatcher.correlateAll(audioPresence, [subPresence], maxLagSeconds, sampleRate);
        return results[0] || { confidence: 0, offsetSeconds: 0 };
    }

    /**
     * Vectorized batch cross-correlation across multiple subtitle candidates.
     * Evaluates all candidates in < 15 ms by sharing FFT(audioPresence).
     * @param {Float32Array|Array<number>} audioPresence - Audio voice presence vector at 100 Hz.
     * @param {Array<Float32Array|Array<number>>} subPresences - Array of candidate presence vectors.
     * @param {number} maxLagSeconds - Search offset (+/- seconds, default 15s).
     * @param {number} sampleRate - Sampling rate in Hz (default 100).
     * @returns {Array<{ confidence: number, offsetSeconds: number }>}
     */
    static correlateAll(audioPresence, subPresences, maxLagSeconds = 15, sampleRate = 100) {
        if (!audioPresence || audioPresence.length === 0 || !subPresences || subPresences.length === 0) {
            return (subPresences || []).map(() => ({ confidence: 0, offsetSeconds: 0 }));
        }

        const maxLag = Math.floor(maxLagSeconds * sampleRate);
        const N = audioPresence.length;
        const nFft = nextPowerOf2(N + maxLag);
        const fft = getFFT(nFft);

        // Compute mean and variance of audio presence
        let sumA = 0;
        for (let i = 0; i < N; i++) sumA += audioPresence[i];
        const meanA = sumA / N;

        let varA = 0;
        const aRe = new Float32Array(nFft);
        const aIm = new Float32Array(nFft);
        for (let i = 0; i < N; i++) {
            const diff = audioPresence[i] - meanA;
            aRe[i] = diff;
            varA += diff * diff;
        }

        if (varA <= 1e-9) {
            return subPresences.map(() => ({ confidence: 0, offsetSeconds: 0 }));
        }

        fft.transform(aRe, aIm, false);

        // Preallocate reusable scratch buffers for candidates
        const bRe = new Float32Array(nFft);
        const bIm = new Float32Array(nFft);
        const cRe = new Float32Array(nFft);
        const cIm = new Float32Array(nFft);

        return subPresences.map((sub) => {
            if (!sub || sub.length === 0) {
                return { confidence: 0, offsetSeconds: 0 };
            }

            const subLen = Math.min(N, sub.length);
            let sumB = 0;
            for (let i = 0; i < subLen; i++) sumB += sub[i];
            const meanB = sumB / subLen;

            let varB = 0;
            bRe.fill(0);
            bIm.fill(0);
            for (let i = 0; i < subLen; i++) {
                const diff = sub[i] - meanB;
                bRe[i] = diff;
                varB += diff * diff;
            }

            const denom = Math.sqrt(varA * varB);
            if (denom <= 1e-9) {
                return { confidence: 0, offsetSeconds: 0 };
            }

            fft.transform(bRe, bIm, false);

            // Wiener-Khinchin cross-correlation: C = conj(A) * B
            for (let i = 0; i < nFft; i++) {
                cRe[i] = aRe[i] * bRe[i] + aIm[i] * bIm[i];
                cIm[i] = aRe[i] * bIm[i] - aIm[i] * bRe[i];
            }
            fft.transform(cRe, cIm, true);

            let maxCorr = -Infinity;
            let bestLag = 0;

            for (let lag = -maxLag; lag <= maxLag; lag++) {
                const idx = lag >= 0 ? lag : nFft + lag;
                const corr = cRe[idx] / denom;
                if (corr > maxCorr) {
                    maxCorr = corr;
                    bestLag = lag;
                }
            }

            return {
                confidence: Math.max(0, Math.min(1.0, maxCorr)),
                offsetSeconds: -bestLag / sampleRate
            };
        });
    }

    /**
     * Dual-window frame-rate drift detector (Section 2.3).
     * Compares correlation offsets across two time windows separated by deltaSeconds.
     * @param {Float32Array} audioPresence1 - Window 1 audio presence.
     * @param {Float32Array} audioPresence2 - Window 2 audio presence.
     * @param {Float32Array} subVector1 - Window 1 subtitle presence.
     * @param {Float32Array} subVector2 - Window 2 subtitle presence.
     * @param {number} deltaSeconds - Time separation between probe window centers (e.g. 570s).
     * @param {number} maxLagSeconds - Search offset in seconds (default 15s).
     * @param {number} sampleRate - Sampling rate in Hz (default 100).
     */
    static detectDrift(audioPresence1, audioPresence2, subVector1, subVector2, deltaSeconds, maxLagSeconds = 15, sampleRate = 100) {
        const match1 = AcousticFFTMatcher.correlate(audioPresence1, subVector1, maxLagSeconds, sampleRate);
        const match2 = AcousticFFTMatcher.correlate(audioPresence2, subVector2, maxLagSeconds, sampleRate);

        const diff = match2.offsetSeconds - match1.offsetSeconds;
        const driftPerSecond = deltaSeconds > 0 ? diff / deltaSeconds : 0;
        const hasDrift = Math.abs(diff) >= 0.05; // 50 ms drift threshold

        // Check 25.0 FPS -> 23.976 FPS drift ratio: (25.0 - 23.976) / 23.976 = 0.04271
        const absDrift = Math.abs(driftPerSecond);
        const expected25to23976 = (25.0 - 23.976) / 23.976;
        const is25to23976Fps = hasDrift && Math.abs(absDrift - expected25to23976) < 0.005;

        // Scaling factor to apply to subtitle cue timestamps
        const recommendedScale = is25to23976Fps
            ? (driftPerSecond < 0 ? (23.976 / 25.0) : (25.0 / 23.976))
            : (1.0 / (1.0 - driftPerSecond));

        return {
            hasDrift,
            offset1: match1.offsetSeconds,
            offset2: match2.offsetSeconds,
            driftPerSecond,
            is25to23976Fps,
            recommendedScale,
            confidence1: match1.confidence,
            confidence2: match2.confidence
        };
    }
}

module.exports = {
    FastFFT,
    AcousticFFTMatcher
};
