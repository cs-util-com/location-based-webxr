# `elevation-nudge.ts`

## Purpose

The arithmetic of the manual vertical offset applied to all OSM content in AR
(DEC-E1) — one press up or down, bounded, and the label that describes it.

## Public API

- `NUDGE_STEP_M: number` — metres per press. **1 m, not 0.25 m.** The error this
  exists to null is the reported ~10 m; a quarter-metre step is 40 presses each
  way, which is a control nobody uses. A finer step would suit a 1–2 m GPS
  altitude error, which is not the reported symptom.
- `NUDGE_LIMIT_M: number` — how far the nudge may reach either way (50 m). Five
  times the reported symptom, so it never constrains the job it exists for.
- `nudged(currentM, direction, stepM?) → number` — one press. `direction` is
  `+1` (raise) or `-1` (lower). Clamps to `±NUDGE_LIMIT_M`. `stepM` defaults to
  `NUDGE_STEP_M` and exists so the reach is testable independently of the
  shipped step.
- `describeNudge(valueM) → string` — the label. Always signed for non-zero
  values, always shown including at zero, and renders a non-finite input as
  `"0 m"` rather than as a measurement.

**Error modes:** none throw. `describeNudge` degrades a non-finite input to
`"0 m"`; `nudged` clamps rather than rejecting.

## Invariants & assumptions

- **Integer steps from an integer start stay exact.** Ten presses up then ten
  down must return `Object.is(value, 0)`, not `1e-15`. The reset path compares
  against the un-nudged offset vector exactly, so a value that _renders_ as
  `0 m` while _comparing_ unequal would show as a scene that never quite goes
  back. Pinned by a test.
- **Bounded in both directions, but never stuck at a bound.** `nudged` at the
  limit still steps back toward zero — a clamp that also blocked the return
  would strand the user.
- **This is a fudge over a diagnosed defect, not a datum.** It corrects the
  symptom, not the altitude estimate, so it deliberately diverges from the
  height the data claims.
- **It is a constant cancelling a moving quantity.** `worldBaselineY` is
  re-solved on every GPS fix with no outlier rejection, so one new fix can move
  it by metres between two glances. Expect to re-adjust, and read it beside the
  altitude readout — without the raw altitude on screen, drift and a mis-set
  nudge are indistinguishable.
- **Since the auto offset landed, the nudge is TRIM on top of it.** The applied
  value is `composeElevationM(autoM, manualTrimM)` in `ar-mode.ts`
  (`ar-elevation-auto.ts` owns the auto term); with auto off or cold the trim
  behaves exactly as described above — pinned in `ar-mode.test.ts`.
- Pure by design: no scene, no session, no DOM. The arithmetic is the part worth
  testing and it should be testable without any of them.

## Examples

```ts
let offset = 0;
offset = nudged(offset, 1); //  1  → describeNudge → "+1 m"
offset = nudged(offset, -1); // 0  → describeNudge →  "0 m"
offset = nudged(offset, -1); // -1 → describeNudge → "−1 m"

// Bounded, and still reversible at the bound:
nudged(NUDGE_LIMIT_M, 1); //  NUDGE_LIMIT_M
nudged(NUDGE_LIMIT_M, -1); // NUDGE_LIMIT_M - NUDGE_STEP_M
```

## Tests

`elevation-nudge.test.ts` — covers the step direction, exact accumulation with
no floating-point drift, the bound in both directions, stepping back off a
bound, the injectable step, that the shipped step can actually reach the
reported ~10 m error in ≤10 presses, and every `describeNudge` case including
zero and non-finite.

## Related

- `ar-elevation-control.ts` — the DOM control that owns the value and calls
  this.
- `ar-mode.ts` — sums the offset onto the geometric offset **at the
  `attachContentTo` call site**, never inside `sceneAnchorOffsetNue`, whose
  `up: 0` is a guarded invariant against double-counting the geoid.
- `GpsPlusSlamJs_Docs/docs/2026-08-16-1123-ar-elevation-and-compass-controls-plan.md`
  — the plan and DEC-E1.
- `GpsPlusSlamJs_Docs/docs/2026-08-16-1230-altitude-offset-from-elevation-data-review.md`
  — the estimator that would eventually replace this manual nudge.
