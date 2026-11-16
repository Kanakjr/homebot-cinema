'use strict';
// Plugin "telegram": forwards the core "notify" hook to a Telegram chat. Needs TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.

const https = require('https');

/** Markdown (legacy) text for one notification. */
function format({ title, text }) {
    const esc = (s) => String(s || '').replace(/([_*`[])/g, '\\$1');
    return title ? `*${esc(title)}*\n${esc(text)}` : esc(text);
}

function defaultSend({ token, chatId, text }) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });
        const req = https.request({
            hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`, method: 'POST', timeout: 10000,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, (res) => { res.resume(); res.on('end', () => (res.statusCode < 300 ? resolve() : reject(new Error(`HTTP ${res.statusCode}`)))); });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        req.end(body);
    });
}

function register(ctx, { send = defaultSend } = {}) {
    const token = ctx.config.get('TELEGRAM_BOT_TOKEN');
    const chatId = ctx.config.get('TELEGRAM_CHAT_ID');
    if (!token || !chatId) return ctx.disable('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set');
    ctx.hooks.on('notify', async (n) => {
        await send({ token, chatId, text: format(n || {}) });
    });
    return {};
}

module.exports = { register, format };
