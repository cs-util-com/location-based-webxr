# `draw-cost.ts` — what the last frame cost the GPU

## Purpose

Formats the renderer's per-frame draw-call and triangle counts for the status
line, so "are the meshes as efficient as possible" (R4-17) has a number.

## Public API

- `DrawCost` — `{ calls, triangles }`, narrowed from
  `THREE.WebGLRenderer.info.render`.
- `describeDrawCost(cost | undefined): string` — a status-line fragment, or `""`.

## Invariants & assumptions

- **`""` for "not measured", never `"0 draws"`.** Before the first render, "the
  renderer has drawn nothing" and "the renderer drew a frame containing nothing"
  are different claims and only the second is a defect. `writeStatus` drops
  empty parts, so an unmeasured cost simply does not appear rather than
  appearing as a false measurement.
- **Read AFTER the render, in `requestFrame`.** three resets these counters at
  the start of each render, so any later read describes a frame that has not
  happened.
- **This is what was DRAWN, not what was built.** Every other counter in the
  status line — volumes, parts, plates, roads, POI, areas — describes the scene
  graph. This one describes what survived frustum culling, which is exactly the
  difference Stage 3's geometry chunking is meant to create.
- **Thousands separators**, because the interesting comparisons are six-figure
  and a status line is read at a glance.

## Examples

```ts
describeDrawCost({ calls: 7, triangles: 1234 }); // "7 draws / 1,234 tri"
describeDrawCost(undefined); // ""
```

## Tests

`draw-cost.test.ts` — the happy path, thousands separation, and the two "nothing
to report" cases (`undefined` and a zero-call frame) that keep "not measured"
distinguishable from "measured as nothing".
