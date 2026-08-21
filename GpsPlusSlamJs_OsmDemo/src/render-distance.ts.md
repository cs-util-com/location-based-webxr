# `render-distance.ts`

## Purpose

How far the 3D view draws, as one number a debug control can turn — the
arithmetic behind the r541 reporter's _"wie viel weiter man rendern könnte"_.

> **⚠️ [RETRACTED 2026-08-21] This module used to describe TWO coupled distances,
> and the shipped control moves only one.** Milestones Q9 and Q10 were merged on
> the reasoning that a far plane past the ground plane shows the void beyond it
> (finding R2-9), so the ground had to widen with the camera. Two owner decisions
> replaced that; see below. `terrainExtentM` was removed from the return type,
> and the property test that scaled it went with it.

## Public API

- `renderDistanceFor(multiplier: number): { farPlaneM }` — the far plane a
  multiplier implies. `1` returns today's shipped value exactly.
- `MAX_RENDER_MULTIPLIER = 10` — the ceiling the control offers.

## Why the ground plane does not follow (owner decisions, 2026-08-21)

- **Seeing empty scene past the ground's edge is acceptable.** That was the
  entire objection to a far-plane-only control, and it was cosmetic.
- **Seeing _invented_ terrain is not** — and that is what widening the plane
  actually produces. `surfaceHeight` clamps its sample index per axis and the GPU
  path uses `ClampToEdgeWrapping`, so the edge profile extrudes outward as
  stripes that read as relief and are fabricated. That is finding R2-9 in its
  real form, and `moveGroundTo` names it.

Widening the plane honestly would mean widening the height field with it, which
is a worker-protocol change nobody has scoped: `createTerrainCycle` destructures
`extentM`/`spacingM` once at construction and closes over them. So
`BuildingView.setFarPlane` moves the camera and the fog, and nothing else.

**Do not "finish the wiring" by moving the ground plane.** That is the failure
this section exists to prevent.

## Invariants & assumptions

- **Inert at `1`.** The control must change nothing until it is moved; a drift
  here turns a measurement instrument into a shipped behaviour change, which
  DEC-Y24 forbids.
- **Every invalid multiplier collapses to `1`** — `NaN`, both infinities, zero,
  negatives, and anything below 1. This number reaches the camera's `far`, where
  a `NaN` renders nothing and raises no error; the field report would read "the
  3D view is empty", which is indistinguishable from several unrelated causes.
- **The ceiling is about draw cost and legibility, NOT memory** — the original
  wording claimed an unbounded multiplier would OOM because `GROUND_SEGMENTS`
  grows with the extent. It does not: the derivation is capped at
  `MAX_GROUND_SEGMENTS` (480).
- **10× survived a measurement that looked fatal.** A spike found the
  **cold-start** loaded radius is 1048–2346 m with a best case of ~5 km, which
  says a 24 km far plane can only draw empty space. True of a fresh session and
  false of the system: `DemoPipeline.loaded` is never evicted, so a session that
  has been walked around holds far more city. See
  `2026-08-21-1420-render-distance-is-data-bound-findings.md`.

## What this module deliberately does not do

- It does not touch `FAR_PLANE_M`, and `far-field.test.ts` still pins the shipped
  default view. If wiring this ever requires editing that constant, the design is
  wrong and gets re-planned rather than the guard relaxed.
- It ships no new default. The multiplier that turns out to be affordable is a
  measurement the owner takes with the control, and only then a separate change.
- **It does not know about the fog**, deliberately. The fog moves with the far
  plane — it must, or the control is a no-op — but that coupling lives in
  `BuildingView.setFarPlane` as a single ratio, not as a second number here.
  `ar-scene-environment.ts` records why: two constants with a test asserting they
  are equal is a test that cannot fail.

## Examples

```ts
// The arithmetic lives at the CALL SITE, not in BuildingView: render-distance.ts
// reads FAR_PLANE_M from building-view.ts, so importing it back would be a cycle.
buildingView.setFarPlane(renderDistanceFor(4).farPlaneM);
```

## Tests

- `render-distance.test.ts` — inertness at 1×, scaling, the clamp,
  invalid-input collapse, and finiteness/positivity for every input.
- `scene-3d.spec.js`, "the render-distance dial moves the camera AND the fog, and
  is inert at 1x" — the wiring, asserted through a readout painted from the
  camera and the fog rather than from the slider. It cannot be a unit test:
  `BuildingView` constructs a `WebGLRenderer`.
- `far-field.test.ts` (unchanged) — the shipped constants and the default view.
