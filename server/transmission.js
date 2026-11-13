// HomeBot Cinema Transmission JSON-RPC Client
const http = require('http');

class TransmissionClient {
    constructor(options = {}) {
        this.host = options.host || process.env.TRANSMISSION_HOST || 'transmission';
        this.port = options.port || parseInt(process.env.TRANSMISSION_PORT || '9091', 10);
        this.path = options.path || '/transmission/rpc';
        this.sessionId = null;
    }

    call(method, args = {}, retryCount = 0) {
        return new Promise((resolve, reject) => {
            const body = JSON.stringify({ method, arguments: args });
            const headers = {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            };
            if (this.sessionId) {
                headers['X-Transmission-Session-Id'] = this.sessionId;
            }

            const req = http.request({
                hostname: this.host,
                port: this.port,
                path: this.path,
                method: 'POST',
                headers,
                timeout: 10000
            }, (res) => {
                if (res.statusCode === 409) {
                    const newSid = res.headers['x-transmission-session-id'];
                    if (newSid) {
                        this.sessionId = newSid;
                        if (retryCount < 2) {
                            return this.call(method, args, retryCount + 1).then(resolve).catch(reject);
                        }
                    }
                    return reject(new Error('Transmission 409 Session ID handshake failed'));
                }

                let responseData = '';
                res.on('data', chunk => responseData += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        if (parsed.result === 'success') {
                            resolve(parsed.arguments);
                        } else {
                            reject(new Error(`Transmission RPC error: ${parsed.result}`));
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse Transmission response: ${e.message} (Raw: ${responseData.slice(0, 200)})`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(new Error(`Transmission connection error (${this.host}:${this.port}): ${err.message}`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Transmission RPC request timed out after 10s`));
            });

            req.write(body);
            req.end();
        });
    }

    async getTorrents(fields = [
        'id', 'name', 'status', 'percentDone', 'rateDownload', 'rateUpload',
        'eta', 'totalSize', 'leftUntilDone', 'downloadDir', 'files',
        'isFinished', 'errorString', 'hashString', 'addedDate'
    ]) {
        const res = await this.call('torrent-get', { fields });
        return res.torrents || [];
    }

    async getTorrent(id, fields) {
        const torrents = await this.getTorrents(fields);
        return torrents.find(t => t.id === id || t.hashString === id) || null;
    }

    async addTorrent({ filename, downloadDir, paused = false }) {
        const args = {
            filename,
            paused
        };
        if (downloadDir) {
            args['download-dir'] = downloadDir;
        }
        const res = await this.call('torrent-add', args);
        return res['torrent-added'] || res['torrent-duplicate'];
    }

    async removeTorrent(ids, deleteLocalData = false) {
        const torrentIds = Array.isArray(ids) ? ids : [ids];
        return await this.call('torrent-remove', {
            ids: torrentIds,
            'delete-local-data': deleteLocalData
        });
    }

    async startTorrents(ids) {
        const torrentIds = Array.isArray(ids) ? ids : [ids];
        return await this.call('torrent-start', { ids: torrentIds });
    }

    async stopTorrents(ids) {
        const torrentIds = Array.isArray(ids) ? ids : [ids];
        return await this.call('torrent-stop', { ids: torrentIds });
    }

    async getFreeSpace(dirPath = '/downloads') {
        return await this.call('free-space', { path: dirPath });
    }
}

module.exports = TransmissionClient;
