// Copyright (C) 2017-2026 Smart code 203358507

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CONSTANTS, getKeyboardShortcutKeys, languages, useFileDropListener, useInterval, useShortcut, useTimeout, useToast } from 'stremio/common';
import { SmartSubtitleSelector } from 'stremio/common/subtitles/SmartSubtitleSelector';
import { AudioVADProbe } from 'stremio/common/subtitles/AudioVADProbe';
import {
    getSubtitleDelayStepMultiplier,
    snapSubtitleDelay,
    SUBTITLES_DELAY_REPEAT_DELAY_MS,
    SUBTITLES_DELAY_REPEAT_INTERVAL_MS,
    SUBTITLES_DELAY_STEP_MS,
} from './subtitleDelay';

const withFallbackLabels = (tracks?: SubtitleTrack[] | null): SubtitleTrack[] => {
    if (!Array.isArray(tracks)) {
        return [];
    }

    return tracks.map((track) => ({
        ...track,
        label: track.label || track.url || '',
    }));
};

const findTrackById = (tracks: SubtitleTrack[], id?: string | null) => {
    if (!id) {
        return undefined;
    }

    return tracks.find((track) => track.id === id);
};

const normalizeLanguage = (language?: string | null) => {
    if (!language) {
        return undefined;
    }

    const value = language.trim();
    const normalized = languages.find(value) ?? languages.find(value.toLowerCase());

    return normalized?.code;
};

const findTrackByLanguage = (tracks: SubtitleTrack[], language?: string | null) => {
    const languageCode = normalizeLanguage(language);
    if (!languageCode) {
        return undefined;
    }

    return tracks.find((track) => normalizeLanguage(track.lang) === languageCode);
};

type SubtitleCandidate = {
    source: SubtitleSource,
    id?: string,
    language?: string,
};

type ResolvedSubtitleCandidate = {
    source: SubtitleSource,
    rank: number,
    track: SubtitleTrack,
};

type SubtitleDelayHold = {
    direction: number,
    key: string,
    repeated: boolean,
    startedAt: number,
    stream: unknown,
    value: number,
};

const candidateMatchesTrack = (
    candidate: SubtitleCandidate,
    source: SubtitleSource,
    track: SubtitleTrack,
) => {
    if (candidate.source !== source || (candidate.id && candidate.id !== track.id)) {
        return false;
    }

    return !candidate.language || normalizeLanguage(track.lang) === candidate.language;
};

const resolveCandidate = (
    candidate: SubtitleCandidate,
    subtitlesTracks: SubtitleTrack[],
    extraSubtitlesTracks: SubtitleTrack[],
) => {
    const tracks = candidate.source === 'embedded' ? subtitlesTracks : extraSubtitlesTracks;
    const track = candidate.id ?
        findTrackById(tracks, candidate.id)
        :
        findTrackByLanguage(tracks, candidate.language);

    return track && (!candidate.language || normalizeLanguage(track.lang) === candidate.language) ?
        track
        :
        undefined;
};

const buildCandidates = (
    sessionPreference: SubtitlePreference | null,
    savedTrack: SubtitlesTrackState | null | undefined,
    globalLanguage: string | null,
) => {
    const candidates: SubtitleCandidate[] = [];
    const languagesOrder: string[] = [];
    const sessionEnabled = sessionPreference?.enabled === true;
    const sessionLanguage = normalizeLanguage(sessionPreference?.language);
    const savedLanguage = normalizeLanguage(savedTrack?.language);
    const savedSource = savedTrack ? (savedTrack.embedded ? 'embedded' : 'external') : undefined;
    const preferredSource = sessionEnabled ? sessionPreference.source : savedSource;
    const sources: SubtitleSource[] = preferredSource === 'external' ?
        ['external', 'embedded']
        :
        ['embedded', 'external'];

    const addLanguage = (language?: string) => {
        if (language && !languagesOrder.includes(language)) {
            languagesOrder.push(language);
        }
    };

    if (savedTrack?.id && (!sessionEnabled ||
        !sessionPreference.source || sessionPreference.source === savedSource)) {
        candidates.push({
            source: savedSource as SubtitleSource,
            id: savedTrack.id,
            ...(sessionLanguage ? { language: sessionLanguage } : {}),
        });
    }

    if (sessionEnabled) {
        addLanguage(sessionLanguage ?? savedLanguage);
    } else {
        addLanguage(savedLanguage);
    }
    addLanguage(normalizeLanguage(globalLanguage));
    if (sessionEnabled) {
        addLanguage(normalizeLanguage(CONSTANTS.DEFAULT_SUBTITLES_LANGUAGE));
    }

    // Keep language ahead of source so the selected language can cross source types.
    languagesOrder.forEach((language) => {
        sources.forEach((source) => candidates.push({ source, language }));
    });

    return candidates;
};

