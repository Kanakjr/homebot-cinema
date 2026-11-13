// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useTranslation } = require('react-i18next');
const PropTypes = require('prop-types');
const classNames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button } = require('stremio/components');
const styles = require('./styles');

const Error = React.forwardRef(({ className, code, message, stream }, ref) => {
    const { t } = useTranslation();

    const [playlist, fileName] = React.useMemo(() => {
        return [
            stream?.deepLinks?.externalPlayer?.playlist,
            stream?.deepLinks?.externalPlayer?.fileName,
        ];
    }, [stream]);

    const [copied, setCopied] = React.useState(false);

    const streamUrl = React.useMemo(() => {
        if (stream?.url) return stream.url;
        if (playlist) return playlist;
        try {
            const hash = typeof window !== 'undefined' ? window.location.hash || '' : '';
            const match = hash.match(/#\/player\/([^/?#]+)/);
            if (match && match[1]) {
                const decoded = JSON.parse(atob(decodeURIComponent(match[1])));
                if (decoded && decoded.url) return decoded.url;
            }
        } catch (_) { /* not available here */ }
        return null;
    }, [stream, playlist]);

    // External players need a link they can open without a Cloudflare session. /api/downloads/stream/* is
    // bypassed at Cloudflare Access on this host and protected by a signed link, added below.
    const basePublicUrl = streamUrl || null;

    const [signature, setSignature] = React.useState('');
    React.useEffect(() => {
        setSignature('');
        if (!basePublicUrl || /[?&]sig=/.test(basePublicUrl)) return;
        let match = null;
        try {
            match = new URL(basePublicUrl).pathname.match(/^\/api\/downloads\/stream\/([^/]+)/);
        } catch (_) {
            // not a parseable URL: leave unsigned
        }
        if (!match) return;
        let cancelled = false;
        fetch(`/api/downloads/link/${match[1]}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((json) => { if (!cancelled && json && json.path) setSignature(json.path.split('?')[1] || ''); })
            .catch(() => setSignature(''));
        return () => { cancelled = true; };
    }, [basePublicUrl]);

    const publicUrl = React.useMemo(() => {
        if (!basePublicUrl || !signature) return basePublicUrl;
        return `${basePublicUrl}${basePublicUrl.includes('?') ? '&' : '?'}${signature}`;
    }, [basePublicUrl, signature]);

    const vlcUrl = React.useMemo(() => {
        if (!publicUrl) return null;
        return `vlc://${publicUrl}`;
    }, [publicUrl]);

    const infuseUrl = React.useMemo(() => {
        if (!publicUrl) return null;
        return `infuse://x-callback-url/play?url=${encodeURIComponent(publicUrl)}`;
    }, [publicUrl]);

    const iinaUrl = React.useMemo(() => {
        if (!publicUrl) return null;
        return `iina://weblink?url=${encodeURIComponent(publicUrl)}`;
    }, [publicUrl]);

    const downloadUrl = React.useMemo(() => {
        if (!publicUrl) return null;
        const separator = publicUrl.includes('?') ? '&' : '?';
        return `${publicUrl}${separator}download=1`;
    }, [publicUrl]);

    const handleCopy = React.useCallback(() => {
        if (!publicUrl) return;
        navigator.clipboard.writeText(publicUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 3000);
        });
    }, [publicUrl]);

    const reloadWithRemux = React.useCallback(() => {
        const { hash } = window.location;
        if (!/[?&]forceTranscoding\b/.test(hash)) {
            window.location.hash = hash + (hash.includes('?') ? '&' : '?') + 'forceTranscoding=1';
        }
        window.location.reload();
    }, []);

    return (
        <div ref={ref} className={classNames(className, styles['error'])}>
            <div className={styles['error-label']} title={message}>{message}</div>
            {
                code === 2 || code === 83 ?
                    <div className={styles['error-sub']}>
                        Your browser couldn&apos;t play this stream (it may use an unsupported container or audio codec). Try Retry, or open in VLC/Infuse/IINA, or download the file directly:
                    </div>
                    :
                    null
            }
            <div className={styles['external-buttons-row']}>
                {
                    publicUrl ? (
                        <>
                            <button className={styles['external-player-btn']} onClick={reloadWithRemux}>
                                🔄 Retry Playback
                            </button>
                            <a className={styles['external-player-btn']} href={vlcUrl} target={'_blank'} rel="noopener noreferrer" title="Play directly in VLC">
                                📱 Play in VLC
                            </a>
                            <a className={styles['external-player-btn']} href={infuseUrl} target={'_blank'} rel="noopener noreferrer" title="Play directly in Infuse">
                                🍎 Open in Infuse
                            </a>
                            <a className={styles['external-player-btn']} href={iinaUrl} target={'_blank'} rel="noopener noreferrer" title="Play directly in IINA">
                                🖥️ Open in IINA
                            </a>
                            <a className={styles['external-player-btn']} href={downloadUrl} download>
                                💾 Download Media File
                            </a>
                            <button className={styles['external-player-btn']} onClick={handleCopy}>
                                {copied ? '✅ Stream Link Copied!' : '📋 Copy Stream Link'}
                            </button>
                        </>
                    ) : null
                }
            </div>
            {
                playlist && fileName && !streamUrl ?
                    <Button
                        className={styles['playlist-button']}
                        title={t('PLAYER_OPEN_IN_EXTERNAL')}
                        href={playlist}
                        download={fileName}
                        target={'_blank'}
                    >
                        <Icon className={styles['icon']} name={'ic_downloads'} />
                        <div className={styles['label']}>{t('PLAYER_OPEN_IN_EXTERNAL')}</div>
                    </Button>
                    :
                    null
            }
        </div>
    );
});

Error.propTypes = {
    className: PropTypes.string,
    code: PropTypes.number,
    message: PropTypes.string,
    stream: PropTypes.object,
};

module.exports = Error;
