// HomeBot Cinema Sentinel: Sonarr-Style TV Series Library Auto-Downloader
const fs = require('fs');
const path = require('path');
const https = require('https');
const { pickBest } = require('./grabber/quality');
const { buildMagnet } = require('./grabber/magnet');
const { chooseLive } = require('./grabber/swarm_probe');
const { reconcile, markSkipped, clearSkipped, tagOf, parseTag, normalizeScope, inScope, scopeLabel } = require('./sentinel_state');
const http = require('http');

class SentinelDaemon {
    constructor(downloadsManager, dataPath = path.resolve(__dirname, '../data')) {
        this.downloadsManager = downloadsManager;
        this.dataPath = dataPath;
        this.monitoredFile = path.join(dataPath, 'monitored_series.json');
        this.monitored = this.loadMonitored();
        this.telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
        this.telegramChatId = process.env.TELEGRAM_CHAT_ID || '';
        this.intervalHandle = null;
        this.library = null;
    }

    loadMonitored() {
        if (fs.existsSync(this.monitoredFile)) {
            try {
                return JSON.parse(fs.readFileSync(this.monitoredFile, 'utf8'));
            } catch (e) {
                console.error('[Sentinel] Error reading monitored_series.json:', e);
            }
        }
        return {};
    }

    saveMonitored() {
        try {
            const tmpFile = `${this.monitoredFile}.tmp`;
            fs.writeFileSync(tmpFile, JSON.stringify(this.monitored, null, 2), 'utf8');
            fs.renameSync(tmpFile, this.monitoredFile);
        } catch (e) {
            console.error('[Sentinel] Error saving monitored_series.json:', e);
        }
    }

    start(intervalMs = 2 * 60 * 60 * 1000) {
        if (this.intervalHandle) clearInterval(this.intervalHandle);
        console.log('[Sentinel] Auto-downloader daemon started (interval: 2h)');
        // Run first check after 30 seconds
        setTimeout(() => this.checkAllMonitored(), 30000);
        this.intervalHandle = setInterval(() => this.checkAllMonitored(), intervalMs);
    }

    stop() {
        if (this.intervalHandle) clearInterval(this.intervalHandle);
        this.intervalHandle = null;
    }

    /**
     * Base URL of the Stremio stream addon that Sentinel and the copilot ask for release candidates: STREAM_ADDON_URL, either the
     * addon's base ("https://addon.example.com") or the install link you would paste into Stremio (".../manifest.json", config
     * path included). Nothing is hardcoded: you choose the source, and without one nothing is fetched.
     */
    streamAddonBase() {
        const raw = String(process.env.STREAM_ADDON_URL || '').trim().replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
        return /^https?:\/\/[^\s]+$/i.test(raw) ? raw : '';
    }

    /** Release candidates for a video id ("tt…" for a movie, "tt…:S:E" for an episode), the same source Sentinel uses. */
    async fetchStreams(type, videoId) {
        const base = this.streamAddonBase();
        if (!base) {
            if (!this.warnedNoStreamAddon) { this.warnedNoStreamAddon = true; console.warn('[Sentinel] STREAM_ADDON_URL is not set: there is no stream addon to ask for releases, so nothing is fetched.'); }
            return [];
        }
        const res = await this.fetchJson(`${base}/stream/${type}/${videoId}.json`);
        return (res && res.streams) || [];
    }

