// Copyright (C) 2017-2026 HomeBot Cinema
// Core's side of the plugin system (the plugins themselves live in plugins/<id>/ui). See host.js for the slots.

const host = require('./host');
const { PluginSlot, PluginBoundary, renderPlugin } = require('./PluginSlot');

module.exports = { ...host, PluginSlot, PluginBoundary, renderPlugin };
