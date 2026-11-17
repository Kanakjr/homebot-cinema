// Copyright (C) 2017-2026 HomeBot Cinema
// Unit and performance tests for Dynamic Acoustic Subtitle Matcher

const {
    FastFFT,
    AcousticFFTMatcher,
    SubtitleCandidateParser,
    AudioVADProbe,
    SmartSubtitleSelector
} = require('../src/common/subtitles');

describe('FastFFT Engine', () => {
    it('performs round-trip forward and inverse FFT with negligible numerical error', () => {
        const N = 512;
        const fft = new FastFFT(N);
        const origRe = new Float32Array(N);
        const origIm = new Float32Array(N);

        for (let i = 0; i < N; i++) {
            origRe[i] = Math.sin((2 * Math.PI * 5 * i) / N) + 0.5 * Math.cos((2 * Math.PI * 13 * i) / N);
        }

        const re = new Float32Array(origRe);
        const im = new Float32Array(origIm);

        fft.transform(re, im, false);
        fft.transform(re, im, true);

        for (let i = 0; i < N; i++) {
            expect(Math.abs(re[i] - origRe[i])).toBeLessThan(1e-4);
            expect(Math.abs(im[i])).toBeLessThan(1e-4);
        }
    });
});

describe('AcousticFFTMatcher', () => {
    const sampleRate = 100; // 100 Hz = 10 ms bins
    const duration = 60; // 60 seconds
    const N = duration * sampleRate; // 6000 points

    // Synthesize reference audio speech bursts (e.g. dialogue at 5s-9s, 15s-22s, 32s-40s)
    function createReferenceAudio() {
        const audio = new Float32Array(N);
        for (let i = 500; i < 900; i++) audio[i] = 1.0;
        for (let i = 1500; i < 2200; i++) audio[i] = 1.0;
        for (let i = 3200; i < 4000; i++) audio[i] = 1.0;
        return audio;
    }

    it('recovers zero delay with near 1.0 confidence on identical vectors', () => {
        const audio = createReferenceAudio();
        const sub = new Float32Array(audio);

        const result = AcousticFFTMatcher.correlate(audio, sub, 15, sampleRate);
        expect(result.confidence).toBeGreaterThan(0.99);
        expect(result.offsetSeconds).toBeCloseTo(0, 2);
    });

    it('passes unit tests against synthetically delayed arrays (+2.5s delay) with 100% accuracy', () => {
        const audio = createReferenceAudio();
        const subDelayed = new Float32Array(N);
        const shiftSamples = 250; // +2.5 seconds (sub starts late)

        for (let i = 0; i < N; i++) {
            if (i - shiftSamples >= 0 && i - shiftSamples < N) {
                subDelayed[i] = audio[i - shiftSamples];
            }
        }

        const result = AcousticFFTMatcher.correlate(audio, subDelayed, 15, sampleRate);
        expect(result.confidence).toBeGreaterThan(0.95);
        // If sub is 2.5s late, calibration offset is -2.5s
        expect(result.offsetSeconds).toBeCloseTo(-2.5, 2);
    });

    it('passes unit tests against synthetically delayed arrays (-4.0s early) with 100% accuracy', () => {
        const audio = createReferenceAudio();
        const subEarly = new Float32Array(N);
        const shiftSamples = -400; // -4.0 seconds (sub starts early)

        for (let i = 0; i < N; i++) {
            if (i - shiftSamples >= 0 && i - shiftSamples < N) {
                subEarly[i] = audio[i - shiftSamples];
            }
        }

        const result = AcousticFFTMatcher.correlate(audio, subEarly, 15, sampleRate);
        expect(result.confidence).toBeGreaterThan(0.95);
        // If sub is 4.0s early, calibration offset is +4.0s
        expect(result.offsetSeconds).toBeCloseTo(4.0, 2);
    });

    it('safely handles flat/silent vectors without throwing or NaN', () => {
        const audio = createReferenceAudio();
        const silentSub = new Float32Array(N);

        const result = AcousticFFTMatcher.correlate(audio, silentSub, 15, sampleRate);
        expect(result.confidence).toBe(0);
        expect(result.offsetSeconds).toBe(0);
    });

    it('executes batch correlation matrix across 20 candidate subtitles in < 15 ms', () => {
        const audio = createReferenceAudio();
        const candidates = [];

        for (let k = 0; k < 20; k++) {
            const sub = new Float32Array(N);
            // Candidate 7 is the true match with +1.8s delay (shift = 180)
            if (k === 7) {
                const shift = 180;
                for (let i = 0; i < N; i++) {
                    if (i - shift >= 0 && i - shift < N) {
                        sub[i] = audio[i - shift];
                    }
                }
            } else {
                // Other candidates have completely different dialogue timing (or shifted beyond maxLag)
                const start = (k * 270 + 350) % N;
                const len = 300 + (k * 50);
                for (let i = start; i < Math.min(N, start + len); i++) {
                    sub[i] = 1.0;
                }
            }
            candidates.push(sub);
        }

        // Measure batch FFT execution time
        const start = performance.now();
        const results = AcousticFFTMatcher.correlateAll(audio, candidates, 15, sampleRate);
        const elapsed = performance.now() - start;

        // Must execute in < 15 ms CPU budget
        expect(elapsed).toBeLessThan(15.0);

        // Candidate 7 must be verified best match with -1.8s offset
        expect(results[7].confidence).toBeGreaterThan(0.95);
        expect(results[7].offsetSeconds).toBeCloseTo(-1.8, 2);

        // Other non-matching candidates should have lower confidence
        for (let k = 0; k < 20; k++) {
            if (k !== 7) {
                expect(results[k].confidence).toBeLessThan(results[7].confidence);
            }
        }
    });

    it('detects 25.0 FPS to 23.976 FPS frame-rate drift using dual-window verification', () => {
        // Window 1: offset is -1.0s
        const audio1 = createReferenceAudio();
        const sub1 = new Float32Array(N);
        const shift1 = 100; // 1.0s
        for (let i = 0; i < N; i++) {
            if (i - shift1 >= 0 && i - shift1 < N) sub1[i] = audio1[i - shift1];
        }

        // Window 2 at minute 10 (delta = 540 seconds):
        // 25.0 -> 23.976 drift = 540 * (25 - 23.976)/23.976 = ~23.06 seconds
        const driftSeconds = 540 * ((25.0 - 23.976) / 23.976);
        const shift2 = Math.round((1.0 + driftSeconds) * sampleRate);
        const audio2 = createReferenceAudio();
        const sub2 = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            if (i - shift2 >= 0 && i - shift2 < N) sub2[i] = audio2[i - shift2];
        }

        const driftInfo = AcousticFFTMatcher.detectDrift(audio1, audio2, sub1, sub2, 540, 30, sampleRate);
        expect(driftInfo.hasDrift).toBe(true);
        expect(driftInfo.is25to23976Fps).toBe(true);
        expect(driftInfo.recommendedScale).toBeCloseTo(23.976 / 25.0, 3);
    });
});

