// Copyright (C) 2017-2026 HomeBot Cinema

// Release names ("Show.Name.S02E03.1080p.WEB-DL.x265-GROUP") read as a title plus an episode tag. Real titles pass through.
const prettyTitle = (raw) => {
    const t = String(raw || '');
    if (!/[._]/.test(t) || /\s/.test(t.trim())) return t;
    const m = t.match(/^(.*?)[._ -]+(?:S(\d{1,2})E(\d{1,3})|(\d{4})(?=[._ ]))/i);
    if (!m) return t.replace(/[._]+/g, ' ').trim();
    const name = m[1].replace(/[._]+/g, ' ').trim();
    return m[2] ? `${name} · S${Number(m[2])} E${Number(m[3])}` : `${name} (${m[4]})`;
};

module.exports = prettyTitle;
