# subscribe-to-selector.ts

## Purpose

Selective store subscription utility that fires a callback only when a specific selector's output changes by reference equality (`!==`). Replaces the manual `let lastX = …; if (current !== lastX) { … }` tracking pattern used throughout store subscribers.

## Public API

| Symbol                | Signature                                                                              | Description                                                                 |
| --------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `subscribeToSelector` | `<T>(store, selector, onChange) => () => void`                                         | Subscribe to a derived value; fires `onChange(current, previous)` on change |
| `SubscribableStore`   | `{ getState: () => CombinedRootState, subscribe: (listener) => () => void }` interface | Minimal store contract — satisfied by `RecorderStore` and replay stores     |

### `subscribeToSelector(store, selector, onChange)`

- **store** — any object satisfying `SubscribableStore`
- **selector** — pure function `(state: CombinedRootState) => T` extracting a value from state
- **onChange** — callback `(current: T, previous: T | undefined) => void` invoked when the selector result changes by strict reference equality
- Returns `() => void` — unsubscribe function

## Invariants & Assumptions

- Uses strict reference equality (`!==`) for change detection — relies on Redux immutability guarantees (new reference = new data).
- The `previous` parameter is `undefined` on the first notification after subscription.
- If the selector returns `undefined`, the first notification is suppressed (`undefined === undefined`).
- Safe to call multiple times with different selectors on the same store — each creates an independent subscription.
- The callback is synchronous — called during the store's subscriber notification loop.

## Examples

```typescript
import { subscribeToSelector } from './subscribe-to-selector';
import { selectAlignmentMatrix } from './app-selectors';

const unsub = subscribeToSelector(
  store,
  selectAlignmentMatrix,
  (matrix, prev) => {
    if (matrix) applyMatrix(matrix);
  }
);

// Later:
unsub();
```

## Tests

Covered by `subscribe-to-selector.test.ts` (12 test cases):

- Core change detection: fires on reference change, skips same reference, null↔non-null transitions
- Lifecycle: subscribe, unsubscribe, no callbacks after unsubscribe
- Edge cases: undefined initial, strict reference equality (not deep), reads fresh state

## Related Files

- [store-subscribers.ts](store-subscribers.ts) — primary consumer
- [app-selectors.ts](app-selectors.ts) — selectors used with this utility
- [combined-root-state.ts](combined-root-state.ts) — `CombinedRootState` type definition
