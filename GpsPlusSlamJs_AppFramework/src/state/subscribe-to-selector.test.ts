/**
 * Tests for subscribeToSelector — selective store subscription utility.
 *
 * Why these tests matter:
 * subscribeToSelector replaces manual tracking variables (lastX patterns)
 * in store subscribers with automated reference-equality change detection.
 * Correct behavior is critical: false negatives cause stale UI, false
 * positives cause redundant work on every dispatch (60 Hz odometry updates).
 *
 * @see docs/2026-04-07-architecture-observations-consolidated.md §1
 */

import { describe, it, expect, vi } from 'vitest';
import type { CombinedRootState } from './combined-root-state';
import {
  subscribeToSelector,
  type SubscribableStore,
} from './subscribe-to-selector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal CombinedRootState for testing selectors. */
function makeState(
  overrides: Partial<CombinedRootState> = {}
): CombinedRootState {
  return {
    gpsData: null,
    gpsElements: {} as CombinedRootState['gpsElements'],
    arElements: {} as CombinedRootState['arElements'],
    recording: {} as CombinedRootState['recording'],
    tracking: {} as CombinedRootState['tracking'],
    trackingQuality: {} as CombinedRootState['trackingQuality'],
    arSpaceCorrection: { observations: [] },
    ...overrides,
  };
}

