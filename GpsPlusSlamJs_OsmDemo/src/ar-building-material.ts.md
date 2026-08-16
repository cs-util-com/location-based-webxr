# `ar-building-material.ts`

## Purpose

The AR building look — **"Double-sided X-ray pulse"**, ported from the owner's
chosen shader-lab variant (2026-08-16). An interior-safe luminous shell: both
faces glow, brighter at grazing angles, with a slow breathing pulse offset per
building.

## Public API

- `AR_SHELL_PARAMS` — the owner's chosen values, with the shader lab's own
  defaults recorded beside each in the source. They differ, and the differences
  are visible.
- `createArBuildingMaterial(params?) → { material, setTime(seconds) }` —
  `params` overrides any of `AR_SHELL_PARAMS`.

## Invariants & assumptions

- **The three material flags ARE the effect, not styling.**
  - `DoubleSide` makes it _interior-safe_ — standing inside a building you see
    its back faces glow rather than looking through a hole. It also roughly
    doubles the fragments on the largest mesh in the scene.
  - `AdditiveBlending` is what makes it read as light rather than paint.
  - `depthWrite: false` stops overlapping shells occluding each other wrongly —
    and, **accepted by the owner**, means the route line, NPC agent and POI
    markers now show _through_ buildings.
  - `depthTest` stays **on**: shells are still hidden by anything that does write
    depth, including the terrain.
- **`forceSinglePass`.** With additive blending and no depth write there is
  nothing for three's default two-pass transparency to order, so the second pass
  is pure fragment cost on the scene's biggest mesh.
- **AR only.** Additive over the desktop view's sky gradient would wash out and
  would lose the depth ordering that view depends on. `ar-mode.ts` applies and
  restores it; `building-view.ts` holds it so a mid-session refetch cannot drop it.
- **It needs two vertex attributes** that only the buildings layer carries:
  `aHeight01` (position within the feature, driving the vertical phase) and
  `aFeatureRand` (per-building phase offset). Names must match
  `mesh-layers.ts`'s `setAttribute` calls exactly — a mismatch leaves the
  attribute undefined and the pulse frozen at phase 0. Pinned by a test.
- **`color` is declared explicitly** rather than via `vertexColors: true`: that
  flag only injects defines for three's own shader chunks, which this shader
  does not use.
- **`setTime` refuses a non-finite clock.** The frame loop hands `elapsed`,
  which is 0 after a reset by documented contract; a NaN would make `sin` NaN
  and blank every building at once.
- **`colourMix` defaults to 0.35** (owner decision): the palette's class
  distinctions stay legible in AR — which is what `feature-colours.test.ts`
  protects — while the scene still reads as cyan. **`colourMix: 0` reproduces
  the approved screenshot exactly.**

## ⚠️ The risk that cannot be checked from a desk

Additive blending **brightens** what is behind it. The variant was judged against
a procedural backdrop; over a real camera feed on a bright daylit street the glow
may wash out to near-invisible, and at night it may bloom. This needs a phone,
and it is the one risk that could invalidate the choice outright.

Fallbacks if fragment cost proves too high: `FrontSide` (losing the
interior-safe property) or a distance cutoff. The AR HUD already reports draw
calls, triangles and a rolling fps, which is the instrument for that measurement.

## Tests

`ar-building-material.test.ts` — the three flags, that every uniform the fragment
shader declares is supplied (derived from the shader source, so adding a uniform
without wiring it cannot pass), the two attribute declarations, the owner's
parameters against the lab defaults, the colour-mix escape hatch, and that a
non-finite clock is refused.

## Related

- `mesh-layers.ts` — attaches `aHeight01` / `aFeatureRand`, buildings only.
- `gps-plus-slam-osm`'s `chunk-meshes.ts` — produces them.
- `worker/shell-rand.ts` — the stable per-building phase.
- `GpsPlusSlamJs_Docs/docs/2026-08-16-1937-ar-xray-building-material-plan.md`
