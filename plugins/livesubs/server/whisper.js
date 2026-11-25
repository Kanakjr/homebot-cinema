'use strict';
// Client for a whisper.cpp `whisper-server` (POST /inference, multipart). It runs natively on the host so it can use the
// GPU (Metal on a Mac); the app reaches it over HTTP.

function createWhisperClient({ baseUrl, fetchImpl = fetch, timeoutMs = 120000 }) {
    const base = String(baseUrl || '').replace(/\/+$/, '');

    async function transcribe(wav, { language = 'auto', translate = false } = {}) {
        const form = new FormData();
        form.append('file', new Blob([wav], { type: 'audio/wav' }), 'chunk.wav');
        form.append('response_format', 'verbose_json');
        form.append('language', language || 'auto');
        form.append('temperature', '0');
        if (translate) form.append('translate', 'true');
        const r = await fetchImpl(`${base}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok) throw new Error(`whisper HTTP ${r.status}`);
        const j = await r.json();
        if (j && j.error) throw new Error(`whisper: ${j.error}`);
        return { segments: (j && j.segments) || [], language: (j && (j.detected_language || j.language)) || null };
    }

    async function health() {
        try {
            const r = await fetchImpl(`${base}/`, { signal: AbortSignal.timeout(3000) });
            return r.ok;
        } catch {
            return false;
        }
    }

    return { transcribe, health, baseUrl: base };
}

module.exports = { createWhisperClient };
