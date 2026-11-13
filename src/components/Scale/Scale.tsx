import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import styles from './Scale.less';

type Props = {
    value: number,
    options: number[],
    tabIndex?: number,
    onChange: (value: number) => void,
};

const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Keep arrow keys on the range instead of spatial navigation.
    if (event.key.startsWith('Arrow')) event.stopPropagation();
};

// The slider moves between the listed choices (by position), so the choices need not be evenly spaced numbers.
const Scale = ({ options, value, tabIndex, onChange }: Props) => {
    const { t } = useTranslation();
    const [preview, setPreview] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);
    const dragging = useRef<number | null>(null);

    const onTickClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        onChange(Number(event.currentTarget.value));
    }, [onChange]);

    const onPointerDown = useCallback((event: React.PointerEvent<HTMLInputElement>) => {
        if (event.isPrimary && event.button === 0) dragging.current = event.pointerId;
    }, []);

    const onInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const next = options[event.currentTarget.valueAsNumber] ?? value;
        setPreview(next);
        // Zooming during a drag moves the slider underneath the pointer.
        if (dragging.current === null) onChange(next);
    }, [onChange, options, value]);

    useEffect(() => {
        setPreview(value);
    }, [value]);

    useEffect(() => {
        const finishDrag = (event: PointerEvent) => {
            if (dragging.current !== event.pointerId || !inputRef.current) return;
            dragging.current = null;
            onChange(options[inputRef.current.valueAsNumber] ?? value);
        };
        const cancelDrag = () => {
            if (dragging.current === null) return;
            dragging.current = null;
            setPreview(value);
        };

        // Let the native range own pointer capture; taking it breaks WebKit dragging.
        document.addEventListener('pointerup', finishDrag, true);
        document.addEventListener('pointercancel', cancelDrag, true);
        window.addEventListener('blur', cancelDrag);
        return () => {
            document.removeEventListener('pointerup', finishDrag, true);
            document.removeEventListener('pointercancel', cancelDrag, true);
            window.removeEventListener('blur', cancelDrag);
        };
    }, [value, options, onChange]);

    return (
        <div className={styles['scale']}>
            <div className={styles['ticks']} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
                {
                    options.map((tick) => (
                        <button
                            type={'button'}
                            value={tick}
                            className={classNames(styles['label'], { [styles['active']]: preview === tick })}
                            key={tick}
                            aria-pressed={preview === tick}
                            onClick={onTickClick}
                        >
                            {options.length > 6 ? (preview === tick ? `${tick}%` : tick) : `${tick}%`}
                        </button>
                    ))
                }
            </div>
            <input
                ref={inputRef}
                type={'range'}
                tabIndex={tabIndex}
                aria-label={t('SETTINGS_UI_ZOOM')}
                aria-valuetext={`${preview}%`}
                value={Math.max(0, options.indexOf(preview))}
                min={0}
                max={options.length - 1}
                step={1}
                onKeyDown={onKeyDown}
                onPointerDown={onPointerDown}
                onChange={onInputChange}
            />
        </div>
    );
};

export default Scale;
