# surface-smoothing.ts

## Purpose

The mesh cursor's smoothing in time (mesh-cursor smoothing plan 2026-10-15-0944 in
`GpsPlusSlamJs_Docs/docs/`): the owner's phone test of the mesh cursor - "it could be a
little bit smoother: a little bit more lerping". The ring eases toward each frame's surface
point with time constants, and jumps instead of gliding when it would have to cross to a
different surface.

## Public API

- `SurfaceSmoothingConfig` - `{ positionTauS, normalTauS, snapRatio }`.
- `DEFAULT_SURFACE_SMOOTHING` - `{ positionTauS: 0.1, normalTauS: 0.2, snapRatio: 0.3 }`.
- `smoothingAlpha(tauS, dtS)` - `1 - exp(-dt / tau)`, the share of the remaining lag a
  step of `dtS` seconds closes. `dtS <= 0` gives 0 (never away from the target); a
  non-finite `dtS` gives 1 (an unknown gap: catch up); `tauS <= 0` gives 1 (no smoothing).
- `createSurfaceSmoother(overrides?)` - `{ update(target, dtS, viewDistanceM), reset() }`:
  - `update` returns the ring's point (fresh vectors) or null. The first sample, the first
    after `reset()`, and any sample the ring lags by more than `snapRatio x viewDistanceM`
    land exactly on the target (position and normal). Otherwise the position lerps and
    the normal turns along the great circle toward the target's, each by its own alpha.
  - A non-finite point or a zero/non-finite normal is no sample: the smoother resets and
    returns null (the caller then has no point - the hit-test drives the ring).
  - A non-finite `viewDistanceM` snaps (a threshold of 0).
  - Throws `RangeError` at construction for a negative or non-finite setting.

## Invariants & assumptions

- **Frame-rate independent by construction:** for a held target, N steps of `dt / N`
  equal one of `dt` (the alphas compose: `(1 - a1)(1 - a2) = 1 - a(dt1 + dt2)`; the normal
  stays on one great circle). The framework's `clampedAlpha(rate, dt) = min(rate * dt, 1)`
  (`visualization/lerp-utils.ts`) is the linear approximation of this and is only roughly
  independent; it is left as it is for its four framework users. `1 - exp(-dt / tau)` is a
  one-liner, so it exists here once for the package (DEC-H3), as it does inline in the
  framework's elevation estimator, the Landing scene and the Globe.
- **The snap tests the LAG** (smoothed point to target), not the per-frame jump, so it
  does not depend on the frame rate; it is relative to the target's distance from the
  camera because the cursor sits on the screen-centre ray and what is "far" scales with
  how far it looks. A steady pan lags `v x tau` (0.1 m at 1 m/s) and glides; a jump to a
  surface behind (a table edge to the floor) snaps.
- Never past the target and never away from it for a held target (alpha in [0, 1]).
- Normals are unit length out; the target's is normalised in.
- The caller supplies `dtS`; the mesh surface passes the time since the last SMOOTHED pick,
  so a hole in the mesh is a gap in the smoother's time.

## Parameter sweeps (60 Hz, analytic and pinned by the property test)

- `positionTauS` 0.03 / 0.05 / 0.08 / **0.1** / 0.15 / 0.2 / 0.3 s:
  - tremble left of 1 cm frame noise: 0.52 / 0.41 / 0.32 / **0.29** / 0.24 / 0.20 / 0.17;
  - settle to 1 cm of a 20 cm step: 0.09 / 0.15 / 0.24 / **0.30** / 0.45 / 0.60 / 0.90 s;
  - lag at 1 m/s: 2 / 4 / 7 / **9** / 14 / 19 / 29 cm.
  - Verdict: monotone trade, no value better at both; 0.1 s calms the tremble to under a
    third and settles within a third of a second ("a little bit more").
- `snapRatio` 0.1 - 0.6: across the whole range a pan at 1 m/s (2 m away) glides and a
  table-to-floor jump (1 m to 2.5 m) snaps; 0.3 is not on an edge.
- `normalTauS` 0.2 s: the same curve at twice the time constant (the owner asked for the
  rotation to be calmed more).

## Examples

```ts
const smoother = createSurfaceSmoother();
// once per frame, with the raycast hit:
const ring = smoother.update({ position, normal }, dtS, hit.distance);
// after a tracking origin reset:
smoother.reset();
```

## Tests

- `surface-smoothing.test.ts` - the exact step, gaps and bad `dt`, the first point, easing
  and convergence, the slower normal, the snap and the no-snap, a short hole and a long
  gap, `reset()`, bad input as no sample, unknown distance, copies out, bad settings, the
  defaults (mutation-checked: the linear `clampedAlpha` form fails six tests, no snap
  fails four).
- `surface-smoothing.property.test.ts` - finite point and unit normal for any input and
  `dt`; never away from or past a held target; frame-rate independence; no lag beyond the
  snap ratio survives a step; alpha composition; the sweeps above.
