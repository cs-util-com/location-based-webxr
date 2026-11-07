# `mesh/building-heights.ts`

## Purpose

Simple 3D Buildings height resolution: how tall a volume is, and where it starts.

## Public API

- `resolveHeights(tags): BuildingHeights` — `{ minHeightM, eaveHeightM,
totalHeightM, roofShape, heightIsGuessed, roofDirectionDeg?, roofOrientation? }`
- `parseLengthMetres(raw): number | undefined`
- `isBuilding(feature)`, `isBuildingPart(feature)`
- `DEFAULT_LEVEL_HEIGHT_M` (3), `DEFAULT_BUILDING_HEIGHT_M` (6)
- `type RoofShape` — `flat | pyramidal | skillion | gabled | hipped | dome |
onion | round | gambrel`

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
  confidently wrong shape for a value with no agreed meaning.
  - **Four wiki shapes are drawn as their nearest generated shape**, not flat:
    `cone` as `pyramidal`, `half-hipped` and `mansard` as `hipped`,
    `saltbox` as `gabled`. Flat was the wrong fallback for them: it also drops
    `roof:height`, so the walls ran up to where the roof should have ended (a
    45 m onion turret became a post).
- **`roof:direction`** is read as degrees (any real number, taken mod 360) or
  one of the 16 compass names, case and surrounding space ignored; anything
  else is `undefined` and the roof keeps its default direction. It names the
  downhill facing of the slope.
- **`roof:orientation=across`** is the only value carried; `along` is the
  default and is carried as nothing.
- **Junk lengths parse to `undefined`, never `0`.** A zero-height building is
  invisible, which reads as "not mapped" rather than "bad tag". Feet are
  supported because real OSM data contains them.

## Examples

```ts
const heights = resolveHeights({ height: "157", min_height: "12" });
```

## Tests

`building-heights.test.ts` — `min_height` against `height`, the
`roof:direction` and `roof:orientation` parse, and the shape aliases.

`buildings.test.ts` — precedence, the flagged guess, `min_height`, the roof
clamp, feet/metres/junk parsing, and the unrecognised-shape fallback.
