// Copyright (C) 2017-2026 HomeBot Cinema
// Interface zoom choices. Plain CommonJS so it can be shared by CONSTANTS, the settings slider and the unit test.

// Finer steps around the default (90) where most people tune, coarser steps for large screens.
const INTERFACE_SCALES = [70, 80, 90, 100, 110, 125, 150, 175];

// 90% is easier to view and work with than the original 100%, for every new profile.
const DEFAULT_INTERFACE_SCALE = 90;

// Maps any stored value (undefined, or one from an older choice list such as 75) to the closest choice we offer.
const nearestInterfaceScale = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_INTERFACE_SCALE;
    return INTERFACE_SCALES.reduce((best, scale) => (Math.abs(scale - value) < Math.abs(best - value) ? scale : best), INTERFACE_SCALES[0]);
};

module.exports = { INTERFACE_SCALES, DEFAULT_INTERFACE_SCALE, nearestInterfaceScale };