describe('SubtitleCandidateParser', () => {
    it('parses SRT formatted timestamps and constructs 100 Hz presence vector', () => {
        const srtContent = `
1
00:00:05,000 --> 00:00:09,000
First spoken dialogue

2
00:00:15,500 --> 00:00:20,000
Second spoken sentence
`;

        const vector = SubtitleCandidateParser.parseToPresenceVector(srtContent, 60, 0, 100);
        expect(vector.length).toBe(6000);

        // Before 5s should be silence (0)
        expect(vector[400]).toBe(0);
        // Between 5s and 9s should be active (1)
        expect(vector[500]).toBe(1);
        expect(vector[700]).toBe(1);
        expect(vector[890]).toBe(1);
        // At 12s should be silence
        expect(vector[1200]).toBe(0);
        // At 16s should be active
        expect(vector[1600]).toBe(1);
    });

    it('parses WebVTT formatted timestamps with dots and optional hours', () => {
        const vttContent = `WEBVTT

00:02.000 --> 00:06.500
First VTT cue without hours

01:10:00.000 --> 01:10:05.000
Second cue with hours
`;

        const vector = SubtitleCandidateParser.parseToPresenceVector(vttContent, 10, 0, 100);
        expect(vector.length).toBe(1000);
        expect(vector[100]).toBe(0);
        expect(vector[250]).toBe(1);
        expect(vector[600]).toBe(1);
    });

    it('correctly handles window start offset', () => {
        const srt = `
1
00:00:35,000 --> 00:00:40,000
Dialogue at 35 seconds
`;

        // Probe window [30s, 90s] -> startOffset = 30s
        const vector = SubtitleCandidateParser.parseToPresenceVector(srt, 60, 30, 100);
        // Relative to 30s, 35s is at offset 5s (index 500)
        expect(vector[400]).toBe(0);
        expect(vector[500]).toBe(1);
        expect(vector[950]).toBe(1);
        expect(vector[1100]).toBe(0);
    });

    it('parses and shifts cues', () => {
        const srt = `
1
00:00:10,000 --> 00:00:15,000
Sample dialogue
`;
        const cues = SubtitleCandidateParser.parseCues(srt);
        expect(cues.length).toBe(1);
        expect(cues[0].start).toBe(10);
        expect(cues[0].end).toBe(15);
        expect(cues[0].text).toBe('Sample dialogue');

        const shifted = SubtitleCandidateParser.shiftCues(cues, -2.5);
        expect(shifted[0].start).toBe(7.5);
        expect(shifted[0].end).toBe(12.5);

        const vtt = SubtitleCandidateParser.serializeToVtt(shifted);
        expect(vtt).toContain('WEBVTT');
        expect(vtt).toContain('00:00:07.500 --> 00:00:12.500');
    });
});