    // HTTP GET Helper with JSON parsing
    fetchJson(url) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            client.get(url, { headers: { 'User-Agent': 'HomeBot-Cinema/2.0' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return this.fetchJson(res.headers.location).then(resolve).catch(reject);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
                }
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                });
            }).on('error', reject);
        });
    }

    // Send Telegram alert
    async sendTelegramNotification(message) {
        if (!this.telegramToken || !this.telegramChatId) return;
        try {
            const postData = JSON.stringify({
                chat_id: this.telegramChatId,
                text: message,
                parse_mode: 'Markdown'
            });

            const req = https.request({
                hostname: 'api.telegram.org',
                path: `/bot${this.telegramToken}/sendMessage`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            });
            req.on('error', (err) => console.warn('[Sentinel] Telegram alert failed:', err.message));
            req.write(postData);
            req.end();
        } catch (e) {
            console.warn('[Sentinel] Telegram alert exception:', e.message);
        }
    }

    // Add or update monitored series
    setGrabber(grabber) {
        this.grabber = grabber;
    }

    // The server library is the source of truth for what is really on disk.
    setLibrary(library) {
        this.library = library;
    }

    // A download for this episode is running, or finished AND its file is still there.
    // (downloads.json keeps "completed" records for files that were deleted later, so the record alone proves nothing.)
    isActive(mediaId) {
        for (const rec of Object.values(this.downloadsManager.downloads || {})) {
            if (rec.mediaId !== mediaId) continue;
            if (rec.status === 'completed') return !!rec.filePath && fs.existsSync(rec.filePath);
            return true;
        }
        return false;
    }

    // Episodes recorded as downloaded whose files have disappeared (deleted by hand) are moved to "skipped":
    // no longer counted as downloaded, and not silently fetched again.
    async reconcileItem(item) {
        if (!this.library) return [];
        const last = this.library.status.finishedAt ? Date.parse(this.library.status.finishedAt) : 0;
        if (Date.now() - last > 60 * 1000) await this.library.scan(); // fresh look at the disk
        if (!this.library.scanTrusted()) return []; // never judge from a failed scan or an unmounted drive
        const lib = this.library.getByImdb(item.imdbId);
        const onDisk = new Set();
        for (const s of (lib && lib.seasons) || []) {
            for (const e of s.episodes) if (e.episode !== null && e.episode !== undefined) onDisk.add(tagOf(s.season, e.episode));
        }
        const removed = reconcile(item, {
            onDisk,
            active: (tag) => {
                const p = parseTag(tag);
                return !!p && this.isActive(`${item.imdbId}:${p.season}:${p.episode}`);
            }
        });
        if (removed.length) {
            this.saveMonitored();
            console.log(`[Sentinel] "${item.title}": ${removed.length} episode(s) no longer on disk (${removed.slice(0, 4).join(', ')}${removed.length > 4 ? ', …' : ''}); not re-downloading unless asked`);
        }
        return removed;
    }

    // An admin deleted this episode in the library: remember it was intentional.
    markEpisodeRemoved(imdbId, season, episode) {
        const item = this.monitored[imdbId];
        if (!item) return false;
        markSkipped(item, tagOf(season, episode));
        this.saveMonitored();
        return true;
    }

    // "Re-download": forget the skips (all, or one season) and look for those episodes again.
    redownload(imdbId, season) {
        const item = this.monitored[imdbId];
        if (!item) throw Object.assign(new Error('not_monitored'), { status: 404 });
        const cleared = clearSkipped(item, season);
        this.saveMonitored();
        if (cleared.length) setTimeout(() => this.checkSeries(imdbId), 1000);
        return cleared;
    }

    // scope: what may be downloaded (see sentinel_state). Omitted = keep the existing scope; a brand-new monitor defaults to
    // "new episodes only" so switching Sentinel on can never queue a whole back catalog by surprise.
    addMonitored({ imdbId, title, poster, quality = '1080p', profileId, scope }) {
        if (!imdbId) throw new Error('imdbId is required');
        const keptScope = this.monitored[imdbId] ? this.monitored[imdbId].scope : undefined;
        const finalScope = scope !== undefined ? normalizeScope(scope) : (keptScope || (this.monitored[imdbId] ? { mode: 'all' } : normalizeScope({ mode: 'new' })));
        this.monitored[imdbId] = {
            imdbId,
            title: title || imdbId,
            poster: poster || null,
            quality: quality || '1080p',
            // quality profile (null = the default profile); replaces the old hard-coded 1080p rule
            profileId: profileId === undefined ? (this.monitored[imdbId]?.profileId ?? null) : profileId,
            scope: finalScope,
            monitored: true,
            downloadedEpisodes: this.monitored[imdbId]?.downloadedEpisodes || [],
            skippedEpisodes: this.monitored[imdbId]?.skippedEpisodes || [],
            downloadedAt: this.monitored[imdbId]?.downloadedAt || {},
            addedAt: this.monitored[imdbId]?.addedAt || new Date().toISOString(),
            lastChecked: null
        };
        this.saveMonitored();
        console.log(`[Sentinel] Monitored series registered: "${title}" (${imdbId}), ${scopeLabel(finalScope)}`);
        // Trigger quick check in background
        setTimeout(() => this.checkSeries(imdbId), 1000);
        return this.monitored[imdbId];
    }

    removeMonitored(imdbId) {
        if (this.monitored[imdbId]) {
            delete this.monitored[imdbId];
            this.saveMonitored();
            return true;
        }
        return false;
    }

    getMonitored() {
        return Object.values(this.monitored).map((item) => {
            let onDiskEpisodes = null;
            if (this.library) {
                const lib = this.library.getByImdb(item.imdbId);
                onDiskEpisodes = lib && lib.seasons ? lib.seasons.reduce((a, s) => a + s.episodes.length, 0) : 0;
            }
            const scope = item.scope || { mode: 'all' };
            return { ...item, scope, scopeLabel: scopeLabel(scope), onDiskEpisodes, skippedCount: (item.skippedEpisodes || []).length };
        });
    }

    // Check a single monitored series
    async checkSeries(imdbId) {
        const item = this.monitored[imdbId];
        if (!item || !item.monitored) return { checked: false };

        console.log(`[Sentinel] Checking series: "${item.title}" (${imdbId})...`);
        const now = new Date();
        const queuedEpisodes = [];

        await this.reconcileItem(item); // forget episodes whose files were deleted

        try {
            // 1. Fetch metadata from Cinemeta
            const metaRes = await this.fetchJson(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
            const meta = metaRes.meta;
            if (!meta || !Array.isArray(meta.videos)) {
                console.warn(`[Sentinel] No videos found for ${imdbId}`);
                return { checked: false, error: 'No video metadata' };
            }

            // 2. Filter for aired episodes
            for (const ep of meta.videos) {
                const season = ep.season;
                const episode = ep.number || ep.episode;
                if (!season || !episode) continue;

                const epTag = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
                const mediaId = `${imdbId}:${season}:${episode}`;

                // Check air date if available
                if (ep.released) {
                    const releaseDate = new Date(ep.released);
                    if (releaseDate > now) {
                        // Future episode not yet aired
                        continue;
                    }
                }

                // outside what this monitor was asked to fetch (other seasons, or the back catalog in "new only" mode)
                if (!inScope(item.scope, season, ep.released)) continue;

                // Removed on purpose (deleted from disk): never fetched again unless the user asks ("Re-download")
                if ((item.skippedEpisodes || []).includes(epTag)) continue;
                if (item.downloadedEpisodes.includes(epTag)) continue;

                // A download for it is running, or finished and its file is still there
                if (this.isActive(mediaId)) {
                    item.downloadedEpisodes.push(epTag);
                    continue;
                }

                // Episode has aired and is not yet downloaded -> Auto-fetch stream!
                console.log(`[Sentinel] Found missing episode: ${item.title} ${epTag}! Scraping streams...`);
                try {
                    const streams = await this.fetchStreams('series', `${imdbId}:${season}:${episode}`);
                    if (streams.length === 0) {
                        console.log(`[Sentinel] No streams available yet for ${epTag}`);
                        continue;
                    }

                    // Pick the best release under this show's quality profile. If nothing fits we wait and retry
                    // on the next scan instead of grabbing an arbitrary fallback (cam rips, 80 GB remuxes, ...).
                    const profile = this.grabber ? this.grabber.resolve(item.profileId) : null;
                    if (!profile) throw new Error('quality profiles are not configured');
                    const pick = pickBest(profile.config, streams, 'series');
                    if (!pick.picked) {
                        console.log(`[Sentinel] ${epTag}: no release fits "${profile.name}" yet (${streams.length} checked); will retry`);
                        continue;
                    }
                    // ...and only one whose swarm is alive; otherwise wait and retry on the next scan instead of queueing a stuck download
                    if (this.grabber.probeMany) {
                        const live = await chooseLive(pick, this.grabber.probeMany);
                        if (!live.picked) {
                            console.log(`[Sentinel] ${epTag}: the best releases have no live swarm right now (${live.checked} checked); will retry`);
                            continue;
                        }
                        pick.picked = live.picked;
                    }
                    const selectedStream = pick.picked.stream;
                    const magnet = buildMagnet(selectedStream, `${item.title} ${epTag}`);

                    if (magnet) {
                        const dlRecord = await this.downloadsManager.addDownload({
                            magnet,
                            mediaId,
                            imdbId,
                            title: `${item.title} - ${epTag}`,
                            type: 'series',
                            season,
                            episode,
                            poster: item.poster || meta.poster,
                            showTitle: item.title
                        });

                        item.downloadedEpisodes.push(epTag);
                        (item.downloadedAt = item.downloadedAt || {})[epTag] = new Date().toISOString();
                        queuedEpisodes.push({ epTag, title: dlRecord.title });

                        // Send Telegram push notification
                        await this.sendTelegramNotification(
                            `🍿 *HomeBot Cinema Sentinel*\n` +
                            `Auto-downloading new episode:\n` +
                            `*Show:* ${item.title}\n` +
                            `*Episode:* ${epTag} ("${ep.title || 'Episode ' + episode}")\n` +
                            `*Target:* HomeServer Cinema SSD`
                        );
                    }
                } catch (scrapeErr) {
                    console.warn(`[Sentinel] Scrape stream failed for ${epTag}:`, scrapeErr.message);
                }
            }

            item.lastChecked = new Date().toISOString();
            this.saveMonitored();

            return { checked: true, queuedCount: queuedEpisodes.length, queuedEpisodes };
        } catch (err) {
            console.error(`[Sentinel] Error checking ${imdbId}:`, err);
            return { checked: false, error: err.message };
        }
    }

    async checkAllMonitored() {
        console.log('[Sentinel] Running periodic scan across all monitored series...');
        const results = [];
        for (const imdbId of Object.keys(this.monitored)) {
            try {
                const res = await this.checkSeries(imdbId);
                results.push({ imdbId, res });
            } catch (e) {
                console.error(`[Sentinel] Check series ${imdbId} failed:`, e);
            }
        }
        return results;
    }
}

module.exports = SentinelDaemon;
