# `underground-lines.ts` — the below-surface diagnostic geometry

**Purpose.** Build the vertices and material for the underground layer's 3D
lines, away from the renderer.

## Why this is its own module

`BuildingView` needs a WebGL context to construct, so anything assembled inside
it is reachable only by an e2e — and **an e2e can see that pink lines appeared
without being able to say whether they are transparent, at the right depth, or
whether a node became a tick rather than nothing at all.**

Each of those three has broken once, and all three were found by review rather
than by a test. Moving the construction here is what makes them assertable.

## Public API

- `undergroundVertices(outlines) => number[]` — ENU x,y pairs packed into
  line-segment vertices as scene `x, depth, -y`.
- `undergroundMaterial() => THREE.LineBasicMaterial`.
- `buildUndergroundLines(outlines) => THREE.LineSegments | undefined` —
  `undefined` when there is nothing to draw, so the caller does not add a
  zero-vertex object to the scene on every refresh of a corpus with no excluded
  features, which is the common case.
- `UNDERGROUND_DEPTH_M = -6`, `NODE_TICK_M = 1.5`.

## Invariants

- **`transparent: true` is load-bearing, not cosmetic.** `WebGLRenderer` splits
  its render list into opaque / transmissive / transparent and draws opaque
  **first**; `renderOrder` only sorts _within_ a list. Shipped opaque, these
  lines drew before the translucent affordance slabs and cell surfaces, which
  then blended over them — so `RENDER_ORDER.underground` outranked `areas` and
  `cells` in the table while losing to both on screen. See `layer-order.ts`,
  whose "only translucent layers appear here" note is a **requirement on the
  material**, not a description of one.
- **`depthTest: false`**, because the lines are drawn below the terrain and
  would otherwise be occluded by the very ground they exist to be seen under.
- **A lone point is a node and gets a vertical tick.** "A segment needs two ends"
  silently dropped bins, subway entrances and shafts — from the diagnostic whose
  entire job is showing what was silently dropped. The corpus fixture's only
  below-surface feature is exactly such a node.
- **A fixed depth, not the feature's real one.** OSM's `layer` is an ordering and
  `level` is a storey index; neither is a distance, so metres derived from them
  would be a fabricated elevation.
- **The colour is `UNDERGROUND_COLOUR` from `surface-colours.ts`**, shared with
  the 2D map. It was previously written twice, and the map's copy was not a
  colour at all — a `className` with no CSS rule anywhere behind it, so Leaflet
  drew its default blue while both sidecars claimed "a colour nothing else
  uses".

## Coordinates

Outlines arrive **already in ENU**, packed x,y per point, because the frame lives
in the worker where every other piece of scene geometry is built. A page that
converted lat/lng itself would need a second copy of the frame and would go stale
on every recentre.

## Example

```ts
const lines = buildUndergroundLines(snapshot.undergroundOutlines);
if (lines !== undefined) scene.add(lines);
```

## Tests

`underground-lines.test.ts` — segment packing for two- and three-point ways, the
node tick, degenerate and empty inputs, the three material invariants, the
render-order rung, and the colour's distinctness from the rest of the palette
plus its `#rrggbb` rendering (including zero-padding, which `toString(16)` drops).

**What these do NOT cover:** that the lines are actually visible on screen — that
is the e2e's job, and it is why the material invariants are pinned here instead.
