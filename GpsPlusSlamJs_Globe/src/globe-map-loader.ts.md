# globe-map-loader.ts

How the globe's global maps (the night lights, the clouds, the first
look's two halves) are fetched: decoded off the main thread where the
browser can, so the 4,096 x 2,048 cloud map (round-3 plan
`GpsPlusSlamJs_Docs/docs/2026-10-08-2345-globe-round-3-owner-feedback-plan.md`,
M1) does not stall a frame as the flight starts.

## Public API

- `GlobeSurfaceLoader`: `loadTexture(source, onLoad, onError)` returns a
  `THREE.Texture` at once, filled in when the file arrives (re-exported by
  `globe-surface.ts`, whose `createGlobeSurface` takes one; Node tests
  pass a stub).
- `decodesOffThread(userAgent, hasCreateImageBitmap)`: whether this
  browser takes the off-thread path. False without `createImageBitmap`, in
  Safari before 17 and in Firefox before 98 (three's own rule for its
  glTF loader: those did not honour the decoder's options), true otherwise,
  also when no user agent is known.
- `bitmapMapLoader`: `THREE.ImageBitmapLoader` with
  `imageOrientation: "flipY"` (WebGL does not flip an `ImageBitmap`, and the texture's `flipY`
  is false), `premultiplyAlpha: "none"` (the tiles' alpha is the water
  mask) and `colorSpaceConversion: "none"` (the clouds are numbers; the
  night map's sRGB is decoded by its texture's colour space). The bitmap is
  closed when its texture is disposed.
- `elementMapLoader`: `THREE.TextureLoader`, an image element.
- `globeMapLoader()`: the loader for this browser.

## Invariants

- Both paths draw the same pixels: the lab's `mapBitmap=0` takes the
  element path, and `globe-cloud-map.smoke.spec.mjs` compares the two
  (mean difference 0.00 over 576 points of a cloudy view, 2026-10-09). A
  decoder that ignored the flip would put every cloud on the other
  hemisphere.
- A grey map's one-channel upload (`GlobeSource.grey`, `RedFormat`) is set
  by `globe-surface.ts` on the texture this returns, not here.

## Tests

- `globe-map-loader.test.ts`: the browser rule (Chrome, Safari 17/18,
  Firefox 98 off the thread; Safari 15/16, Firefox 97 and a missing API on
  the element).
- `globe-surface.test.ts`: the clouds as `RedFormat`, the night as RGBA.
- `labs/globe/globe-cloud-map.smoke.spec.mjs` (design system): the map in
  a browser, 4,096 x 2,048, one channel, an `ImageBitmap`, and equal to
  the element path.
