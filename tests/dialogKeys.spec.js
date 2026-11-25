// Copyright (C) 2017-2026 HomeBot Cinema

const { dialogKeyAction, moveFocus } = require('../src/common/dialogKeys');

describe('dialogKeyAction', () => {
    it('confirms with Enter and cancels with Escape or the remote back key', () => {
        expect(dialogKeyAction('Enter')).toBe('enter');
        expect(dialogKeyAction('Escape')).toBe('cancel');
        expect(dialogKeyAction('GoBack')).toBe('cancel');
    });
    it('treats Backspace as back on a button, but as typing in the text field', () => {
        expect(dialogKeyAction('Backspace')).toBe('cancel');
        expect(dialogKeyAction('Backspace', { inInput: true })).toBeNull();
    });
    it('moves between buttons with the arrows and Tab, but leaves Left/Right to the caret in the text field', () => {
        expect(dialogKeyAction('ArrowRight')).toBe('next');
        expect(dialogKeyAction('ArrowLeft')).toBe('prev');
        expect(dialogKeyAction('ArrowLeft', { inInput: true })).toBeNull();
        expect(dialogKeyAction('ArrowDown', { inInput: true })).toBe('next');
        expect(dialogKeyAction('Tab', { shift: true })).toBe('prev');
    });
    it('ignores every other key', () => {
        expect(dialogKeyAction('a')).toBeNull();
        expect(dialogKeyAction(' ')).toBeNull();
    });
});

describe('moveFocus', () => {
    it('wraps around in both directions', () => {
        expect(moveFocus(0, 2, 'next')).toBe(1);
        expect(moveFocus(1, 2, 'next')).toBe(0);
        expect(moveFocus(0, 2, 'prev')).toBe(1);
    });
    it('starts at the first or last element when nothing in the dialog has focus', () => {
        expect(moveFocus(-1, 3, 'next')).toBe(0);
        expect(moveFocus(-1, 3, 'prev')).toBe(2);
        expect(moveFocus(0, 0, 'next')).toBe(-1);
    });
});
