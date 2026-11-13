'use strict';
// The copilot's chat loop (GrowwTrader's chat_with_gemini, for a cinema): brief + tools, at most MAX_ROUNDS model calls,
// and a guard so the reply can never claim something was started when no stage tool succeeded.

const MAX_ROUNDS = 6;
const TURN_BUDGET_MS = 60000;
const MAX_MESSAGES = 20;

const SYSTEM_PROMPT = [
    'You are the HomeBot Cinema copilot, a friendly assistant inside a private home media app: movies and series the family streams or downloads to their own server.',
    'You can recommend titles, answer questions about titles, the server library, downloads and THIS profile\'s watch history, and PREPARE (stage) a download or a monitor.',
    'RULES:',
    '- You can only STAGE a download or a monitor. Nothing happens until the user presses Confirm on the card shown in the chat. Never say anything was downloaded, queued or started: say it is staged for their confirmation. Say that only after stage_download or stage_monitor returned STAGED_PENDING_USER_CONFIRMATION in this turn; if you have not called it yet, call it instead of describing it.',
    '- Use the CINEMA BRIEF first (watch history, server library, downloads). Call tools only for what it lacks.',
    '- Never invent titles, ratings, runtimes, availability or links. Use tool results. If a tool fails or finds nothing, say so plainly.',
    '- When you recommend or mention specific titles, call present_titles with their IMDb ids so the user sees poster cards. The cards already show the titles, so do NOT repeat them as a list: write one or two short sentences of why they fit.',
    '- Titles marked on_server can be played right away: say so, and never offer to download something that is already on the server or already downloading.',
    '- Streaming availability is for the region in the brief. Ratings are TMDB ratings, which differ slightly from IMDb.',
    '- Series downloads are staged one episode at a time. For whole seasons or all future episodes, explain that a monitor (admin only) does that.',
    '- KIDS profile: only child-friendly titles, and never stage anything.',
    '- Be concise and warm. Plain text only: no markdown, no asterisks, no bullet lists, no tables.',
].join('\n');

// A reply that says something was staged / queued / started while no stage tool succeeded this turn.
const CLAIM_RE = /\bstag(?:ed|ing)\b|\bi(?:'|’)?ve (?:queued|started|added|set up|scheduled)\b|\bi have (?:queued|started|added|set up|scheduled)\b|\b(?:download|monitor(?:ing)?)(?: has| is| will be)? (?:now )?(?:started|begun|queued|enabled|on)\b|\b(?:started|queued|added) (?:the |your )?download/i;

const NOT_CONFIGURED = 'The copilot is not set up yet: an admin needs to add GEMINI_API_KEY to the server settings.';

function createAgent({ gemini, tools, brief, staging, now = () => Date.now() }) {
    /** messages: [{ role: 'user' | 'assistant', content }] already validated by the route. */
    async function chat({ messages, profile, login }) {
        if (!gemini.configured()) return { reply: NOT_CONFIGURED, titles: [], staged: [], trace: [], configured: false };

        const { text: briefText, catalog } = await brief.build({ profile, login });
        const system = `${SYSTEM_PROMPT}\n\n${briefText}`;
        let history = messages.slice(-MAX_MESSAGES);
        while (history.length && history[0].role !== 'user') history = history.slice(1);
        const contents = history.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));

        const ctx = { profile, login, kids: !!profile.is_kid, catalog, known: new Set(catalog.keys()), titles: [], staged: [] };
        const trace = [];
        const started = now();
        let text = '';
        let nudged = false;
        let finished = false;

        for (let round = 0; round < MAX_ROUNDS && !finished; round++) {
            if (round > 0 && now() - started > TURN_BUDGET_MS) break;
            const data = await gemini.generate({ system, contents, tools: tools.declarations });
            const parts = ((data.candidates || [])[0] || {}).content?.parts || [];
            const calls = parts.filter((p) => p.functionCall);
            text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');

            if (!calls.length) {
                const claims = CLAIM_RE.test(text);
                const stagedOk = trace.some((t) => /^stage_/.test(t.name) && t.ok);
                if (claims && !stagedOk && !nudged) {
                    nudged = true;
                    contents.push({ role: 'model', parts: parts.length ? parts : [{ text }] });
                    contents.push({ role: 'user', parts: [{ text: 'SYSTEM CHECK: your reply says something was staged, queued or started, but no stage tool succeeded this turn. If the user asked for a download or a monitor, call stage_download or stage_monitor now. Otherwise restate your answer without claiming that anything was staged.' }] });
                    continue;
                }
                if (claims && !stagedOk) text += '\n\n(Note: nothing was actually staged, so there is nothing waiting for your confirmation.)';
                finished = true;
                break;
            }

            contents.push({ role: 'model', parts });
            const responses = [];
            for (const p of calls) {
                const { name, args } = p.functionCall;
                let result;
                try {
                    result = await tools.run(name, args || {}, ctx);
                } catch (e) {
                    console.warn(`[AI] tool ${name} failed: ${e.message}`);
                    result = { error: String(e.message || 'tool failed').slice(0, 200) };
                }
                trace.push({ name, ok: !(result && result.error) });
                responses.push({ functionResponse: { name, response: { result } } });
            }
            contents.push({ role: 'user', parts: responses });
        }
        if (!finished && !text) text = 'I could not finish that request. Please try again.';
        return { reply: text.trim(), titles: ctx.titles, staged: ctx.staged, trace, configured: true };
    }

    return { chat };
}

module.exports = { createAgent, SYSTEM_PROMPT, CLAIM_RE, MAX_ROUNDS, MAX_MESSAGES, NOT_CONFIGURED };
