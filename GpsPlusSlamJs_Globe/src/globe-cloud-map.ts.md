# globe-cloud-map.ts - the cloud map in two stages

- Purpose: round-3 plan 2026-10-08-2345 §18, the owner's DEC-R3-13..16.
  The globe's clouds are NASA's 8,192 x 4,096 map (the owner: "pixelated
  already at 3,000 km" with the 2,048, still soft with the 4,096). It is
  too large for one committed file and too slow for the first look, so it
  comes in two stages: a 1,024 x 512 preview loaded with the first look,
  then the full map, fetched in four 4,096 x 2,048 pieces in the
  background and drawn into ONE one-channel 8,192 x 4,096 texture on the
  GPU, which then replaces the preview for every cloud reader at once.
- Public API:
  - `createGlobeCloudMap({ source, loader, builder?, now? })` - a
    `GlobeCloudMap` for a registry source with `pieces` (the clouds);
    `RangeError` for one without. `loader` is the surface's
    (`globe-map-loader.ts`: decoded off the main thread where the browser
    can); `builder` the GPU step (default `gpuCloudMapBuilder`); `now`
    the page clock for `fullAtMs`.
  - `GlobeCloudMap`:
    - `texture` - the map the readers sample now: the preview, then the
      full map once it is drawn, the preview again after a context loss.
      The surface assigns it to `surfaceUniforms.uClouds` every frame.
    - `previewSettled` - the preview is in or failed; the first look waits
      for this and nothing else of the clouds.
    - `update(renderer)` - per frame: once the preview has settled, checks
      the device (`capabilities.maxTextureSize`): at least the full map's
      width and height, the full map (`scale` 1); at least half of them
      and a loader that `resizes`, the same four pieces decoded at half
      size into a 4,096 x 2,048 map (`scale` 0.5, zero extra bytes: M1b
      review, item 5); else `full: "too-large"` and the preview stays.
      Then it
      asks for the pieces two at a time (`MAX_HELD`), allocates the full
      map on the next frame, then draws each piece the frame after it
      arrives (one a frame: each is a 4,096 x 2,048 upload), frees it at
      once and asks for the next, swapping after the fourth (M1b review:
      waiting for all four held about 134 MB of decoded RGBA at once). A
      piece that fails is asked for again after 1 s, then after 4 s more
      (`RETRY_BACKOFF_MS`, on the `now` clock); a third failure ends the
      round (`full: "failed"`, the preview stays). Registers for the canvas's context loss and
      restore on its first call. A renderer without `capabilities` (a
      test stub, a page that never draws) leaves it waiting.
    - `settled()` - `{ done, failed }` for the surface's global-map
      counter: done once the preview has settled (the full map is its own
      stage in `state()`, so the loading label does not wait for its 4 MB
      nor return after a context loss: M1b review, item 7); failed only
      when nothing is drawn (no preview, and no full map).
    - `state()` - `{ stage: "preview" | "full", width, height, preview:
"loading" | "in" | "failed", full, scale, allocated, piecesDrawn, piecesHeld,
piecesFailed, retries, error, rebuilds, fullAtMs, bitmap }`; `error`
      why the GPU step threw, or null; `full` is `waiting`,
      `loading` (allocated, pieces streaming in), `in`, `failed`,
      `too-large` or `lost`; `piecesHeld` the pieces requested and not
      yet drawn (never more than two); `rebuilds` counts full maps built
      after a context loss; `fullAtMs` the page time of the first swap;
      `bitmap` whether the images were decoded off the main thread.
    - `dispose()` - frees the preview, the full map and any piece, and
      stops listening.
  - `CloudMapBuilder` - `{ create(renderer, width, height), draw(renderer,
full, piece, x, y, last) }`, the GPU step as a seam.
  - `gpuCloudMapBuilder` (module-private, the default) - the real one: a
    `DataTexture` with no data,
    `RedFormat`, its levels given as empty `mipmaps` descriptors (14
    for 8,192 x 4,096) with `source.dataReady = false` and
    `generateMipmaps` off: three allocates every level with one
    texStorage2D and neither uploads nor builds mipmaps of the empty map
    (with `generateMipmaps` on, three r185 also ran generateMipmap on the
    empty storage, a wasted pass: M1b review, item 3); linear-mipmap
    filtering, wrapping in longitude; each piece drawn by
    `renderer.copyTextureToTexture` (texSubImage2D of the piece's own
    image, so a piece never becomes a GPU texture of its own), with
    `generateMipmaps` on for the last copy alone, so the mipmaps are built
    once.
- Invariants & assumptions:
  - Pieces are placed by the registry's `globeMapPieces` (row 0 the
    north); GL rows count from the bottom, so a piece's `y` is
    `height - top - pieceHeight`. One texture, so no shader change and no
    seam between pieces (the B-spline in `globe-cloud-filter.ts` reads
    `textureSize`, so it works on both stages).
  - An `ImageBitmap` piece is already flipped by the decoder (WebGL never
    flips one); an image element is flipped by the unpack state, which
    three takes from the destination's `flipY`, so the builder sets it per
    piece. Colour conversion is off for the grey levels.
  - Memory (DEC-R3-16, the M1b review): at most two pieces are held at a
    time, each freed (the loader closes a bitmap when its texture is
    disposed) the moment it is drawn, all of them as soon as one fails:
    about 64 MiB of decoded RGBA at the peak instead of 134 MB; the preview is kept (2 MB of RGBA) for a context loss. On the
    GPU: the full map with its mips is about 44.7 MB as R8, the preview
    0.7 MB.
  - Context loss: three re-uploads a texture from its image when the
    context is restored, but the full map has no image (its pieces are
    freed), so it would come back empty. On a loss the full map and any
    round in flight are dropped and the preview shows; on the restore the
    pieces load again (the browser's cache usually has them) and the map
    is rebuilt. A late answer from a dropped round is freed on arrival.
  - Defensive: `update` never throws: a GPU step that throws (the
    allocation or a copy) drops the round, keeps the preview and reports
    `full: "failed"` with `error`; a renderer without `capabilities` or
    `domElement` is tolerated.
- Examples:

  ```ts
  const cloudMap = createGlobeCloudMap({
    source: globeSource("clouds"),
    loader,
  });
  // per frame:
  cloudMap.update(renderer);
  surfaceUniforms.uClouds.value = cloudMap.texture;
  ```

- Tests: `globe-cloud-map.test.ts` (the preview first, as one channel of
  numbers; the pieces only after the preview and a renderer; one texture,
  each piece drawn as it arrives (in any order) at its place, one a
  frame, never more than two alive, the swap after the fourth; a failed piece asked for again twice on its backoff, then keeping the preview and reported; a small
  device keeping the preview; the counter's settling; a context loss and
  restore rebuilding, a loss mid-build dropping the round; dispose; the
  real builder through a recording renderer: 14 empty levels allocated,
  nothing uploaded, the mipmaps built on the last copy alone). The
  GPU builder by the browser smoke
  `GpsPlusSlamJs_DesignSystem/labs/globe/globe-cloud-map-8k.smoke.spec.mjs`
  (the stages, the swap drawing the same clouds, no seam at the date line,
  the first look on the preview, a context loss and restore).
