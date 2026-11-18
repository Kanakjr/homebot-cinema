import React, { forwardRef, useMemo } from 'react';
import classNames from 'classnames';
import { Image } from 'stremio/components';
import styles from './Buffering.less';

type Props = {
    className: string,
    logo: string,
    progress: number,
    loaded?: boolean,
};

const Buffering = forwardRef<HTMLDivElement, Props>(({ className, logo, progress, loaded }, ref) => {
    const style = useMemo(() => {
        return {
            clipPath: `inset(0 ${100 - progress}% 0 0)`,
        };
    }, [progress]);

    // `progress` is how much of the file the server already holds, not how much the player buffered: it reads
    // 100% from the start for a file on disk or a cached stream. Show a number only while it is a real partial value.
    const statusText = !loaded
        ? 'Connecting…'
        : typeof progress === 'number' && progress > 0 && progress < 100
            ? `Buffering ${Math.round(progress)}%`
            : 'Buffering…';

    return (
        <div ref={ref} className={classNames(className, styles['buffering'])}>
            <div className={styles['content']}>
                <div className={styles['logo-container']}>
                    <Image
                        className={styles['logo']}
                        style={style}
                        src={logo}
                        alt={' '}
                        fallbackSrc={require('/assets/images/stremio_symbol.png')}
                    />
                    <Image
                        className={classNames(styles['logo'], styles['background'])}
                        src={logo}
                        alt={' '}
                        fallbackSrc={require('/assets/images/stremio_symbol.png')}
                    />
                </div>
                <div className={styles['status-container']}>
                    <div className={styles['spinner']} />
                    <span className={styles['status-label']}>{statusText}</span>
                </div>
            </div>
        </div>
    );
});

export default Buffering;
