/**
 * Why this test matters: the error object comes from the browser, so its
 * code can be anything. Whatever it is, the button must land on a failure
 * state that has a label to show and a fix to name, never on an in-progress
 * or success state (which would leave it spinning or claim a fix that never
 * came), and never throw inside its own error handler.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { labelFor, locateAdvice, stateForError } from './locate-state.js';

describe('stateForError, for any code a browser might hand over', () => {
  it('lands on a failure with a label and a fix', () => {
    fc.assert(
      fc.property(fc.option(fc.integer(), { nil: undefined }), (code) => {
        const state = stateForError(code);
        expect(['denied', 'timeout', 'unavailable']).toContain(state);
        expect(labelFor(state).trim()).not.toBe('');
        expect(locateAdvice(state).trim()).not.toBe('');
      })
    );
  });
});
