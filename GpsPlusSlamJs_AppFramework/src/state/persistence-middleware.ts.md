# persistence-middleware.ts

## Purpose

Redux middleware factory that persists qualifying actions to a `StorageBackend` during active recording sessions. Replaces the inline persistence logic previously embedded in the manual dispatch wrapper (§4 — `configureStore` migration).

## Public API

| Export                          | Kind     | Description                                                                                  |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `PersistenceMiddlewareOptions`  | Type     | Options: `storageBackend` (required), `persistedPrefixes` (required), `onWriteFailure` (opt) |
| `PersistenceMiddleware`         | Type     | `Middleware & { flushPendingWrites(): Promise<void> }` — the middleware plus its drain hook  |
| `createPersistenceMiddleware()` | Function | Factory returning a `PersistenceMiddleware`                                                  |
| `slicePrefixOf()`               | Function | `'gpsData/setZeroPos'` → `'gpsData'`; used by callers to derive prefixes from action types   |

## Persistence Rules

1. **Recording gate:** Persists when `state.recording.isRecording` is `true` after the reducer runs. Also persists `endSession` when the pre-reducer state was recording (captures `wasRecording` before `next(action)`).
2. **Data-driven prefix whitelist:** Persists actions whose slice prefix is in `persistedPrefixes`. The store factory derives this list from real action creators (`slicePrefixOf(setZeroPos.type)` → `gpsData`, `slicePrefixOf(recordWriteFailure.type)` → `recording`, `slicePrefixOf(recordDiagnostic.type)` → `diagnostics`, the reducer-less log-only notes) plus caller-supplied `persistedExtraPrefixes` (the recorder passes `slicePrefixOf(addRefPointEntry.type)` → `refPoints`). No prefix literal is hand-typed in the middleware — a slice rename propagates automatically (the 2026-05-28 `refPointsV2/` → `refPoints/` regression class). With the recorder wired, the effective whitelist is `gpsData/*`, `recording/*`, `diagnostics/*`, `refPoints/*`.
3. **Exclusion:** `recording/recordWriteFailure` is always excluded (derived from the imported `recordWriteFailure.type`, not a literal) to prevent recursive persistence.
4. **Non-persisted prefixes:** `routing/*`, `scenario/*`, `gpsElements/*`, `arElements/*`, `tracking/*`, `trackingQuality/*`, and any other non-whitelisted action types are not persisted.
5. **Stop semantics:** `endSession` itself IS persisted (detected via `wasRecording` check). After `endSession`, `isRecording` is `false`, so no further actions are persisted.

## Invariants & Assumptions

