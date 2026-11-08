# painted-ground-rules.js

## Purpose

The pure decisions of the O2 painted-ground prototype: which land-use class a
feature's tags paint into the ground, its muted colour, the paint order where
uses overlap, and the size of the ground texture. No three.js, no DOM.

## Public API

- `GROUND_CLASSES` - frozen map class -> `{ colour, tier, label }`; sRGB hex
  colours near today's ground (0x6b7280), each with a chroma under 45.
- `landuseClassOf(tags)` - the class name or `null`. Buildings never paint; a
  pitch with a hard `surface` is a `court`; `highway=pedestrian` + `area=yes` is
  a `square`; `water=*` always means water. Bad input (null, non-object) gives
  `null`.
- `paintOrder(entries)` - a sorted copy of `{ key, cls, area }`, painted last on
  top: tier ascending (0 zoning, 1 open land, 2 water, 3 surfaces), then area
  descending, then key. Independent of input order.
- `chroma(hex)` - largest sRGB channel minus smallest (DEC-R4-5).
- `paintColour(cls, strength, neutral)` - the class colour pulled towards
  `neutral`; strength is clamped to [0, 1], non-numbers count as 0.
- `polygonAreaM2(rings)` - shoelace area, outer ring minus holes; 0 for no ring.
- `MAX_TEXTURE_SIDE` (2048) and `rasterPlan(box, texelM)` -> `{ width, height,
texelM, bytes }`; the texel grows when the box would exceed the cap; `bytes`
  is RGBA8 without mipmaps.

## Invariants

- Tier order is the overlap priority: a pitch inside a park inside a
  residential zone shows as pitch, then park, then residential.
- Within a tier the smaller area wins, so a nested use stays visible.
- Colours are cosmetic choices, not data; the classes come from OSM tags only.

## Example

```js
landuseClassOf({ leisure: "pitch", surface: "asphalt" }); // "court"
rasterPlan({ minX: -320, minY: -320, maxX: 320, maxY: 320 }, 1); // 640 x 640
```

## Tests

`painted-ground-rules.test.mjs` (`node --test`): class mapping, priority order,
determinism, chroma ceiling, colour mixing, area, raster size and cap.
