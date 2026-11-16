// Copyright (C) 2017-2026 HomeBot Cinema
// Quick picks for Smart filters, modelled on the lists IMDb offers (charts, genre lists, regional cinema).
// Every value must be one the filter UI can show: see RATINGS/VOTES/YEARS/RUNTIMES (tests/findPresets.spec.js checks it).
// Streaming services are matched by name against what TMDB lists for the region, because ids differ per country.

const RATINGS = [0, 6, 6.5, 7, 7.5, 8, 8.5, 9];
const VOTES = [0, 50, 200, 500, 1000, 5000];
const YEARS = [0, 2025, 2020, 2015, 2010, 2000, 1990, 1980];
const RUNTIMES = [0, 60, 90, 100, 120, 150];
const SORTS = [['rating', 'Top rated'], ['popularity', 'Most popular'], ['votes', 'Most voted'], ['newest', 'Newest']];

const m = (extra) => ({ type: 'movie', ...extra });
const s = (extra) => ({ type: 'series', ...extra });

const GROUPS = [
    {
        title: 'Charts',
        items: [
            { label: 'Top rated movies of all time', f: m({ minRating: 8, minVotes: 5000 }) },
            { label: 'Top rated TV shows of all time', f: s({ minRating: 8, minVotes: 1000 }) },
            { label: 'Most popular movies right now', f: m({ sort: 'popularity', minVotes: 200 }) },
            { label: 'Most popular TV shows right now', f: s({ sort: 'popularity', minVotes: 200 }) },
            { label: 'Best movies of the last two years', f: m({ yearFrom: 2025, minRating: 7, minVotes: 500 }) },
            { label: 'Best new series (2025 onwards)', f: s({ yearFrom: 2025, minRating: 7.5, minVotes: 200 }) },
        ],
    },
    {
        title: 'On streaming',
        items: [
            { label: 'Top-rated documentaries on Netflix', f: m({ genres: ['Documentary'], services: ['Netflix'], minRating: 7.5, minVotes: 200 }) },
            { label: 'Documentary series on Netflix', f: s({ genres: ['Documentary'], services: ['Netflix'], minRating: 7.5, minVotes: 200 }) },
            { label: 'Top-rated movies on Netflix', f: m({ services: ['Netflix'], minRating: 7.5, minVotes: 1000 }) },
            { label: 'Top-rated series on Netflix', f: s({ services: ['Netflix'], minRating: 8, minVotes: 500 }) },
            { label: 'Top-rated movies on Prime Video', f: m({ services: ['Amazon Prime Video'], minRating: 7.5, minVotes: 1000 }) },
            { label: 'Top-rated series on Prime Video', f: s({ services: ['Amazon Prime Video'], minRating: 8, minVotes: 500 }) },
            { label: 'Top-rated movies on JioHotstar', f: m({ services: ['JioHotstar'], minRating: 7.5, minVotes: 1000 }) },
            { label: 'Top-rated series on JioHotstar', f: s({ services: ['JioHotstar'], minRating: 8, minVotes: 500 }) },
            { label: 'Top-rated series on Apple TV', f: s({ services: ['Apple TV'], minRating: 8, minVotes: 200 }) },
        ],
    },
    {
        title: 'Movies by genre',
        items: [
            { label: 'Top-rated action movies', f: m({ genres: ['Action'], minRating: 7, minVotes: 1000 }) },
            { label: 'Top-rated comedies', f: m({ genres: ['Comedy'], minRating: 7, minVotes: 1000 }) },
            { label: 'Top-rated thrillers', f: m({ genres: ['Thriller'], minRating: 7.5, minVotes: 1000 }) },
            { label: 'Top-rated crime movies', f: m({ genres: ['Crime'], minRating: 7.5, minVotes: 1000 }) },
            { label: 'Top-rated sci-fi movies', f: m({ genres: ['Science Fiction'], minRating: 7.5, minVotes: 1000 }) },
            { label: 'Top-rated horror movies', f: m({ genres: ['Horror'], minRating: 6.5, minVotes: 1000 }) },
            { label: 'Top-rated romance movies', f: m({ genres: ['Romance'], minRating: 7, minVotes: 500 }) },
            { label: 'Top-rated animated movies', f: m({ genres: ['Animation'], minRating: 7.5, minVotes: 1000 }) },
            { label: 'Top-rated family movies', f: m({ genres: ['Family'], minRating: 7, minVotes: 500 }) },
            { label: 'Top-rated documentaries', f: m({ genres: ['Documentary'], minRating: 7.5, minVotes: 200 }) },
        ],
    },
    {
        title: 'Series by genre',
        items: [
            { label: 'Top-rated crime series', f: s({ genres: ['Crime'], minRating: 8, minVotes: 500 }) },
            { label: 'Top-rated sci-fi & fantasy series', f: s({ genres: ['Sci-Fi & Fantasy'], minRating: 8, minVotes: 500 }) },
            { label: 'Top-rated comedy series', f: s({ genres: ['Comedy'], minRating: 8, minVotes: 500 }) },
            { label: 'Top-rated animated series', f: s({ genres: ['Animation'], minRating: 8, minVotes: 200 }) },
        ],
    },
    {
        title: 'By language',
        items: [
            { label: 'Top-rated Hindi movies', f: m({ lang: 'hi', minRating: 7, minVotes: 500 }) },
            { label: 'Top-rated Tamil movies', f: m({ lang: 'ta', minRating: 7, minVotes: 200 }) },
            { label: 'Top-rated Telugu movies', f: m({ lang: 'te', minRating: 7, minVotes: 200 }) },
            { label: 'Top-rated Malayalam movies', f: m({ lang: 'ml', minRating: 7, minVotes: 200 }) },
            { label: 'Top-rated Korean series', f: s({ lang: 'ko', minRating: 8, minVotes: 200 }) },
            { label: 'Top-rated Spanish series', f: s({ lang: 'es', minRating: 7.5, minVotes: 200 }) },
            { label: 'Top-rated anime series', f: s({ lang: 'ja', genres: ['Animation'], minRating: 8, minVotes: 200 }) },
            { label: 'Top-rated anime movies', f: m({ lang: 'ja', genres: ['Animation'], minRating: 7.5, minVotes: 500 }) },
        ],
    },
    {
        title: 'Short on time',
        items: [
            { label: 'Great films under 100 minutes', f: m({ minRating: 7.5, minVotes: 1000, maxRuntime: 100 }) },
            { label: 'Short comedies under 100 minutes', f: m({ genres: ['Comedy'], minRating: 7, minVotes: 500, maxRuntime: 100 }) },
            { label: 'Short documentaries under 90 minutes', f: m({ genres: ['Documentary'], minRating: 7.5, minVotes: 200, maxRuntime: 90 }) },
        ],
    },
];

// flat list; `index` is what the dropdown stores
const PRESET_GROUPS = GROUPS.map((g) => ({ title: g.title, items: g.items }));
const PRESETS = PRESET_GROUPS.flatMap((g) => g.items);
PRESETS.forEach((p, index) => { p.index = index; });

module.exports = { RATINGS, VOTES, YEARS, RUNTIMES, SORTS, PRESET_GROUPS, PRESETS };
