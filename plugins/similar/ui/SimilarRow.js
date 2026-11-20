// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "similar": "More like this" under a title's description (slot metaDetailsSections).

const React = require('react');
const PropTypes = require('prop-types');
const { api } = require('stremio/common/serverApi');
const styles = require('./SimilarRow.less');

const SimilarRow = ({ type, id }) => {
    const [items, setItems] = React.useState([]);
    React.useEffect(() => {
        setItems([]);
        if ((type !== 'movie' && type !== 'series') || !/^tt\d+$/.test(id || '')) return undefined;
        let alive = true;
        api('GET', `/api/similar/${type}/${encodeURIComponent(id)}`)
            .then((r) => { if (alive) setItems((r && Array.isArray(r.items)) ? r.items : []); })
            .catch(() => null);
        return () => { alive = false; };
    }, [type, id]);

    if (items.length < 2) return null;
    return (
        <div className={styles['similar']}>
            <div className={styles['heading']}>More like this</div>
            <div className={styles['row']}>
                {items.map((m) => (
                    <a
                        key={m.id}
                        className={styles['item']}
                        href={`#/detail/${m.type}/${encodeURIComponent(m.id)}`}
                        title={m.year ? `${m.name} (${m.year})` : m.name}
                    >
                        <div className={styles['poster-container']}>
                            {m.poster ? (
                                <img className={styles['poster']} src={m.poster} alt="" loading="lazy" />
                            ) : (
                                <div className={styles['poster']}>{m.name}</div>
                            )}
                            {m.rating ? (
                                <span className={styles['rating']}>★ {m.rating.toFixed(1)}</span>
                            ) : null}
                        </div>
                        <div className={styles['name']}>{m.name}</div>
                        {m.year ? <div className={styles['year']}>{m.year}</div> : null}
                    </a>
                ))}
            </div>
        </div>
    );
};
SimilarRow.propTypes = { type: PropTypes.string, id: PropTypes.string };

module.exports = SimilarRow;
