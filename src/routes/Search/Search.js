// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const useTranslate = require('stremio/common/useTranslate');
const { default: useVisibleCatalogs } = require('stremio/common/useVisibleCatalogs');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { withCoreSuspender } = require('stremio/common');
const { Image, MainNavBars, MetaItem, MetaRow } = require('stremio/components');
const PageHeader = require('stremio/components/PageHeader');
const { api } = require('stremio/common/serverApi');
const topResults = require('./topResults');
const useSearch = require('./useSearch');
const styles = require('./styles');
const { useSearchParams } = require('react-router-dom');

const Search = () => {
    const [queryParams] = useSearchParams();
    const { t } = useTranslation();
    const translate = useTranslate();
    const [search, loadSearchRows] = useSearch(queryParams);
    const query = React.useMemo(() => {
        return search.selected !== null ?
            search.selected.extra.reduceRight((query, [name, value]) => {
                if (name === 'search') {
                    return value;
                }

                return query;
            }, null)
            :
            null;
    }, [search.selected]);
    // HomeBot: titles already on the server for this query (matched or unmatched), marked and listed first
    const [serverItems, setServerItems] = React.useState([]);
    React.useEffect(() => {
        let cancelled = false;
        if (!query) {
            setServerItems([]);
            return undefined;
        }
        api('GET', `/api/library?q=${encodeURIComponent(query)}`)
            .then((res) => !cancelled && setServerItems(Array.isArray(res && res.items) ? res.items : []))
            .catch(() => !cancelled && setServerItems([]));
        return () => { cancelled = true; };
    }, [query]);
    const top = React.useMemo(() => {
        if (query === null) return [];
        const ranked = topResults(search.catalogs, query);
        return topResults.mergeServerResults(ranked, serverItems);
    }, [search.catalogs, query, serverItems]);
    const { catalogRows, scrollContainerRef, onScroll } = useVisibleCatalogs({
        catalogs: search.catalogs,
        loadRange: loadSearchRows,
    });
    // HomeBot: only show empty-state when neither addon catalogs nor the local library have results
    const noResults = top.length === 0 && search.catalogs.length > 0 && search.catalogs.every((catalog) => {
        return catalog.content?.type === 'Err' && catalog.content.content === 'EmptyContent';
    });
    return (
        <MainNavBars className={styles['search-container']} route={'search'} query={query}>
            <div ref={scrollContainerRef} className={styles['search-content']} onScroll={onScroll}>
                {
                    query !== null && !noResults && (search.catalogs.length > 0 || top.length > 0) ?
                        <div className={styles['search-page-header']}>
                            <PageHeader eyebrow="Search" title={`Results for “${query}”`} />
                        </div>
                        :
                        null
                }
                {
                    query === null ?
                        <div className={classnames(styles['search-hints-wrapper'])}>
                            <div className={classnames(styles['search-hints-title-container'], 'animation-fade-in')}>
                                <div className={styles['search-hints-title']}>{translate.string('SEARCH_ANYTHING')}</div>
                            </div>
                            <div className={classnames(styles['search-hints-container'], 'animation-fade-in')}>
                                <div className={styles['search-hint-container']}>
                                    <Icon className={styles['icon']} name={'trailer'} />
                                    <div className={styles['label']}>{translate.string('SEARCH_CATEGORIES')}</div>
                                </div>
                                <div className={styles['search-hint-container']}>
                                    <Icon className={styles['icon']} name={'actors'} />
                                    <div className={styles['label']}>{translate.string('SEARCH_PERSONS')}</div>
                                </div>
                                <div className={styles['search-hint-container']}>
                                    <Icon className={styles['icon']} name={'link'} />
                                    <div className={styles['label']}>{translate.string('SEARCH_PROTOCOLS')}</div>
                                </div>
                                <div className={styles['search-hint-container']}>
                                    <Icon className={styles['icon']} name={'imdb-outline'} />
                                    <div className={styles['label']}>{translate.string('SEARCH_TYPES')}</div>
                                </div>
                            </div>
                        </div>
                        :
                        search.catalogs.length === 0 && top.length === 0 ?
                            <div className={styles['message-container']}>
                                <Image
                                    className={styles['image']}
                                    src={require('/assets/images/empty.png')}
                                    alt={' '}
                                />
                                <div className={styles['message-label']}>{ translate.string('STREMIO_TV_SEARCH_NO_ADDONS') }</div>
                            </div>
                            :
                            noResults ?
                                <div className={styles['message-container']}>
                                    <Image
                                        className={styles['image']}
                                        src={require('/assets/images/empty.png')}
                                        alt={' '}
                                    />
                                    <div className={styles['message-label']}>{t('HOMEBOT_SEARCH_NO_RESULTS', 'No results for “{{query}}”', { query })}</div>
                                    <div className={styles['message-hint']}>{t('HOMEBOT_SEARCH_NO_RESULTS_HINT', 'Check the spelling, or try a title, an actor or an IMDb link.')}</div>
                                </div>
                                :
                                <>
                                    {top.length >= 1 ?
                                        <MetaRow
                                            className={classnames(styles['search-row'], styles['search-row-poster'], 'animation-fade-in')}
                                            title="Top results"
                                            catalog={{ items: top }}
                                            itemComponent={MetaItem}
                                        />
                                        :
                                        null}
                                    {catalogRows.map(({ catalog, index }) => {
                                        switch (catalog.content?.type) {
                                            case 'Ready': {
                                                return (
                                                    <MetaRow
                                                        key={index}
                                                        className={classnames(styles['search-row'], styles[`search-row-${catalog.content.content[0].posterShape}`], 'animation-fade-in')}
                                                        catalog={catalog}
                                                        itemComponent={MetaItem}
                                                    />
                                                );
                                            }
                                            case 'Err': {
                                                if (catalog.content.content !== 'EmptyContent') {
                                                    return (
                                                        <MetaRow
                                                            key={index}
                                                            className={classnames(styles['search-row'], 'animation-fade-in')}
                                                            catalog={catalog}
                                                            message={catalog.content.content}
                                                        />
                                                    );
                                                }
                                                return null;
                                            }
                                            default: {
                                                return (
                                                    <MetaRow.Placeholder
                                                        key={index}
                                                        className={classnames(styles['search-row'], styles['search-row-poster'], 'animation-fade-in')}
                                                        catalog={catalog}
                                                        title={translate.catalogTitle(catalog)}
                                                    />
                                                );
                                            }
                                        }
                                    })}
                                </>
                }
            </div>
        </MainNavBars>
    );
};

const SearchFallback = () => {
    const [queryParams] = useSearchParams();
    return <MainNavBars className={styles['search-container']} route={'search'} query={queryParams.get('search') ?? queryParams.get('query')} />;
};

module.exports = withCoreSuspender(Search, SearchFallback);
