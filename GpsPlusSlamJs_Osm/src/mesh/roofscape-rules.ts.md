# roofscape-rules.ts

## Purpose

The pure decisions of the invented roofscape: which untagged building gets an
invented roof, which is refused one (by class, by footprint size or by its
neighbourhood), how high each stands, which of its walls stand against a
neighbour's, which wing ends take a gable, and where the eave ring of an
overhanging slope runs. No meshes and no three.js; `invented-roofs.ts` turns
the answers into geometry.

## Public API

- `RoofscapeParams`, `ROOFSCAPE_DEFAULTS` (frozen): every number the rules use,
  each documented on the interface. The defaults are the ones the owner chose
  the city-look prototype with (gables on 72 % of houses, slopes tan
  0.62-0.9 with a floor of 0.36, a 5.5 m maximum rise, a 0.32 m overhang, a
  200 m neighbourhood, a 2 500 m2 large-footprint net).
- `keepReason(tags, { hasParts, belowSurface, heightLimitM })`: why a building
  keeps the library's own volume (`"part"`, `"below surface"`, `"parts"`,
  `"tagged roof"`, `"floating"`, `"no roof by class"`, `"tall"`), or
  `undefined` when it gets an invented roof. Any roof tag wins.
- `isSacred(tags)`: church or chapel; steep and always granted.
- `inventedEaveHeightM(tags, areaM2, key)`: the tag's height, else a seeded
  wall height by class and size (2.5-10.5 m in all cases).
- `refusedHeightM(tags, areaM2, key, prior, params)`: a refused building's
  height; in a flat neighbourhood stating enough heights, a seeded value
  between its neighbours' quartiles.
- `inventedRoofRefusal(tags, areaM2, prior, params)`: why a candidate gets a
  flat lid (`"flat by class"`, `"large footprint"`, or the prior's `why`), or
  `undefined`.
- `neighbourhoodPriors(entries, params)`: `Map<key, NeighbourhoodPrior>` from
  tags alone. Tagged roofs nearby decide first (one vote per building: an
  outline's tagged parts vote through it); else a neighbourhood whose outlines
  mostly state three storeys or more reads as flat; else nothing is known.
  An entry's optional `xScale` (true metres per frame metre east, default 1)
  makes the radius a ground distance, so a caller planning in an
  equirectangular frame gets the same neighbours wherever the frame lies.
- `simplifyRing(ring, toleranceM)`: drops near-collinear corners, never below a
  triangle.
- `sharedWalls(ring, owner, segments, params)`: per wall, whether another
  owner's wall runs along it (within `sharedGapM`, over `sharedMinShare` of
  its length, parallel within about 11 degrees).
- `chooseGableEnds(candidates, ring, shared, params)`: the gable walls: not
  shared, `gableMinM`-`gableMaxM` long, longest first, never two adjacent.
- `offsetRing(ring, offsets)`: each wall moved outward by its own offset
  (outward for a counter-clockwise ring); `undefined` for a corner that cannot
  follow (nearly straight walls with different offsets, a mitre longer than
  four times the largest offset, a degenerate wall, a length mismatch).

## Invariants and assumptions

- Tags always win: every rule applies only to a building the map says nothing
  about.
- Never a place name: a flat-roofed district is recognised from the tags
  around a building, so the rule is the same anywhere.
- Stable: every invented value is `mixedUnit(key, salt)` of the feature key,
  so reloads, devices and moved windows draw the same house.
- `neighbourhoodPriors` does not depend on the order of its input and finds
  exactly the neighbours a scan of every pair finds (grid of cell size
  `priorRadiusM`, 3x3 cells searched). Non-finite centres are left out of the
  grid.
- Rings are ENU metres, unclosed (no repeated last corner).

## Examples

```ts
const priors = neighbourhoodPriors(entries, ROOFSCAPE_DEFAULTS);
const keep = keepReason(tags, {
  hasParts: false,
  belowSurface: false,
  heightLimitM: ROOFSCAPE_DEFAULTS.heightLimitM,
});
if (keep === undefined) {
  const refusal = inventedRoofRefusal(
    tags,
    area,
    priors.get(key),
    ROOFSCAPE_DEFAULTS,
  );
  const eave =
    refusal === undefined
      ? inventedEaveHeightM(tags, area, key)
      : refusedHeightM(tags, area, key, priors.get(key), ROOFSCAPE_DEFAULTS);
}
```

## Tests

- `roofscape-rules.test.ts`: the keep reasons, the refusals, the heights and
  their bands, part votes collapsing into their outline, the tall
  neighbourhood, shared walls, gable choice, offsets.
- `roofscape-rules.property.test.ts`: priors are order-invariant and equal a
  brute-force scan; a zero offset is the identity; the untagged eave stays
  within 2.5-10.5 m.
