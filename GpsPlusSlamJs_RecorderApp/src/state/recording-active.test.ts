/**
 * Why these tests matter: every recorder tap that records something (the
 * reference-point mark, the phase marker) asks this predicate whether its
 * dispatch can still reach the recording's `actions/`. Saying yes in the stop
 * window, or for a state without a `recording` slice, would confirm a marker
 * on screen that the zip never gets.
 */
import { describe, it, expect } from 'vitest';
import { isRecordingActive } from './recording-active';

describe('isRecordingActive', () => {
  it('is true only while recording and not stopping', () => {
    const recording = { recording: { isRecording: true } };
    expect(isRecordingActive(recording, false)).toBe(true);
    expect(isRecordingActive(recording, true)).toBe(false);
  });

  it.each([
    ['not recording', { recording: { isRecording: false } }],
    ['no recording slice', {}],
    ['a non-boolean flag', { recording: { isRecording: 'yes' } }],
    ['no state', null],
  ])('is false for %s', (_label, state) => {
    expect(isRecordingActive(state, false)).toBe(false);
  });
});
