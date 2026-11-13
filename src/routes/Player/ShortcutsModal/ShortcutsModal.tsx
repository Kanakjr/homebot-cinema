import React from 'react';
import classnames from 'classnames';
import styles from './ShortcutsModal.less';

type Props = {
    className?: string;
    onClose: () => void;
};

const SHORTCUT_SECTIONS = [
    {
        title: '🎬 Playback & Seeking',
        items: [
            { label: 'Jump to 0% – 90%', keys: ['0 – 9'] },
            { label: 'Play / Pause', keys: ['Space', 'K'] },
            { label: 'Seek ±5 seconds', keys: ['←', '→'] },
            { label: 'Seek ±10 seconds', keys: ['J', 'L'] },
            { label: 'Next Video / Episode', keys: ['Shift + N'] },
        ]
    },
    {
        title: '🔊 Audio & Volume',
        items: [
            { label: 'Volume Up / Down', keys: ['↑', '↓'] },
            { label: 'Mute / Unmute', keys: ['M'] },
            { label: 'Audio Tracks Menu', keys: ['A'] },
        ]
    },
    {
        title: '💬 Subtitles',
        items: [
            { label: 'Toggle Subtitles On/Off', keys: ['C'] },
            { label: 'Subtitles Menu', keys: ['S'] },
            { label: 'Subtitle Delay ±50ms', keys: ['G', 'H'] },
            { label: 'Subtitle Size Up/Down', keys: ['-', '='] },
        ]
    },
    {
        title: '⚙️ Controls & Display',
        items: [
            { label: 'Speed ±0.25x', keys: ['<', '>'] },
            { label: 'Speed Menu', keys: ['R'] },
            { label: 'Toggle Fullscreen', keys: ['F'] },
            { label: 'Aspect Ratio Mode', keys: ['V'] },
            { label: 'Stream Statistics', keys: ['D'] },
            { label: 'Shortcuts Guide', keys: ['?'] },
            { label: 'Exit / Close Menu', keys: ['Esc'] },
        ]
    }
];

const ShortcutsModal = ({ className, onClose }: Props) => {
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [onClose]);

    return (
        <div className={classnames(styles['shortcuts-modal-overlay'], className)} onClick={onClose}>
            <div className={styles['shortcuts-modal-card']} onClick={(e) => e.stopPropagation()}>
                <div className={styles['shortcuts-modal-header']}>
                    <div className={styles['title-group']}>
                        <span className={styles['icon']}>⚡</span>
                        <span className={styles['title']}>HomeBot Cinema Hotkeys & Shortcuts</span>
                    </div>
                    <button className={styles['close-button']} onClick={onClose} title="Close (Esc)">
                        ✕
                    </button>
                </div>
                <div className={styles['shortcuts-modal-body']}>
                    {SHORTCUT_SECTIONS.map((section, idx) => (
                        <div key={idx} className={styles['shortcuts-section']}>
                            <div className={styles['section-title']}>{section.title}</div>
                            <div className={styles['shortcut-list']}>
                                {section.items.map((item, itemIdx) => (
                                    <div key={itemIdx} className={styles['shortcut-row']}>
                                        <span className={styles['label']}>{item.label}</span>
                                        <div className={styles['keys']}>
                                            {item.keys.map((k, kIdx) => (
                                                <kbd key={kIdx}>{k}</kbd>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ShortcutsModal;
