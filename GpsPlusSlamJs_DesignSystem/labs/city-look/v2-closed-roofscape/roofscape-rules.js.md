# roofscape-rules.js

## Purpose

V2's decisions, all pure: which building gets an invented roof, how high its
walls stand, which muted tones it takes, which walls it shares with a
neighbour, and which roof it ends up with.

## Public API

- `planCity(entries, options)` -> `{ plans, counts }`. `entries`:
  `{ key, tags, rings, belowSurface? }`, rings in local metres, buildings and
  parts. `options`: `triangulate` (required), and `heightLimitM`,
  `simplifyToleranceM`, `gableShare`, `overhangM`, `maxRiseM`, `sharedGapM`,
  each defaulting to `PARAMS`. A plan is
  `{ key, rings, roofRings, eaveM, tan, roof, style, colours }`; `roof` null
  means the method failed and the house gets a flat lid. `counts` carries why
  each other building was kept and how many roofs took each style
  (`gable`, `shared`, `hip`, `cut`, `flat`).
- `keepReason(tags, { hasParts, heightLimitM, belowSurface })`: why a building
  stays exactly as today, or null.
- `eaveHeightM(tags, areaM2, key)`, `coloursFor(tags, key)`: the tagged value,
  else a seeded one.
- `simplifyRing`, `prepareRing`, `sharedWalls`, `offsetRing`, `PARAMS`.

## Invariants and assumptions

- Kept unchanged: a part, an outline holding parts, any `roof:*` shape, height
  or levels tag (so an explicit `flat` stays flat), `min_height` or
  `building:min_level`, below the surface, a class that has no pitched roof
  (`roof`, `garages`, `kiosk`, ...), a tagged height above the limit.
- Everything invented is seeded from the OSM key, never an index.
- A roof is accepted only when it covers its footprint within 0.4 % and no
  slope triangle lies outside the outline or inside a courtyard. The ladder:
  gables plus shared walls, shared walls only, plain hip; then flush instead of
  with an eave; then a flat lid.
- A stated `height` is the whole building: the roof fits inside it. Levels give
  the eave (3 m each) and the roof goes on top.
- The eave reaches `overhangM` past slope walls only; gable and shared walls
  stay on their line, so an eave never grows into the neighbour.

## Example

```js
const { plans } = planCity(entries, { triangulate, heightLimitM: 14 });
```

## Tests

`roofscape-rules.test.mjs`, on synthetic cases and on both real fixtures:
tagged cases kept, Heidelberg's church and parts untouched, two runs identical,
no crack in any real house, eaves never reach past a neighbour.