/** Mock store with manual state control + listener notification. */
function makeMockStore(initialState: CombinedRootState) {
  let currentState = initialState;
  const listeners: Array<() => void> = [];

  return {
    store: {
      getState: () => currentState,
      subscribe: (listener: () => void) => {
        listeners.push(listener);
        return () => {
          const idx = listeners.indexOf(listener);
          if (idx !== -1) listeners.splice(idx, 1);
        };
      },
    } satisfies SubscribableStore,
    setState(newState: CombinedRootState) {
      currentState = newState;
      for (const l of listeners) l();
    },
    get listenerCount() {
      return listeners.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('subscribeToSelector', () => {
  // --- Core change detection ---

  it('fires onChange when selector result changes by reference', () => {
    // Why: the primary invariant — callback runs only on actual state changes
    const mock = makeMockStore(makeState());
    const onChange = vi.fn();
    const arrayA = [1, 2, 3];
    const arrayB = [4, 5, 6];

    let result: number[] = arrayA;
    subscribeToSelector(mock.store, () => result, onChange);

    // First dispatch: previous is undefined, current is arrayA → fires
    mock.setState(makeState());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(arrayA, undefined);

    // Switch to arrayB: different reference → should fire again
    onChange.mockClear();
    result = arrayB;
    mock.setState(makeState());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(arrayB, arrayA);
  });

  it('does not fire onChange when selector result is the same reference', () => {
    // Why: avoids redundant work on high-frequency dispatches (60 Hz odometry)
    const stableRef = [1, 2, 3];
    const mock = makeMockStore(makeState());
    const onChange = vi.fn();

    subscribeToSelector(mock.store, () => stableRef, onChange);

    // First dispatch: previous is undefined → fires (initial detection)
    mock.setState(makeState());
    expect(onChange).toHaveBeenCalledTimes(1);
    onChange.mockClear();

    // Second dispatch: same reference → should NOT fire
    mock.setState(makeState());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('detects change from null to non-null', () => {
    // Why: alignment matrix starts null and becomes non-null during recording
    const mock = makeMockStore(makeState());
    const onChange = vi.fn();
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

    let selectorResult: unknown = null;
    subscribeToSelector(mock.store, () => selectorResult, onChange);

    // null → null: first call, prev is undefined ≠ null → fires
    mock.setState(makeState());
    expect(onChange).toHaveBeenCalledWith(null, undefined);
    onChange.mockClear();

    // null → matrix: should fire
    selectorResult = matrix;
    mock.setState(makeState());
    expect(onChange).toHaveBeenCalledWith(matrix, null);
  });

  it('detects change from non-null to null', () => {
    // Why: alignment matrix could be reset in a new session
    const mock = makeMockStore(makeState());
    const onChange = vi.fn();
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

    let selectorResult: unknown = matrix;
    subscribeToSelector(mock.store, () => selectorResult, onChange);

    // undefined → matrix → fires
    mock.setState(makeState());
    onChange.mockClear();

    // matrix → null → fires
    selectorResult = null;
    mock.setState(makeState());
    expect(onChange).toHaveBeenCalledWith(null, matrix);
  });

  it('provides both current and previous values to onChange', () => {
    // Why: GPS event processing needs previous array length to compute delta
    const mock = makeMockStore(makeState());
    const onChange = vi.fn();
    const arr1 = ['a'];
    const arr2 = ['a', 'b'];

    let result: string[] = arr1;
    subscribeToSelector(mock.store, () => result, onChange);

    mock.setState(makeState());
    expect(onChange).toHaveBeenCalledWith(arr1, undefined);

    result = arr2;
    mock.setState(makeState());
    expect(onChange).toHaveBeenCalledWith(arr2, arr1);
  });

  // --- Subscription lifecycle ---

  it('subscribes to the store and returns an unsubscribe function', () => {
    // Why: callers must be able to wire and tear down subscriptions cleanly
    const mock = makeMockStore(makeState());
    expect(mock.listenerCount).toBe(0);

    const unsub = subscribeToSelector(mock.store, () => null, vi.fn());
    expect(mock.listenerCount).toBe(1);
    expect(typeof unsub).toBe('function');
  });

  it('unsubscribe removes the listener from the store', () => {
    // Why: prevents leaks when sessions are torn down
    const mock = makeMockStore(makeState());
    const unsub = subscribeToSelector(mock.store, () => null, vi.fn());
    expect(mock.listenerCount).toBe(1);

    unsub();
    expect(mock.listenerCount).toBe(0);
  });

  it('after unsubscribe, state changes do not trigger onChange', () => {
    // Why: prevents work after cleanup (e.g., session teardown)
    const mock = makeMockStore(makeState());
    const onChange = vi.fn();

    let result: unknown = 'a';
    const unsub = subscribeToSelector(mock.store, () => result, onChange);

    // Initial fire
    mock.setState(makeState());
    onChange.mockClear();

    unsub();
    result = 'b';
    mock.setState(makeState());
    expect(onChange).not.toHaveBeenCalled();
  });

  // --- Edge cases ---

  it('treats undefined initial previous correctly (first dispatch always fires if value differs from undefined)', () => {
    // Why: ensures first dispatch is detected even when selector returns a falsy value
    const mock = makeMockStore(makeState());
    const onChange = vi.fn();

    subscribeToSelector(mock.store, () => 0, onChange);
    mock.setState(makeState());

    // 0 !== undefined → should fire
    expect(onChange).toHaveBeenCalledWith(0, undefined);
  });

  it('does not fire on first dispatch if selector returns undefined', () => {
    // Why: undefined === undefined → no change detected
    const mock = makeMockStore(makeState());
    const onChange = vi.fn();

    subscribeToSelector(mock.store, () => undefined, onChange);
    mock.setState(makeState());

    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses strict reference equality, not deep equality', () => {
    // Why: deep equality would be expensive at 60 Hz; reference comparison
    // relies on Redux immutability guarantees (new reference = new data)
    const mock = makeMockStore(makeState());
    const onChange = vi.fn();

    let result = { x: 1 };
    subscribeToSelector(mock.store, () => result, onChange);

    mock.setState(makeState());
    onChange.mockClear();

    // New object with same content → different reference → should fire
    result = { x: 1 };
    mock.setState(makeState());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reads state from the store on each notification (not stale)', () => {
    // Why: selector must see the latest state, not a stale closure capture
    const mock = makeMockStore(makeState());
    const onChange = vi.fn();

    subscribeToSelector(mock.store, (state) => state.gpsData, onChange);

    const gpsData = {
      zero: { lat: 50, lon: 8 },
    } as CombinedRootState['gpsData'];
    mock.setState(makeState({ gpsData }));

    expect(onChange).toHaveBeenCalledWith(gpsData, undefined);
  });
});
