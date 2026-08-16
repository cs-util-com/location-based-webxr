# `compass-influence.ts`

## Purpose

Maps a 0–1 "how much say does the compass have" influence onto the four library
settings that actually produce it (DEC-E2). Pure: no store, no session, no DOM.

## Public API

- `COMPASS_INFLUENCE_STEP` — `0.05`, matching the RecorderApp's existing
  `compass-vote-weight` slider so field notes from the two apps are comparable.
- `COMPASS_INFLUENCE_DEFAULT` — `0.1`, the library's own
  `compassSteadyStateMaxWeight` default.
- `compassSettingsFor(influence) → CompassSettings` — `{ rotationPriorEnabled,
coldStartOverrideEnabled, experimentEnabled, voteWeight }`.
- `describeCompassInfluence(influence) → string` — the label, with both ends
  named rather than only numbered.

**Error modes:** none throw. Out-of-range values clamp; non-finite collapses to
the fully-silent combination.

## Invariants & assumptions

- **Influence 0 is NOT vote weight 0, and this is the whole reason the module
  exists.** `compass-steady-state.ts` computes
  `clamp01((1 − obs) + obs·trust·weight)`, so at `weight = 0` the result is
  `1 − observability` — a **full compass override** whenever yaw is poorly
  observable, which is exactly when someone reaches for the slider.
  - Nor does disabling the rotation prior help on its own: that falls through to
    the **cold-start override**, whose curve is identical and which has been
    default **on** since 2026-07-25.
  - So a genuine zero needs **three** settings together. A slider dispatching
    fewer has a zero end where the compass still drives — invisible from the UI.
- **`coldStartOverrideEnabled` is `false` at EVERY position**, not just zero.
  Left on at non-zero influence, two mechanisms drive yaw at once and the slider
  is no longer what is being measured.
- **The experiment combo is part of any non-zero influence.** The steady-state
  term multiplies by `trustScalar`, which is `0` unless trust is exactly
  `trusted`. The §6a field corpus measured compass↔GPS offsets of −4.3…+18.8°
  against a default tolerance of **8°**, which "rarely activates trust on real
  devices", and **there is no standalone runtime setter for the tolerance** —
  `setCompassExperimentEnabled`'s combo pinning it to **15°** is the only route.
  Without it the slider is identically inert at every position while walking.
  - ⚠️ **This is a deliberate behaviour change bundled into the control**, not a
    neutral default. The combo also sets `useCompassPairSelection`.
  - **Verified, not assumed:** `gpsDataSlice` maps `compassVoteWeight` _after_
    the combo block and unconditionally, so the slider's value survives it.
- **The applied bearing is smoothed at `coldStartSnapAlpha = 0.15` per GPS
  event**, so a change takes roughly 15–30 fixes to express. The control says so
  on screen; see `ar-compass-control.ts.md`.

## Examples

```ts
compassSettingsFor(0);
// { rotationPriorEnabled: false, coldStartOverrideEnabled: false,
//   experimentEnabled: false, voteWeight: 0 }   <- the only true silence

compassSettingsFor(0.35);
// { rotationPriorEnabled: true, coldStartOverrideEnabled: false,
//   experimentEnabled: true, voteWeight: 0.35 }

describeCompassInfluence(0); // "compass 0.00 — GPS only"
describeCompassInfluence(1); // "compass 1.00 — full"
```

## Tests

`compass-influence.test.ts` — the three-setting zero, the override staying off
at every position, the experiment combo above zero, weight pass-through,
clamping (including that a clamped zero is a _real_ zero), non-finite input, the
step/default matching the RecorderApp, and every label case.

## Related

- `ar-compass-control.ts` — the slider that owns the value and calls this.
- `ar-mode.ts` / `main.ts` — the four dispatches.
- `GpsPlusSlamJs_Docs/docs/2026-08-16-1123-ar-elevation-and-compass-controls-plan.md`
  §3 — DEC-E2 and the analysis this module implements.
