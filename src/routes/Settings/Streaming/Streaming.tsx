import React, { forwardRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { Button, MultiselectMenu } from 'stremio/components';
import { useToast } from 'stremio/common';
import { Section, Option } from '../components';
import URLsManager from './URLsManager';
import useStreamingOptions from './useStreamingOptions';
import styles from './Streaming.less';

type Props = {
    profile: Profile,
    streamingServer: StreamingServer,
};

// HomeBot: the app always uses its own origin as the streaming server (src/App/App.js resets anything else), so the URL list
// with "Add URL" only confuses. Hidden instead of deleted to keep upstream merges small.
const SERVER_URL_EDITING = false;

const Streaming = forwardRef<HTMLDivElement, Props>(({ profile, streamingServer }: Props, ref) => {
    const { t } = useTranslation();
    const toast = useToast();

    const {
        streamingServerRemoteUrlInput,
        remoteEndpointSelect,
        cacheSizeSelect,
        cacheLocationSelect,
        cacheLocationError,
        settingsDisabled,
        torrentProfileSelect,
        transcodingProfileSelect,
    } = useStreamingOptions(streamingServer);
    // HomeBot: these are server-wide settings (one streaming server for the household): only admins change them. The server
    // enforces it too (POST /settings is admin-only in http_server.js).
    const canEdit = !!(window as any).ssoIsAdmin;
    const locked = settingsDisabled || !canEdit;

    const onCopyRemoteUrl = useCallback(() => {
        if (streamingServer.remoteUrl) {
            navigator.clipboard.writeText(streamingServer.remoteUrl);

            toast.show({
                type: 'success',
                title: t('SETTINGS_REMOTE_URL_COPIED'),
                timeout: 2500,
            });
        }
    }, [streamingServer.remoteUrl]);

    return (
        <Section ref={ref} label={'SETTINGS_NAV_STREAMING'}>
            {SERVER_URL_EDITING && <URLsManager selectedUrl={profile.settings.streamingServerUrl} settings={streamingServer.settings} />}
            {!canEdit && <div style={{ opacity: 0.6, fontSize: '0.9rem', marginBottom: '1rem' }}>{t('HOMEBOT_STREAMING_ADMIN_NOTE', 'These settings apply to the whole household. Only an admin can change them.')}</div>}
            {
                streamingServerRemoteUrlInput.value !== null &&
                    <Option className={styles['configure-input-container']} label={'SETTINGS_REMOTE_URL'}>
                        <div className={styles['label']} title={streamingServerRemoteUrlInput.value}>{streamingServerRemoteUrlInput.value}</div>
                        <Button className={styles['configure-button-container']} title={t('SETTINGS_COPY_REMOTE_URL')} onClick={onCopyRemoteUrl}>
                            <Icon className={styles['icon']} name={'link'} />
                        </Button>
                    </Option>
            }
            {
                profile.auth !== null && profile.auth.user !== null && remoteEndpointSelect !== null &&
                    <Option label={'SETTINGS_HTTPS_ENDPOINT'}>
                        <MultiselectMenu
                            className={'multiselect'}
                            {...remoteEndpointSelect}
                            disabled={locked}
                        />
                    </Option>
            }
            {
                cacheSizeSelect !== null &&
                    <Option label={'SETTINGS_SERVER_CACHE_SIZE'}>
                        <MultiselectMenu
                            className={'multiselect'}
                            {...cacheSizeSelect}
                            disabled={locked}
                        />
                    </Option>
            }
            {
                cacheLocationSelect !== null &&
                    <Option className={styles['cache-location-container']} label={'SETTINGS_CACHING_DRIVE'}>
                        <div className={styles['cache-location-control']} title={cacheLocationSelect.title}>
                            <MultiselectMenu
                                className={'multiselect'}
                                {...cacheLocationSelect}
                                disabled={(cacheLocationSelect as any).disabled || !canEdit}
                            />
                            {cacheLocationError && <div className={styles['cache-location-error']} role={'alert'}>{cacheLocationError}</div>}
                        </div>
                    </Option>
            }
            {
                torrentProfileSelect !== null &&
                    <Option label={'SETTINGS_SERVER_TORRENT_PROFILE'}>
                        <MultiselectMenu
                            className={'multiselect'}
                            {...torrentProfileSelect}
                            disabled={locked}
                        />
                    </Option>
            }
            {
                transcodingProfileSelect !== null &&
                    <Option label={'SETTINGS_TRANSCODE_PROFILE'}>
                        <MultiselectMenu
                            className={'multiselect'}
                            {...transcodingProfileSelect}
                            disabled={locked}
                        />
                    </Option>
            }
        </Section>
    );
});

export default Streaming;
