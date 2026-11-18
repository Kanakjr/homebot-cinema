// Copyright (C) 2017-2026 HomeBot Cinema

// "Show - Episode (2×1)" -> "Show · S2 E1 · Episode". Titles without an episode marker pass through unchanged.
// The separator needs spaces on both sides, so a hyphen inside a name ("Spider-Man") is left alone.
const formatPlayerTitle = (title, seriesInfo, metaItem) => {
    if (!title || typeof title !== 'string') return '';
    const withEpisode = title.match(/^(.*?)\s+-\s+(.*?)\s*\((\d+)[×x](\d+)\)$/i);
    if (withEpisode) {
        const [, show, episodeTitle, season, episode] = withEpisode;
        return episodeTitle.trim() ?
            `${show.trim()} · S${season} E${episode} · ${episodeTitle.trim()}`
            :
            `${show.trim()} · S${season} E${episode}`;
    }
    const withoutTitle = title.match(/^(.*?)\s*\((\d+)[×x](\d+)\)$/i);
    if (withoutTitle) {
        return `${withoutTitle[1].trim()} · S${withoutTitle[2]} E${withoutTitle[3]}`;
    }
    if (seriesInfo && typeof seriesInfo.season === 'number' && typeof seriesInfo.episode === 'number') {
        const show = metaItem?.name || title.split(' - ')[0].trim();
        const episodeTitle = metaItem?.videos?.find((video) => video.season === seriesInfo.season && video.episode === seriesInfo.episode)?.title;
        return episodeTitle ?
            `${show} · S${seriesInfo.season} E${seriesInfo.episode} · ${episodeTitle}`
            :
            `${show} · S${seriesInfo.season} E${seriesInfo.episode}`;
    }
    return title;
};

module.exports = formatPlayerTitle;
