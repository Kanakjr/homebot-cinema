// Copyright (C) 2017-2026 HomeBot Cinema
// Our wording for a few stock English strings + HomeBot UI strings (merged over stremio-translations en-US in src/index.js).
// Other interface languages keep their own translations.

const homebotStrings = require('./homebotStrings');

module.exports = {
    ...homebotStrings,
    BUTTON_SEE_ALL: 'See all',
    SEARCH_ANYTHING: 'Search for movies, shows and people, or paste a link',
};
