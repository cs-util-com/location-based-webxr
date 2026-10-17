# globe-relief-fallback.ts

- Purpose: the relief's fallback where its source has no tile (tour editor
  plan `2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md` §13, G1
  step 2; G0 spikes, "Coverage"). Mapterhorn answers 404 at z13 and finer
  outside national coverage (measured in Morocco). The library's image
  source neither checks the status nor knows a second source: the error
  page was decoded as heights and the tile failed. This asks the fallback
  (AWS Terrarium) for the same tile and resamples its HEIGHTS to the
  source's tile size, because the library refills each height grid's
  border from its neighbours assuming they have the same size.
- Public API:
  - `decodeTerrariumM(r, g, b)`: the library's formula,
    `r * 256 + g + b / 256 - 32768`.
  - `encodeTerrarium(heightM, out, i)`: writes a Terrarium pixel (alpha
    255), rounded to 1/256 m and clamped to the encoding's range.
  - `resampleTerrarium(rgba, srcSize, dstSize)`: a square tile resampled:
    heights decoded, bilinear at the destination's pixel centres (centres
    beyond the source's outer centres take the edge), encoded again; the
    same size returns a copy. RangeError for a size that is not a positive
    integer or data that is not `srcSize² x 4` bytes.
  - `fillTileTemplate(url, z, x, y)`: every `{z}`, `{x}`, `{y}` filled.
  - `installReliefFallback(plugin, { fallbackUrl, tileDimension,
decodeRgba?, makeTexture? })` -> `{ stats(), dispose() }`:
    - wraps the plugin's `loadRootTileset`; once that has made the image
      source (`_source`), each height tile is fetched through the source's
      own `fetchData` (the relief's download queue, the tile's abort
      signal);
    - a tile the source has takes the library's own
      `processBufferToTexture`;
    - on a 404 the same z/x/y from `fallbackUrl`, decoded (`decodeRgba`,
      by default `createImageBitmap` without colour conversion or
      premultiplication, then a 2D canvas), resampled to `tileDimension`,
      made a texture (`makeTexture`, by default as the library makes one:
      flipped, no mipmaps, sRGB);
    - any other status, a failed fallback or a fallback tile that is not
      square rejects, naming the status;
    - `stats()` -> `{ fallbacks, failures }`; `dispose()` restores the root
      load (a source already made keeps its fetch);
    - TypeError for a plugin without `loadRootTileset`; RangeError for a
      template without `{z}/{x}/{y}` or a tile size that is not a positive
      integer.
- Invariants & assumptions:
  - Heights are interpolated, never encoded bytes: a carry from green into
    red is a 256 m step in the bytes and 1/256 m in height.
  - The library calls `_source.fetchItem([x, y, level], signal)` from its
    grid cache (0.5.3); `globe-terrain.test.ts` drives the real plugin to
    hold that order and the url.
  - Both sources share the tiling (Web Mercator XYZ), so the same z/x/y
    covers the same ground.
  - A fallback tile's heights are AWS's: at a coverage border the two
    sources meet with whatever offset they have there (5-11 m in towns).
- Example:

  ```ts
  createGlobeTerrain({ ...options, fallbackUrl: TERRARIUM_URL_TEMPLATE });
  // or directly:
  const fallback = installReliefFallback(plugin, {
    fallbackUrl,
    tileDimension: 512,
  });
  ```

- Tests: `globe-relief-fallback.test.ts` (the encoding's round trip as a
  property, the decode formula, resampling: same size, flat, a plane
  across a byte carry as a property, refusals; the fallback on a fake
  plugin: the library's path for a tile the source has, the fallback at
  the same tile with the download queue's fetch and signal, rejections
  naming the status, dispose and refusals). `globe-terrain.test.ts` drives
  it through the real plugin; the lab's `globe-editor-blocks.smoke.spec.mjs`
  through the page against a fake of both hosts.
