// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "similar" (UI): "More like this" on title pages (slot metaDetailsSections).

const React = require('react');

module.exports = {
    metaDetailsSections: [{ id: 'similar', Component: React.lazy(() => import('./SimilarRow')) }],
};
