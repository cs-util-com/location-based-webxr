# globe-relief-fallback.ts

- Purpose: the relief's fallback where its source has no tile (tour editor
  plan `2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md` §13, G1
  step 2; G0 spikes, "Coverage"; G1 review M2, all in the primary repo's
  `GpsPlusSlamJs_Docs/docs/`). Mapterhorn answers 404 where it has no
  tile: at z13-14 outside national coverage, and over deep ocean at every
  zoom finer than about z5 (probed 2026-10-18: Marrakesh z14 and z13 404,
  z12 200; mid-Atlantic 404 from z12 down to z6, z5 200; Munich present to
  z16). Its coverage is nested: a tile exists only where its parent does.
  The library's image source neither checks the status nor knows what
  else to draw. This draws the missing tile from the SAME source's
  nearest ancestor, cropped to the tile and upsampled to the source's
  tile size (the library refills each height grid's border from its
  neighbours assuming they have the same size). One pyramid, so no step
  where the source changes; the first version asked AWS Terrarium for the
  same tile, which put a 5-12 m step at every coverage border (G0) and
  had no answer over the ocean, where AWS's z12 is 0 m anyway.
- What a failed tile draws without this (3d-tiles-renderer 0.5.3, read
  2026-10-18): the plugin's `parseToMesh` rethrows any error but an
  abort, so the tile is marked FAILED (`stats.failed`, a console error,
  never retried). FAILED counts as "download finished" but not as a
  ready child, so its parent never has all children ready, and the
  nearest ancestor drawn the frame before stays drawn over the whole
  parent's area, hiding the failed tile's loaded siblings too, for the
  rest of the session. A 404 body decoded as an image fails the same way.
  With this fallback that happens only where the source has no ancestor
  at all, or answers anything but 200 or 404.
- Public API:
  - `RELIEF_FALLBACK`: `maxDepth` 24 (the deepest crop, the relief tree's
    own limit), `knownMissingMax` 4,096 (tiles remembered as missing
    before the memory is cleared: about 100 KB of keys).
  - `decodeTerrariumM(r, g, b)`: the library's formula,
    `r * 256 + g + b / 256 - 32768`.
  - `encodeTerrarium(heightM, out, i)`: writes a Terrarium pixel (alpha
    255), rounded to 1/256 m and clamped to the encoding's range.
  - `AncestorCrop` `{ depth, col, row }`: where a tile lies in its
    ancestor `depth` levels up, column and row counted north first (as XYZ
    counts), each below 2^depth. For tile x, y and depth d: `col = x & (2^d
    - 1)`, `row = y & (2^d - 1)`.
  - `resampleTerrarium(rgba, srcSize, dstSize, crop?)`: the part `crop` of
    a square tile (the whole tile by default) resampled to `dstSize`:
    heights decoded, bilinear at the destination's pixel centres, encoded
    again. A destination centre `(i + 0.5) / dstSize` of the part lies at
    `(offset * dstSize + i + 0.5) * srcSize / (dstSize * 2^depth) - 0.5` in
    the ancestor's pixels, clamped to its outer centres. The whole tile at
    the same size returns a copy. RangeError for a size that is not a
    positive integer, data that is not `srcSize² x 4` bytes, or a crop
    outside the tile (depth above `maxDepth`, column or row not below
    2^depth).
  - `DecodedRgba` `{ data, width, height }`: decoded RGBA rows, north first.
  - `installReliefFallback(plugin, { tileDimension, decodeRgba?,
makeTexture? })` -> `{ stats(), dispose() }`:
    - wraps the plugin's `loadRootTileset`; once that has made the image
      source (`_source`), each height tile is fetched through the source's
      own `fetchData` (the relief's download queue, the tile's abort
      signal);
    - a tile the source has takes the library's own
      `processBufferToTexture`;
    - on a 404 it walks up `source.getUrl(x >> d, y >> d, level - d)` to
      the nearest ancestor that answers 200, decodes it (`decodeRgba`, by
      default `createImageBitmap` without colour conversion or
      premultiplication, then a 2D canvas), crops and upsamples it to
      `tileDimension`, and makes it a texture (`makeTexture`, by default as
      the library makes one: flipped, no mipmaps, sRGB);
    - every 404 is remembered, and a walk starts above the coarsest tile
      known missing among the tile and its ancestors: the coverage is
      nested, and the 404s carry no cache header, so the browser would
      ask again every time (measured 2026-10-18: no `cache-control` on a
      404, `max-age=604800` on a 200);
    - any other status, an ancestor that is not square, or no ancestor at
      all (level 0 missing) rejects, naming the url and status, and the
      library marks the tile failed (above);
    - `stats()` -> `{ fallbacks, failures }`; `dispose()` restores the root
      load (a source already made keeps its fetch);
    - TypeError for a plugin without `loadRootTileset`; RangeError for a
      tile size that is not a positive integer.
- Invariants & assumptions:
  - Heights are interpolated, never encoded bytes: a carry from green into
    red is a 256 m step in the bytes and 1/256 m in height.
  - The children of one ancestor meet without a seam: each part is exactly
    the whole ancestor resampled to `dstSize x 2^depth` and cut (a
    property test holds this within 1/256 m).
  - The library calls `_source.fetchItem([x, y, level], signal)` from its
    grid cache, and `getUrl(x, y, level)` fills an XYZ template with north
    first (0.5.3); `globe-terrain.test.ts` drives the real plugin to hold
    that order and the urls of the walk.
  - An upsampled ancestor is coarser than the tile would be: over the
    ocean that is 0 m either way; at a national coverage border it is
    GLO-30 (the source's own z12) beside the national model, the same
    meeting the source has at that border in every other client.
  - A known-missing memory that fills is cleared, not trimmed: the cost
    of clearing is one 404 per level again, not a wrong tile.
  - Concurrent walks may ask for the same missing ancestor before its
    first 404 returns; that costs a request, not a wrong tile.
- Example:

  ```ts
  createGlobeTerrain({
    ...reliefTerrainOptions(mapterhornRelief(constants), "desktop"),
    imagery,
    template,
    heightScale: 1,
  }); // ancestorFallback: true comes from the source
  // or directly:
  const fallback = installReliefFallback(plugin, { tileDimension: 512 });
  ```

- Tests: `globe-relief-fallback.test.ts` (the encoding's round trip as a
  property, the decode formula; resampling: same size, flat, a plane
  across a byte carry as a property, a quarter crop pinned by hand, a
  child equal to its part of the whole ancestor upsampled as a property,
  crop and size refusals; the installer on a fake plugin: the library's
  path for a tile the source has, the walk up two missing levels to the
  ancestor with the download queue's fetch and signal, the known-missing
  skip, rejections naming the status and "no ancestor", dispose and
  refusals). Two hand mutants were caught: column and row swapped, the
  crop's offset dropped. `globe-terrain.test.ts` drives it through the
  real plugin; the lab's `globe-editor-blocks.smoke.spec.mjs` through the
  page against a fake host with a nested coverage gap.
