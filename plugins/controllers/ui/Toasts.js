// Copyright (C) 2017-2026 HomeBot Cinema
// Controller connection and low-battery toasts overlay.

const { useEffect, useRef } = require('react');
const { useToast } = require('stremio/common');
const { usePad } = require('./usePad');
const { batteryText, isLowBattery, justConnected } = require('./logic');

const Toasts = () => {
    const toast = useToast();
    const { available, state } = usePad();
    const announced = useRef(new Set());
    const lowBatteryWarned = useRef(new Set());

    useEffect(() => {
        if (!available || !state) {
            return;
        }
        const now = Date.now();
        (state.pads || []).forEach((pad) => {
            const key = `${pad.slot}:${pad.id}:${pad.connectedAt}`;
            // Only controllers that connected moments ago: not the ones already there when a page loads.
            if (justConnected(pad, now) && !announced.current.has(key)) {
                announced.current.add(key);
                toast.show({
                    type: 'info',
                    title: `${pad.id} connected`,
                    message: batteryText(pad) || undefined,
                    timeout: 3000,
                });
            }
            const lowKey = `${pad.slot}:${pad.id}`;
            if (isLowBattery(pad) && !lowBatteryWarned.current.has(lowKey)) {
                lowBatteryWarned.current.add(lowKey);
                toast.show({
                    type: 'alert',
                    title: 'Controller battery low',
                    message: `${pad.id}: ${batteryText(pad)}`,
                    timeout: 6000,
                });
            }
        });
    }, [available, state, toast]);

    return null;
};

module.exports = Toasts;
