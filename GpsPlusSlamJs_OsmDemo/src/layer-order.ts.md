# `layer-order.ts`

**Purpose.** State, in one place, how far above the terrain surface each ground-level layer is drawn, so that no two of them are ever coplanar.

## Public API

- `groundLift(layer: LayerKind): number` — metres above the terrain surface for that layer. Total over `LayerKind`: every kind returns a number, and the `switch` is exhaustive with no `default`, so **adding a layer kind without deciding its lift is a compile error** rather than a silent 0.
  - Ground layers, lowest first: `plates` 0.04, `roads` 0.08, `areas` 0.12, `cells` 0.16.
  - `buildings`, `trees`, `poi` → **0**. They stand up from the ground and are separated by their own geometry; lifting them would only make them float.
  - `terrainDebug` used to be here at **0**, for a different reason with the same answer: it re-coloured the ground plane _in place_ rather than adding a surface above it, so a lifted copy would z-fight with the plane it replaced. It is now a ground mode rather than a layer (W6, DEC-R5-4) — and needing a bespoke reason to sit in this table was one of the signs it never belonged in the registry.
- `GROUND_LAYERS` — the four lifted layers, lowest first. Exported so a test can assert the ladder is strictly increasing **without re-listing it**; a second list would be the thing that drifts.
- `ROUTE_LIFT_M` — the planned route's polyline, one rung **above** the whole ladder. It is not a `LayerKind` (not toggleable, not a claim about the ground), so it cannot go through `groundLift` — but it is coplanar with everything that does, which is exactly why it lives here rather than in `route-path.ts`. Above `cells` because the route is the artefact stage 4 exists to show (DEC-R11-3), and occluding it behind an affordance overlay would hide it.

`STEP_M = 0.04` is deliberately not exported. Callers ask for a layer's lift, they do not do the arithmetic.

## Invariants & assumptions

- **The order is a design decision, not an accident of magnitude.** Plates lowest because a car park _is_ the ground there; roads above plates because a road crossing a landuse polygon should read as on top of it; merged areas above both because they are a claim _about_ the ground rather than part of it; cells highest because the per-cell grid is the finest-grained claim and is the thing being interrogated, so it must never be occluded by a coarser layer.
- **One module rather than a constant per file.** Five things want `y ≈ 0` — terrain plane, plates, roads, area slabs, affordance grid — and coplanar geometry z-fights into a shimmering stripe that changes with the camera and reads as a rendering bug. Whether no two are coplanar is only checkable if the offsets are stated together. This existed implicitly as `cell-mesh.ts`'s lone `GRID_LIFT_M`, which was fine at one lifted layer and stops being fine at five, because each new constant would be chosen against whichever neighbour its author happened to think of.
- **Lifts are relative to the terrain surface, not to `y = 0`.** A consumer adds `groundLift(kind)` to the sampled ground height at each vertex, so the ladder holds over relief as well as over flat ground.
- **The step size is bounded from both sides.** Large enough to beat depth-buffer precision, small enough that nothing looks like it is floating — 4 cm is invisible at any distance this scene is viewed from.
  - **Caveat, and the module comment currently overstates this (follow-up F12).** It claims 4 cm is "~three orders of magnitude above the depth resolution there". For the camera's 0.5 m → 4000 m frustum and a 24-bit buffer the resolution is ≈ z² / (near · 2²⁴): **~5 mm at 200 m, ~3 cm at 500 m, ~25 cm at 1400 m.** So the claim holds near the camera and inverts beyond ~500 m, where `STEP_M` is at or below the noise floor. Nothing has been observed to z-fight yet; if a distant plate or slab ever shimmers, this is why, and the fix is a distance-scaled lift rather than a bigger constant.

## Examples

```ts
import { groundLift, GROUND_LAYERS } from "./layer-order.js";

// Drape a plate on the terrain, lifted by its layer's rung.
const y = terrain.heightAt({ x, y: northM }) + groundLift("plates");

// The ladder is strictly increasing, without restating it.
const lifts = GROUND_LAYERS.map(groundLift); // [0.04, 0.08, 0.12, 0.16]
```

## Tests

- `layer-order.test.ts` — strictly increasing along the ladder; every ground layer gets a distinct non-zero lift; `cells` is at the top, because they are what is being inspected; nothing that stands up from the ground is lifted; every `LayerKind` is answered, so a new kind cannot be forgotten; and every lift stays small enough not to look like floating.
- The visible consequence is covered by e2e rather than here: `playwright-tests/` asserts that switching the `plates` and `areas` layers on changes the rendered pixels, which is the assertion that would fail if a lift collapsed into the terrain plane.
