# god-rays.js

## Purpose

God rays for the look-dev page (round-3 look-dev programme, stream G; the
owner's decision of 2026-09-28: the cheap version first, behind its own
switch, then judged by eye): radial screen-space light shafts. The bright
sky around the sun is blurred along lines toward the sun's screen point
and added to the HDR scene before tone mapping, like the bloom. Page-side
only; nothing in the framework changes.

## Public API

- `GOD_RAYS` (frozen): the shipped look, `{ samples, endWeight, reach,
strength, threshold, maxExcess, radius, scale, jitter, offscreenMargin,
horizonFadeDeg }`; each value's meaning is in the source, the sweeps
  behind them in the results record (2026-09-28 lookdev god rays).
- `sunClipPoint(viewProjection, dir)` → `{ x, y, inFront }`: the sun's
  NDC point for a column-major 4×4 view-projection and a direction toward
  the sun (a point at infinity: the camera's position does not move it).
  `inFront` false (and x, y NaN) behind the camera or exactly sideways.
  `RangeError` for a matrix that is not 16 numbers or a zero or
  non-finite direction.
- `offscreenFade(x, y, margin)`: 1 on screen, smoothly 0 at `margin` NDC
  units past the nearer edge.
- `horizonFade(sunY, [lo, hi])`: 0 at or below `lo` degrees of elevation,
  1 at or above `hi`, smooth between (`sunY` is the unit direction's up
  part).
- `godRaysFade(viewProjection, dir, params)` → `{ x, y, inFront, fade }`:
  the product of the two fades, 0 behind the camera.
- `rayWeights(n, endWeight)`, `stepDecay(n, endWeight)`: one ray's tap
  weights (geometric, the last `endWeight` × the first, normalised to 1)
  and the factor between neighbours. `RangeError` outside 1..256 taps or
  an end weight outside (0, 1].
- `validateGodRaysParams(params)`: `RangeError` for any value outside its
  range.
- `createGodRays({ THREE, Pass, FullScreenQuad, camera, sunDirection,
params? })` → `{ sync(composer, on), configure(values), pass, active,
info() }`:
  - `sync` builds the pass the first time it is switched on under a
    composer, inserted right before the composer's `OutputPass`, and gives
    the composer's scene target (`renderTarget2`) a `DepthTexture`; off
    keeps it disabled; a different composer (or none) drops it.
  - `sync(composer, true)` THROWS (and leaves the pass off) when the
    composer's enabled passes swap an odd number of times a frame (the
    invariant below, review 2026-09-29 A1). The page calls it on every
    tier or look change, so a new swapping pass fails loudly there.
  - `configure` merges values into the live pass and any later one
    (a refused value changes nothing) and returns the merged set.
  - `info()` → `{ active, x, y, inFront, fade, params }`, the last drawn
    frame's sun point and fade.
  - `sunDirection()` is read every frame and returns `[x, y, z]`.

## Invariants & assumptions

- THE SKY IS WHAT SITS AT THE CLEARED DEPTH. The sky is drawn at depth 1
  without writing depth, and the cloud sheet and slab write none, so
  buildings, terrain, the floating pond and the catalog block the rays
  through the depth test, and clouds block them through the darker sky
  they draw (the mask reads the rendered HDR colour, not a cloud model).
  A 24-bit depth sits within the 4-step tolerance of 1 only past about
  29 km, inside the page's fog.
- THE DEPTH TEXTURE IS THE SCENE TARGET'S, resolved from its multisampled
  depth by three at the end of the RenderPass. It is the scene's only while
  the composer's swapping passes are even in number (lookdev.js
  `applyTier`: the clamp and the OutputPass swap; the RenderPass, the bloom,
  the AO and this pass do not). `sync` checks that count whenever the rays
  are on: three keeps its read and write buffers across frames, so an odd
  count would put the RenderPass on renderTarget1 every other frame, and
  the mask would read a cleared depth there (every pixel sky, a flicker).
  The pass itself does not swap (`needsSwap` false) and its three draws
  neither test nor write depth.
- Three draws a frame: the sky mask and the radial blur into two
  half-float buffers at `scale` of the composer's size (linear filtered),
  and a composite that ADDS the rays' colour into the composer's read
  buffer and keeps its alpha. The composite scales the rays by the air in
  front of each surface, 1 - e^(-d / `airM`) for a surface `d` metres away
  (the sky gets all of it; `airM` 0 adds the same everywhere), read from
  the same depth texture. Nothing is drawn while the fade is 0, so a
  sun behind the camera or below the horizon costs three matrix products
  and no GPU work.
- The mask keeps a sky pixel's colour scaled to its luminance above
  `threshold`, capped at `maxExcess` (the disc is ~10^4 × the sky and
  would otherwise be the only source), fading to 0 at `radius` canvas
  heights from the sun.
- The blur divides by its weights' total, so `samples` changes the grain,
  not the brightness; `jitter` (0..1) offsets each pixel's first tap by a
  fixed per-pixel pattern, trading banding for a static grain (identical
  frame to frame, so pixel tests repeat); taps outside the frame count as
  dark.
- The rays are added in HDR before tone mapping, so in DISPLAY units a
  hue-preserving tone mapper (Khronos Neutral) can map a brighter HDR
  pixel of a new hue to a slightly smaller sum of RGB; the smokes count
  darker pixels in luminance with a tolerance (results record).
- The pass refuses to be the composer's last pass: it adds into a buffer
  that must still reach the screen.
- On a browser that renders multisampled targets through
  `WEBGL_multisampled_render_to_texture` (Quest), three attaches the depth
  texture as a multisampled one; the resolved depth there is unverified.

## Example

```js
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
const rays = createGodRays({
  THREE,
  Pass,
  FullScreenQuad,
  camera,
  sunDirection: () => [sun.x, sun.y, sun.z],
});
rays.sync(composer, true); // before the OutputPass; the scene target gets depth
rays.configure({ samples: 64 }); // the sweep's handle
```

## Tests

- `god-rays.test.mjs` (Node's runner, the real three the page serves):
  the sun's NDC point against three's own projection, behind-camera and
  sideways suns, the fades' ranges and monotony (seeded property checks),
  the weights' normalisation and sample-count independence, parameter
  validation, and the pass against a recording renderer (its place before
  the output, the depth texture, no swap, three draws into the right
  targets with no depth test or write, additive colour with the alpha
  kept, autoClear restored, no draw at fade 0, the last-pass refusal, the
  odd-swap refusal).
- `god-rays.smoke.spec.mjs` (the page, SwiftShader): the rays against
  their own off baseline at the same pixels (a partly covered sun gains
  light in a band, less far out, nothing darker), the same with the AO
  on (the desktop default: the rays still only add), sky only (a wall in
  front of the sun adds nothing at threshold 0, with a control),
  byte-identical frames behind the camera and below the horizon (with an
  in-run mutation of the horizon fade), byte-identical frames with the
  switch off on both tiers, the phone composer's picture at strength 0,
  the switch and the hash key, the cost ratios, and on demand the
  opening-state cost (`GOD_RAYS_COST=1`) and the look sweep
  (`GOD_RAYS_SWEEP=1`).
