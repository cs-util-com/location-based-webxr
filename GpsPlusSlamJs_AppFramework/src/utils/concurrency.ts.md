# concurrency.ts

## Purpose

Provides helpers for limiting the number of concurrent async operations. Used to prevent excessive memory consumption and I/O pressure when scanning many files in parallel (e.g., reading zip metadata during scenario discovery).

## Public API

### `mapWithConcurrencyLimit<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]>`

Maps over an array with a concurrency cap on the async mapper function. Behaves like `Promise.all(items.map(fn))` but limits how many mapper invocations run simultaneously.

- **Input:** Array of items, concurrency limit (positive integer, `>= 1`), async mapper function
- **Output:** Array of results in the same order as input items
- **Errors:**
  - Throws `RangeError` if `limit < 1` (e.g., 0, negative values)
  - Re-throws the **first** error from any mapper invocation (fail-fast). Once any worker throws, surviving workers stop pulling new items (a shared failure flag) instead of draining the queue in the background. In-flight invocations still run to completion, and the function settles (re-throws) only **after** all of them have settled — workers resolve and the first recorded error is re-thrown afterwards, so the rejection never races ahead of still-running background work and a later sibling throw cannot leak as an unhandled rejection.

### `forEachWithConcurrencyLimit<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>, signal?: AbortSignal): Promise<void>`

Runs an async, side-effecting worker over each item with a concurrency cap, invoking the worker **per item as the pool pulls it** rather than collecting results. This is the "emit as each settles" shape progressive consumers need (e.g. `streamRecordingIndex` emitting one recording at a time).

- **Input:** Items, concurrency limit (`>= 1`), async worker, optional `AbortSignal`
- **Output:** `void` — the worker produces its own side effect (e.g. a streaming callback)
- **Errors:**
  - Throws `RangeError` if `limit < 1`
  - Re-throws the **first** error from any worker invocation (fail-fast). Once any worker throws, surviving pumps stop pulling **new** items (a shared failure flag) — the same "stop pulling" behavior as abort — so they don't keep emitting side effects into a tearing-down consumer. In-flight workers run to completion, and the function settles (re-throws) only **after** they have — fully mirroring the abort path, so the caller's `await` returns once no worker is still emitting rather than the rejection racing ahead of detached background work. A later sibling throw cannot leak as an unhandled rejection.
- **Abort:** When `signal` is aborted, workers stop pulling **new** items (checked before each pull). In-flight workers run to completion (the underlying File System Access reads cannot be torn mid-read). An already-aborted signal starts no work at all.

## Invariants & Assumptions

- `mapWithConcurrencyLimit` results are always returned **in input order**, regardless of completion order.
- `forEachWithConcurrencyLimit` makes **no ordering guarantee** — completion order depends on which worker finishes first. Each item's worker is invoked exactly once unless aborted.
- At most `limit` invocations are active at any time (both helpers).
- If `limit >= items.length`, behavior is identical to `Promise.all`.
- Worker pool pattern: `min(limit, items.length)` workers pull from a shared index counter.

## Examples

```typescript
import {
  mapWithConcurrencyLimit,
  forEachWithConcurrencyLimit,
} from './concurrency';

// Read metadata from 50 zip files, max 4 at a time (ordered array of results)
const results = await mapWithConcurrencyLimit(zipFiles, 4, async (file) => {
  return await readMetadata(file);
});

// Stream coverage per recording as each resolves, abortable
const controller = new AbortController();
await forEachWithConcurrencyLimit(
  legacyEntries,
  4,
  async (entry) => emit(await deriveCoverage(entry)),
  controller.signal
);
```

## Tests

- Unit tests: `concurrency.test.ts`.
  - `mapWithConcurrencyLimit` — ordered results, empty input, limit > items, peak concurrency tracking, error propagation, fail-fast stops pulling new items after a mapper throws, error path waits for in-flight workers to settle before rejecting (mirrors abort), first error wins when multiple mappers throw (no unhandled rejection), sequential execution (limit=1), RangeError for limit=0, RangeError for negative limit, descriptive error message content.
  - `forEachWithConcurrencyLimit` — one invocation per item, empty-input no-op, concurrency cap, abort stops pulling new items, fail-fast stops pulling new items after a worker throws, error path waits for in-flight workers to settle before rejecting (mirrors abort), first error wins when multiple workers throw (no unhandled rejection), already-aborted signal starts no work, RangeError for limit < 1.
