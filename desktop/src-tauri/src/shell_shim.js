// Injected at document start (before the page's own scripts): the web UI reads `chrome.webview`
// ONCE when src/common/Platform/shell/useShell.ts is imported, so this cannot be added later.
// Messages from the page go to the Rust command `shell_ipc`; messages back arrive through
// window.__shellDispatch(jsonString), which fans out to the 'message' listeners like WebView2 does.
(function () {
    if (window.__shellShimInstalled) return;
    window.__shellShimInstalled = true;
    if (document.documentElement) {
        document.documentElement.dataset.shell = 'macos';
    } else {
        document.addEventListener('DOMContentLoaded', function () {
            document.documentElement.dataset.shell = 'macos';
        });
    }
    var listeners = [];

    function send(msg) {
        try {
            var internals = window.__TAURI_INTERNALS__;
            if (!internals || typeof internals.invoke !== 'function') {
                console.error('[shell shim] Tauri IPC is not available on this page');
                return;
            }
            internals.invoke('shell_ipc', { msg: msg }).catch(function (e) {
                console.error('[shell shim] shell_ipc failed', e);
            });
        } catch (e) {
            console.error('[shell shim]', e);
        }
    }

    // stremio-video asks the streaming server to probe every stream and sends it through an HLS transcode when a
    // browser engine could not play it as is (embedded subtitles, 2+ audio tracks, HEVC, DTS...). It skips that
    // only when `window.qt` exists (the old Qt shell). mpv plays all of it directly, so the transcode only adds a
    // probe round trip, the HLS start-up and a lossy H.264 re-encode that washes out HDR. Nothing else in the web UI
    // reads window.qt (checked in the production bundle), so claim to be that shell.
    if (typeof window.qt === 'undefined') window.qt = {};

    window.chrome = window.chrome || {};
    window.chrome.webview = {
        postMessage: function (msg) { send(typeof msg === 'string' ? msg : JSON.stringify(msg)); },
        addEventListener: function (type, cb) { if (type === 'message') listeners.push(cb); },
        removeEventListener: function (type, cb) { listeners = listeners.filter(function (l) { return l !== cb; }); }
    };

    function formatAudioTrack(track, index) {
        var codecMap = {
            'eac3': 'E-AC3', 'ac3': 'AC3', 'truehd': 'TrueHD', 'dts': 'DTS',
            'dts-hd ma': 'DTS-HD MA', 'aac': 'AAC', 'flac': 'FLAC', 'opus': 'Opus',
            'mp3': 'MP3', 'vorbis': 'Vorbis'
        };
        var rawCodec = (track.codec || '').toLowerCase();
        var codec = codecMap[rawCodec] || (rawCodec ? rawCodec.toUpperCase() : '');
        var channels = '';
        var chCount = track['demux-channel-count'] || track['audio-channels'];
        if (track['demux-channels']) {
            channels = String(track['demux-channels']);
        } else if (chCount === 8) {
            channels = '7.1';
        } else if (chCount === 6) {
            channels = '5.1';
        } else if (chCount === 2) {
            channels = 'Stereo';
        } else if (chCount === 1) {
            channels = 'Mono';
        }

        var isAtmos = track.title && /atmos/i.test(track.title);
        var isSdh = track['hearing-impaired'] || (track.title && /sdh/i.test(track.title));
        var tags = [];
        if (codec) tags.push(codec);
        if (channels && (!codec || !codec.includes(channels))) tags.push(channels);
        if (isAtmos && (!codec || !codec.includes('Atmos'))) tags.push('Atmos');
        if (isSdh) tags.push('SDH');

        var tagStr = tags.join(' ');
        if (track.title) {
            var title = track.title.trim();
            if (tagStr && !title.toLowerCase().includes(rawCodec) && !title.includes(tagStr)) {
                return title + (tagStr ? ' · ' + tagStr : '');
            }
            return title;
        }
        return tagStr || ('Track ' + (index + 1));
    }

    function formatSubTrack(track, index) {
        var isSdh = track['hearing-impaired'] || (track.title && /\b(sdh|cc)\b/i.test(track.title));
        var isForced = track.forced || (track.title && /\bforced\b/i.test(track.title));
        var rawCodec = (track.codec || '').toLowerCase();
        var codecBadge = (rawCodec === 'pgs' || rawCodec === 'hdmv_pgs_subtitle') ? 'PGS' : '';

        var tags = [];
        if (track.title) {
            var cleanTitle = track.title.trim();
            if (cleanTitle) tags.push(cleanTitle);
        }
        if (isForced && (!track.title || !/\bforced\b/i.test(track.title))) tags.push('Forced');
        if (isSdh && (!track.title || !/\b(sdh|cc)\b/i.test(track.title))) tags.push('SDH');
        if (codecBadge && (!track.title || !track.title.includes(codecBadge))) tags.push(codecBadge);

        if (tags.length > 0) {
            return tags.join(' · ');
        }
        return track.lang ? 'Embedded' : ('Track ' + (index + 1));
    }

    window.__shellDispatch = function (json) {
        try {
            var obj = typeof json === 'string' ? JSON.parse(json) : json;
            if (obj && obj.type === 1 && Array.isArray(obj.args) && obj.args[0] === 'mpv-prop-change') {
                var payload = obj.args[1];
                if (payload && payload.name === 'track-list' && Array.isArray(payload.data)) {
                    window.__mpvTrackList = payload.data;
                    payload.data.forEach(function (t, idx) {
                        if (t.type === 'audio') {
                            t.title = formatAudioTrack(t, idx);
                        } else if (t.type === 'sub') {
                            t.title = formatSubTrack(t, idx);
                        }
                    });
                    if (typeof json === 'string') {
                        json = JSON.stringify(obj);
                    }
                }
            }
        } catch (e) {
            // pass through raw json if parsing fails
        }

        listeners.slice().forEach(function (l) {
            try { l({ data: json }); } catch (e) { console.error('[shell shim] listener failed', e); }
        });
    };

    // Suppress native WebKit context menu on macOS (Open link in new tab, reload, etc.),
    // while preserving inputs/textareas and allowing Shift+Right-Click for dev tools.
    window.addEventListener('contextmenu', function (e) {
        if (e.shiftKey) return;
        var target = e.target;
        var isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
        var hasSelection = window.getSelection && window.getSelection().toString().length > 0;
        if (!isInput && !hasSelection) {
            e.preventDefault();
        }
    }, true);
})();
