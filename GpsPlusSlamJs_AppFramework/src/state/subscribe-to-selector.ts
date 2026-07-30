/**
 * Selective store subscription utility.
 *
 * Replaces manual tracking variables (lastX patterns) in store subscribers
 * with automated reference-equality change detection. Only fires the
 * callback when the selector's output actually changes between dispatches.
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-07-architecture-observations-consolidated.md §1
 */

import type { CombinedRootState } from './combined-root-state';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal store interface for selector subscriptions.
 * Both RecorderStore (live) and replay stores satisfy this.
 */
export interface SubscribableStore {
  getState: () => CombinedRootState;
  subscribe: (listener: () => void) => () => void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Subscribe to a specific derived value from the store, invoking `onChange`
 * only when the selector result changes by strict reference equality (`!==`).
 *
 * This replaces the `let lastX = …; if (current !== lastX) { … }` pattern
 * previously used in store-subscribers.ts.
 *
 * @param store    — subscribable store instance
 * @param selector — pure function extracting a value from state
 * @param onChange — callback receiving (current, previous) when the value changes
 * @returns unsubscribe function
 */
export function subscribeToSelector<T>(
  store: SubscribableStore,
  selector: (state: CombinedRootState) => T,
  onChange: (current: T, previous: T | undefined) => void
): () => void {
  let previous: T | undefined;

  return store.subscribe(() => {
    const current = selector(store.getState());
    if (current !== previous) {
      const prev = previous;
      previous = current;
      onChange(current, prev);
    }
  });
}
