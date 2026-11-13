// Copyright (C) 2017-2026 HomeBot Cinema
// /find -> smart filters: rating, genre, streaming service, language, runtime and year in one place.

const React = require('react');
const { MainNavBars } = require('stremio/components');
const Find = require('./Find');
const styles = require('./styles');

const FindRoute = () => (
    <MainNavBars className={styles['route']} route={'discover'}>
        <Find />
    </MainNavBars>
);

module.exports = FindRoute;
