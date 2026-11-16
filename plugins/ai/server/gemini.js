'use strict';
// Minimal Gemini REST client (generateContent with function calling). No SDK: a single fetch.
// The key only ever travels in the x-goog-api-key header, and errors never contain it.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function createGemini({ apiKey, model, fetchImpl, timeoutMs = 30000 } = {}) {
    const key = String(apiKey || '').trim();
    const name = String(model || '').trim() || 'gemini-2.5-flash';
    const doFetch = fetchImpl || ((...a) => fetch(...a));

    const configured = () => key.length > 0;

    /** One model turn. `contents` are Gemini messages, `tools` are function declarations. Returns the parsed response. */
    async function generate({ system, contents, tools }) {
        if (!configured()) throw Object.assign(new Error('gemini_not_configured'), { status: 503 });
        const body = {
            system_instruction: { parts: [{ text: system }] },
            contents,
            tools: [{ function_declarations: tools }],
            generationConfig: { temperature: 0.4 },
        };
        let lastStatus = 0;
        for (let attempt = 1; attempt <= 2; attempt++) {
            let res;
            try {
                res = await doFetch(`${BASE}/${encodeURIComponent(name)}:generateContent`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(timeoutMs),
                });
            } catch (_) {
                if (attempt >= 2) throw Object.assign(new Error('gemini_unreachable'), { status: 502 });
                await new Promise((r) => setTimeout(r, 400));
                continue;
            }
            if (res.ok) return res.json();
            lastStatus = res.status;
            // busy or rate limited: one more try; anything else is final
            if ((res.status === 429 || res.status === 503) && attempt < 2) { await new Promise((r) => setTimeout(r, 800)); continue; }
            break;
        }
        if (lastStatus === 400 || lastStatus === 401 || lastStatus === 403) throw Object.assign(new Error('gemini_rejected'), { status: 502 });
        throw Object.assign(new Error(`gemini_http_${lastStatus}`), { status: 502 });
    }

    return { configured, model: name, generate };
}

module.exports = { createGemini };