- **Per-instance action index** (Bug 10 fix): each middleware instance maintains its own `actionIndex` counter starting at 0. Pre-increment yields 1-based indices (`000001.json`, `000002.json`, …). This prevents cross-store index bleed.
- **Index reset on startSession:** `actionIndex` is reset to 0 when `recording/startSession` is dispatched, ensuring each session starts at index 1.
- **Write queue with concurrency limit:** `storageBackend.writeAction()` calls are enqueued in a `WriteQueue` with a maximum of 3 concurrent writes. This prevents unbounded memory growth when storage is slow (e.g., OPFS locked by another tab or GC pauses on mobile). Failures are caught and handled via `recordWriteFailure` dispatch + `onWriteFailure` callback.
- **Drain hook (`flushPendingWrites`, 2026-07-12):** resolves once the queue is fully idle — every enqueued write (including ones waiting behind the concurrency cap) has settled; resolves immediately when idle and never hangs on rejected writes (they count as settled). The stop flow MUST await it (via the store's `flushPendingActionWrites`) before anything reads the session's `actions/` (final sync, ZIP export) — otherwise an action dispatched moments before Stop can land after the export enumerated the directory and silently miss the zip (indoor-loop enablement follow-up §3.6b). Writes enqueued after the queue went idle again are not waited for.
- **Error normalization:** non-`Error` rejections (e.g., `Promise.reject('string')`) are wrapped in `new Error(String(err))` before processing.
- **No recursion:** `recordWriteFailure` is excluded from the persistence whitelist, so dispatching it from the error handler cannot trigger another write.
- **Re-entrancy tripwire (dev guardrail):** a closure-scoped `dispatchDepth` is incremented at handler entry and decremented in a `finally` wrapping the **whole** body (so the post-`next()` depth check is correct). When a **persisted** action is about to be enqueued while `dispatchDepth > 1` — i.e. it was dispatched re-entrantly from inside another action's `next()` (the classic synchronous `store.subscribe` + `dispatch` trap) — the middleware `log.warn`s **once per instance** (`hasWarnedReentrant`). Such an action receives a LOWER replay index than its trigger (the index is assigned after `next()`) and is dropped on replay — a silent, replay-only failure the warning surfaces at dev time. **Observational only:** the recorded actions/indices are unchanged and it **never throws** (throwing could destabilise a live recording). **Deliberately not gated on `enableDevChecks`** (which the middleware doesn't receive anyway): the cost is one integer compare per dispatch and the warning is self-limiting, so leaving it on in production is harmless and still catches a regression in dev-checks-off builds. The middleware's own async `recordWriteFailure` dispatch runs in a later macrotask at depth 1 and is excluded from persistence, so it never trips the guard. See [`2026-06-28-0751-subscriber-dispatch-persistence-ordering-review.md`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-28-0751-subscriber-dispatch-persistence-ordering-review.md) and the sibling [guardrail review](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-28-0751-persistence-reentrancy-guardrail-review.md). The structural fix that makes the warning fire on no current call site is the listener middleware in [`slam-app-store-listener.ts`](slam-app-store-listener.ts).

## Examples

```typescript
import { createPersistenceMiddleware } from './persistence-middleware';
import { OpfsStorageBackend } from '../storage/opfs-storage-backend';

const middleware = createPersistenceMiddleware({
  storageBackend: new OpfsStorageBackend(),
  // Derive prefixes from the actual slices, never hand-typed literals.
  persistedPrefixes: ['gpsData', 'recording'],
  onWriteFailure: (err) => showToast(`Write failed: ${err.message}`),
});

// Used in configureStore:
configureStore({
  reducer: {
    /* ... */
  },
  middleware: (getDefault) => getDefault().concat(middleware),
});
```

## Tests

- `persistence-middleware.test.ts` — covering:
  - No persistence when not recording
  - `startSession` persistence (recording gate checked after reduce)
  - `gpsData/*`, `refPoints/*`, and `recording/*` persistence
  - `recordWriteFailure` exclusion
  - `routing/*` exclusion
  - Stop-after-endSession semantics
  - 1-based indexing
  - Per-instance index isolation
  - `onWriteFailure` callback invocation
  - `recordWriteFailure` dispatch on storage error
  - Non-Error rejection normalization
  - Action passthrough (middleware doesn't block dispatch)
  - Concurrent write limit when storage is slow (backpressure)
  - Multi-session actionIndex reset (new sessions start at index 1)
  - `endSession` persistence (not dropped by isRecording=false gate)
  - **Data-driven whitelist:** only slices listed in `persistedPrefixes` are persisted; an unlisted slice is dropped even while recording (the rename-drift guard)
  - **`slicePrefixOf`** unit tests (namespaced type → prefix, no-slash passthrough, first-slash split)
  - **Re-entrancy tripwire** (`describe('persistence re-entrancy tripwire')`): a subscriber re-entrantly dispatching a persisted action warns once and names the action (and the recorded writes are kept with the inverted index, proving the guard is observational); normal top-level dispatches do not warn; the async `recordWriteFailure` dispatch on a write error does not false-positive
- The end-to-end producer guard wiring the REAL recorder slice + REAL middleware lives in `recorder-store.test.ts` → "should persist refPoints/ mark actions when recording".

## Related

- [create-slam-app-store.ts](create-slam-app-store.ts.md) — the factory that wires this middleware into `configureStore`
- [recording-slice.ts](recording-slice.ts.md) — provides `recordWriteFailure` action creator
- [storage-backend.ts](../storage/storage-backend.ts.md) — `StorageBackend` interface
