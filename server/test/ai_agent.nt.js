'use strict';
// The chat loop with a scripted fake Gemini and fake tools.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgent, MAX_ROUNDS, MAX_MESSAGES, NOT_CONFIGURED, SYSTEM_PROMPT } = require('../ai/agent');

const call = (name, args = {}) => ({ candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] });
const say = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });

function build({ script, run, configured = true, catalog = new Map() }) {
    const seen = [];
    const gemini = {
        configured: () => configured,
        generate: async (req) => { seen.push(JSON.parse(JSON.stringify(req))); const next = typeof script === 'function' ? script(seen.length) : script.shift(); return next; },
    };
    const tools = { declarations: [{ name: 'find_titles' }], run: run || (async () => ({ ok: true })) };
    const brief = { build: async () => ({ text: 'CINEMA BRIEF (live data)\nfake', catalog }) };
    const agent = createAgent({ gemini, tools, brief, staging: {} });
    return { agent, seen };
}
const profile = { id: 1, is_kid: 0 };
const login = { email: 'a@example.com', isAdmin: false };
const user = (content) => ({ role: 'user', content });

test('a tool call is run, its result is sent back, and the final text is returned with the tool trace', async () => {
    const ran = [];
    const { agent, seen } = build({
        script: [call('find_titles', { type: 'movie' }), say('Here you go.')],
        run: async (name, args) => { ran.push({ name, args }); return { titles: [] }; },
    });
    const r = await agent.chat({ messages: [user('something light')], profile, login });
    assert.equal(r.reply, 'Here you go.');
    assert.deepEqual(ran, [{ name: 'find_titles', args: { type: 'movie' } }]);
    assert.deepEqual(r.trace, [{ name: 'find_titles', ok: true }]);
    assert.equal(seen.length, 2);
    assert.match(seen[0].system, /HomeBot Cinema copilot/);
    assert.match(seen[0].system, /CINEMA BRIEF \(live data\)/, 'the brief is in the system prompt every turn');
    const fnResponse = seen[1].contents.at(-1).parts[0].functionResponse;
    assert.equal(fnResponse.name, 'find_titles');
    assert.deepEqual(fnResponse.response.result, { titles: [] });
});

test('a tool that throws becomes an error result the model can read (and the turn still finishes)', async () => {
    const { agent, seen } = build({ script: [call('find_titles'), say('Sorry, TMDB is down.')], run: async () => { throw new Error('tmdb_unreachable'); } });
    const r = await agent.chat({ messages: [user('hi')], profile, login });
    assert.deepEqual(r.trace, [{ name: 'find_titles', ok: false }]);
    assert.deepEqual(seen[1].contents.at(-1).parts[0].functionResponse.response.result, { error: 'tmdb_unreachable' });
    assert.equal(r.reply, 'Sorry, TMDB is down.');
});

test('the loop stops after MAX_ROUNDS model calls', async () => {
    let n = 0;
    const { agent } = build({ script: () => { n++; return call('find_titles'); } });
    const r = await agent.chat({ messages: [user('loop forever')], profile, login });
    assert.equal(n, MAX_ROUNDS);
    assert.match(r.reply, /could not finish/i);
});

test('a reply claiming something was staged, with no successful stage tool, is nudged once and then annotated', async () => {
    const { agent, seen } = build({ script: [say("I've queued the download for you."), say('All done, it is downloading now. I staged it.')] });
    const r = await agent.chat({ messages: [user('download Dune')], profile, login });
    assert.equal(seen.length, 2, 'one nudge');
    assert.match(seen[1].contents.at(-1).parts[0].text, /SYSTEM CHECK/);
    assert.match(r.reply, /nothing was actually staged/i);
});

test('after the nudge the model really stages: no note is added', async () => {
    const { agent } = build({
        script: [say('I staged it for you.'), call('stage_download', { imdb_id: 'tt1', type: 'movie' }), say('Staged for your confirmation.')],
        run: async () => ({ status: 'STAGED_PENDING_USER_CONFIRMATION' }),
    });
    const r = await agent.chat({ messages: [user('download Dune')], profile, login });
    assert.equal(r.reply, 'Staged for your confirmation.');
    assert.doesNotMatch(r.reply, /Note:/);
    assert.deepEqual(r.trace.map((t) => [t.name, t.ok]), [['stage_download', true]]);
});

test('a stage tool that returned an error does not count as staged', async () => {
    const { agent } = build({
        script: [call('stage_download'), say('Done, I have queued it.'), say('Sorry, I could not stage it.')],
        run: async () => ({ error: 'no_live_swarm' }),
    });
    const r = await agent.chat({ messages: [user('download Dune')], profile, login });
    assert.deepEqual(r.trace, [{ name: 'stage_download', ok: false }]);
    assert.equal(r.reply, 'Sorry, I could not stage it.');
});

test('ordinary replies (including talk about what is queued) are left alone', async () => {
    const { agent, seen } = build({ script: [say('Two downloads are queued; Silo is at 40%.')] });
    const r = await agent.chat({ messages: [user("what's downloading?")], profile, login });
    assert.equal(seen.length, 1);
    assert.equal(r.reply, 'Two downloads are queued; Silo is at 40%.');
});

test('only the last MAX_MESSAGES messages are sent, and the conversation always starts with the user', async () => {
    const messages = [];
    for (let i = 0; i < 15; i++) { messages.push(user(`q${i}`), { role: 'assistant', content: `a${i}` }); }
    messages.push(user('latest'));
    const { agent, seen } = build({ script: [say('ok')] });
    await agent.chat({ messages, profile, login });
    const sent = seen[0].contents;
    assert.ok(sent.length <= MAX_MESSAGES);
    assert.equal(sent[0].role, 'user');
    assert.equal(sent.at(-1).parts[0].text, 'latest');
    assert.ok(sent.every((m, i) => i === 0 || m.role !== sent[i - 1].role), 'roles alternate');
});

test('without a key the copilot says it is not set up and Gemini is never called', async () => {
    const { agent, seen } = build({ script: [], configured: false });
    const r = await agent.chat({ messages: [user('hi')], profile, login });
    assert.equal(r.reply, NOT_CONFIGURED);
    assert.equal(r.configured, false);
    assert.equal(seen.length, 0);
});

test('the system prompt keeps the safety rules: stage only, kids, no inventing', () => {
    assert.match(SYSTEM_PROMPT, /only STAGE/);
    assert.match(SYSTEM_PROMPT, /Confirm/);
    assert.match(SYSTEM_PROMPT, /KIDS profile/);
    assert.match(SYSTEM_PROMPT, /Never invent/);
});
