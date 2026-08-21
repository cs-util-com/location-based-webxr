import { describe, expect, it } from 'vitest';

import {
  INITIAL,
  isActive,
  isPlaying,
  progressFraction,
  transportReducer,
  type TransportState,
} from './playback-transport.js';

/**
 * Why these tests matter: this reducer is the single source of truth for "what
 * is playing, where, and is the panel open" — it drives both the exclusive
 * one-clip-at-a-time policy and the progress bar. The subtle cases are (a) a
 * click always (re)starts from 0, (b) `seek` is fraction-of-duration and
 * clamped, and (c) a *stale* `ended` or `tick` (from a clip the user already
 * switched away from — pausing an element emits a final `timeupdate`) must be
 * ignored, or it would wrongly stop or scrub the newly-started clip.
 */

const playing = (over: Partial<TransportState> = {}): TransportState => ({
  activeId: 'a',
  status: 'playing',
  positionSec: 0,
  durationSec: 10,
  ...over,
});

describe('transportReducer', () => {
  it('starts the clicked clip from 0 and opens it (from initial)', () => {
    expect(transportReducer(INITIAL, { type: 'click', id: 'a' })).toEqual({
      activeId: 'a',
      status: 'playing',
      positionSec: 0,
      durationSec: 0,
    });
  });

  it('switches to another clip, resetting position (exclusive playback)', () => {
    const s = playing({ positionSec: 6 });
    expect(transportReducer(s, { type: 'click', id: 'b' })).toEqual({
      activeId: 'b',
      status: 'playing',
      positionSec: 0,
      durationSec: 0,
    });
  });

  it('restarts the same clip from 0, keeping its already-known duration', () => {
    const s = playing({ status: 'paused', positionSec: 7, durationSec: 10 });
    // Same clip, same element — the duration is still valid, so the progress
    // bar must not flash empty until the next tick.
    expect(transportReducer(s, { type: 'click', id: 'a' })).toEqual({
      activeId: 'a',
      status: 'playing',
      positionSec: 0,
      durationSec: 10,
    });
  });

  it('toggles play -> pause and pause -> play', () => {
    const paused = transportReducer(playing(), { type: 'toggle' });
    expect(paused.status).toBe('paused');
    expect(transportReducer(paused, { type: 'toggle' }).status).toBe('playing');
  });

  it('ignores toggle when nothing is active', () => {
    expect(transportReducer(INITIAL, { type: 'toggle' })).toEqual(INITIAL);
  });

  it('seek sets position to fraction * duration', () => {
    const s = playing({ durationSec: 20 });
    expect(
      transportReducer(s, { type: 'seek', fraction: 0.25 }).positionSec
    ).toBe(5);
  });

  it('clamps seek fraction to [0, 1]', () => {
    const s = playing({ durationSec: 20 });
    expect(
      transportReducer(s, { type: 'seek', fraction: -1 }).positionSec
    ).toBe(0);
    expect(transportReducer(s, { type: 'seek', fraction: 2 }).positionSec).toBe(
      20
    );
  });

  it('ignores seek when nothing is active', () => {
    expect(transportReducer(INITIAL, { type: 'seek', fraction: 0.5 })).toEqual(
      INITIAL
    );
  });

  it('tick updates position and duration from the active clip', () => {
    const s = playing();
    expect(
      transportReducer(s, {
        type: 'tick',
        id: 'a',
        positionSec: 3,
        durationSec: 12,
      })
    ).toEqual({
      activeId: 'a',
      status: 'playing',
      positionSec: 3,
      durationSec: 12,
    });
  });

  it('ignores tick when nothing is active', () => {
    expect(
      transportReducer(INITIAL, {
        type: 'tick',
        id: 'a',
        positionSec: 3,
        durationSec: 12,
      })
    ).toEqual(INITIAL);
  });

  it('ignores a stale tick from a clip the user already switched away from', () => {
    const s = playing({ activeId: 'b', positionSec: 2, durationSec: 8 });
    // Pausing "a" emits a final timeupdate after the switch — it must not
    // scrub "b"'s playhead or overwrite its duration.
    expect(
      transportReducer(s, {
        type: 'tick',
        id: 'a',
        positionSec: 5,
        durationSec: 12,
      })
    ).toBe(s);
  });

  it('ended on the active clip pauses it at the end', () => {
    const s = playing({ positionSec: 9, durationSec: 10 });
    expect(transportReducer(s, { type: 'ended', id: 'a' })).toEqual({
      activeId: 'a',
      status: 'paused',
      positionSec: 10,
      durationSec: 10,
    });
  });

  it('ignores a stale ended from a clip the user already switched away from', () => {
    const s = playing({ activeId: 'b', positionSec: 2 });
    // "a" ended late, but "b" is the active clip now — must not stop "b".
    expect(transportReducer(s, { type: 'ended', id: 'a' })).toBe(s);
  });
});

describe('selectors', () => {
  it('isActive / isPlaying reflect the active clip and status', () => {
    const s = playing();
    expect(isActive(s, 'a')).toBe(true);
    expect(isActive(s, 'b')).toBe(false);
    expect(isPlaying(s, 'a')).toBe(true);
    expect(isPlaying(transportReducer(s, { type: 'toggle' }), 'a')).toBe(false);
  });

  it('progressFraction is position/duration clamped to [0,1], 0 when no duration', () => {
    expect(progressFraction(playing({ positionSec: 5, durationSec: 10 }))).toBe(
      0.5
    );
    expect(
      progressFraction(playing({ positionSec: 99, durationSec: 10 }))
    ).toBe(1);
    expect(progressFraction(INITIAL)).toBe(0);
  });
});
