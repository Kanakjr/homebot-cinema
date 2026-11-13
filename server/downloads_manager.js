// HomeBot Cinema Downloads Manager
const fs = require('fs');
const path = require('path');
const { isInsideRoots } = require('./media_paths');
const TransmissionClient = require('./transmission');

class DownloadsManager {
    constructor(dataPath = path.resolve(__dirname, '../data')) {
        this.dataPath = dataPath;
        this.downloadsFile = path.join(dataPath, 'downloads.json');
        this.monitoredFile = path.join(dataPath, 'monitored_series.json');
        this.transmission = new TransmissionClient();

        // Ensure data path exists
        if (!fs.existsSync(this.dataPath)) {
            fs.mkdirSync(this.dataPath, { recursive: true });
        }

        this.downloads = this.loadDownloads();
        this.monitored = this.loadMonitored();
    }

    loadDownloads() {
        if (fs.existsSync(this.downloadsFile)) {
            try {
                return JSON.parse(fs.readFileSync(this.downloadsFile, 'utf8'));
            } catch (e) {
                console.error('[DownloadsManager] Error reading downloads.json:', e);
            }
        }
        return {};
    }

    saveDownloads() {
        try {
            const tmpFile = `${this.downloadsFile}.tmp`;
            fs.writeFileSync(tmpFile, JSON.stringify(this.downloads, null, 2), 'utf8');
            fs.renameSync(tmpFile, this.downloadsFile);
        } catch (e) {
            console.error('[DownloadsManager] Error saving downloads.json:', e);
        }
    }

