# `compass-influence.ts`

## Purpose

Maps a 0–1 "how much say does the compass have" influence, plus the gear-panel
experiment options, onto the eight library dispatches that actually produce it
(DEC-E2, extended by the 2026-08-20 transition plan DEC-Y1d/Y1e). Pure: no
store, no session, no DOM.

## Public API

- `COMPASS_INFLUENCE_STEP` — `0.05`, matching the RecorderApp's existing
  `compass-vote-weight` slider so field notes from the two apps are comparable.
- `COMPASS_INFLUENCE_DEFAULT` — **`0.8`** (raised from 0.1 on 2026-08-20,
  `87500e31`, as the demo's testbed stance). The **library's** own
  `compassSteadyStateMaxWeight` default remains `0.1` — the demo deliberately
  diverges, and whether 0.8 is error or correction is exactly what the corpus
  cannot yet say (see the trust-gate census results doc §0/§5).
- `COMPASS_EXPERIMENT_DEFAULTS` — `{ rotationPriorEnabled: true, trustGateMode:
"ramp", pairSelectionEnabled: true, trustToleranceDeg: 15,
webXRConsistencyEnabled: false }`.
- `compassSettingsFor(influence, experiments) → CompassSettings` — the
  eight-field dispatch set: `{ rotationPriorEnabled, coldStartOverrideEnabled,
experimentEnabled, voteWeight, trustGateMode, pairSelectionEnabled,
trustToleranceDeg, webXRConsistencyEnabled }`.
- `describeCompassInfluence(influence, live?: CompassLiveState) → string` —
  the label, with both ends named rather than only numbered. With `live`, the
  DEC-Y12 readout: target vs applied weight and the trust phase (e.g.
  `compass 0.80 target — now 0.42 untrusted`), so the on-screen label can show
  what the solve is actually using, not only what was requested.
- `describeTrustGate(mode: CompassTrustGateMode) → string` — one-line label
  for the gate mode (consumed by `ar-mode.ts`).
- Exported types: `CompassTrustGateMode` (`"off" | "binary" | "ramp"`),
  `CompassExperiments`, `CompassLiveState`.

> **Doc-rot note (2026-09-01):** until today this sidecar still described the
> original four-field shape and the 0.1 default, six weeks after both changed —
> and its "no standalone tolerance setter" claim (also stale since 2026-08-20)
> propagated into a planning session as fact. If the module's API moves again,
> this file moves in the same commit.

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
- **`coldStartOverrideEnabled` is `false` whenever the rotation prior is
  on** — i.e. at zero, and at non-zero influence with the default experiments.
  With the prior toggled OFF at non-zero influence it is deliberately `true`:
  the fall-through hands yaw back to the validated Stage 0 baseline, because
  "prior off" must mean "the validated baseline", not "no compass at all"
  (`compassSettingsFor`, pinned by the "turning the rotation prior OFF hands
  back to Stage 0" test). Left on WITH the prior, two mechanisms would drive
  yaw at once — which is why the pair is never both-on.
- **The experiment combo is part of any non-zero influence.** The steady-state
  term multiplies by `trustScalar`, which is `0` unless trust is exactly
  `trusted`. The §6a field corpus measured compass↔GPS offsets of −4.3…+18.8°
  against a default tolerance of **8°**, which "rarely activates trust on real
  devices". The combo pins the tolerance to **15°**; the standalone
  `setCompassTrustAgreeToleranceDeg` setter has ALSO existed since 2026-08-20
  and is dispatched explicitly — the combo stays because it gates the prior and
  pair selection in the same breath, not because it is the only route. Without
  the tolerance change the slider is identically inert at every position while
  walking.
  - ⚠️ **This is a deliberate behaviour change bundled into the control**, not a
    neutral default. The combo also sets `useCompassPairSelection`.
  - **Verified, not assumed:** `gpsDataSlice` maps `compassVoteWeight` _after_
    the combo block and unconditionally, so the slider's value survives it.
- **The applied bearing is smoothed at `coldStartSnapAlpha = 0.15` per GPS
  event**, so a change takes roughly 15–30 fixes to express. The control says so
  on screen; see `ar-compass-control.ts.md`.

## Examples

```ts
// At zero the `experiments` argument is IGNORED entirely — SILENT returns
// before reading it, and no toggle may reintroduce the compass, because
// "GPS only" is the control arm (pinned by test).
compassSettingsFor(0, COMPASS_EXPERIMENT_DEFAULTS);
// { rotationPriorEnabled: false, coldStartOverrideEnabled: false,
//   experimentEnabled: false, voteWeight: 0, trustGateMode: "binary",
//   pairSelectionEnabled: false, trustToleranceDeg: 15,
//   webXRConsistencyEnabled: false }            <- the only true silence

compassSettingsFor(0.35, COMPASS_EXPERIMENT_DEFAULTS);
// { rotationPriorEnabled: true, coldStartOverrideEnabled: false,
//   experimentEnabled: true, voteWeight: 0.35, trustGateMode: "ramp",
//   pairSelectionEnabled: true, trustToleranceDeg: 15,
//   webXRConsistencyEnabled: false }

describeCompassInfluence(0); // "compass 0.00 — GPS only"
describeCompassInfluence(1); // "compass 1.00 — full"
```

## Tests

`compass-influence.test.ts` — the three-setting zero, the cold-start override
following the rotation prior (off while the prior is on; the deliberate
fall-through to Stage 0 when the prior is toggled off), the experiment combo
above zero, weight pass-through, clamping (including that a clamped zero is a
_real_ zero), non-finite input, the step matching the RecorderApp (the DEFAULTS
deliberately diverge: demo 0.8, RecorderApp 0.1), every label case, and the
DEC-Y12 live-diagnostics readout (target vs applied weight and trust phase).
`describeTrustGate`'s labels are covered in `ar-compass-control.test.ts`.

## Related

- `ar-compass-control.ts` — the slider that owns the value and calls this.
- `main.ts` (`onCompassSettings`) — the eight dispatches, in their load-bearing
  order (combo before the standalone setters); `ar-mode.ts` only forwards the
  callback.
- `GpsPlusSlamJs_Docs/docs/2026-08-16-1123-ar-elevation-and-compass-controls-plan.md`
  §3 — DEC-E2 and the analysis this module implements.
