# sync-manager.ts

## Purpose

Periodically runs a caller-supplied async sync operation, so a recording in
progress is regularly flushed from OPFS to the user's chosen external ZIP file
and survives a crash or a killed tab.

It does **not** know what syncing means — the operation is injected. The module
is pure scheduling + status: an interval, a page-hide trigger, a concurrency
guard, and a status object for the HUD.

## Public API

Exactly three exports.

### `createSyncManager(syncFn, options?): SyncManager`

- `syncFn: () => Promise<void>` — the operation to run on each tick.
- `options.intervalMs?: number` — tick interval, default `DEFAULT_SYNC_INTERVAL_MS`.
- `options.onStatusChange?: (status) => void` — called on every status transition.

### `SyncManager` (interface)

- `start()` — begin ticking and attach the `visibilitychange` listener. Calling
  it while already started is a no-op.
- `stop()` — clear the timer, detach the listener, status → `idle`.
- `getStatus()` — a **copy** of the current status (callers cannot mutate it).
- `syncNow()` — sync immediately, then reset the interval.

### `DEFAULT_SYNC_INTERVAL_MS`

`60_000`. Agreed in a user-feedback session; the production call site passes no
`intervalMs`, so this is the interval that actually ships.

`SyncStatus` (`{ state: 'idle' | 'active' | 'syncing'; lastSyncTime: number | null; lastError: string | null }`)
and `SyncManagerOptions` are **not exported** — they are reachable only through
the exported signatures.

## Invariants & assumptions

- **No overlapping syncs.** A tick that arrives while `state === 'syncing'` is
  dropped, not queued. A slow `syncFn` therefore self-limits rather than piling
  up.
- **Late completions after `stop()` are discarded.** This is the module's
  subtlest behaviour and the reason the `stopped` flag exists separately from
  `status.state`: `syncFn` is awaited, so it can settle _after_ `stop()` has
  already run. `stopped` is set `false` in `start()`, `true` as the **first**
  statement of `stop()`, and re-checked after the `await` on both the success
  and the error path. Without it a completing sync would write `state: 'active'`
  over the `idle` that `stop()` just set, and the HUD would show a live sync for
  a session that has ended.
- **A failing `syncFn` never stops the loop.** The error is logged, stored in
  `status.lastError`, and the state returns to `active`.
- **Interval reset after out-of-band syncs.** Both `syncNow()` and the page-hide
  sync restart the timer, so a manual sync is not immediately followed by a
  scheduled one.
- **Page-hide, not page-show.** The `visibilitychange` handler acts only on
  `visibilityState === 'hidden'` — the point is to flush before the OS can
  discard the tab. (Contrast `sensors/permission-checker.ts`, which listens to
  the same event for the opposite edge.)
- **`stop()` is idempotent and safe before `start()`** — every teardown branch is
  null-guarded.
- Requires `document`; unit tests run under jsdom with fake timers.

## Example

The real call site (`recording/recording-session-handlers.ts`) — note the
default interval and the HUD wiring:

```ts
const syncManager = createSyncManager(
  async () => {
    lastSyncResult = await syncScenarioSessionToExternalZip(
      saveFileHandle,
      scenarioName,
      currentSessionName,
      { contributors: buildZipContributors() }
    );
  },
  {
    onStatusChange: (status) => {
      updateSyncStatus(status); // HUD indicator
    },
  }
);
syncManager.start();
// ... recording ...
await syncManager.syncNow(); // flush before teardown
syncManager.stop();
```

## Tests

`sync-manager.test.ts` — 22 tests on fake timers, grouped as: factory surface,
start/stop lifecycle, `getStatus`, `syncNow`, visibility-change handling, status
callbacks, and a dedicated **`stop()` race condition** group pinning the
late-completion rule above on both the resolve and the reject path.
