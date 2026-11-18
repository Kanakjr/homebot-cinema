// Copyright (C) 2017-2024 Smart code 203358507

import React, { useCallback, useMemo, MouseEvent } from 'react';
import Icon from '@stremio/stremio-icons/react';
import classNames from 'classnames';
import { useNavigateWithOrigin } from 'stremio-router';
import { Button, HorizontalScroll, Image } from 'stremio/components';
import styles from './Cell.less';

type Props = {
    selected: CalendarDate | null,
    monthInfo: CalendarMonthInfo,
    date: CalendarDate,
    items: CalendarContentItem[],
    onClick: (date: CalendarDate) => void,
};

const Cell = ({ selected, monthInfo, date, items, onClick }: Props) => {
    const { navigateWithOrigin } = useNavigateWithOrigin();
    const [active, today] = useMemo(() => [
        date.day === selected?.day,
        date.day === monthInfo.today,
    ], [selected, monthInfo, date]);
    // HomeBot: days before today are dimmed, so the eye lands on what is still to come
    const past = useMemo(() => {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        return new Date(date.year, date.month - 1, date.day) < startOfToday;
    }, [date]);

    const onCellClick = () => {
        onClick && onClick(date);
    };

    const onPosterClick = useCallback((event: MouseEvent<HTMLDivElement>, target: string) => {
        event.preventDefault();
        event.stopPropagation();
        navigateWithOrigin(target);
    }, [navigateWithOrigin]);

    return (
        <Button
            className={classNames(styles['cell'], { [styles['active']]: active, [styles['today']]: today, [styles['past']]: past })}
            onClick={onCellClick}
        >
            <div className={styles['heading']}>
                <div className={styles['day']}>
                    {date.day}
                </div>
            </div>
            <HorizontalScroll className={styles['items']}>
                {
                    items.map(({ id, name, poster, deepLinks }) => (
                        <Button key={id} className={styles['item']} href={deepLinks.metaDetailsStreams} tabIndex={-1} onClick={(event) => onPosterClick(event, deepLinks.metaDetailsStreams)}>
                            <Icon className={styles['icon']} name={'play'} />
                            <Image
                                className={styles['poster']}
                                src={poster}
                                alt={name}
                            />
                        </Button>
                    ))
                }
            </HorizontalScroll>
            {
                items.length > 0 ?
                    <Icon className={styles['more']} name={'more-horizontal'} />
                    :
                    null
            }
        </Button>
    );
};

export default Cell;
