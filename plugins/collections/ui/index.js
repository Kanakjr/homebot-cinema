// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "collections" (UI): "Part of the X collection" on movie pages (slot metaDetailsSections).

const React = require('react');

module.exports = {
    metaDetailsSections: [{ id: 'collection', Component: React.lazy(() => import('./CollectionRow')) }],
};
