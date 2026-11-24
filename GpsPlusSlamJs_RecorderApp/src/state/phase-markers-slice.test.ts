/**
 * Unit tests for the `phaseMarkers` slice.
 *
 * Why these tests matter: a phase marker is the only ground truth the offline
 * analysis gets about which protocol step (hold, near, circle, picture...) a
 * stretch of a recording belongs to. A marker that is silently renumbered,
 * accepted out of order, or stored with a garbage timestamp would map a phase
 * onto the wrong stretch of pose track, which is worse than no marker.
 */
import { describe, it, expect } from 'vitest';
import {
  phaseMarked,
  phaseMarkersReducer,
  selectPhaseMarkers,
  selectPhaseMarkerCount,
  selectNextPhaseMarkerNumber,
  type PhaseMarkersState,
} from './phase-markers-slice';

const initial = (): PhaseMarkersState =>
  phaseMarkersReducer(undefined, { type: '@@init' });

const asRoot = (phaseMarkers: PhaseMarkersState) => ({ phaseMarkers });

describe('phaseMarkers slice', () => {
  // Why: the persisted action type IS the zip format; offline readers match
  // on this exact string, so a rename must fail a test, not a field analysis.
  it('records under the phaseMarkers/phaseMarked action type', () => {
    expect(phaseMarked.type).toBe('phaseMarkers/phaseMarked');
  });

  it('starts empty, with marker 1 next', () => {
    const state = initial();
    expect(selectPhaseMarkers(asRoot(state))).toEqual([]);
    expect(selectPhaseMarkerCount(asRoot(state))).toBe(0);
    expect(selectNextPhaseMarkerNumber(asRoot(state))).toBe(1);
  });

  it('appends a marker and advances the next number', () => {
    let state = initial();
    state = phaseMarkersReducer(
      state,
      phaseMarked({ number: 1, timestamp: 1_700_000_000_000 })
    );
    state = phaseMarkersReducer(
      state,
      phaseMarked({ number: 2, timestamp: 1_700_000_003_000 })
    );
    expect(selectPhaseMarkers(asRoot(state))).toEqual([
      { number: 1, timestamp: 1_700_000_000_000 },
      { number: 2, timestamp: 1_700_000_003_000 },
    ]);
    expect(selectPhaseMarkerCount(asRoot(state))).toBe(2);
    expect(selectNextPhaseMarkerNumber(asRoot(state))).toBe(3);
  });

  // Why: the reducer is where the "strictly increasing" rule lives, so a
  // replayed or duplicated action can never put two markers with the same
  // number, or a lower one after a higher one, into the store.
  it.each([
    ['a repeated number', { number: 1, timestamp: 2 }],
    ['a lower number', { number: 0, timestamp: 2 }],
    ['a fractional number', { number: 1.5, timestamp: 2 }],
    ['a NaN number', { number: Number.NaN, timestamp: 2 }],
    ['a NaN timestamp', { number: 2, timestamp: Number.NaN }],
    ['an infinite timestamp', { number: 2, timestamp: Infinity }],
    ['a negative timestamp', { number: 2, timestamp: -1 }],
  ])('ignores %s', (_label, payload) => {
    const first = phaseMarkersReducer(
      initial(),
      phaseMarked({ number: 1, timestamp: 1 })
    );
    const after = phaseMarkersReducer(first, phaseMarked(payload));
    expect(after).toBe(first);
  });

  // Why: a malformed action read from a zip (no payload, wrong shape) must
  // not throw out of a replay.
  it('ignores an action without a usable payload', () => {
    const state = initial();
    const after = phaseMarkersReducer(state, {
      type: phaseMarked.type,
      payload: undefined,
    });
    expect(after).toBe(state);
  });

  it('reads a missing slice as empty', () => {
    expect(selectPhaseMarkerCount({})).toBe(0);
    expect(selectNextPhaseMarkerNumber({})).toBe(1);
  });
});
