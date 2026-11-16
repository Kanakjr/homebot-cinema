// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "collections": "Part of the X collection" under a movie's description (slot metaDetailsSections).

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { api } = require('stremio/common/serverApi');
const styles = require('./CollectionRow.less');

const CollectionRow = ({ type, id }) => {
    const [collection, setCollection] = React.useState(null);
    React.useEffect(() => {
        setCollection(null);
        if (type !== 'movie' || !/^tt\d+$/.test(id || '')) return undefined;
        let alive = true;
        api('GET', `/api/collections/movie/${encodeURIComponent(id)}`)
            .then((r) => { if (alive) setCollection((r && r.collection) || null); })
            .catch(() => null);
        return () => { alive = false; };
    }, [type, id]);

    if (!collection || !Array.isArray(collection.items) || collection.items.length < 2) return null;
    const position = collection.items.findIndex((m) => m.id === id);
    return (
        <div className={styles['collection']}>
            <div className={styles['heading']}>
                {/^the\s/i.test(collection.name) ? 'Part of ' : 'Part of the '}<span className={styles['name']}>{collection.name}</span>
                {position >= 0 ? <span className={styles['count']}> · {position + 1} of {collection.items.length}</span> : null}
            </div>
            <div className={styles['row']}>
                {collection.items.map((m) => (
                    <a
                        key={m.id}
                        className={classnames(styles['item'], { [styles['current']]: m.id === id })}
                        href={`#/detail/movie/${encodeURIComponent(m.id)}`}
                        title={m.year ? `${m.name} (${m.year})` : m.name}
                        aria-current={m.id === id ? 'page' : undefined}
                    >
                        {m.poster ? <img className={styles['poster']} src={m.poster} alt="" loading="lazy" /> : <div className={styles['poster']}>{m.name}</div>}
                        <div className={styles['label']}>{m.year || 'Coming'}</div>
                    </a>
                ))}
            </div>
        </div>
    );
};

CollectionRow.propTypes = { type: PropTypes.string, id: PropTypes.string };

module.exports = CollectionRow;
