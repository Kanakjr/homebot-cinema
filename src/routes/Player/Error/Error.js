// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useTranslation } = require('react-i18next');
const PropTypes = require('prop-types');
const classNames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button } = require('stremio/components');
const { decodeStreamUrl, decodeStreamUrlSync } = require('./decodeStreamUrl');
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
    const [hashStreamUrl, setHashStreamUrl] = React.useState(() => {
        const hash = typeof window !== 'undefined' ? window.location.hash || '' : '';
        return decodeStreamUrlSync(hash);
    });

    React.useEffect(() => {
        if (stream?.url || playlist) return undefined;
        const hash = typeof window !== 'undefined' ? window.location.hash || '' : '';
        const syncUrl = decodeStreamUrlSync(hash);
        if (syncUrl) {
            setHashStreamUrl(syncUrl);
            return undefined;
        }
        let cancelled = false;
        decodeStreamUrl(hash).then((url) => {
            if (!cancelled && url) setHashStreamUrl(url);
        });
        return () => { cancelled = true; };
    }, [stream, playlist]);

    const streamUrl = stream?.url || playlist || hashStreamUrl || null;

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
                        {publicUrl
                            ? 'Your browser couldn\u2019t play this stream (it may use an unsupported container or audio codec). Try Retry, or open in VLC/Infuse/IINA, or download the file directly:'
                            : 'Your browser couldn\u2019t play this stream (it may use an unsupported container or audio codec).'}
                    </div>
                    :
                    null
            }
            <div className={styles['external-buttons-row']}>
                {
                    publicUrl ? (
                        <>
                            <button className={styles['external-player-btn']} onClick={reloadWithRemux}>
                                {t('HOMEBOT_RETRY_PLAYBACK', '🔄 Retry Playback')}
                            </button>
                            <a className={styles['external-player-btn']} href={vlcUrl} target={'_blank'} rel="noopener noreferrer" title="Play directly in VLC">
                                {t('HOMEBOT_PLAY_VLC', '📱 Play in VLC')}
                            </a>
                            <a className={styles['external-player-btn']} href={infuseUrl} target={'_blank'} rel="noopener noreferrer" title="Play directly in Infuse">
                                {t('HOMEBOT_OPEN_INFUSE', '🍎 Open in Infuse')}
                            </a>
                            <a className={styles['external-player-btn']} href={iinaUrl} target={'_blank'} rel="noopener noreferrer" title="Play directly in IINA">
                                {t('HOMEBOT_OPEN_IINA', '🖥️ Open in IINA')}
                            </a>
                            <a className={styles['external-player-btn']} href={downloadUrl} download>
                                {t('HOMEBOT_DOWNLOAD_MEDIA', '💾 Download Media File')}
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
