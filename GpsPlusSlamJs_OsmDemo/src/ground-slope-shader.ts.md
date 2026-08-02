# `ground-slope-shader.ts`

**Purpose:** patches §2's slope treatment — aspect tint, isoclines, rim light —
into `MeshStandardMaterial` via `onBeforeCompile`.

## Public API

- `installGroundSlope(material, uniforms)` — adds the patch, keeping any
  existing compile hook. Sets `material.needsUpdate`.
- `SLOPE_SHADER_ANCHORS` — the `#include` markers the patch depends on, exported
  as data so a test can assert they still exist.
- `SlopeUniforms` — `{ uSlope: { value: number } }`, 1 on / 0 off.

## Invariants & assumptions

- **It CHAINS, it does not replace.** `material.onBeforeCompile` is a single
  function and the ground already carries `installGroundDisplacement`. An
  assignment would throw the displacement away — the terrain would flatten, in
  GPU mode only, with nothing reported. The previous hook is **bound** to the
  material, not merely captured, so a hook that uses `this` keeps working.
- **The anchors are asserted against three's real shader source.** A
  `String.replace` with a missing needle returns the input unchanged, so a
  renamed chunk makes the whole patch a silent no-op: plain ground, no error,
  green suite. The chunk is `opaque_fragment`; the older `output_fragment` name
  that most examples still use no longer exists.
- **The world normal is computed in the vertex shader, not derived from
  `vNormal`.** three's `vNormal` is view-space and steepness is meaningless
  there — it would change as the camera moved. `objectNormal` is used so the
  displacement patch's rewritten normal flows through.
- **Only the lit material is patched.** The height-ramp material is
  `MeshBasicMaterial` — unlit on purpose so the hypsometric colour is not
  modulated by shading — and has no `outgoingLight` to patch.
- **The uniform object is shared, not copied**, so one write reaches every
  material that was patched with it.

## Cost

Measured on the e2e suite when this became the default ground: **5.5 min → 8.3
min**, and two tests that pass standalone began timing out under contention.
That figure mostly measures headless Chromium's CPU rasteriser, where
per-fragment maths is far more expensive than on a real GPU — treat it as an
upper bound. The frame-ms readout from the perf overlay on a device is the
instrument that matters (F39), and it has not been taken.

## Examples

```ts
installGroundDisplacement(material, uniforms);
installGroundSlope(material, uniforms); // chains; order matters
uniforms.uSlope.value = 1; // no recompile
```

## Tests

- `ground-slope-shader.test.ts` — anchors exist; the patch rewrites both
  shaders; it chains rather than replacing; the uniform object is shared; the
  material is marked for recompilation.
- `terrain-slope.test.ts` covers the arithmetic this mirrors.
