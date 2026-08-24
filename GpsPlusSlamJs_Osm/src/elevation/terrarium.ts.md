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
  - `TerrariumProviderOptions.requestTimeoutMs?` — how long one tile request may
    take before it degrades to "no data". **Unset by default**, and the absence
    of a default is the contract: a sole provider on a slow link wants patience,
    while a primary sitting in front of a fast fallback wants impatience, and
    only the composing consumer knows which it is building.
- `browserPngDecoder(): PngDecoder`
- `TERRARIUM_URL_TEMPLATE`, `TERRARIUM_ATTRIBUTION`, `DEFAULT_TERRARIUM_ZOOM`
- `MAPTERHORN_URL_TEMPLATE`, `MAPTERHORN_ATTRIBUTION` — Mapterhorn's
  terrarium-encoded tiles (national open LiDAR compiled with Copernicus GLO-30
  fallback): same encoding, WebP-compressed, **512-px tiles**. Drops into
  `TerrariumProvider` as `urlTemplate` with no other configuration.

## Invariants & assumptions

- **Decode once, sample for free.** This is the only reason elevation at res 13
  is possible: point queries cap out at 100,000 points/day globally, and one
  res-7 fetch tile holds ~117,649 res-13 cells.
- **A deadline is a `TimeoutError`, never an `AbortError`, and the difference
  decides whether a batch degrades or fails.** `load` rethrows aborts — a caller
  that walked away wants no answer — and degrades everything else to
  `undefined`. `requestTimeoutMs` is implemented with `AbortSignal.timeout`,
  whose reason is a `TimeoutError`, so it lands on the degrade branch. Building
  the same feature on `AbortController.abort()` would reject the whole batch and
  reproduce the unreachable-fallback bug of 2026-08-19 while looking like its
  fix. `terrarium.test.ts` asserts the reason's _name_ at the fetch boundary for
  exactly this reason.
- **The deadline is per TILE, not per caller.** It is composed with
  `InFlightRequests`' internal controller — the one shared by every caller
  joined to that tile — so the first joiner's clock bounds them all and a late
  joiner inherits a partly-spent budget. Correct for a tile cache (one fetch,
  one verdict, everyone served) but not the intuitive reading, so it is pinned
  by a test rather than left to inference.
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
- **Tile-index maths is independent of tile size; within-tile offsets are
  not.** `toWorldPixel` scales with 2^z · tileSize, so `worldX / tileSize`
  names the same tile whatever the size — which is why the provider can group
  positions into tiles at its 256-px maths size before fetching anything. The
  fractional offset DOES scale with the tile's actual pixel width, so sampling
  rescales it by `tile.size / 256` once the decoded size is known. Without the
  rescale, a 512-px tile (Mapterhorn's size) is sampled only in its top-left
  quadrant — every elevation displaced toward the tile origin, silently, as
  plausible terrain. The 256 lives once, as `TILE_MATH_SIZE`, which is also
  the default `tileSize` of `toTilePixel`/`toWorldPixel`/`fromWorldPixel` —
  so the provider's rescale and the pixel maths cannot silently diverge.
- **`browserPngDecoder` is not PNG-specific despite the name.**
  `createImageBitmap` sniffs the bytes' actual format, so WebP terrarium tiles
  decode through the same path; the name is historical.
- **Positions are grouped by tile before fetching**, and one fetch is in flight
  per tile however many positions want it.
  - Through [`InFlightRequests`](../source/in-flight-requests.ts.md), so those
    callers do not share an `AbortSignal`. A DEM tile under one position is very
    likely to be wanted again by an unrelated later query, and the first
    caller's lifetime must not become everyone's.
- Latitude clamps to the Mercator limit rather than emitting `Infinity`.
- A missing or corrupt tile yields `undefined` per position; an abort propagates.

## Examples

```ts
const provider = new TerrariumProvider({ decodePng: browserPngDecoder() });
const heights = await provider.elevationAt(cells.map(cellCentre));
```

To make tiles survive an offline restart, compose a persisting fetch into the
`fetchImpl` seam — see [`caching-tile-fetch.ts.md`](./caching-tile-fetch.ts.md):

```ts
const provider = new TerrariumProvider({
  decodePng: browserPngDecoder(),
  fetchImpl: createCachingTileFetch({ store }),
});
```

## Tests

`terrarium.test.ts` — the encoding against the published formula including
negative ground and both extremes, tile arithmetic direction/clamping/wrapping,
exact and interpolated sampling, edge clamping, non-square rejection, the
provider's one-fetch-per-tile, caching, `undefined`-not-zero and abort
behaviour, and 512-px tiles (quadrant-distinct synthetic tiles pin that the
within-tile offset is rescaled to the decoded size, including end-to-end with
the Mapterhorn URL template). No image codec is used.
`terrarium.property.test.ts` — `toWorldPixel`/`fromWorldPixel` as exact
inverses, monotonicity, and per-zoom doubling.
