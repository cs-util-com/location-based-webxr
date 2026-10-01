# water-surface-material.ts

## Purpose

The lightweight water surface (plan 2026-09-23-0048, M4; DEC-SKY-3: "keep
the water part very lightweight"). A `MeshPhysicalMaterial` with water's
index of refraction, plus two layers of scrolling procedural wave normals and
a distance fade. No custom shader, no texture, no render target, no
reflection pass: the sky reflection comes from `scene.environment`, the sun
glint from the directional light's GGX lobe, and the atmosphere haze patches
it like any other lit material.

## Public API

- `WATER_SURFACE` — every constant the GLSL uses: `ior` 1.333, the depth
  `tint`, `roughnessNear` 0.06 / `roughnessFar` 0.22 over `roughnessRampM`
  [60, 900] m, the per-wave anti-aliasing fade `aliasFadeRad` [0.8, 1.6]
  (phase change per pixel), and six `waves` (direction, wavelength,
  amplitude, phase; `speedMps` derived from deep-water dispersion).
- `waterSlope(x, z, t, footprintM?)` → `[∂h/∂x, ∂h/∂z]`, each wave faded
  for a pixel footprint as the shader fades it; `waterNormal(x, z, t)` →
  unit normal; `waterWaveFade(k, footprintM)`; `waterRoughnessAtDistance(m)`.
  TS twins of the shader.
- `class WaterSurface` — `new WaterSurface({ tint?, slopeGlsl? })`:
  - `slopeGlsl`: GLSL that defines `vec2 waterSlopeAt(vec2 p, float t)`
    (world x/z in metres, seconds), REPLACING the six built-in waves (the
    look-dev page's water candidates, programme plan 2026-09-26-0539, W6).
    It may declare its own helpers. A custom slope has no TS twin here.
    `RangeError` when it does not define `waterSlopeAt`. Each slope gets its
    own program: the key is `water-surface|<slopeGlsl or built-in>`,
    because three shares programs between materials whose
    `onBeforeCompile` source is equal (the haze chains after this key);
  - `polish`: the water polish's switches (`water-polish.ts`, round-3
    stream W: `lostVariance`, `sunSize`, `fresnelDamp`, `antiTiling`,
    `gusts`, `body`), each off unless named true. Each combination gets
    its own program (`|polish:<names>` on the key); with every switch off
    the source, key and uniforms are exactly the unpolished water's.
    RangeError for an unknown switch, and for `lostVariance`, `antiTiling`
    or `gusts` on a wave set without the per-wave statement the hook needs
    (see `water-polish.ts.md`);
  - `polish` (read back: every switch named) and `polishUniforms` (bound
    only while a switch is on); `configurePolish(values)` changes the
    polish's constants without a recompile (RangeError for a bad value or
    for `values` that is not an object, and then nothing changes);
  - `material` (`MeshPhysicalMaterial`, named `water-surface`);
  - `uniforms.uWaterTime` (shared with every compiled program);
  - `update(seconds)` — advance the waves; `RangeError` for a negative or
    non-finite step; no GPU work (see the clock note below);
  - `dispose()`.
  - `RangeError` for a non-finite tint.

## Invariants & assumptions

- Water's F0 is 0.02 through three's own `ior` path
  (`pow2((ior − 1) / (ior + 1))`), not the 0.04 three assumes for a generic
  dielectric.
- The surface is HORIZONTAL (world +y up); the patch replaces the normal
  with the wave normal in world space, converted to view space.
- Calm by construction: the steepest possible slope Σ A·k ≈ 0.16 (a test
  holds it below 0.2), and the surface is level on average.
- Wavelengths (3...21 m) are sized for a city view tens to hundreds of metres
  from the camera. EACH WAVE fades by its own phase change per pixel
  (`fwidth`), short waves first, and the roughness rises with distance, so
  detail becomes blur instead of shimmer. (A first cut faded all six waves
  together by distance, which left the 3.3 m wave shimmering at 200-300 m;
  M4 review, finding 7.)
- `roughnessNear` sits above three's physical-lighting floor (0.0525), so
  the twin says what the GPU draws; a test reads the floor from three.
- NOT supported: instanced or batched meshes (one wave pattern per
  instance) and double-sided water (the normal is always the upper side's).
- The clock is never rebased: after a day of `update` the fastest wave
  loses ~0.03 rad of phase precision, after a week ~0.25 rad (a stutter).
- Apply the atmosphere haze AFTER creating the material; it chains after the
  water's patch (a test compiles both into one program).
- A glint can reach ~1e5 in scene units, Inf in a half-float target: a
  composer needs a clamp before any blur (the look-dev page's firefly clamp
  at 1024).

## Examples

```ts
const water = new WaterSurface();
lake.material = water.material;
haze.applyToObject(scene); // after: chains after the water's patch
// per frame:
water.update(dtSeconds);
```

## Tests

- `water-surface-material.test.ts` — F0 0.02, unit upward normals
  (property), level on average, the calm-slope bound, deep-water speeds, the
  surface moving over time, two directions > 30° apart, the per-wave fade
  (untouched for a small pixel, gone for a large one, short waves first),
  roughness monotone with distance and above three's floor, the patched real ShaderLib shader and its
  shared time uniform, `update` validation, the tint, coexistence with the
  haze; a custom `slopeGlsl` replacing the built-in waves, its own program
  key per slope (also under the haze), and the refusal of GLSL without
  `waterSlopeAt`; the polish: the patch before the polish PINNED (a
  SHA-256 of the output on a shader made of the patch's anchors, taken at
  webxr 542ac053, so three's own chunk text does not move it), every
  switch off equal to no polish, each switch on the real ShaderLib shader
  with its own key and uniforms, all six under the cloud shadows and the
  haze, the refusal of an unhookable wave set, `configurePolish`.
- GPU: the look-dev smoke's "the water's waves move on the GPU, and the lake
  warms with the sky" (lake view: 12/12 points move when the waves
  advance; red over blue ×1.64 from noon to golden hour).
