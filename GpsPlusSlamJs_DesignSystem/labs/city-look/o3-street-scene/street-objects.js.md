# street-objects.js

Purpose: decides O3's street objects from mapped data alone: which nodes are lamps, benches, bins and bollards (and what is guessed about each), where zebra stripes lie, and which items a distance cut keeps. Pure: no three.js, no DOM.

## Public API

- `FURNITURE_PARAMS`: default heights (mast lamp 5 m, OSM2World's default; wall lamp 4 m; suspended lamp 6 m; bollard 0.9 m) and `cutM` 80.
- `MARK_PARAMS`: stripe pitch 1 m, bar 0.5 m, stripe length 3 m without a `width` tag, snap 5 cm.
- `isZebraTags(tags)`: `crossing:markings` in zebra, ladder, zebra:double, ladder:skewed, or `crossing=zebra`, or `crossing_ref=zebra`.
- `furnitureOf(nodes, rand)` returns `{ key, kind, x, y, yawRad, heightM, guessed }[]`. Kinds are `lamp`, `lamp-wall`, `lamp-suspended`, `bench`, `bin` and `bollard`. A tagged `height` wins over the default. `direction` (compass degrees) sets the yaw; otherwise the yaw is seeded from the id. `guessed` lists `height` and `yaw` wherever they were not mapped.
- `nearWithin(items, eye, cutM)`: indices within the cut, measured in plan.
- `zebraStripes(crossingWays, nodes, roads)`: stripes along zebra-marked crossing ways, and across the road under a lone zebra node. A node already on a striped way is not drawn twice, and a node on no road is skipped.

## Invariants

- Only nodes become furniture; ways and areas never do.
- Nothing is placed without a mapped tag. Guesses (a height, a yaw) are listed per item.
- Stripes stay inside their crossing way, centred, at the pitch.

## Tests

`street-objects.test.mjs` (`node --test`): mapped nodes only, heights, wall and suspended lamps, seeded and mapped yaw, zebra tags, stripes along a way, stripes for a lone node, the cut.
