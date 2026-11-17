// Copyright (C) 2017-2026 HomeBot Cinema
// The sidebar tabs, in order. The number-key shortcuts (1–7) follow the same list, so the two cannot drift apart.

const BASE_TABS = [
    { id: 'board', label: 'Home', icon: 'home', href: '/' },
    { id: 'discover', label: 'Discover', icon: 'discover', href: '/discover' },
    { id: 'library', label: 'Library', icon: 'library', href: '/library' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar', href: '/calendar' },
    { id: 'downloads', label: 'Downloads', icon: 'download', href: '/downloads' },
    { id: 'settings', label: 'SETTINGS', icon: 'settings', href: '/settings' },
];
const ADMIN_TAB = { id: 'admin', label: 'Admin', icon: 'lock', href: '/admin' };

const navTabs = (isAdmin) => (isAdmin ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS);

module.exports = { navTabs };
