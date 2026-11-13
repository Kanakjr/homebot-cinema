'use strict';
// Wires the AI copilot: Gemini client + brief + tools + agent + staged actions + routes.
// Off (the chat answers "not set up") until GEMINI_API_KEY is configured.

const { createGemini } = require('./gemini');
const { createStaging } = require('./staging');
const { createBrief } = require('./brief');
const { createTools } = require('./tools');
const { createAgent } = require('./agent');
const { registerAiRoutes } = require('./routes');

function registerAi(app, deps) {
    const { requireProfile, db, tmdb, library, downloadsManager, sentinel, qualityStore, probeMany, region } = deps;
    const gemini = deps.gemini || createGemini({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL });
    const staging = createStaging();
    const brief = createBrief({ raw: db.raw, library, downloadsManager, sentinel, qualityStore, staging, region });
    const tools = createTools({
        tmdb, library, downloadsManager, sentinel, qualityStore, staging, probeMany, region,
        fetchStreams: (type, videoId) => sentinel.fetchStreams(type, videoId),
        fetchMeta: async (type, imdbId) => ((await sentinel.fetchJson(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`)) || {}).meta,
        history: brief.history,
    });
    const agent = createAgent({ gemini, tools, brief, staging });
    registerAiRoutes(app, { requireProfile, gemini, agent, staging, downloadsManager, sentinel, db });
    return { gemini, staging, agent };
}

module.exports = { registerAi };
