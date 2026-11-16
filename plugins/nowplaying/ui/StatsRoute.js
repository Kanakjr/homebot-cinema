// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "nowplaying": #/stats, the Watch stats page for the profile in use (admins can switch profile).

const React = require('react');
const { MainNavBars } = require('stremio/components');
const StatsPage = require('./StatsPage');
const styles = require('./Stats.less');

const StatsRoute = () => (
    <MainNavBars className={styles['route']} route={'stats'}>
        <div className={styles['scroll']}>
            <StatsPage />
        </div>
    </MainNavBars>
);

module.exports = StatsRoute;
