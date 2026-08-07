# `mesh/building-heights.ts`

## Purpose

Simple 3D Buildings height resolution: how tall a volume is, and where it starts.

## Public API

- `resolveHeights(tags): BuildingHeights` — `{ minHeightM, eaveHeightM,
totalHeightM, roofShape, heightIsGuessed }`
- `parseLengthMetres(raw): number | undefined`
- `isBuilding(feature)`, `isBuildingPart(feature)`
- `DEFAULT_LEVEL_HEIGHT_M` (3), `DEFAULT_BUILDING_HEIGHT_M` (6)
- `type RoofShape` — `flat | pyramidal | skillion | gabled | hipped | dome`

## Invariants & assumptions

- **Precedence: `height`, then `building:levels` × 3 m (+ `roof:height`), then a
  flagged default.** `heightIsGuessed` exists because the census found only 16 %
  of buildings carry `height` — a silent default would make "we know this is 6 m"
  and "we have no idea" indistinguishable.
- **`min_height` is what makes `building:part` work.** It is where the walls
  START, and it is the difference between a cathedral shape and a pile of boxes
  all standing on the ground.
- **A roof taller than its building is clamped.** A mistyped `roof:height=30` on
  a 10 m house would otherwise spike through the sky — the most visible bad-data
  artefact in practice.
- **An unrecognised `roof:shape` falls back to flat, never to a guess.** A flat
  roof of the right footprint at the right height is a far smaller error than a
  confidently wrong `gambrel`, and §8.4 notes a roof is barely visible from the
  pavement anyway.
- **Junk lengths parse to `undefined`, never `0`.** A zero-height building is
  invisible, which reads as "not mapped" rather than "bad tag". Feet are
  supported because real OSM data contains them.

## Examples

```ts
const heights = resolveHeights({ height: "157", min_height: "12" });
```

## Tests

`buildings.test.ts` — precedence, the flagged guess, `min_height`, the roof
clamp, feet/metres/junk parsing, and the unrecognised-shape fallback.
