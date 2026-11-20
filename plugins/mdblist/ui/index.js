// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "mdblist" (UI): Rotten Tomatoes, Popcornmeter, IMDb, Metacritic and Letterboxd scores.

const React = require('react');

module.exports = {
    metaDetailsSections: [{ id: 'mdblist-ratings', Component: React.lazy(() => import('./MdblistRatings')), order: 10 }],
};
