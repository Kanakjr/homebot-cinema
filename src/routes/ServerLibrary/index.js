// Copyright (C) 2017-2026 HomeBot Cinema
// /server -> the grid of everything on the server; /server/:id -> one movie or show.

const React = require('react');
const { useParams } = require('react-router');
const { MainNavBars } = require('stremio/components');
const ServerLibrary = require('./ServerLibrary');
const ServerTitle = require('./ServerTitle');
const styles = require('./styles');

const ServerLibraryRoute = () => {
    const { id } = useParams();
    return (
        <MainNavBars className={styles['route']} route={'library'}>
            <div className={styles['scroll']}>
                {id ? <ServerTitle key={id} id={id} /> : <ServerLibrary />}
            </div>
        </MainNavBars>
    );
};

module.exports = ServerLibraryRoute;