describe('AudioVADProbe', () => {
    it('extracts presence vector from PCM channel samples', () => {
        const sampleRate = 16000;
        const durationSeconds = 10;
        const totalSamples = sampleRate * durationSeconds;
        const pcm = new Float32Array(totalSamples);

        // Add 2 seconds of synthetic voice tone between 2s and 4s
        for (let i = sampleRate * 2; i < sampleRate * 4; i++) {
            pcm[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
        }

        const profile = AudioVADProbe.extractVoiceProfileFromPCM(pcm, sampleRate, durationSeconds, 100);
        expect(profile.length).toBe(1000);

        // 1s -> silence
        expect(profile[100]).toBe(0);
        // 3s -> voice active
        expect(profile[300]).toBe(1);
        // 5s -> silence
        expect(profile[500]).toBe(0);
    });
});

describe('SmartSubtitleSelector', () => {
    it('automatically selects and retimes the best add-on subtitle from candidates', async () => {
        // Audio speech profile
        const N = 6000;
        const audio = new Float32Array(N);
        for (let i = 500; i < 900; i++) audio[i] = 1.0;
        for (let i = 1500; i < 2200; i++) audio[i] = 1.0;

        // Candidate 1: completely different timing (Director Cut)
        const srt1 = `
1
00:00:01,000 --> 00:00:03,000
Wrong scene 1

2
00:00:08,000 --> 00:00:10,000
Wrong scene 2
`;

        // Candidate 2: Perfect match delayed by 2.2 seconds (cue at 7.2s and 17.2s)
        const srt2 = `
1
00:00:07,200 --> 00:00:11,200
Dialogue matching first burst

2
00:00:17,200 --> 00:00:24,200
Dialogue matching second burst
`;

        // Candidate 3: Silent or sparse
        const srt3 = `
1
00:00:45,000 --> 00:00:48,000
Late monologue
`;

        const candidates = [
            { id: 'sub-1', name: 'OpenSubtitles #1 (Director Cut)', text: srt1, lang: 'eng' },
            { id: 'sub-2', name: 'OpenSubtitles #2 (Blu-ray 1080p)', text: srt2, lang: 'eng' },
            { id: 'sub-3', name: 'OpenSubtitles #3 (WEB-DL)', text: srt3, lang: 'eng' }
        ];

        const selection = await SmartSubtitleSelector.rankAndSelect(audio, candidates, {
            durationSeconds: 60,
            minConfidence: 0.75
        });

        expect(selection.isAutoSynced).toBe(true);
        expect(selection.bestTrack.id).toBe('sub-2');
        expect(selection.confidence).toBeGreaterThan(0.90);
        // Candidate 2 is delayed by 2.2s, so recommended offset is -2.2s
        expect(selection.recommendedOffset).toBeCloseTo(-2.2, 2);
        expect(selection.executionTimeMs).toBeLessThan(50);
    });

    it('falls back gracefully to first track when correlation is below threshold', async () => {
        const N = 6000;
        const audio = new Float32Array(N);
        for (let i = 500; i < 900; i++) audio[i] = 1.0;

        const unmatchedSrt = `
1
00:00:50,000 --> 00:00:55,000
No overlap
`;

        const candidates = [
            { id: 'sub-default', name: 'Default Subtitle', text: unmatchedSrt, lang: 'eng' }
        ];

        const selection = await SmartSubtitleSelector.rankAndSelect(audio, candidates, {
            minConfidence: 0.80
        });

        expect(selection.isAutoSynced).toBe(false);
        expect(selection.bestTrack.id).toBe('sub-default');
        expect(selection.recommendedOffset).toBe(0);
    });
});
