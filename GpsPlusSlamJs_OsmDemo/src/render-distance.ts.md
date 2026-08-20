# `render-distance.ts`

## Purpose

How far the 3D view draws, as **one** number a debug control can turn — the
arithmetic behind milestones Q9 and Q10, which the code showed to be a single
request rather than two (DEC-Y23).

## Public API

- `renderDistanceFor(multiplier: number): { farPlaneM, terrainExtentM }` — the
  distances a multiplier implies. `1` returns today's shipped values exactly.
- `MAX_RENDER_MULTIPLIER = 10` — the ceiling the control offers.

## Invariants & assumptions

- **`farPlaneM <= terrainExtentM` at every multiplier**, including invalid ones.
  This is the relationship `FAR_PLANE_M === TERRAIN_EXTENT_M` encodes today, and
  it exists because the ground plane stops at the extent: a camera that sees
  further looks past the edge of the world and finds buildings standing on
  nothing (finding R2-9). Held **by construction** — both values come from one
  factor — rather than by a clamp a later edit could get wrong. Pinned by a
  property test over arbitrary input.
- **Inert at `1`.** The control must change nothing until it is moved; a drift
  here turns a measurement instrument into a shipped behaviour change, which
  DEC-Y24 forbids.
- **Every invalid multiplier collapses to `1`** — `NaN`, both infinities, zero,
  negatives, and anything below 1. These numbers reach the camera's `far` and the
  ground plane's geometry, where a `NaN` renders nothing and raises no error; the
  field report would read "the 3D view is empty", which is indistinguishable from
  several unrelated causes.
- **The ceiling is about memory, not taste.** `GROUND_SEGMENTS` derives from
  `TERRAIN_EXTENT_M * 2 / TERRAIN_SPACING_M`, so vertex count grows with the
  extent; an unbounded multiplier kills the tab, which teaches the operator
  nothing about where the affordable limit was.
- **It does NOT fetch more terrain data.** The extent controls how far the
  already-sampled field is drawn. If the field is only sampled to 2400 m, a
  larger extent draws a flat or extrapolated skirt — and that limit may itself be
  the real answer to "why is the profile only visible near me", so it must be
  measured and reported rather than hidden.

## What this module deliberately does not do

- It does not touch `FAR_PLANE_M` or `TERRAIN_EXTENT_M`, and
  `far-field.test.ts` still pins their relationship for the default view. If
  wiring this ever requires editing those constants, the design is wrong and gets
  re-planned rather than the guard relaxed.
- It ships no new default. The multiplier that turns out to be affordable is a
  measurement the owner takes with the control, and only then a separate change.

## Examples

```ts
const { farPlaneM, terrainExtentM } = renderDistanceFor(4);
camera.far = farPlaneM;
camera.updateProjectionMatrix();
rebuildGroundPlane(terrainExtentM);
```

## Tests

- `render-distance.test.ts` — inertness at 1×, the coupling invariant as a
  property over arbitrary multipliers, scaling, the clamp, invalid-input
  collapse, and finiteness/positivity for every input.
- `far-field.test.ts` (unchanged) — the same relationship for the shipped
  constants and the default view.