    loadMonitored() {
        if (fs.existsSync(this.monitoredFile)) {
            try {
                return JSON.parse(fs.readFileSync(this.monitoredFile, 'utf8'));
            } catch (e) {
                console.error('[DownloadsManager] Error reading monitored_series.json:', e);
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
            console.error('[DownloadsManager] Error saving monitored_series.json:', e);
        }
    }

    // Find main video file in a torrent or directory
    findMainVideoFile(baseDir, files) {
        const videoExtensions = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v'];
        
        if (Array.isArray(files) && files.length > 0) {
            // Sort by file length descending to find the actual movie/episode
            const sorted = [...files].sort((a, b) => (b.length || 0) - (a.length || 0));
            for (const file of sorted) {
                const ext = path.extname(file.name).toLowerCase();
                if (videoExtensions.includes(ext)) {
                    const fullPath = path.join(baseDir, file.name);
                    if (fs.existsSync(fullPath)) return fullPath;
                }
            }
        }

        // If baseDir itself is a file
        if (fs.existsSync(baseDir)) {
            const stat = fs.statSync(baseDir);
            if (stat.isFile()) return baseDir;
            if (stat.isDirectory()) {
                const entries = fs.readdirSync(baseDir, { recursive: true });
                let largestFile = null;
                let largestSize = 0;
                for (const entry of entries) {
                    const entryPath = path.join(baseDir, entry);
                    try {
                        const s = fs.statSync(entryPath);
                        if (s.isFile() && videoExtensions.includes(path.extname(entry).toLowerCase())) {
                            if (s.size > largestSize) {
                                largestSize = s.size;
                                largestFile = entryPath;
                            }
                        }
                    } catch (_) {}
                }
                return largestFile;
            }
        }
        return null;
    }

    // Add a new download task
    async addDownload({ magnet, mediaId, imdbId, title, showTitle, type = 'movie', season, episode, poster, year }) {
        if (!magnet) {
            throw new Error('Magnet or torrent URL is required');
        }

        let downloadDir = '/downloads/complete';
        if (type === 'movie' && fs.existsSync('/Movies')) {
            downloadDir = '/Movies';
        } else if (type === 'series' && fs.existsSync('/TV')) {
            // one folder per show: /TV/<Show>/Season NN (not one folder per episode)
            const safeTitle = (showTitle || title || 'Show').replace(/[^a-zA-Z0-9 ._-]/g, '').trim() || 'Show';
            const seasonFolder = `Season ${String(season || 1).padStart(2, '0')}`;
            downloadDir = path.join('/TV', safeTitle, seasonFolder);
            try {
                fs.mkdirSync(downloadDir, { recursive: true });
            } catch (_) {}
        }

        const tResult = await this.transmission.addTorrent({
            filename: magnet,
            downloadDir
        });

        const torrentId = tResult.id;
        const hashString = tResult.hashString;
        const recordId = `dl_${hashString || Date.now()}`;

        const record = {
            id: recordId,
            torrentId,
            hashString,
            mediaId: mediaId || (type === 'series' ? `${imdbId}:${season}:${episode}` : imdbId),
            imdbId: imdbId || null,
            title: title || tResult.name || 'Unknown Media',
            type,
            season: season != null ? Number(season) : null,
            episode: episode != null ? Number(episode) : null,
            poster: poster || null,
            year: year || null,
            downloadDir,
            status: 'downloading',
            progress: 0,
            rateDownload: 0,
            rateUpload: 0,
            totalSize: 0,
            eta: -1,
            filePath: null,
            addedAt: new Date().toISOString(),
            completedAt: null
        };

        this.downloads[recordId] = record;
        this.saveDownloads();

        console.log(`[DownloadsManager] Added download: "${record.title}" (ID: ${recordId}, Torrent: ${torrentId})`);
        return record;
    }

    // List all downloads and synchronize with Transmission
    async listDownloads() {
        let activeTorrents = [];
        try {
            activeTorrents = await this.transmission.getTorrents();
        } catch (e) {
            console.warn('[DownloadsManager] Transmission RPC unavailable:', e.message);
        }

        const torrentsMap = new Map();
        for (const t of activeTorrents) {
            torrentsMap.set(t.id, t);
            if (t.hashString) torrentsMap.set(t.hashString, t);
        }

        let hasChanges = false;
        const activeList = [];
        const completedList = [];

        for (const id of Object.keys(this.downloads)) {
            const item = this.downloads[id];
            const live = torrentsMap.get(item.torrentId) || (item.hashString ? torrentsMap.get(item.hashString) : null);

            if (live) {
                item.progress = live.percentDone != null ? Number(live.percentDone) : item.progress;
                item.rateDownload = live.rateDownload || 0;
                item.rateUpload = live.rateUpload || 0;
                item.totalSize = live.totalSize || item.totalSize;
                item.eta = live.eta >= 0 ? live.eta : -1;
                item.torrentId = live.id;

                // Status mapping: 0=Stopped, 4=Downloading, 6=Seeding
                if (live.status === 0) {
                    item.status = live.percentDone >= 1 ? 'completed' : 'paused';
                } else if (live.percentDone >= 1 || live.isFinished || live.status === 6) {
                    item.status = 'completed';
                    if (!item.completedAt) item.completedAt = new Date().toISOString();
                } else {
                    item.status = 'downloading';
                }

        // Check for file path
                if (!item.filePath || !fs.existsSync(item.filePath)) {
                    const resolved = this.findMainVideoFile(live.downloadDir, live.files);
                    if (resolved) {
                        item.filePath = resolved;
                        hasChanges = true;
                    }
                }

                // If completed and MP4 exists or needs remux
                if (item.status === 'completed' && item.filePath) {
                    const ext = path.extname(item.filePath).toLowerCase();
                    if (ext === '.mkv' || ext === '.avi') {
                        const mp4Path = item.filePath.replace(/\.(mkv|avi)$/i, '.mp4');
                        if (fs.existsSync(mp4Path)) {
                            item.filePath = mp4Path;
                            hasChanges = true;
                        } else {
                            this.remuxToFaststartMp4(item.filePath);
                        }
                    }
                }
            } else {
                // If not in Transmission anymore, verify file exists on disk
                if (item.filePath && fs.existsSync(item.filePath)) {
                    item.status = 'completed';
                    item.progress = 1;
                } else {
                    item.status = 'missing';
                }
            }

            if (item.status === 'completed') {
                completedList.push(item);
            } else {
                activeList.push(item);
            }
        }

        if (hasChanges) {
            this.saveDownloads();
        }

        // Also discover any pre-existing files in /Movies and /TV not tracked yet
        const localDiscovered = this.discoverLocalLibrary();

        // Disk stats
        const disk = this.getDiskStats();

        return {
            active: activeList,
            completed: completedList,
            localDiscovered,
            disk
        };
    }

    // Discover existing movies and TV shows from host volumes
    discoverLocalLibrary() {
        const discovered = [];
        const videoExtensions = ['.mp4', '.mkv', '.webm'];

        // 1. Scan /Movies
        if (fs.existsSync('/Movies')) {
            try {
                const items = fs.readdirSync('/Movies');
                for (const item of items) {
                    if (item.startsWith('.')) continue;
                    const itemPath = path.join('/Movies', item);
                    const stat = fs.statSync(itemPath);
                    if (stat.isFile() && videoExtensions.includes(path.extname(item).toLowerCase())) {
                        discovered.push({
                            id: `local_mov_${Buffer.from(item).toString('hex').slice(0, 16)}`,
                            title: item.replace(/\.[^/.]+$/, '').replace(/[._]/g, ' '),
                            type: 'movie',
                            filePath: itemPath,
                            size: stat.size,
                            modifiedAt: stat.mtime.toISOString()
                        });
                    } else if (stat.isDirectory()) {
                        const mainVideo = this.findMainVideoFile(itemPath, null);
                        if (mainVideo) {
                            const vStat = fs.statSync(mainVideo);
                            discovered.push({
                                id: `local_mov_${Buffer.from(item).toString('hex').slice(0, 16)}`,
                                title: item.replace(/[._]/g, ' '),
                                type: 'movie',
                                filePath: mainVideo,
                                size: vStat.size,
                                modifiedAt: vStat.mtime.toISOString()
                            });
                        }
                    }
                }
            } catch (e) {
                console.error('[DownloadsManager] Scan /Movies error:', e);
            }
        }

        // 2. Scan /TV
        if (fs.existsSync('/TV')) {
            try {
                const shows = fs.readdirSync('/TV');
                for (const show of shows) {
                    if (show.startsWith('.')) continue;
                    const showPath = path.join('/TV', show);
                    const stat = fs.statSync(showPath);
                    if (stat.isDirectory()) {
                        const videoFiles = [];
                        const walk = (dir) => {
                            const entries = fs.readdirSync(dir);
                            for (const entry of entries) {
                                if (entry.startsWith('.')) continue;
                                const entryPath = path.join(dir, entry);
                                const s = fs.statSync(entryPath);
                                if (s.isDirectory()) walk(entryPath);
                                else if (s.isFile() && videoExtensions.includes(path.extname(entry).toLowerCase())) {
                                    videoFiles.push({ path: entryPath, name: entry, size: s.size });
                                }
                            }
                        };
                        try { walk(showPath); } catch (_) {}
                        
                        if (videoFiles.length > 0) {
                            discovered.push({
                                id: `local_tv_${Buffer.from(show).toString('hex').slice(0, 16)}`,
                                title: show.replace(/[._]/g, ' '),
                                type: 'series',
                                episodeCount: videoFiles.length,
                                episodes: videoFiles.map(v => ({
                                    name: v.name,
                                    filePath: v.path,
                                    size: v.size
                                }))
                            });
                        }
                    }
                }
            } catch (e) {
                console.error('[DownloadsManager] Scan /TV error:', e);
            }
        }

        return discovered;
    }

    // Get disk statistics
    getDiskStats() {
        try {
            // Using statfsSync if available in Node 19+
            if (fs.statfsSync) {
                const stats = fs.statfsSync(fs.existsSync('/Movies') ? '/Movies' : '/downloads');
                const total = stats.blocks * stats.bsize;
                const free = stats.bavail * stats.bsize;
                const used = total - free;
                return {
                    totalBytes: total,
                    freeBytes: free,
                    usedBytes: used,
                    totalGB: Math.round(total / (1024 * 1024 * 1024)),
                    freeGB: Math.round(free / (1024 * 1024 * 1024)),
                    usedGB: Math.round(used / (1024 * 1024 * 1024)),
                    percentUsed: Math.round((used / total) * 100)
                };
            }
        } catch (_) {}

        return {
            totalBytes: 1000 * 1024 * 1024 * 1024,
            freeBytes: 175 * 1024 * 1024 * 1024,
            usedBytes: 825 * 1024 * 1024 * 1024,
            totalGB: 1000,
            freeGB: 175,
            usedGB: 825,
            percentUsed: 82
        };
    }

    // Check media status by mediaId
    async checkMedia(mediaId) {
        if (!mediaId) return { downloaded: false };

        await this.listDownloads();

        for (const item of Object.values(this.downloads)) {
            if (item.mediaId === mediaId || item.imdbId === mediaId) {
                return {
                    downloaded: item.status === 'completed',
                    status: item.status,
                    progress: item.progress,
                    rateDownload: item.rateDownload,
                    eta: item.eta,
                    id: item.id,
                    streamUrl: item.status === 'completed' ? `/api/downloads/stream/${item.id}` : null,
                    title: item.title
                };
            }
        }

        return { downloaded: false };
    }

    // Perform an action: pause, resume, delete
    async actionDownload(id, action, deleteLocalData = false) {
        const item = this.downloads[id];
        if (!item) throw new Error(`Download ${id} not found`);

        if (action === 'pause') {
            await this.transmission.stopTorrents(item.torrentId);
            item.status = 'paused';
            this.saveDownloads();
        } else if (action === 'resume') {
            await this.transmission.startTorrents(item.torrentId);
            item.status = 'downloading';
            this.saveDownloads();
        } else if (action === 'delete') {
            if (item.torrentId) {
                try {
                    await this.transmission.removeTorrent(item.torrentId, deleteLocalData);
                } catch (e) {
                    console.warn('[DownloadsManager] Remove from transmission failed:', e.message);
                }
            }
            if (deleteLocalData && item.filePath && isInsideRoots(item.filePath)) {
                try {
                    fs.unlinkSync(item.filePath);
                } catch (e) {
                    console.warn('[DownloadsManager] File deletion failed:', e.message);
                }
            }
            delete this.downloads[id];
            this.saveDownloads();
        }

        return { success: true, id, action };
    }

    // Remux MKV to faststart MP4 in background for instant web range streaming
    remuxToFaststartMp4(filePath) {
        if (!filePath || !fs.existsSync(filePath)) return;
        const ext = path.extname(filePath).toLowerCase();
        if (ext !== '.mkv' && ext !== '.avi') return;
        const mp4Path = filePath.replace(/\.(mkv|avi)$/i, '.mp4');
        if (fs.existsSync(mp4Path)) return;
        if (!this.remuxingJobs) this.remuxingJobs = new Set();
        if (this.remuxingJobs.has(filePath)) return;

        this.remuxingJobs.add(filePath);
        console.log(`[DownloadsManager] Background remuxing to faststart MP4: ${path.basename(filePath)}`);
        const { spawn } = require('child_process');
        const tmpMp4 = `${mp4Path}.tmp.mp4`;
        const proc = spawn('ffmpeg', [
            '-y',
            '-i', filePath,
            '-map', '0:v:0',
            '-map', '0:a:0?',
            '-sn',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-ac', '2',
            '-b:a', '192k',
            '-movflags', '+faststart',
            tmpMp4
        ]);

        proc.on('close', (code) => {
            this.remuxingJobs.delete(filePath);
            if (code === 0 && fs.existsSync(tmpMp4)) {
                try {
                    fs.renameSync(tmpMp4, mp4Path);
                    console.log(`[DownloadsManager] Successfully created faststart MP4: ${path.basename(mp4Path)}`);
                    let updated = false;
                    for (const item of Object.values(this.downloads)) {
                        if (item.filePath === filePath) {
                            item.filePath = mp4Path;
                            updated = true;
                        }
                    }
                    if (updated) this.saveDownloads();
                } catch (e) {
                    console.error('[DownloadsManager] Failed to rename remuxed MP4:', e);
                }
            } else {
                console.warn(`[DownloadsManager] Remux failed for ${path.basename(filePath)} (code ${code})`);
                try { fs.unlinkSync(tmpMp4); } catch (_) {}
            }
        });
    }

    // Range-capable HTTP media streaming with automatic MP4 optimization
    streamMedia(req, res, idOrFilePath) {
        let targetPath = null;

        if (this.downloads[idOrFilePath]) {
            targetPath = this.downloads[idOrFilePath].filePath;
        } else if (fs.existsSync(idOrFilePath)) {
            targetPath = idOrFilePath;
        } else {
            // 1. Try base64 decoded path
            try {
                const decoded = Buffer.from(idOrFilePath, 'base64').toString('utf8');
                if (fs.existsSync(decoded)) targetPath = decoded;
            } catch (_) {}

            // 2. Try matching discovered items
            if (!targetPath) {
                const discovered = this.discoverLocalLibrary();
                for (const d of discovered) {
                    if (d.id === idOrFilePath) {
                        targetPath = d.filePath;
                        break;
                    }
                    if (Array.isArray(d.episodes)) {
                        for (const ep of d.episodes) {
                            const epId = `local_ep_${Buffer.from(ep.filePath).toString('hex').slice(0, 16)}`;
                            if (epId === idOrFilePath || ep.filePath === idOrFilePath) {
                                targetPath = ep.filePath;
                                break;
                            }
                        }
                    }
                    if (targetPath) break;
                }
            }
        }

        // The id may be an absolute path or base64 path: never serve anything outside the media roots
        // (otherwise any login could read data/cinema.db, stream_secret.key, /proc/self/environ, ...).
        if (targetPath && !isInsideRoots(targetPath)) {
            console.warn('[DownloadsManager] refused to stream a path outside the media roots');
            return res.status(404).json({ error: 'Media file not found on disk' });
        }

        if (!targetPath || !fs.existsSync(targetPath)) {
            return res.status(404).json({ error: 'Media file not found on disk' });
        }

        // If target is MKV/AVI, check if an MP4 counterpart already exists on disk
        const initialExt = path.extname(targetPath).toLowerCase();
        if (initialExt === '.mkv' || initialExt === '.avi') {
            const mp4Candidate = targetPath.replace(/\.(mkv|avi)$/i, '.mp4');
            if (fs.existsSync(mp4Candidate)) {
                targetPath = mp4Candidate;
            } else {
                this.remuxToFaststartMp4(targetPath);
            }
        }

        const stat = fs.statSync(targetPath);
        const fileSize = stat.size;
        const ext = path.extname(targetPath).toLowerCase();
        const isMkv = ext === '.mkv' || ext === '.avi';
        const isDownload = req.query.download === '1' || req.query.dl === '1' || req.query.raw === '1';
        const forceRaw = req.query.raw === '1';
        const filename = path.basename(targetPath);
        const disposition = isDownload ? `attachment; filename="${encodeURIComponent(filename)}"` : `inline; filename="${encodeURIComponent(filename)}"`;

        let mimeType = 'video/mp4';
        if (ext === '.mkv') mimeType = 'video/x-matroska';
        else if (ext === '.webm') mimeType = 'video/webm';
        else if (ext === '.avi') mimeType = 'video/x-msvideo';
        else if (ext === '.mov') mimeType = 'video/quicktime';

        if (req.method === 'OPTIONS') {
            res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Origin',
                'Access-Control-Max-Age': '86400'
            });
            return res.end();
        }

