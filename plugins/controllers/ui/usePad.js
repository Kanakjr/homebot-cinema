// Copyright (C) 2017-2026 HomeBot Cinema
// Hook for game controller state from window.__cinemaPad in the desktop app.

const React = require('react');
const { useState, useEffect, useRef } = React;

const rAF = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
const cAF = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id) => clearTimeout(id);

function usePad() {
    const padApi = typeof window !== 'undefined' ? window.__cinemaPad : null;
    const available = Boolean(padApi);
    const [state, setState] = useState(() => (padApi ? padApi.getState() : null));
    const rafIdRef = useRef(null);
    const pendingStateRef = useRef(null);

    useEffect(() => {
        if (!padApi) {
            return;
        }

        setState(padApi.getState());

        const unsubscribe = padApi.subscribe((nextState) => {
            pendingStateRef.current = nextState;
            if (rafIdRef.current === null) {
                rafIdRef.current = rAF(() => {
                    rafIdRef.current = null;
                    setState(pendingStateRef.current);
                });
            }
        });

        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
            if (rafIdRef.current !== null) {
                cAF(rafIdRef.current);
                rafIdRef.current = null;
            }
        };
    }, [padApi]);

    return { available, state };
}

usePad.usePad = usePad;
module.exports = usePad;
