// Copyright (C) 2017-2026 HomeBot Cinema
// <PluginSlot name="appOverlays" {...props} />: renders every active plugin's contribution to a slot. Each one is lazy-loaded
// and isolated: a plugin that throws while rendering is logged and hidden, the rest of the app keeps working.

const React = require('react');
const PropTypes = require('prop-types');
const { slot } = require('./host');

class PluginBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { failed: false };
    }
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error) {
        console.error(`[plugins] ${this.props.pluginId} crashed in ${this.props.where}:`, error);
    }
    render() {
        return this.state.failed ? null : this.props.children;
    }
}
PluginBoundary.propTypes = { pluginId: PropTypes.string, where: PropTypes.string, children: PropTypes.node };

/** Wraps one plugin component (Suspense for lazy chunks + error boundary). */
const renderPlugin = (item, where, props, ref) => (
    <PluginBoundary key={`${item.pluginId}:${item.id}`} pluginId={item.pluginId} where={where}>
        <React.Suspense fallback={null}>
            <item.Component {...props} ref={ref} />
        </React.Suspense>
    </PluginBoundary>
);

// `name` is the slot; slot props must never be called `name` (it would replace the slot name and crash the screen)
const PluginSlot = ({ name, ...props }) => {
    const items = React.useMemo(() => slot(name), [name]);
    return items.length ? <>{items.map((item) => renderPlugin(item, name, props))}</> : null;
};
PluginSlot.propTypes = { name: PropTypes.string.isRequired };

module.exports = { PluginSlot, PluginBoundary, renderPlugin };
