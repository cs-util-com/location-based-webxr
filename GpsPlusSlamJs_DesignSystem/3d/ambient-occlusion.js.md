# ambient-occlusion.js

## Purpose

Screen-space ambient occlusion on the look-dev page's **desktop tier**
(round-3 plan
`GpsPlusSlamJs_Docs/docs/2026-09-27-0532-owner-feedback-round-3-plan.md`,
stream C; round-2 plan `2026-09-26-2055-owner-feedback-round-2-plan.md`,
M2e). It is three's own `GTAOPass`, with three page changes:

- **The sky, the clouds and every other transparent or depth-less object
  stay out of the AO's normal/depth pass.** three hides only points and
  lines there and draws every other mesh with ONE override material
  (`MeshNormalMaterial`, depth write on, front faces). So the sky (a 2 m
  box whose own vertex shader puts it at depth 1) would be drawn as a 2 m
  box at the origin, and the cloud sheet and slab as opaque planes and
  boxes: geometry the main pass never has in its depth.
- **The AO is multiplied in place** onto the composer's scene target
  (three's blend material, drawn without a clear), and the pass does not
  swap. three's own output first copies the scene into the other buffer
  and swaps. The page's scene target is the multisampled one only while an
  even number of passes swap (`lookdev.js` `applyTier`: the clamp and the
  output pass), so a swapping AO pass would put every other frame's scene
  into the plain target.
- **The AO fades out with view depth** (between `fadeStartM` 300 m and
  `fadeEndM` 700 m), in the blend, from the pass's own depth target. Without
  it the AO darkened the hazed distance: the ground-ridge line at 2.5 km by
  5-25 levels, where a metre-scale radius is a pixel or two and the haze,
  not occlusion, sets the colour. The fade also keeps anything at the sky's
  depth (1.0) untouched, whatever the AO map holds there. The window was
  re-swept at the shipped radius (records below): 500-1200 m or 700-1500 m
  would keep the dense city's near-ring creases but darken the ridge foot
  by up to 1.1 / 3.1 levels.

The phone tier (the page's default) has no composer, so no AO. The switch
stays visible there, says so, and offers the tier switch.

Records: `GpsPlusSlamJs_Docs/docs/2026-09-27-0716-lookdev-gtao-results.md`
and its review-fixes addendum (`2026-09-27-*-lookdev-gtao-review-fixes-results.md`
in the same folder).

## Public API

- `AO_PARAMS`: the AO parameters at the scene's metre scale
  (`radius` 5 m, `thickness` 8 m, in view-space metres; `distanceExponent`
  1, `distanceFallOff` 1, `scale` 1, `samples` 16; `screenSpaceRadius:
false`), plus the page's `intensity` (three's `blendIntensity`, 1; not
  swept, the strength was swept as `scale`) and `fadeStartM` / `fadeEndM`
  (300 / 700 m).
- `AO_DENOISE`: the denoise parameters (`radius` in pixels, the three
  edge-stopping weights, `samples`, `rings`, `radiusExponent`).
- `hiddenFromAoNormals(object)`: `true` for sprites, lines and points, and
  for a mesh none of whose materials is visible, opaque and depth-writing.
  A group (anything that is not drawn itself) is never hidden: its children
  decide.
- `withPageExclusions(GTAOPass)`: a subclass of the given `GTAOPass`:
  - `needsSwap = false`; `render` computes the AO with three's own output
    off, then draws the depth-faded blend onto `readBuffer`. It **throws**
    when it is the composer's last pass (`renderToScreen`): the screen never
    received the scene it would multiply;
  - `_overrideVisibility` hides by `hiddenFromAoNormals`;
    `pageExclusions = false` (a test surface) falls back to three's rule;
  - `updateGtaoMaterial` also takes `intensity`, `fadeStartM`, `fadeEndM`;
  - `resolutionScale` (1 by default) scales its targets against the
    composer's size (`setSize`); a sweep handle, see the record;
  - `dispose` also frees `gtaoMaterial` and `blendMaterial`, which three
    r185's own dispose leaves behind.
- `createAmbientOcclusion({ GTAOPass, scene, camera, params?, denoise?,
userAgent? })` returns the page's controller:
  - `sync(composer, on)`: builds the pass the first time `on` is true while
    a composer exists, inserts it right after the composer's `RenderPass`
    (before the HDR clamp and the bloom), and sets `enabled`. A different
    composer, or `null`, drops the pass (the page disposes a composer's
    passes with it).
  - `configure({ params, denoise, resolutionScale })`: merges parameters
    into the live pass and into any pass built later (a new scale re-sizes
    the live pass at once; outside (0, 1] it throws a `RangeError`);
    returns the merged values.
  - `pass` (or `null`), `active` (whether the AO draws), and `unsupported`
    (null, or why this browser gets none: see Oculus Browser below).

The module has no imports: the page hands in three's `GTAOPass`, so Node's
runner tests it against the real pass.

## Invariants & assumptions

- **It relies on three internals.** `_overrideVisibility` (called by
  `GTAOPass.render` around its normal/depth pass, undone by
  `_restoreVisibility` from `_visibilityCache`), `_renderPass` (the
  full-screen draw), the blend material's `intensity` / `tDiffuse`
  uniforms, and `render` honouring `OUTPUT.Off`. An upgrade that renames
  one, or stops calling `_overrideVisibility`, would put the sky and the
  clouds back into the AO's depth without any error.
  `ambient-occlusion.test.mjs` runs the real pass against a recording
  renderer and fails in that case: "draws the normal/depth pass without
  the sky..." and "still finds the internals".
- **Opaque, depth-writing meshes stay in**, the water included: they occlude
  in the main pass, so they must occlude here. A mesh is excluded only when
  NONE of its materials would write depth.
- **The exclusion rule's edges** (pinned by unit tests where marked):
  - (a) a transparent mesh that DOES write depth is still left out; the
    main pass has it in its depth, so its pixels get the AO of whatever is
    behind it (tested);
  - (b) hiding a left-out mesh hides its whole subtree (three's `visible`),
    so an opaque child of a sky or cloud mesh would lose its AO; the page
    has no such child (tested);
  - (c) the override material draws front faces only, so a `DoubleSide`
    mesh seen from its back (the page's ridges may be) is missing from the
    AO's depth and gets no AO; at the ridges' 2.5 km the fade has already
    removed it.
- **Oculus Browser is refused.** three invalidates a multisampled colour
  buffer right after resolving it when the user agent is Oculus Browser
  (`WebGLTextures`, `supportsInvalidateFramebuffer`), and the in-place blend
  draws into that buffer again, so it would multiply undefined content.
  There `sync` builds nothing and the readout says "AO n/a on Oculus
  Browser". Chrome, Firefox and Safari keep the buffer.
- **The normal/depth pass has no multisampling.** The AO is computed at one
  sample per pixel and multiplied onto the resolved, multisampled scene.
  The record measures what that does at silhouettes (no halo found).
- **The AO multiplies the whole pixel,** direct sun and haze included (three's
  blend), which is why it fades out before the hazed distance.
- **The fade is by view depth, the haze by distance.** The blend fades on
  the depth along the view axis; the haze grows with the distance along
  the ray. Toward the frame's edges a point is farther than its view depth
  (55° vertical field at 1280x800: 13 % at the top and bottom edges, 30 %
  at the side edges, 40 % in the corners), so the AO fades later there
  than the haze would suggest.
- **A transparent object in front of AO'd geometry shows the AO through
  it** (it is excluded, so the AO of what is behind it applies). Seen from
  just above the cloud sheet, the city 2 km below would be darkened through
  the deck; the fade removes that at the page's distances.
- **Cost scales with the scene, not only with pixels.** The normal/depth
  pass re-renders every visible mesh (the dense city's 42,000 instances
  included) with the override material. The blend draws into the
  multisampled target again, which costs a second full resolve. And when
  the shadow maps render every frame (`setShadowParams({ everyFrame: true })`)
  they are rendered again inside the AO's pass. SwiftShader ratios are in
  the record; no real-GPU number exists yet.
- Only the desktop tier draws it; `enabled` follows the page's `ao` state.

## Examples

```js
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { createAmbientOcclusion } from "./ambient-occlusion.js";

const ao = createAmbientOcclusion({ GTAOPass, scene, camera });
ao.sync(composer, true); // built, inserted after the RenderPass, enabled
ao.configure({ params: { radius: 4 } });
ao.sync(composer, false); // kept, disabled
```

## Tests

- `ambient-occlusion.test.mjs` (Node's runner, the real three): the
  exclusion rule and its edges (a) and (b), the normal/depth pass drawn
  without the excluded objects and restored after, the in-place blend with
  no swap, the refusal as last pass, the depth fade's uniforms, intensity,
  dispose, the parameters, the Oculus Browser refusal, and the controller's
  lazy build, reuse and composer change.
- `ambient-occlusion.smoke.spec.mjs` (the page, SwiftShader): the crease
  darkens, open ground, the sky and clouds, the ridge foot and the dense
  city past the fade stay within their tolerances, each shown failing on an
  in-run mutation (intensity 0, distance exponent 3, the fade off, three's
  own exclusion rule); the phone tier draws no AO; the switch and its tier
  note; the scene keeps its MSAA on every frame (no in-run mutation; the
  swapping pass was run against it once, record); and the logged cost
  ratio.
