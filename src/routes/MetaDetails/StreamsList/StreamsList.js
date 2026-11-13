// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useNavigate } = require('react-router');
const { default: toPath } = require('stremio-router/toPath');
const { useGoBack } = require('stremio-router');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button, Image, MultiselectMenu } = require('stremio/components');
const { useCore } = require('stremio/core');
const Stream = require('./Stream');
const StreamFilterBar = require('./StreamFilterBar');
const { parseStream } = require('./streamParser');
const styles = require('./styles');
const { usePlatform, useProfile } = require('stremio/common');
const { api } = require('stremio/common/serverApi');
const { useQualityProfiles, toRawStream } = require('stremio/common/qualityProfile');
const { default: SeasonEpisodePicker } = require('../EpisodePicker');

const ALL_ADDONS_KEY = 'ALL';

// Rough ranking used until the profile preview arrives (and for the "Best" filter).
const heuristicScore = (p) => {
    if (!p) return 0;
    let s = 0;
    if (p.isCam) s -= 1000;
    if (p.resolution === '1080p') s += 500;
    else if (p.resolution === '4K') s += 450;
    else if (p.resolution === '720p') s += 200;
    if (p.hdr) s += 60;
    if (typeof p.seeders === 'number') s += Math.min(p.seeders, 300);
    if (p.sizeGB && p.sizeGB >= 1 && p.sizeGB <= 15) s += 40;
    return s;
};