const resolveBestCandidate = (
    candidates: SubtitleCandidate[],
    subtitlesTracks: SubtitleTrack[],
    extraSubtitlesTracks: SubtitleTrack[],
): ResolvedSubtitleCandidate | undefined => {
    for (let rank = 0; rank < candidates.length; rank++) {
        const candidate = candidates[rank];
        const track = resolveCandidate(candidate, subtitlesTracks, extraSubtitlesTracks);
        if (track) {
            return { source: candidate.source, rank, track };
        }
    }

    return undefined;
};

const findCandidateRank = (
    candidates: SubtitleCandidate[],
    source: SubtitleSource,
    track: SubtitleTrack,
) => {
    return candidates.findIndex((candidate) => candidateMatchesTrack(candidate, source, track));
};

const useSubtitles = ({
    player,
    video,
    settings,
    streamStateChanged,
    subtitlePreferenceChanged,
    menusOpen,
    closeMenus,
    closeSubtitlesMenu,
    toggleSubtitlesMenu,
}: UseSubtitlesArgs): UseSubtitlesResult => {
    const { t } = useTranslation();
    const { setSubtitlesTrack, setExtraSubtitlesTrack, setSubtitlesDelay, setSubtitlesSize, setSubtitlesOffset } = video;
    const toast = useToast();
    const videoRef = useRef(video);
    const settingsRef = useRef(settings);
    const trackSelectionLocked = useRef(false);
    const appliedTrack = useRef<{ id: string, source: SubtitleSource } | null>(null);
    const lastSelectedTrack = useRef<SelectedSubtitleTrack | null>(null);
    const subtitleDelayHold = useRef<SubtitleDelayHold | null>(null);
    const subtitleDelayInterval = useInterval(SUBTITLES_DELAY_REPEAT_INTERVAL_MS);
    const subtitleDelayTimeout = useTimeout(SUBTITLES_DELAY_REPEAT_DELAY_MS);
    const [autoSyncInfo, setAutoSyncInfo] = useState<{
        isAutoSynced: boolean,
        isSyncing?: boolean,
        isEmbedded?: boolean,
        bestTrack: SubtitleTrack | null,
        confidence: number,
        recommendedOffset: number,
        message?: string,
    } | null>(null);
    const autoSyncAttemptedStream = useRef<unknown>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    videoRef.current = video;
    settingsRef.current = settings;

    const streamSubtitles = useMemo(() => {
        return withFallbackLabels(player.selected?.stream.subtitles);
    }, [player.selected]);

    const externalSubtitles = useMemo(() => {
        return withFallbackLabels(player.subtitles);
    }, [player.subtitles]);

    const allTracks = useMemo(() => {
        return video.state.subtitlesTracks.concat(video.state.extraSubtitlesTracks);
    }, [video.state.subtitlesTracks, video.state.extraSubtitlesTracks]);

    const hasTracks = allTracks.length > 0;
    const applySubtitleStyle = useCallback(() => {
        const currentSettings = settingsRef.current;
        const currentVideo = videoRef.current;

        currentVideo.setSubtitlesSize(currentSettings.subtitlesSize);
        currentVideo.setSubtitlesOffset(currentSettings.subtitlesOffset);
        currentVideo.setSubtitlesTextColor(currentSettings.subtitlesTextColor);
        currentVideo.setSubtitlesBackgroundColor(currentSettings.subtitlesBackgroundColor);
        currentVideo.setSubtitlesOutlineColor(currentSettings.subtitlesOutlineColor);
    }, []);

    const rememberTrack = useCallback((track: SubtitleTrack, embedded: boolean) => {
        const language = normalizeLanguage(track.lang);
        lastSelectedTrack.current = {
            id: track.id,
            embedded,
            ...(language ? { language } : {}),
        };
        streamStateChanged({
            subtitleTrack: {
                id: track.id,
                embedded,
                language: track.lang,
            },
        });
        subtitlePreferenceChanged({
            enabled: true,
            source: embedded ? 'embedded' : 'external',
            ...(language ? { language } : {}),
        });
    }, [streamStateChanged, subtitlePreferenceChanged]);

    const disableSubtitles = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        const videoEl = document.querySelector('video');
        if (videoEl && videoEl.textTracks) {
            Array.from(videoEl.textTracks).forEach((track) => {
                try {
                    track.mode = 'disabled';
                } catch (_e) {
                    // Ignore on non-configurable tracks
                }
            });
        }

        const selectedTrack = video.state.selectedSubtitlesTrackId !== null ?
            findTrackById(video.state.subtitlesTracks, video.state.selectedSubtitlesTrackId)
            :
            findTrackById(video.state.extraSubtitlesTracks, video.state.selectedExtraSubtitlesTrackId);
        const selectedSource = video.state.selectedSubtitlesTrackId !== null ?
            'embedded'
            :
            video.state.selectedExtraSubtitlesTrackId !== null ?
                'external'
                :
                undefined;
        const source = player.subtitlePreference?.source ?? selectedSource;
        const language = player.subtitlePreference?.language ?? normalizeLanguage(selectedTrack?.lang);

        trackSelectionLocked.current = true;
        appliedTrack.current = null;
        setSubtitlesTrack(null);
        setExtraSubtitlesTrack(null);
        streamStateChanged({ subtitleTrack: null });
        subtitlePreferenceChanged({
            enabled: false,
            ...(source ? { source } : {}),
            ...(language ? { language } : {}),
        });
    }, [
        player.subtitlePreference,
        streamStateChanged,
        subtitlePreferenceChanged,
        setSubtitlesTrack,
        setExtraSubtitlesTrack,
        video.state.subtitlesTracks,
        video.state.extraSubtitlesTracks,
        video.state.selectedSubtitlesTrackId,
        video.state.selectedExtraSubtitlesTrackId,
    ]);

    const selectEmbeddedTrack = useCallback((track: SubtitleTrack | null) => {
        if (!track) {
            disableSubtitles();
            return;
        }

        trackSelectionLocked.current = true;
        appliedTrack.current = { id: track.id, source: 'embedded' };
        setSubtitlesTrack(track.id);
        rememberTrack(track, true);
    }, [disableSubtitles, rememberTrack, setSubtitlesTrack]);

    const selectExtraTrack = useCallback((track: SubtitleTrack | null) => {
        if (!track) {
            disableSubtitles();
            return;
        }

        trackSelectionLocked.current = true;
        appliedTrack.current = { id: track.id, source: 'external' };
        setExtraSubtitlesTrack(track.id);
        rememberTrack(track, false);
    }, [disableSubtitles, rememberTrack, setExtraSubtitlesTrack]);

    const changeDelay = useCallback((delay: number) => {
        setSubtitlesDelay(delay);
        streamStateChanged({ subtitleDelay: delay });
    }, [streamStateChanged, setSubtitlesDelay]);

    const finishSubtitleDelayHold = useCallback((applyStep: boolean) => {
        const hold = subtitleDelayHold.current;
        subtitleDelayInterval.cancel();
        subtitleDelayTimeout.cancel();
        subtitleDelayHold.current = null;

        if (applyStep && hold && !hold.repeated) {
            const delay = hold.value + hold.direction * SUBTITLES_DELAY_STEP_MS;
            changeDelay(snapSubtitleDelay(delay, hold.direction));
        }
    }, [changeDelay]);

    const startSubtitleDelayHold = useCallback((combo: number, key: string, repeat: boolean) => {
        if (repeat || subtitleDelayHold.current) return;

        const hold = {
            direction: combo === 1 ? 1 : -1,
            key: key.toUpperCase(),
            repeated: false,
            startedAt: performance.now(),
            stream: videoRef.current.state.stream,
            value: videoRef.current.state.extraSubtitlesDelay ?? 0,
        };
        subtitleDelayHold.current = hold;

        subtitleDelayTimeout.start(() => subtitleDelayInterval.start(() => {
            if (subtitleDelayHold.current !== hold) return;
            if (videoRef.current.state.stream !== hold.stream) {
                finishSubtitleDelayHold(false);
                return;
            }

            hold.repeated = true;
            const multiplier = getSubtitleDelayStepMultiplier(performance.now() - hold.startedAt);
            const delay = hold.value + hold.direction * SUBTITLES_DELAY_STEP_MS * multiplier;
            hold.value = snapSubtitleDelay(delay, hold.direction);
            changeDelay(hold.value);
        }));
    }, [changeDelay, finishSubtitleDelayHold]);

    useEffect(() => {
        const onKeyUp = (event: KeyboardEvent) => {
            const key = subtitleDelayHold.current?.key;
            if (!key) return;

            const keys = getKeyboardShortcutKeys(event);
            if (keys.includes(`Key${key}`) || keys.includes(key)) {
                finishSubtitleDelayHold(true);
            }
        };
        const onBlur = () => finishSubtitleDelayHold(false);

        document.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);
        return () => {
            document.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
        };
    }, [finishSubtitleDelayHold]);

    useEffect(() => {
        if (menusOpen) finishSubtitleDelayHold(false);
    }, [finishSubtitleDelayHold, menusOpen]);

    const changeSize = useCallback((size: number) => {
        setSubtitlesSize(size);
        streamStateChanged({ subtitleSize: size });
    }, [streamStateChanged, setSubtitlesSize]);

    const updateSize = useCallback((delta: number) => {
        const sizes = CONSTANTS.SUBTITLES_SIZES as number[];
        const sizeIndex = sizes.indexOf(video.state.subtitlesSize ?? -1);
        const nextIndex = Math.max(0, Math.min(sizes.length - 1, sizeIndex + delta));

        changeSize(sizes[nextIndex]);
    }, [changeSize, video.state.subtitlesSize]);

    const changeOffset = useCallback((offset: number) => {
        setSubtitlesOffset(offset);
        streamStateChanged({ subtitleOffset: offset });
    }, [streamStateChanged, setSubtitlesOffset]);

    const onSubtitlesDrop = useCallback((file: File, buffer: ArrayBuffer) => {
        videoRef.current.addLocalSubtitles(file.name, buffer);
    }, []);

    useFileDropListener(CONSTANTS.SUPPORTED_LOCAL_SUBTITLES, onSubtitlesDrop);

    useEffect(() => {
        if (video.state.stream !== null) {
            video.addExtraSubtitlesTracks(externalSubtitles);
        }
    }, [externalSubtitles, video.state.stream]);

    useEffect(() => {
        trackSelectionLocked.current = false;
        appliedTrack.current = null;
        lastSelectedTrack.current = null;
        autoSyncAttemptedStream.current = null;
        setAutoSyncInfo(null);
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
    }, [video.state.stream]);

    useEffect(() => {
        if (trackSelectionLocked.current) {
            return;
        }

        const sessionPreference = player.subtitlePreference;
        const sessionEnabled = sessionPreference?.enabled === true;

        if (sessionPreference?.enabled === false || (!sessionEnabled && settings.subtitlesLanguage === null)) {
            if (video.state.selectedSubtitlesTrackId !== null ||
                video.state.selectedExtraSubtitlesTrackId !== null) {
                setSubtitlesTrack(null);
                setExtraSubtitlesTrack(null);
            }
            appliedTrack.current = null;
            return;
        }

        const savedTrack = player.streamState?.subtitleTrack;
        const candidates = buildCandidates(sessionPreference, savedTrack, settings.subtitlesLanguage);
        const bestCandidate = resolveBestCandidate(
            candidates,
            video.state.subtitlesTracks,
            video.state.extraSubtitlesTracks,
        );
        const selectedSource = video.state.selectedSubtitlesTrackId !== null ?
            'embedded'
            :
            video.state.selectedExtraSubtitlesTrackId !== null ?
                'external'
                :
                undefined;
        const selectedTrack = selectedSource === 'embedded' ?
            findTrackById(video.state.subtitlesTracks, video.state.selectedSubtitlesTrackId)
            :
            selectedSource === 'external' ?
                findTrackById(video.state.extraSubtitlesTracks, video.state.selectedExtraSubtitlesTrackId)
                :
                undefined;

        if (!bestCandidate) {
            if (sessionEnabled && selectedTrack) {
                setSubtitlesTrack(null);
                setExtraSubtitlesTrack(null);
            }
            appliedTrack.current = null;
            return;
        }

        const selectedRank = selectedTrack && selectedSource ?
            findCandidateRank(candidates, selectedSource, selectedTrack)
            :
            -1;
        const trackToApply = selectedRank === bestCandidate.rank && selectedTrack && selectedSource ?
            { source: selectedSource, track: selectedTrack }
            :
            bestCandidate;

        // Reapply once per stream even if the controller already reports the same track.
        if (appliedTrack.current?.id === trackToApply.track.id &&
            appliedTrack.current.source === trackToApply.source) {
            return;
        }

        trackToApply.source === 'embedded' ?
            setSubtitlesTrack(trackToApply.track.id)
            :
            setExtraSubtitlesTrack(trackToApply.track.id);

        const delay = player.streamState?.subtitleDelay;
        // Selecting an external track resets its delay in stremio-video.
        if (trackToApply.source === 'external' && typeof delay === 'number') {
            setSubtitlesDelay(delay);
        }
        appliedTrack.current = {
            id: trackToApply.track.id,
            source: trackToApply.source,
        };
    }, [
        player.subtitlePreference,
        player.streamState,
        settings.subtitlesLanguage,
        setSubtitlesTrack,
        setExtraSubtitlesTrack,
        setSubtitlesDelay,
        video.state.extraSubtitlesTracks,
        video.state.selectedExtraSubtitlesTrackId,
        video.state.selectedSubtitlesTrackId,
        video.state.stream,
        video.state.subtitlesTracks,
    ]);

    useEffect(() => {
        if (video.state.stream === null) {
            return;
        }

        const delay = player.streamState?.subtitleDelay;
        if (typeof delay === 'number') {
            setSubtitlesDelay(delay);
        }

        const size = player.streamState?.subtitleSize;
        if (typeof size === 'number') {
            setSubtitlesSize(size);
        }

        const offset = player.streamState?.subtitleOffset;
        if (typeof offset === 'number') {
            setSubtitlesOffset(offset);
        }
    }, [player.streamState, video.state.stream, setSubtitlesDelay, setSubtitlesSize, setSubtitlesOffset]);

    const triggerAutoSync = useCallback(async () => {
        const videoEl = document.querySelector('video');
        if (!videoEl) {
            toast.show({
                type: 'error',
                title: 'Playback Video Missing',
                message: 'Cannot access video audio track.',
                timeout: 3000,
            });
            return;
        }

        const candidateTracks = videoRef.current.state.extraSubtitlesTracks;
        if (!candidateTracks || candidateTracks.length === 0) {
            if (videoRef.current.state.selectedSubtitlesTrackId) {
                const track = findTrackById(videoRef.current.state.subtitlesTracks, videoRef.current.state.selectedSubtitlesTrackId);
                setAutoSyncInfo({
                    isAutoSynced: true,
                    isSyncing: false,
                    isEmbedded: true,
                    bestTrack: track || null,
                    confidence: 1.0,
                    recommendedOffset: 0.0,
                    message: 'Embedded stream subtitle is naturally aligned with audio container.',
                });
                toast.show({
                    type: 'info',
                    title: 'Embedded Subtitle Aligned',
                    message: 'Embedded stream track is muxed in sync with audio container.',
                    timeout: 3500,
                });
                return;
            }

            toast.show({
                type: 'info',
                title: 'No Add-on Subtitles Found',
                message: 'No external subtitle candidates available to match against audio.',
                timeout: 3000,
            });
            return;
        }

        const targetLang = normalizeLanguage(
            player.subtitlePreference?.language ?? settings.subtitlesLanguage ?? CONSTANTS.DEFAULT_SUBTITLES_LANGUAGE
        );
        const matchingTracks = targetLang
            ? candidateTracks.filter((t) => normalizeLanguage(t.lang) === targetLang)
            : candidateTracks;

        if (matchingTracks.length === 0) {
            toast.show({
                type: 'info',
                title: 'No Matching Language Subtitles',
                message: `No external subtitles found for language: ${targetLang || 'selected'}`,
                timeout: 3000,
            });
            return;
        }

        setAutoSyncInfo({
            isAutoSynced: false,
            isSyncing: true,
            bestTrack: null,
            confidence: 0,
            recommendedOffset: 0,
        });

        toast.show({
            type: 'info',
            title: 'Analyzing Audio & Subtitles...',
            message: `Probing speech presence across ${matchingTracks.length} candidate track(s)...`,
            timeout: 3000,
        });

        try {
            const probeSeconds = 20;
            const audioProfile = await AudioVADProbe.captureVoiceProfile(videoEl, {
                durationSeconds: probeSeconds,
            });

            const selection = await SmartSubtitleSelector.rankAndSelect(audioProfile, matchingTracks, {
                durationSeconds: probeSeconds,
                minConfidence: 0.70,
            });

            if (selection.isAutoSynced && selection.bestTrack) {
                selectExtraTrack(selection.bestTrack);
                const delayMs = Math.round(selection.recommendedOffset * 1000);
                changeDelay(delayMs);

                setAutoSyncInfo({
                    isAutoSynced: true,
                    isSyncing: false,
                    bestTrack: selection.bestTrack,
                    confidence: selection.confidence,
                    recommendedOffset: selection.recommendedOffset,
                });

                toast.show({
                    type: 'success',
                    title: 'Acoustic Subtitle Synced',
                    message: `${selection.bestTrack.label || selection.bestTrack.lang} (${Math.round(selection.confidence * 100)}% match, ${selection.recommendedOffset >= 0 ? '+' : ''}${selection.recommendedOffset.toFixed(2)}s)`,
                    timeout: 4000,
                });
            } else {
                setAutoSyncInfo({
                    isAutoSynced: false,
                    isSyncing: false,
                    bestTrack: selection.bestTrack || null,
                    confidence: selection.confidence,
                    recommendedOffset: selection.recommendedOffset,
                    message: `Best candidate confidence was ${(selection.confidence * 100).toFixed(0)}% (threshold: 70%)`,
                });
                toast.show({
                    type: 'info',
                    title: 'Low Acoustic Correlation',
                    message: `Best match was only ${(selection.confidence * 100).toFixed(0)}%. You can adjust delay manually.`,
                    timeout: 4000,
                });
            }
        } catch (err: any) {
            console.warn('[SmartSubtitles] Manual acoustic sync error:', err);
            setAutoSyncInfo(null);
            toast.show({
                type: 'error',
                title: 'Acoustic Sync Failed',
                message: err?.message || 'Error processing audio spectrum.',
                timeout: 3000,
            });
        }
    }, [
        changeDelay,
        player.subtitlePreference,
        selectExtraTrack,
        settings.subtitlesLanguage,
        toast,
    ]);

    // Dynamic Acoustic Subtitle Matcher: probes voice presence and auto-selects & retimes best subtitle
    useEffect(() => {
        const stream = video.state.stream;
        if (!stream || video.state.paused === true) {
            return;
        }

        if (autoSyncAttemptedStream.current === stream) {
            return;
        }

        if (trackSelectionLocked.current || player.subtitlePreference?.enabled === false) {
            return;
        }

        // If embedded subtitles are already active, they are naturally aligned with container.
        if (video.state.selectedSubtitlesTrackId !== null) {
            autoSyncAttemptedStream.current = stream;
            return;
        }

        const candidateTracks = video.state.extraSubtitlesTracks;
        if (!candidateTracks || candidateTracks.length === 0) {
            autoSyncAttemptedStream.current = stream;
            return;
        }

        const targetLang = normalizeLanguage(
            player.subtitlePreference?.language ?? settings.subtitlesLanguage ?? CONSTANTS.DEFAULT_SUBTITLES_LANGUAGE
        );
        const matchingTracks = targetLang
            ? candidateTracks.filter((t) => normalizeLanguage(t.lang) === targetLang)
            : candidateTracks;

        if (matchingTracks.length === 0) {
            autoSyncAttemptedStream.current = stream;
            return;
        }

        const videoEl = document.querySelector('video');
        if (!videoEl) {
            return;
        }

        autoSyncAttemptedStream.current = stream;
        const abortCtrl = new AbortController();
        abortControllerRef.current = abortCtrl;

        const probeSeconds = 20;
        AudioVADProbe.captureVoiceProfile(videoEl, {
            durationSeconds: probeSeconds,
            signal: abortCtrl.signal,
        }).then(async (audioProfile: Float32Array) => {
            if (abortCtrl.signal.aborted || videoRef.current.state.stream !== stream) {
                return;
            }

            const selection = await SmartSubtitleSelector.rankAndSelect(audioProfile, matchingTracks, {
                durationSeconds: probeSeconds,
                signal: abortCtrl.signal,
                minConfidence: 0.75,
            });

            if (abortCtrl.signal.aborted || videoRef.current.state.stream !== stream) {
                return;
            }

            if (selection.isAutoSynced && selection.bestTrack && !trackSelectionLocked.current && player.subtitlePreference?.enabled !== false) {
                selectExtraTrack(selection.bestTrack);
                const delayMs = Math.round(selection.recommendedOffset * 1000);
                changeDelay(delayMs);

                const syncData = {
                    isAutoSynced: true,
                    isSyncing: false,
                    bestTrack: selection.bestTrack,
                    confidence: selection.confidence,
                    recommendedOffset: selection.recommendedOffset,
                };
                setAutoSyncInfo(syncData);
            }
        }).catch((err: any) => {
            if (!abortCtrl.signal.aborted) {
                console.warn('[SmartSubtitles] Acoustic sync probe error:', err);
            }
        });

        return () => {
            abortCtrl.abort();
        };
    }, [
        changeDelay,
        player.subtitlePreference,
        selectExtraTrack,
        settings.subtitlesLanguage,
        toast,
        video.state.extraSubtitlesTracks,
        video.state.paused,
        video.state.selectedSubtitlesTrackId,
        video.state.stream,
        video.state.subtitlesTracks,
    ]);

    useEffect(() => {
        if (!hasTracks) {
            closeSubtitlesMenu();
        }
    }, [closeSubtitlesMenu, hasTracks]);

    useEffect(() => {
        const onSubtitlesTrackLoaded = () => {
            toast.show({
                type: 'success',
                title: t('PLAYER_SUBTITLES_LOADED'),
                message: t('PLAYER_SUBTITLES_LOADED_EMBEDDED'),
                timeout: 3000,
            });
        };

        const onExtraSubtitlesTrackLoaded = (track: SubtitleTrack) => {
            toast.show({
                type: 'success',
                title: t('PLAYER_SUBTITLES_LOADED'),
                message: track.exclusive ?
                    t('PLAYER_SUBTITLES_LOADED_EXCLUSIVE')
                    :
                    track.local ?
                        t('PLAYER_SUBTITLES_LOADED_LOCAL')
                        :
                        t('PLAYER_SUBTITLES_LOADED_ORIGIN', { origin: track.origin }),
                timeout: 3000,
            });
        };

        const onExtraSubtitlesTrackAdded = (track: SubtitleTrack) => {
            if (track.local) {
                videoRef.current.setExtraSubtitlesTrack(track.id);
            }
        };

        video.events.on('subtitlesTrackLoaded', onSubtitlesTrackLoaded);
        video.events.on('extraSubtitlesTrackLoaded', onExtraSubtitlesTrackLoaded);
        video.events.on('extraSubtitlesTrackAdded', onExtraSubtitlesTrackAdded);
        video.events.on('implementationChanged', applySubtitleStyle);

        return () => {
            video.events.off('subtitlesTrackLoaded', onSubtitlesTrackLoaded);
            video.events.off('extraSubtitlesTrackLoaded', onExtraSubtitlesTrackLoaded);
            video.events.off('extraSubtitlesTrackAdded', onExtraSubtitlesTrackAdded);
            video.events.off('implementationChanged', applySubtitleStyle);
        };
    }, [applySubtitleStyle, t, toast, video.events]);

    useShortcut('subtitlesDelay', startSubtitleDelayHold, !menusOpen);

    useShortcut('subtitlesSize', useCallback((combo) => {
        combo === 1 ? updateSize(1) : updateSize(-1);
    }, [updateSize]), !menusOpen);

    useShortcut('toggleSubtitles', useCallback(() => {
        const isCurrentlyEnabled = (
            video.state.selectedSubtitlesTrackId !== null ||
            video.state.selectedExtraSubtitlesTrackId !== null
        );

        if (isCurrentlyEnabled) {
            if (video.state.selectedSubtitlesTrackId) {
                const track = findTrackById(
                    video.state.subtitlesTracks,
                    video.state.selectedSubtitlesTrackId,
                );
                const language = normalizeLanguage(track?.lang);
                lastSelectedTrack.current = {
                    id: video.state.selectedSubtitlesTrackId,
                    embedded: true,
                    ...(language ? { language } : {}),
                };
            } else if (video.state.selectedExtraSubtitlesTrackId) {
                const track = findTrackById(
                    video.state.extraSubtitlesTracks,
                    video.state.selectedExtraSubtitlesTrackId,
                );
                const language = normalizeLanguage(track?.lang);
                lastSelectedTrack.current = {
                    id: video.state.selectedExtraSubtitlesTrackId,
                    embedded: false,
                    ...(language ? { language } : {}),
                };
            }

            disableSubtitles();
            toast.show({
                type: 'info',
                title: t('PLAYER_SUBTITLES_DISABLED') || 'Subtitles Off',
                timeout: 2000,
            });
            return;
        }

        // Subtitles are currently OFF -> Enable them!
        trackSelectionLocked.current = false;
        appliedTrack.current = null;
        const saved = player.streamState?.subtitleTrack ?? lastSelectedTrack.current;
        let trackToEnable: { track: SubtitleTrack, embedded: boolean } | undefined;

        if (saved?.id) {
            if (saved.embedded) {
                const trk = findTrackById(video.state.subtitlesTracks, saved.id);
                if (trk) trackToEnable = { track: trk, embedded: true };
            } else {
                const trk = findTrackById(video.state.extraSubtitlesTracks, saved.id);
                if (trk) trackToEnable = { track: trk, embedded: false };
            }
        }

        if (!trackToEnable) {
            const targetLang = normalizeLanguage(
                player.subtitlePreference?.language ?? settings.subtitlesLanguage ?? CONSTANTS.DEFAULT_SUBTITLES_LANGUAGE
            );
            const candidates = buildCandidates({ enabled: true, language: targetLang }, null, targetLang);
            const best = resolveBestCandidate(candidates, video.state.subtitlesTracks, video.state.extraSubtitlesTracks);
            if (best) {
                trackToEnable = { track: best.track, embedded: best.source === 'embedded' };
            } else if (video.state.subtitlesTracks.length > 0) {
                trackToEnable = { track: video.state.subtitlesTracks[0], embedded: true };
            } else if (video.state.extraSubtitlesTracks.length > 0) {
                trackToEnable = { track: video.state.extraSubtitlesTracks[0], embedded: false };
            }
        }

        if (trackToEnable) {
            if (trackToEnable.embedded) {
                selectEmbeddedTrack(trackToEnable.track);
            } else {
                selectExtraTrack(trackToEnable.track);
            }
        } else {
            toast.show({
                type: 'info',
                title: t('PLAYER_SUBTITLES_DISABLED') || 'No Subtitles Available',
                timeout: 2000,
            });
        }
    }, [
        disableSubtitles,
        player.subtitlePreference,
        player.streamState,
        selectEmbeddedTrack,
        selectExtraTrack,
        settings.subtitlesLanguage,
        t,
        toast,
        video.state.extraSubtitlesTracks,
        video.state.selectedExtraSubtitlesTrackId,
        video.state.selectedSubtitlesTrackId,
        video.state.subtitlesTracks,
    ]), !menusOpen);

    useShortcut('subtitlesMenu', useCallback(() => {
        closeMenus();
        if (hasTracks) {
            toggleSubtitlesMenu();
        }
    }, [closeMenus, hasTracks, toggleSubtitlesMenu]));

    const menuProps = useMemo(() => ({
        autoSyncInfo,
        onTriggerAutoSync: triggerAutoSync,
        subtitlesLanguage: settings.subtitlesLanguage,
        interfaceLanguage: settings.interfaceLanguage,
        subtitlesTracks: video.state.subtitlesTracks,
        selectedSubtitlesTrackId: video.state.selectedSubtitlesTrackId,
        subtitlesOffset: video.state.subtitlesOffset,
        subtitlesSize: video.state.subtitlesSize,
        extraSubtitlesTracks: video.state.extraSubtitlesTracks,
        selectedExtraSubtitlesTrackId: video.state.selectedExtraSubtitlesTrackId,
        extraSubtitlesOffset: video.state.extraSubtitlesOffset,
        extraSubtitlesDelay: video.state.extraSubtitlesDelay,
        extraSubtitlesSize: video.state.extraSubtitlesSize,
        assSubtitlesStylingActive: video.state.assSubtitlesStylingActive,
        onSubtitlesTrackSelected: selectEmbeddedTrack,
        onExtraSubtitlesTrackSelected: selectExtraTrack,
        onSubtitlesOffsetChanged: changeOffset,
        onSubtitlesSizeChanged: changeSize,
        onExtraSubtitlesOffsetChanged: changeOffset,
        onExtraSubtitlesDelayChanged: changeDelay,
        onExtraSubtitlesSizeChanged: changeSize,
    }), [
        autoSyncInfo,
        changeDelay,
        changeOffset,
        changeSize,
        selectEmbeddedTrack,
        selectExtraTrack,
        settings.interfaceLanguage,
        settings.subtitlesLanguage,
        triggerAutoSync,
        video.state.extraSubtitlesDelay,
        video.state.extraSubtitlesOffset,
        video.state.extraSubtitlesSize,
        video.state.extraSubtitlesTracks,
        video.state.assSubtitlesStylingActive,
        video.state.selectedExtraSubtitlesTrackId,
        video.state.selectedSubtitlesTrackId,
        video.state.subtitlesOffset,
        video.state.subtitlesSize,
        video.state.subtitlesTracks,
    ]);

    return {
        streamSubtitles,
        allSubtitleTracks: allTracks,
        extraSubtitleTracks: video.state.extraSubtitlesTracks,
        selectedExtraSubtitleTrackId: video.state.selectedExtraSubtitlesTrackId,
        subtitlesMenuProps: menuProps,
        autoSyncInfo,
    };
};

export default useSubtitles;
