'use strict';
// Plugin "ai": the AI copilot. Wires the Gemini client + brief + tools + agent + staged actions + routes.
// Without GEMINI_API_KEY the plugin still loads: the chat answers "not set up" and only admins see the button (to set it up).

const { createGemini } = require('./gemini');
const { createStaging } = require('./staging');
const { createBrief } = require('./brief');
const { createTools } = require('./tools');
const { createAgent } = require('./agent');
const { registerAiRoutes } = require('./routes');

function registerAi(app, deps) {
    const { requireProfile, db, tmdb, library, downloadsManager, sentinel, qualityStore, probeMany, region } = deps;
    const gemini = deps.gemini || createGemini({ apiKey: deps.apiKey, model: deps.model });
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

function register(ctx) {
    const s = ctx.services;
    return registerAi(ctx.app, {
        requireProfile: ctx.auth.requireProfile,
        db: { raw: ctx.db.raw, audit: ctx.db.audit },
        tmdb: s.tmdb, library: s.library, downloadsManager: s.downloads, sentinel: s.sentinel, qualityStore: s.quality, probeMany: s.probeMany,
        region: s.region,
        apiKey: ctx.config.get('GEMINI_API_KEY'), model: ctx.config.get('GEMINI_MODEL'),
    });
}

module.exports = { register, registerAi };
