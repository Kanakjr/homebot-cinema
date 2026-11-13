// Copyright (C) 2017-2026 HomeBot Cinema
// Nuvio-style page header: small eyebrow, big title, muted subtitle, right-aligned actions.

const React = require('react');
const PropTypes = require('prop-types');
const styles = require('./styles');

const PageHeader = ({ eyebrow, title, subtitle, actions, children }) => (
    <header className={styles['page-header']}>
        <div className={styles['text']}>
            {eyebrow ? <div className={styles['eyebrow']}>{eyebrow}</div> : null}
            <h1 className={styles['title']}>{title}</h1>
            {subtitle ? <div className={styles['subtitle']}>{subtitle}</div> : null}
        </div>
        {actions ? <div className={styles['actions']}>{actions}</div> : null}
        {children}
    </header>
);

PageHeader.propTypes = {
    eyebrow: PropTypes.string,
    title: PropTypes.string.isRequired,
    subtitle: PropTypes.node,
    actions: PropTypes.node,
    children: PropTypes.node
};

module.exports = PageHeader;
