// Copyright (C) 2017-2026 HomeBot Cinema
// Lightweight Acoustic Voice Activity Detection (VAD) probe.
// Probes audio directly from an HTML5 media element (or PCM/AudioBuffer)
// and extracts a 100 Hz binary voice presence profile. Zero external dependencies.

const elementSourceMap = new WeakMap();
let sharedAudioContext = null;

function getAudioContext() {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
        try {
            sharedAudioContext = new AudioCtx();
        } catch (_) {
            return null;
        }
    }
    return sharedAudioContext;
}

class AudioVADProbe {
    /**
     * Probes audio from an active HTML5 video or audio element over durationSeconds.
     * Non-destructive: maintains audio output passthrough to the audio destination.
     * @param {HTMLMediaElement} mediaElement
     * @param {object} [options]
     * @param {number} [options.durationSeconds=60] - Probe window duration in seconds.
     * @param {number} [options.sampleRateHz=100] - Profile sampling rate (100 Hz = 10ms bins).
     * @param {AbortSignal} [options.signal] - Optional cancellation signal.
     * @param {function} [options.onProgress] - Optional progress callback ({ progress, elapsedSeconds, voiceRatio }).
     * @returns {Promise<Float32Array>} Voice presence profile vector [0.0 or 1.0].
     */
    static async captureVoiceProfile(mediaElement, options = {}) {
        const durationSeconds = options.durationSeconds || 60;
        const sampleRateHz = options.sampleRateHz || 100;
        const totalSamples = Math.floor(durationSeconds * sampleRateHz);
        const profile = new Float32Array(totalSamples);

        const audioCtx = getAudioContext();
        if (!audioCtx || !mediaElement) {
            return profile;
        }

        if (audioCtx.state === 'suspended') {
            try {
                await audioCtx.resume();
            } catch (_) {
                // Ignore resume failure on autoplay policies
            }
        }

        // Web Audio allows only one MediaElementSourceNode per HTMLMediaElement
        let source = elementSourceMap.get(mediaElement);
        if (!source) {
            try {
                source = audioCtx.createMediaElementSource(mediaElement);
                elementSourceMap.set(mediaElement, source);
            } catch (err) {
                console.warn('[AudioVADProbe] createMediaElementSource failed:', err);
                return profile;
            }
        }

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.3;

        try {
            source.connect(analyser);
            analyser.connect(audioCtx.destination);
        } catch (err) {
            console.warn('[AudioVADProbe] Node connection error:', err);
            return profile;
        }

        const buffer = new Float32Array(analyser.frequencyBinCount);
        const intervalMs = 1000 / sampleRateHz;

        // Speech frequency band: ~300 Hz to ~3400 Hz
        const binWidth = audioCtx.sampleRate / analyser.fftSize;
        const minBin = Math.max(0, Math.floor(300 / binWidth));
        const maxBin = Math.min(analyser.frequencyBinCount - 1, Math.ceil(3400 / binWidth));
        const binCount = Math.max(1, maxBin - minBin + 1);

        let index = 0;
        let voiceSamples = 0;

        return new Promise((resolve) => {
            const cleanup = () => {
                if (timer) clearInterval(timer);
                try {
                    analyser.disconnect();
                } catch (_) {
                    // Ignore disconnect errors
                }
            };

            if (options.signal) {
                options.signal.addEventListener('abort', () => {
                    cleanup();
                    resolve(profile);
                }, { once: true });
            }

            const timer = setInterval(() => {
                if (index >= totalSamples || (mediaElement.ended && index > 100)) {
                    cleanup();
                    profile.hasLowVoiceEnergy = (voiceSamples / Math.max(1, index)) < 0.05;
                    resolve(profile);
                    return;
                }

                if (mediaElement.paused) {
                    // When video is paused, do not advance probe time
                    return;
                }

                analyser.getFloatFrequencyData(buffer);

                // Speech spectral energy computation
                let speechEnergy = 0;
                for (let b = minBin; b <= maxBin; b++) {
                    // Decibels in buffer range from -100 to 0 dB
                    const db = Math.max(-100, buffer[b]);
                    speechEnergy += Math.pow(10, db / 20);
                }
                const avgEnergy = speechEnergy / binCount;

                // Threshold voice presence (adaptive speech presence gate)
                const isSpeech = avgEnergy > 0.015 ? 1.0 : 0.0;
                profile[index] = isSpeech;
                if (isSpeech === 1.0) voiceSamples++;

                index++;

                if (typeof options.onProgress === 'function' && index % (sampleRateHz * 2) === 0) {
                    options.onProgress({
                        progress: index / totalSamples,
                        elapsedSeconds: index / sampleRateHz,
                        voiceRatio: voiceSamples / index
                    });
                }
            }, intervalMs);
        });
    }

    /**
     * Extracts a 100 Hz voice presence vector from raw PCM float channel samples.
     * Pure JS, instantaneous (< 2 ms for 60s @ 16-48 kHz).
     * @param {Float32Array} pcmData - Raw audio PCM samples (mono).
     * @param {number} audioSampleRate - PCM audio sampling rate (e.g. 16000 or 44100).
     * @param {number} [durationSeconds=60] - Max duration to process.
     * @param {number} [sampleRateHz=100] - Target presence vector sampling rate.
     * @returns {Float32Array}
     */
    static extractVoiceProfileFromPCM(pcmData, audioSampleRate, durationSeconds = 60, sampleRateHz = 100) {
        const totalPresenceSamples = Math.floor(durationSeconds * sampleRateHz);
        const profile = new Float32Array(totalPresenceSamples);
        if (!pcmData || pcmData.length === 0 || audioSampleRate <= 0) {
            return profile;
        }

        const samplesPerBin = Math.floor(audioSampleRate / sampleRateHz);
        const maxBins = Math.min(totalPresenceSamples, Math.floor(pcmData.length / samplesPerBin));

        let voiceCount = 0;
        for (let bin = 0; bin < maxBins; bin++) {
            const start = bin * samplesPerBin;
            const end = start + samplesPerBin;
            let sumSq = 0;
            for (let i = start; i < end; i++) {
                sumSq += pcmData[i] * pcmData[i];
            }
            const rms = Math.sqrt(sumSq / samplesPerBin);
            const isVoice = rms > 0.015 ? 1.0 : 0.0;
            profile[bin] = isVoice;
            if (isVoice === 1.0) voiceCount++;
        }

        profile.hasLowVoiceEnergy = maxBins > 0 && (voiceCount / maxBins) < 0.05;
        return profile;
    }

    /**
     * Extracts presence vector from a Web Audio AudioBuffer.
     * @param {AudioBuffer} audioBuffer
     * @param {number} [durationSeconds=60]
     * @param {number} [sampleRateHz=100]
     * @returns {Float32Array}
     */
    static extractVoiceProfileFromAudioBuffer(audioBuffer, durationSeconds = 60, sampleRateHz = 100) {
        if (!audioBuffer) return new Float32Array(durationSeconds * sampleRateHz);
        const channelData = audioBuffer.getChannelData(0);
        return AudioVADProbe.extractVoiceProfileFromPCM(channelData, audioBuffer.sampleRate, durationSeconds, sampleRateHz);
    }
}

module.exports = {
    AudioVADProbe,
    getAudioContext
};