        if (req.method === 'HEAD') {
            res.writeHead(200, {
                'Content-Type': isMkv && !forceRaw ? 'video/mp4' : mimeType,
                'Content-Length': fileSize,
                'Accept-Ranges': 'bytes',
                'Content-Disposition': disposition,
                'Cache-Control': 'private, no-store',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Origin',
                'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type, Content-Disposition'
            });
            return res.end();
        }

        // 1. If MKV/AVI and not downloading raw, live remux on-the-fly to MP4
        if (isMkv && !isDownload && !forceRaw) {
            const { spawn } = require('child_process');
            const startSec = parseFloat(req.query.t || req.query.start || '0');
            console.log(`[StreamMedia] Live remuxing to fragmented MP4: ${path.basename(targetPath)} (start: ${startSec}s)`);

            const ffmpegArgs = ['-hide_banner', '-loglevel', 'error'];
            if (startSec > 0) {
                ffmpegArgs.push('-ss', String(startSec));
            }
            ffmpegArgs.push(
                '-i', targetPath,
                '-map', '0:v:0',
                '-map', '0:a:0?',
                '-sn',
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-ac', '2',
                '-b:a', '192k',
                '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
                '-f', 'mp4',
                'pipe:1'
            );

            res.writeHead(200, {
                'Content-Type': 'video/mp4',
                'Content-Disposition': disposition,
                'Cache-Control': 'private, no-store',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type, Content-Disposition'
            });

            const ffmpegProc = spawn('ffmpeg', ffmpegArgs);
            ffmpegProc.stdout.pipe(res);

            ffmpegProc.stderr.on('data', (data) => {
                console.warn('[FFmpeg stderr]:', data.toString());
            });

            req.on('close', () => {
                try { ffmpegProc.kill('SIGKILL'); } catch (_) {}
            });
            return;
        }

        // 2. Direct Range Streaming (for MP4/WebM or explicit downloads)
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            if (start >= fileSize) {
                res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
                return;
            }

            const chunksize = (end - start) + 1;
            const fileStream = fs.createReadStream(targetPath, { start, end });

            const headers = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': mimeType,
                'Content-Disposition': disposition,
                'Cache-Control': 'private, no-store',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Origin',
                'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type, Content-Disposition'
            };

            res.writeHead(206, headers);
            fileStream.pipe(res);

            req.on('close', () => {
                fileStream.destroy();
            });
        } else {
            const headers = {
                'Content-Length': fileSize,
                'Content-Type': mimeType,
                'Accept-Ranges': 'bytes',
                'Content-Disposition': disposition,
                'Cache-Control': 'private, no-store',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Origin',
                'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type, Content-Disposition'
            };
            res.writeHead(200, headers);
            fs.createReadStream(targetPath).pipe(res);
        }
    }
}

module.exports = DownloadsManager;
