// Copyright (C) 2017-2024 Smart code 203358507

import React, { useEffect, useMemo, useRef } from 'react';
import { Item, ItemPlaceholder } from './Item';
import styles from './List.less';

type Props = {
    className?: string,
    items: CalendarItem[],
    loading: boolean,
    selected: CalendarDate | null,
    monthInfo: CalendarMonthInfo,
    profile: Profile,
    onChange: (date: CalendarDate) => void,
};

const List = ({ className, items, loading, selected, monthInfo, profile, onChange }: Props) => {
    const filteredItems = useMemo(() => {
        return items.filter(({ items }) => items.length);
    }, [items]);

    // HomeBot: open the agenda at today (or the next day with episodes), not at the 1st of the month
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const list = listRef.current;
        if (!list || loading || monthInfo.today === null || filteredItems.length === 0) return;
        const index = filteredItems.findIndex(({ date }) => date.day >= monthInfo.today!);
        const target = list.children[index === -1 ? filteredItems.length - 1 : index] as HTMLElement | undefined;
        if (target) {
            list.scrollTop = target.offsetTop - list.offsetTop;
        }
    }, [filteredItems, loading, monthInfo.today]);

    return (
        <div ref={listRef} className={`${styles['list']}${className ? ` ${className}` : ''}`}>
            {
                items.length === 0 || loading ?
                    [1, 2, 3].map((index) => (
                        <ItemPlaceholder key={index} />
                    ))
                    :
                    filteredItems.map((item) => (
                        <Item
                            key={item.date.day}
                            {...item}
                            selected={selected}
                            monthInfo={monthInfo}
                            profile={profile}
                            onClick={onChange}
                        />
                    ))
            }
        </div>
    );
};

export default List;
