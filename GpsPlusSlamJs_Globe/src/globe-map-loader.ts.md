# globe-map-loader.ts

How the globe's global maps (the night lights, the clouds' preview and
the four pieces of their full map, the first look's two halves) are
fetched: decoded off the main thread where the browser can, so the cloud
maps (round-3 plan
`GpsPlusSlamJs_Docs/docs/2026-10-08-2345-globe-round-3-owner-feedback-plan.md`,
M1 and §18) do not stall a frame as the flight starts.

## Public API

- `GlobeSurfaceLoader`: `loadTexture(source, onLoad, onError, size?)`
  returns a `THREE.Texture` at once, filled in when the file arrives
  (re-exported by `globe-surface.ts`, whose `createGlobeSurface` takes
  one; Node tests pass a stub); `resizes` says whether `size` is honoured
  (the off-thread loader decodes at that size through createImageBitmap's
  `resizeWidth`/`resizeHeight`, high quality: the cloud map's half-size
  pieces, M1b review item 5; the image element ignores it).
- `GlobeMapSize` (module-private): `{ width, height }`.
- `decodesOffThread(userAgent, hasCreateImageBitmap)`: whether this
  browser takes the off-thread path. False without `createImageBitmap`, in
  Safari before 17 and in Firefox before 98 (three's own rule for its
  glTF loader: those did not honour the decoder's options), true otherwise,
  also when no user agent is known.
- The off-thread loader (module-private, chosen by `globeMapLoader()`): `THREE.ImageBitmapLoader` with
  `imageOrientation: "flipY"` (WebGL does not flip an `ImageBitmap`, and the texture's `flipY`
  is false), `premultiplyAlpha: "none"` (the tiles' alpha is the water
  mask) and `colorSpaceConversion: "none"` (the clouds are numbers; the
  night map's sRGB is decoded by its texture's colour space). The bitmap is
  closed when its texture is disposed.
- `elementMapLoader`: `THREE.TextureLoader`, an image element (re-exported
  by `globe-surface.ts` for the lab's `mapBitmap=0`).
- `globeMapLoader()`: the loader for this browser.

## Memory

The off-thread path keeps the decoded `ImageBitmap` as the texture's
image until the texture is disposed (its bitmap is closed then). For the
night map (8.4 MB of RGBA) and the clouds' preview (2 MB) that is the
whole session, since three re-uploads every texture from its image after
a WebGL context loss (phones lose the context when a page is
backgrounded). The clouds' full map is different (round-3 plan §18,
DEC-R3-16, the owner's decision): `globe-cloud-map.ts` disposes each
piece's texture, closing its bitmap (about 32 MB of RGBA each, 128 MB
for the four), as soon as the piece is drawn into the full map, and
rebuilds the map from the pieces after a context loss.

Unverified: that Safari 17+ and Firefox 98+ honour `imageOrientation:
"flipY"` (three's rule comes from its glTF loader, which never asks for a
flip); only Chromium is tested. An iPhone check settles it: clouds in the
wrong hemisphere would show at once.

## Invariants

- Both paths draw the same pixels: the lab's `mapBitmap=0` takes the
  element path, and `globe-cloud-map.smoke.spec.mjs` compares the two
  (mean difference 0.00 over 576 points of a cloudy view, 2026-10-09). A
  decoder that ignored the flip would put every cloud on the other
  hemisphere.
- A grey map's one-channel upload (`GlobeSource.grey`, `RedFormat`) is set
  by `globe-surface.ts` and `globe-cloud-map.ts` on the texture this
  returns, not here.

## Tests

- `globe-map-loader.test.ts`: the browser rule (Chrome, Safari 17/18,
  Firefox 98 off the thread; Safari 15/16, Firefox 97 and a missing API on
  the element).
- `globe-surface.test.ts`, `globe-cloud-map.test.ts`: the clouds as
  `RedFormat`, the night as RGBA.
- `labs/globe/globe-cloud-map.smoke.spec.mjs` (design system): the map in
  a browser, 8,192 x 4,096 once built, one channel, decoded as
  `ImageBitmap`s, and equal to the element path.
