# hud-status-rows.ts

## Purpose

Secondary HUD status rows shown during recording: the storage-sync indicator (`#sync-info`) and the AbsCompass (AbsoluteOrientationSensor) presence row (`#abs-compass-info`). Second panel extracted from the monolithic `hud.ts` (simplify-loop Area 5 stage B, 2026-07-24).

## Public API

- `updateSyncStatus(status: { state: 'idle' | 'active' | 'syncing'; lastSyncTime: number | null; lastError: string | null }): void` — hides the row when idle; otherwise shows green "Xs ago" (with a 10 s refresh interval so the relative time keeps ticking between sync events), yellow "⚠️ error", or green "pending…" when never synced. Each call clears any previous refresh interval first.
- `AbsCompassStatusDisplay` — `{ state: 'active' | 'unavailable' | 'error'; reason?: string; headingDeg?: number | null }`, structurally compatible with the framework's `AbsoluteOrientationStatus`.
- `setAbsCompassStatus(status: AbsCompassStatusDisplay): void` — green live magnetic heading (`123°`, `Number.isFinite`-guarded so a NaN heading degrades to "ok", never "NaN°"), gray "unavailable (reason)", or yellow "⚠️ error (reason)".
- `hideAbsCompass(): void` — hides the row (recording stopped).

All three are re-exported by [`hud.ts`](hud.ts) so HUD consumers (main.ts, recording-session-handlers.ts) keep a single import seam.

## Invariants & assumptions

- Every DOM read is defensive (`getElementById` + null check) — a missing element silently no-ops, matching the HUD-wide convention; independent of `initUI`.
- Owns only the `#sync-*` and `#abs-compass-*` elements.
- The sync refresh interval is module state; `updateSyncStatus` is the only writer and always clears the previous interval, so at most one timer exists.

## Example

```ts
import { updateSyncStatus, setAbsCompassStatus } from './ui/hud'; // via the hud seam
updateSyncStatus({
  state: 'active',
  lastSyncTime: Date.now(),
  lastError: null,
});
setAbsCompassStatus({ state: 'active', headingDeg: 87.3 });
```

## Tests

`hud-status-rows.test.ts` (moved from `hud.test.ts` with the extraction) pins: sync success/error/idle/pending rendering, the 10 s relative-time refresh and its cleanup on idle (fake timers), AbsCompass heading/ok/NaN/unavailable/error rendering, hide, and that `index.html` actually ships the status element.
