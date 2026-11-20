// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "mdblist": Rotten Tomatoes, Popcornmeter, IMDb, Metacritic, Letterboxd ratings.

const React = require('react');
const PropTypes = require('prop-types');
const { api } = require('stremio/common/serverApi');
const styles = require('./MdblistRatings.less');

const MdblistRatings = ({ type, id }) => {
    const [rating, setRating] = React.useState(null);

    React.useEffect(() => {
        setRating(null);
        if ((type !== 'movie' && type !== 'series') || !/^tt\d+$/.test(id || '')) return undefined;
        let alive = true;
        api('GET', `/api/mdblist/${type}/${encodeURIComponent(id)}`)
            .then((r) => {
                if (alive && r && r.rating) setRating(r.rating);
            })
            .catch(() => null);
        return () => { alive = false; };
    }, [type, id]);

    if (!rating) return null;

    const { tomatoes, popcorn, imdb, metacritic, letterboxd } = rating;
    const hasAny = tomatoes || popcorn || metacritic || letterboxd;
    if (!hasAny) return null;

    return (
        <div className={styles['ratings-section']}>
            <div className={styles['section-label']}>Ratings & Reviews</div>
            <div className={styles['ratings-bar']}>
                {tomatoes ? (
                    <div className={styles['pill']} title={`Rotten Tomatoes Critics: ${tomatoes.score}%${tomatoes.votes ? ` (${tomatoes.votes} reviews)` : ''}`}>
                        <span className={styles['icon']}>{tomatoes.fresh ? '🍅' : '🟢'}</span>
                        <span className={styles['val']}>{tomatoes.score}%</span>
                        <span className={styles['lbl']}>Tomatometer</span>
                    </div>
                ) : null}

                {popcorn ? (
                    <div className={styles['pill']} title={`Rotten Tomatoes Audience: ${popcorn.score}%${popcorn.votes ? ` (${popcorn.votes.toLocaleString()} ratings)` : ''}`}>
                        <span className={styles['icon']}>🍿</span>
                        <span className={styles['val']}>{popcorn.score}%</span>
                        <span className={styles['lbl']}>Audience</span>
                    </div>
                ) : null}

                {imdb ? (
                    <div className={styles['pill']} title={`IMDb Rating: ${imdb.score}/10${imdb.votes ? ` (${imdb.votes.toLocaleString()} votes)` : ''}`}>
                        <span className={styles['star']}>★</span>
                        <span className={styles['val']}>{typeof imdb.score === 'number' ? imdb.score.toFixed(1) : imdb.score}</span>
                        <span className={styles['lbl']}>IMDb</span>
                    </div>
                ) : null}

                {metacritic ? (
                    <div className={styles['pill']} title={`Metascore: ${metacritic.score}/100${metacritic.votes ? ` (${metacritic.votes} critics)` : ''}`}>
                        <span className={styles['meta-box']} style={{
                            backgroundColor: metacritic.score >= 61 ? '#66cc33' : metacritic.score >= 40 ? '#ffcc33' : '#ff0000',
                        }}>
                            {metacritic.score}
                        </span>
                        <span className={styles['lbl']}>Metascore</span>
                    </div>
                ) : null}

                {letterboxd ? (
                    <div className={styles['pill']} title={`Letterboxd: ${letterboxd.score}/5`}>
                        <span className={styles['lb-box']}>LB</span>
                        <span className={styles['val']}>{typeof letterboxd.score === 'number' ? letterboxd.score.toFixed(1) : letterboxd.score}</span>
                        <span className={styles['lbl']}>Letterboxd</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

MdblistRatings.propTypes = {
    type: PropTypes.string,
    id: PropTypes.string,
};

module.exports = MdblistRatings;
