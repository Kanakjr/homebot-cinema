// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useGoBack } = require('stremio-router');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button } = require('stremio/components');
const BrandMark = require('stremio/components/BrandMark');
const { useCopilot } = require('stremio/common/copilotState');
const { useHorizontalNavGamepadNavigation } = require('stremio/services/GamepadNavigation');
const SearchBar = require('./SearchBar');
const NavMenu = require('./NavMenu');
const styles = require('./styles');

// fullscreenButton is accepted for API compatibility; fullscreen now lives in the avatar menu
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const HorizontalNavBar = React.memo(({ className, route, query, title, backButton, searchBar, fullscreenButton, navMenu, originPath, hdrInfo, ...props }) => {
    const backButtonOnClick = useGoBack(originPath);
    const renderNavMenuLabel = React.useCallback(({ ref, className, onClick, children, }) => (
        <Button ref={ref} className={classnames(className, styles['button-container'], styles['menu-button-container'])} tabIndex={-1} onClick={onClick}>
            {
                window.ssoProfile && window.ssoProfile.avatar ?
                    <img className={styles['avatar-img']} src={window.ssoProfile.avatar} alt={window.ssoProfile.name} />
                    :
                    <Icon className={styles['icon']} name={'person-outline'} />
            }
            {children}
        </Button>
    ), []);
    const copilot = useCopilot();
    useHorizontalNavGamepadNavigation(route || className, backButton ? backButtonOnClick : undefined);
    return (
        <nav {...props} className={classnames(className, styles['horizontal-nav-bar-container'])}>
            {
                backButton ?
                    <Button className={classnames(styles['button-container'], styles['back-button-container'])} tabIndex={-1} onClick={backButtonOnClick}>
                        <Icon className={styles['icon']} name={'chevron-back'} />
                    </Button>
                    :
                    <div className={styles['logo-container']} title={'HomeBot Cinema'} style={{ cursor: 'pointer' }} onClick={() => { window.location.hash = '#/'; }}>
                        <BrandMark size={42} />
                    </div>
            }
            {
                typeof title === 'string' && title.length > 0 ?
                    <h2 className={styles['title']}>{title}</h2>
                    :
                    null
            }
            {
                searchBar && route !== 'addons' ?
                    <SearchBar className={styles['search-bar']} query={query} active={route === 'search'} />
                    :
                    null
            }
            <div className={styles['buttons-container']}>
                {
                    hdrInfo && (hdrInfo.gamma === 'pq' || hdrInfo.gamma === 'hlg') ?
                        <div className={styles['hdr-indicator']} title={hdrInfo.gamma === 'pq' ? 'HDR10' : 'HLG'}>
                            <Icon className={styles['icon']} name={'hdr'} />
                        </div>
                        :
                        null
                }
                {
                    navMenu && copilot.available ?
                        <Button className={classnames(styles['button-container'], styles['menu-button-container'], { active: copilot.open })} title={'Copilot'} aria-label={'Copilot'} aria-pressed={copilot.open} tabIndex={-1} onClick={copilot.toggle}>
                            <svg className={styles['icon']} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14zM5 15l.7 1.8L7.5 17.5l-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7L5 15z" />
                            </svg>
                        </Button>
                        :
                        null
                }
                {
                    navMenu ?
                        <NavMenu renderLabel={renderNavMenuLabel} />
                        :
                        null
                }
            </div>
        </nav>
    );
});

HorizontalNavBar.displayName = 'HorizontalNavBar';

HorizontalNavBar.propTypes = {
    className: PropTypes.string,
    route: PropTypes.string,
    query: PropTypes.string,
    title: PropTypes.string,
    backButton: PropTypes.bool,
    searchBar: PropTypes.bool,
    fullscreenButton: PropTypes.bool,
    navMenu: PropTypes.bool,
    originPath: PropTypes.string,
    hdrInfo: PropTypes.shape({
        gamma: PropTypes.string,
    }),
};

module.exports = HorizontalNavBar;