const StreamsList = ({ className, video, type, externalPlayerCallbackCanMarkWatched, onEpisodeSearch, ...props }) => {
    const { t } = useTranslation();
    const core = useCore();
    const platform = usePlatform();
    const profile = useProfile();
    const navigate = useNavigate();
    const goBack = useGoBack();
    const streamsContainerRef = React.useRef(null);
    const [selectedAddon, setSelectedAddon] = React.useState(ALL_ADDONS_KEY);
    const onAddonSelected = React.useCallback((value) => {
        streamsContainerRef.current.scrollTo({ top: 0, left: 0, behavior: platform.name === 'ios' ? 'smooth' : 'instant' });
        setSelectedAddon(value);
    }, [platform]);
    const showInstallAddonsButton = React.useMemo(() => {
        return !profile || profile.auth === null || profile.auth?.user?.isNewUser === true && !video?.upcoming;
    }, [profile, video]);
    const backButtonOnClick = React.useCallback(() => {
        if (video.deepLinks && typeof video.deepLinks.metaDetailsVideos === 'string') {
            const navigateTo = `${video.deepLinks.metaDetailsVideos}${
                typeof video.season === 'number'
                    ? `?${new URLSearchParams({ 'season': video.season })}`
                    : ''}`;
            navigate(toPath(navigateTo), { replace: true });
        } else {
            goBack();
        }
    }, [video, navigate, goBack]);
    const countLoadingAddons = React.useMemo(() => {
        return props.streams.filter((stream) => stream.content.type === 'Loading').length;
    }, [props.streams]);
    const streamsByAddon = React.useMemo(() => {
        return props.streams
            .filter((streams) => streams.content.type === 'Ready')
            .reduce((streamsByAddon, streams) => {
                streamsByAddon[streams.addon.transportUrl] = {
                    addon: streams.addon,
                    streams: streams.content.content.map((stream) => ({
                        ...stream,
                        onClick: () => {
                            core.transport.analytics({
                                event: 'StreamClicked',
                                args: {
                                    stream
                                }
                            });
                            if (profile.settings.playerType !== null) {
                                core.transport.dispatch({
                                    action: 'MetaDetails',
                                    args: {
                                        action: 'ExternalPlayerStreamOpened',
                                        args: stream
                                    }
                                });
                            }
                        },
                        addonName: streams.addon.manifest.name
                    }))
                };

                return streamsByAddon;
            }, {});
    }, [props.streams, profile.settings.playerType]);
    const effectiveSelectedAddon = Object.prototype.hasOwnProperty.call(streamsByAddon, selectedAddon) ? selectedAddon : ALL_ADDONS_KEY;
    const filteredStreams = React.useMemo(() => {
        return effectiveSelectedAddon === ALL_ADDONS_KEY ?
            Object.values(streamsByAddon).map(({ streams }) => streams).flat(1)
            :
            streamsByAddon[effectiveSelectedAddon].streams;
    }, [streamsByAddon, effectiveSelectedAddon]);

    // How does each release fare under the selected quality profile? (server-side scoring)
    const { selected: qualityProfile } = useQualityProfiles();
    const [preview, setPreview] = React.useState(null);
    React.useEffect(() => {
        if (!qualityProfile || filteredStreams.length === 0) {
            setPreview(null);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            api('POST', '/api/grabber/preview', {
                profileId: qualityProfile.id,
                type: type === 'series' ? 'series' : 'movie',
                streams: filteredStreams.map(toRawStream)
            })
                .then((r) => { if (!cancelled) setPreview({ ...r, source: filteredStreams }); })
                .catch(() => { if (!cancelled) setPreview(null); });
        }, 400);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [filteredStreams, qualityProfile, type]);
    const matchByStream = React.useMemo(() => {
        if (!preview || preview.source !== filteredStreams) return null;
        const m = new Map();
        preview.results.forEach((r) => m.set(filteredStreams[r.index], { accepted: r.accepted, best: r.index === preview.best, reasons: r.reasons, score: r.score }));
        return m;
    }, [preview, filteredStreams]);

    // Live swarm check: can the streaming server really pull data for the best releases? (listed seeders are often stale)
    const [health, setHealth] = React.useState({});
    const [checking, setChecking] = React.useState(() => new Set());
    const healthRef = React.useRef(health);
    healthRef.current = health;
    React.useEffect(() => {
        if (!matchByStream) return;
        let cancelled = false;
        const keyOf = (st) => st.infoHash.toLowerCase();
        const ranked = filteredStreams
            .filter((st) => st.infoHash && matchByStream.get(st) && matchByStream.get(st).accepted)
            .sort((a, b) => matchByStream.get(b).score - matchByStream.get(a).score);
        const run = async () => {
            // probe in batches of 4, best first, and stop as soon as one swarm is confirmed alive
            for (let i = 0; i < Math.min(ranked.length, 12) && !cancelled; i += 4) {
                if (ranked.slice(0, i + 4).some((st) => (healthRef.current[keyOf(st)] || {}).verdict === 'good')) return;
                const batch = ranked.slice(i, i + 4).filter((st) => !healthRef.current[keyOf(st)]);
                if (batch.length === 0) continue;
                const keys = batch.map(keyOf);
                setChecking((prev) => new Set([...prev, ...keys]));
                let res = null;
                try {
                    res = await api('POST', '/api/streams/probe', { streams: batch.map((st) => ({ infoHash: st.infoHash, fileIdx: st.fileIdx })) });
                } catch (_) {
                    res = null; // probing is best effort: leave these as "unchecked"
                }
                setChecking((prev) => {
                    const next = new Set(prev);
                    keys.forEach((k) => next.delete(k));
                    return next;
                });
                if (cancelled || !res) return;
                setHealth((prev) => ({ ...prev, ...res.results }));
                if (Object.values(res.results).some((r) => r.verdict === 'good')) return;
            }
        };
        run();
        return () => { cancelled = true; };
    }, [matchByStream, filteredStreams]);

    const [filterPill, setFilterPill] = React.useState('ALL');
    const [searchQuery, setSearchQuery] = React.useState('');
    const [hideCam, setHideCam] = React.useState(true);

    const displayStreams = React.useMemo(() => {
        let list = filteredStreams;
        if (!list || list.length === 0) return [];

        const parsedList = list.map((st) => ({
            stream: st,
            parsed: parseStream(st),
        }));

        let result = parsedList;

        if (hideCam) {
            const nonCam = result.filter(({ parsed }) => !parsed?.isCam);
            if (nonCam.length > 0) {
                result = nonCam;
            }
        }

        if (filterPill === 'BEST') {
            result = [...result].sort((a, b) => {
                const score = (p) => {
                    if (!p) return 0;
                    let s = 0;
                    if (p.isCam) s -= 1000;
                    if (p.resolution === '1080p') s += 500;
                    else if (p.resolution === '4K') s += 450;
                    else if (p.resolution === '720p') s += 200;
                    if (p.hdr) s += 60;
                    if (typeof p.seeders === 'number') s += Math.min(p.seeders, 300);
                    if (p.sizeGB && p.sizeGB >= 1 && p.sizeGB <= 15) s += 40;
                    return s;
                };
                return score(b.parsed) - score(a.parsed);
            }).slice(0, 5);
        } else if (filterPill === '4K') {
            result = result.filter(({ parsed }) => parsed?.resolution === '4K');
        } else if (filterPill === '1080P') {
            result = result.filter(({ parsed }) => parsed?.resolution === '1080p');
        } else if (filterPill === '720P') {
            result = result.filter(({ parsed }) => parsed?.resolution === '720p');
        } else if (filterPill === 'COMPACT') {
            result = result.filter(({ parsed }) => parsed?.sizeGB !== null && parsed.sizeGB > 0 && parsed.sizeGB < 3);
        } else if (filterPill === 'HDR') {
            result = result.filter(({ parsed }) => Boolean(parsed?.hdr));
        } else if (filterPill === 'PROFILE' && matchByStream) {
            result = result.filter(({ stream }) => matchByStream.get(stream)?.accepted);
        } else if (filterPill === 'SEEDS') {
            result = result.filter(({ parsed }) => typeof parsed?.seeders === 'number' && parsed.seeders >= 30);
        }

        const q = searchQuery.trim().toLowerCase();
        if (q) {
            result = result.filter(({ stream }) => {
                const text = `${stream.name || ''} ${stream.description || ''} ${stream.addonName || ''}`.toLowerCase();
                return text.includes(q);
            });
        }

        // Always best first: releases the selected profile accepts, ranked by its score; the rest follow.
        // Until the server's preview arrives, a quick local ranking is used. Sorting is stable, so ties keep addon order.
        const HEALTH_ADJ = { good: 300, slow: 0, dead: -5e5 };
        const rank = ({ stream, parsed }) => {
            const m = matchByStream ? matchByStream.get(stream) : null;
            const h = stream.infoHash ? health[stream.infoHash.toLowerCase()] : null;
            return (m ? (m.accepted ? 1e6 : 0) + m.score : heuristicScore(parsed)) + (h ? HEALTH_ADJ[h.verdict] || 0 : 0);
        };
        return [...result].sort((a, b) => rank(b) - rank(a)).map(({ stream }) => stream);
    }, [filteredStreams, filterPill, searchQuery, hideCam, matchByStream, health]);

    // the release to play first: the top acceptable one whose swarm is not known to be dead
    const bestStream = React.useMemo(() => (matchByStream ? displayStreams.find((st) => {
        const m = matchByStream.get(st);
        const h = st.infoHash ? health[st.infoHash.toLowerCase()] : null;
        return m && m.accepted && !(h && h.verdict === 'dead');
    }) || null : null), [displayStreams, matchByStream, health]);
    const swarmOf = (st) => {
        if (!st.infoHash) return undefined;
        const key = st.infoHash.toLowerCase();
        if (checking.has(key)) return { state: 'checking' };
        const h = health[key];
        return h && h.verdict !== 'unknown' ? { state: h.verdict, ms: h.ms, bytes: h.bytes, peers: h.peers, unchoked: h.unchoked } : undefined;
    };
    // counts shown on the quality filters
    const counts = React.useMemo(() => {
        const c = { all: filteredStreams.length, '4k': 0, '1080p': 0, '720p': 0, hdr: 0, compact: 0, seeds: 0 };
        for (const st of filteredStreams) {
            const p = parseStream(st);
            if (!p) continue;
            if (p.resolution === '4K') c['4k']++;
            else if (p.resolution === '1080p') c['1080p']++;
            else if (p.resolution === '720p') c['720p']++;
            if (p.hdr) c.hdr++;
            if (p.sizeGB !== null && p.sizeGB > 0 && p.sizeGB < 3) c.compact++;
            if (typeof p.seeders === 'number' && p.seeders >= 30) c.seeds++;
        }
        if (matchByStream) c.profile = preview.acceptedCount;
        return c;
    }, [filteredStreams, matchByStream, preview]);
    const selectableOptions = React.useMemo(() => {
        return {
            options: [
                {
                    value: ALL_ADDONS_KEY,
                    label: t('ALL_ADDONS'),
                    title: t('ALL_ADDONS')
                },
                ...Object.keys(streamsByAddon).map((transportUrl) => ({
                    value: transportUrl,
                    label: streamsByAddon[transportUrl].addon.manifest.name,
                    title: streamsByAddon[transportUrl].addon.manifest.name,
                }))
            ],
            value: effectiveSelectedAddon,
            onSelect: onAddonSelected
        };
    }, [streamsByAddon, effectiveSelectedAddon, onAddonSelected, t]);

    const handleEpisodePicker = React.useCallback((season, episode) => {
        onEpisodeSearch(season, episode);
    }, [onEpisodeSearch]);

    return (
        <div className={classnames(className, styles['streams-list-container'])}>
            <div className={styles['select-choices-wrapper']}>
                {
                    video ?
                        <React.Fragment>
                            <Button className={classnames(styles['button-container'], styles['back-button-container'])} tabIndex={0} onClick={backButtonOnClick}>
                                <Icon className={styles['icon']} name={'chevron-back'} />
                            </Button>
                            <div className={styles['episode-title']}>
                                {typeof video.season === 'number' && typeof video.episode === 'number'
                                    ? `S${video.season}E${video.episode}${video.title ? ` ${video.title}` : ''}`
                                    : (video.title ?? '')}
                            </div>
                        </React.Fragment>
                        :
                        null
                }
                {
                    Object.keys(streamsByAddon).length > 1 ?
                        <MultiselectMenu
                            {...selectableOptions}
                            className={styles['select-input-container']}
                        />
                        :
                        null
                }
            </div>
            {
                props.streams.length === 0 ?
                    <div className={styles['message-container']}>
                        {
                            type === 'series' ?
                                <SeasonEpisodePicker className={styles['search']} onSubmit={handleEpisodePicker} />
                                : null
                        }
                        <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                        <div className={styles['label']}>{t('ERR_NO_ADDONS_FOR_STREAMS')}</div>
                    </div>
                    :
                    props.streams.every((streams) => streams.content.type === 'Err') ?
                        <div className={styles['message-container']}>
                            {
                                type === 'series' ?
                                    <SeasonEpisodePicker className={styles['search']} onSubmit={handleEpisodePicker} />
                                    : null
                            }
                            {
                                video?.upcoming ?
                                    <div className={styles['label']}>{t('UPCOMING')}...</div>
                                    : null
                            }
                            <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                            <div className={styles['label']}>{t('NO_STREAM')}</div>
                            {
                                showInstallAddonsButton ?
                                    <Button className={styles['install-button-container']} title={t('ADDON_CATALOGUE_MORE')} href={'#/addons'}>
                                        <Icon className={styles['icon']} name={'addons'} />
                                        <div className={styles['label']}>{t('ADDON_CATALOGUE_MORE')}</div>
                                    </Button>
                                    :
                                    null
                            }
                        </div>
                        :
                        filteredStreams.length === 0 ?
                            <div className={styles['streams-container']}>
                                <Stream.Placeholder />
                                <Stream.Placeholder />
                            </div>
                            :
                            <React.Fragment>
                                <StreamFilterBar
                                    activePill={filterPill}
                                    onSelectPill={setFilterPill}
                                    searchQuery={searchQuery}
                                    onSearchChange={setSearchQuery}
                                    hideCam={hideCam}
                                    onToggleHideCam={() => setHideCam((prev) => !prev)}
                                    totalCount={filteredStreams.length}
                                    filteredCount={displayStreams.length}
                                    counts={counts}
                                    profileName={qualityProfile ? qualityProfile.name : ''}
                                />
                                {
                                    displayStreams.length === 0 ? (
                                        <div className={styles['message-container']}>
                                            <div className={styles['label']}>No streams match your filter.</div>
                                            <Button
                                                className={styles['install-button-container']}
                                                onClick={() => {
                                                    setFilterPill('ALL');
                                                    setSearchQuery('');
                                                    setHideCam(false);
                                                }}
                                            >
                                                <div className={styles['label']}>Reset Filters</div>
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className={styles['streams-container']} ref={streamsContainerRef}>
                                            {displayStreams.map((stream, index) => (
                                                <Stream
                                                    key={index}
                                                    videoId={video?.id}
                                                    videoReleased={video?.released}
                                                    addonName={stream.addonName}
                                                    name={stream.name}
                                                    title={stream.title}
                                                    description={stream.description || stream.title}
                                                    thumbnail={stream.thumbnail}
                                                    progress={stream.progress}
                                                    deepLinks={stream.deepLinks}
                                                    externalPlayerCallbackCanMarkWatched={externalPlayerCallbackCanMarkWatched}
                                                    onClick={stream.onClick}
                                                    match={matchByStream && matchByStream.get(stream) ? { ...matchByStream.get(stream), best: stream === bestStream } : undefined}
                                                    swarm={swarmOf(stream)}
                                                />
                                            ))}
                                            {
                                                showInstallAddonsButton ?
                                                    <Button className={styles['install-button-container']} title={t('ADDON_CATALOGUE_MORE')} href={'#/addons'}>
                                                        <Icon className={styles['icon']} name={'addons'} />
                                                        <div className={styles['label']}>{t('ADDON_CATALOGUE_MORE')}</div>
                                                    </Button>
                                                    :
                                                    null
                                            }
                                        </div>
                                    )
                                }
                                {
                                    countLoadingAddons > 0 ?
                                        <div className={styles['addons-loading-container']}>
                                            <div className={styles['addons-loading']}>
                                                {countLoadingAddons} {t('MOBILE_ADDONS_LOADING')}
                                            </div>
                                            <span className={styles['addons-loading-bar']}></span>
                                        </div>
                                        :
                                        null
                                }
                            </React.Fragment>
            }
        </div>
    );
};

StreamsList.propTypes = {
    className: PropTypes.string,
    streams: PropTypes.arrayOf(PropTypes.object).isRequired,
    video: PropTypes.object,
    type: PropTypes.string,
    externalPlayerCallbackCanMarkWatched: PropTypes.bool,
    onEpisodeSearch: PropTypes.func
};

module.exports = StreamsList;
