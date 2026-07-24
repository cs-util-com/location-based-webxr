# hud-tracking-quality-panel.ts

## Purpose

The tracking-quality HUD panel: a colored state badge (`OK` / `DEGRADED` / `WARMING UP` / `AR LOST` + confidence %) with a tap-to-expand detail list of the framework's `TrackingQualityReport` sub-scores. First panel extracted from the monolithic `hud.ts` (simplify-loop Area 5, 2026-07-24).

## Public API

- `updateTrackingQuality(report: TrackingQualityReport): void` — unhides the `#tracking-quality` container, sets the badge label/color from `report.state` (toggling only the state-color classes so static classes from `index.html` survive), writes the four surviving sub-scores plus the Finding-6 `ΣΔrot`/`ΣΔpos` raw sums into the `tq-*` detail elements, and (re)attaches the badge's expand/collapse click listener when the badge element instance changed (DOM rebuild).
- `hideTrackingQuality(): void` — hides the container, collapses and hides the detail panel, resets the expanded flag.

Both are re-exported by [`hud.ts`](hud.ts) so all HUD consumers (and the wiring tests' `vi.mock('./ui/hud')` factories) keep a single import seam; `main.ts` feeds `updateTrackingQuality` into [`hud-tracking-quality-subscriber.ts`](hud-tracking-quality-subscriber.ts) as its injected `updateHud`.

## Invariants & assumptions

- Every DOM read is defensive (`getElementById` + null check): a missing element silently no-ops, matching the HUD-wide convention.
- Owns only the `#tracking-quality*` / `#tq-*` elements; independent of `initUI` — no `UICallbacks`, no cached elements, no other HUD state.
- The detail panel starts collapsed; expanding is per-badge-instance (module-level `tqBadgeWithListener` guards duplicate listeners across DOM rebuilds, and a fresh badge resets the expanded flag).
- HUD-pruning history: compass / heading / obs / walked detail fields were deliberately removed (2026-05-23 field-test Findings 2 & 3; compass sub-score deleted 2026-06-28) — tests guard against re-adding them.

## Example

```ts
import { updateTrackingQuality } from './ui/hud'; // via the hud seam
updateTrackingQuality(report); // report: TrackingQualityReport from the store
```

## Tests

`hud-tracking-quality-panel.test.ts` (moved from `hud.test.ts` with the extraction) pins: container visibility, state labels/colors incl. class-preservation and stale-color removal, sub-score rendering, the pruned-field guard, ΣΔ formatting, badge tap expand/collapse, and hide/re-show collapse behavior.
