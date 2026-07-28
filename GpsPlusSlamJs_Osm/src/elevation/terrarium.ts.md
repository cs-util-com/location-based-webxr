# `elevation/terrarium.ts`

## Purpose

Terrarium terrain tiles: the encoding, Web Mercator tile arithmetic, bilinear
sampling, and the provider that ties them together.

## Public API

- `decodeTerrarium(r, g, b): number`
- `toTilePixel(position, zoom, tileSize?): TilePixel`
- `toElevationTile(image, z, x, y): ElevationTile`
- `sampleTile(tile, px, py): number`
- `class TerrariumProvider` (+ `stats`: `fetches`, `cacheHits`, `decodeFailures`)
- `browserPngDecoder(): PngDecoder`
- `TERRARIUM_URL_TEMPLATE`, `TERRARIUM_ATTRIBUTION`, `DEFAULT_TERRARIUM_ZOOM`

## Invariants & assumptions

- **Decode once, sample for free.** This is the only reason elevation at res 13
  is possible: point queries cap out at 100,000 points/day globally, and one
  res-7 fetch tile holds ~117,649 res-13 cells.
- **The PNG decoder is injected.** No decoder is common to the browser, a Worker
  and Node, and this package has no runtime dependencies. It also makes the
  decode maths testable byte-exactly with no image codec involved.
- **`browserPngDecoder` opts out of colour management AND alpha
  premultiplication, and that is not defensive habit.** A Terrarium tile is data
  that happens to be PNG-encoded, not a picture. `createImageBitmap` +
  `drawImage` + `getImageData` is allowed to rewrite the RGB triple on the way
  through — a `gAMA`, `sRGB` or `iCCP` chunk lets the user agent colour-manage
  it, and premultiplication can shift it again; both default to "the UA may".
  **A one-step shift in R is 256 metres**, arriving as a smooth plausible
  surface rather than an error. So the call passes
  `colorSpaceConversion: "none"` and `premultiplyAlpha: "none"`, and reads back
  with an explicit `colorSpace: "srgb"`.
  - The corruption cannot be reproduced in the gate — it needs a real codec and
    a real colour-managed compositor, and every other test here injects a
    synthetic decoder precisely to avoid one. The tests therefore pin that the
    **flags are requested**, which is the part an edit could silently drop.
- **z=13 by default, not z=14.** At 50.8° N a z=14 tile spans ~1.55 km against a
  2.81 km res-7 hexagon, so covering one fetch tile takes a 3 x 3 block — nine
  requests, the exact cost the res-8 to res-7 move avoided. z=13 spans ~3.1 km,
  so 2 x 2 at worst. The accuracy given up is nominal against ~30 m source
  posting: sampling finer than the source buys interpolated pixels only.
- **Samples are `Float32Array`**, so a decoded tile transfers rather than copies
  across a worker boundary.
- **Bilinear sampling, clamping at tile edges.** Nearest-neighbour is a visible
  staircase at ~12 m/pixel; wrapping at the edge would be wrong by half the
  planet where clamping is wrong by half a pixel.
- **Positions are grouped by tile before fetching**, and one fetch is in flight
  per tile however many positions want it.
- Latitude clamps to the Mercator limit rather than emitting `Infinity`.
- A missing or corrupt tile yields `undefined` per position; an abort propagates.

## Examples

```ts
const provider = new TerrariumProvider({ decodePng: browserPngDecoder() });
const heights = await provider.elevationAt(cells.map(cellCentre));
```

## Tests

`terrarium.test.ts` — the encoding against the published formula including
negative ground and both extremes, tile arithmetic direction/clamping/wrapping,
exact and interpolated sampling, edge clamping, non-square rejection, and the
provider's one-fetch-per-tile, caching, `undefined`-not-zero and abort
behaviour. No image codec is used.
