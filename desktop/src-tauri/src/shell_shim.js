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

    window.__shellDispatch = function (json) {
        listeners.slice().forEach(function (l) {
            try { l({ data: json }); } catch (e) { console.error('[shell shim] listener failed', e); }
        });
    };
})();
