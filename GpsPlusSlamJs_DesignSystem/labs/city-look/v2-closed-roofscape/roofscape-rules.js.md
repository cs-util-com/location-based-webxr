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
  `priorRadiusM`, `priorMinEvidence`, `flatShareMin`, `tallM`, `tallShareMin`,
  `largeFootprintM2`, each defaulting to `PARAMS`; `refusals: false` turns the
  refusals below off (V2 as first chosen, the page's `?prior=off`). A plan is
  `{ key, rings, roofRings, eaveM, tan, roof, style, colours, why? }`; `roof`
  null means a flat lid: the method failed (`counts.failed`), or the rules
  refused an invented roof (`why`, counted in `counts.refused`). `counts`
  carries why each other building was kept and how many roofs took each style
  (`gable`, `shared`, `hip`, `cut`, `flat`).
- `neighbourhoodPriors(entries, options)`: a `Map` from key to
  `{ pitched, why, heights }`, what the data within `priorRadiusM` says about
  roofs. `why` is `flat roofs nearby`, `pitched roofs nearby`,
  `tall neighbourhood` or `no evidence`.
- `inventedRoofRefusal(tags, areaM2, prior, options)`: why a candidate gets a flat
  lid instead of an invented roof (`flat by class`, `large footprint`, or the
  prior's `why`), or null.
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
- Who gets no invented roof, from the data alone (never a city's or a country's
  name, so the same rule runs in Tokyo or Bukhara):
  - The local prior, per building, from everything within `priorRadiusM`
    (200 m). Tagged roof shapes decide first, one vote per building (tagged parts
    vote through their outline): with at least `priorMinEvidence` (5) votes, a
    flat share of `flatShareMin` (0.5) or more means no invented roof. With
    fewer votes, a neighbourhood whose outlines state a height (`height`, or
    levels times 3 m) of at least `tallM` (9 m) for `tallShareMin` (0.5) of
    them is read as flat-roofed too. Otherwise nothing is known and V2 invents.
    Per neighbourhood, not per scene: a city changes within a few hundred
    metres, and a per-scene vote would flip at a tile's edge.
  - Classes that are flat nearly everywhere: `commercial`, `retail`,
    `industrial`, `warehouse`, `supermarket`.
  - A footprint over `largeFootprintM2` (2 500 m²): a net for malls and halls.
    Lower values flatten Meggen's village centre (its five buildings of
    1 213-2 369 m²), which the owner chose V2 for.
  - A church or chapel keeps its roof anywhere.
- A refused building's height: its tag, else, in a flat-roofed neighbourhood
  with enough stated heights, a seeded value between the neighbours' quartiles
  (an untagged Midtown block stands 13-36 m, not a house's 9 m), else V2's
  seeded height by class and size.
- Known limit: the tall rule cannot tell a brownstone row from a European old
  town of three-storey pitched houses whose levels are tagged and roofs are
  not; there it gives flat lids (today's look), never an absurd roof.
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
no crack in any real house, eaves never reach past a neighbour; the local prior
on synthetic towns (flat tags, pitched tags, a tall untagged row, nothing,
distance, one vote per building), the class and size refusals, and on the four
real scenes: no invented roof in Midtown or Park Slope but on a church, Meggen
and Heidelberg exactly as with the refusals off.
