// Copyright (C) 2017-2026 HomeBot Cinema
// Key handling for the in-app confirm/prompt dialogs (dialogs.js), kept pure so it can be tested without a DOM.
// Remotes and game controllers arrive as the same key presses (arrows, Enter, Escape/Backspace).

/**
 * What a key press means inside an open dialog.
 * @param {string} key  KeyboardEvent.key
 * @param {{ inInput?: boolean, shift?: boolean }} ctx  inInput: focus is in the dialog's text field
 * @returns {'enter'|'cancel'|'next'|'prev'|null}
 */
function dialogKeyAction(key, { inInput = false, shift = false } = {}) {
    switch (key) {
        case 'Enter':
            return 'enter';
        case 'Escape':
        case 'GoBack':
        case 'BrowserBack':
            return 'cancel';
        case 'Backspace':
            return inInput ? null : 'cancel'; // in the text field Backspace deletes a character
        case 'Tab':
            return shift ? 'prev' : 'next';
        case 'ArrowDown':
            return 'next';
        case 'ArrowUp':
            return 'prev';
        case 'ArrowRight':
            return inInput ? null : 'next'; // in the text field Left/Right move the caret
        case 'ArrowLeft':
            return inInput ? null : 'prev';
        default:
            return null;
    }
}

/** Index of the element to focus after moving `dir` from `current` in a list of `count` focusable elements (wraps). */
function moveFocus(current, count, dir) {
    if (count <= 0) return -1;
    if (current < 0) return dir === 'prev' ? count - 1 : 0;
    return (current + (dir === 'prev' ? -1 : 1) + count) % count;
}

module.exports = { dialogKeyAction, moveFocus };
