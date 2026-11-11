# street-furniture.ts

## Purpose

Street furniture from mapped OSM nodes: street lamps (mast, wall or
suspended, from `lamp_mount`), bollards, benches and waste baskets, each
with its position, ground height, yaw, drawn height (lamps and bollards) and
the list of what was guessed. Pure data, no three.js; the renderer is
`../three/street-furniture.ts`. Port of the O3 street scene prototype's
furniture
(`GpsPlusSlamJs_DesignSystem/labs/city-look/o3-street-scene/street-objects.js`),
city objects plan 2026-11-07-2315 M5.

## Public API

- `FurnitureKind` = `"lamp" | "bollard" | "bench" | "bin"`;
  `FURNITURE_KINDS` lists all four in build order.
- `FurnitureModel` adds the lamp mounts: `"lamp" | "lamp-wall" |
"lamp-suspended" | "bollard" | "bench" | "bin"`.
- `FURNITURE_DEFAULT_HEIGHT_M` - 5 m mast, 4 m wall, 6 m suspended, 0.9 m
  bollard. `MAX_FURNITURE_HEIGHT_M` (30) - a tagged height above it is a
  typo.
- `furnitureModelOf(tags)` → the model or undefined. Order: lamp, bench,
  bin, bollard (a lamp tagged as a bollard too is a lamp).
- `compassYawRad(raw)` → `-degrees` in radians for a plain decimal
  `direction`, undefined for anything else (cardinal letters, ranges,
  lists, exponents, empty).
- `buildStreetFurniture(features, { frame, groundHeightM?, window, kinds? })`
  → `FurniturePlacement[]` in input order. RangeError for a missing window
  or an unknown kind; `kinds: []` builds none.
  A ground that is missing or answers a non-number reads as 0, as for
  the markings and pedestrian areas.
- `FurniturePlacement` - `{ key, kind, model, position (ENU), groundHeightM,
yawRad, heightM? (lamps and bollards only), guessed: ("height" | "yaw")[] }`.
- `furnitureWithinCut(items, eye, cutM)` → indices within `cutM` metres in
  plan (inclusive), in order; `Infinity` keeps all; RangeError for a cut
  that is not positive.

## Invariants & assumptions

- Nodes only; a way or relation tagged as furniture is ignored (a bench or
  bollard row mapped as a line is not invented into points).
- A tagged `height` (`parseLengthMetres`: metres, `m`, feet) wins when in
  (0, 30] m; otherwise the model default, listed in `guessed`.
- Benches and bins carry no `heightM`: they draw their POI model at its own
  real-world size, so nothing about their height is guessed.
- The seeded yaw is `stableRotationY(key)`, the helper the POI markers use,
  so a bench drawn by either layer faces the same way.
- Cardinal `direction` values (`N`, `NE`) are refused today and take a
  seeded yaw; the prototype did the same.
- Nothing outside `window` (the fetched bbox). Deterministic per node and
  independent of input order (property test).
- Never an obstacle: the navigation index reads ways and areas, not these
  nodes.

## Examples

```ts
const items = buildStreetFurniture(features, {
  frame,
  window,
  kinds: ["lamp", "bollard"],
});
const near = furnitureWithinCut(items, { x: 0, y: 0 }, 80);
```

## Tests

`street-furniture.test.ts` - the tag table and mounts, direction parsing
(degrees, junk refused), nodes only, default and tagged heights with the
typo bound, benches and bins without a height, mapped versus seeded yaw and
the `guessed` lists, position and ground, kinds and order, the window, the
refusals, the cut. `street-furniture.property.test.ts` - the cut keeps
exactly the items within it; placements are the same in any input order.
