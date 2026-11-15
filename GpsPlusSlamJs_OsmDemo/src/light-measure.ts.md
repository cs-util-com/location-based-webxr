# light-measure.ts

## Purpose

The light dialog's measurement of the 3D view as it stands
(`BuildingView.measureLight`): the lit-surface brightness with the heat
grid hidden, and the chroma the grid adds, the heat grid margin. It owns
the ORDER of the work (scene renders, AO passes, readbacks, the redraw
afterwards) apart from the renderer, so the cost can be counted in a unit
test. The two measures themselves are `light-readouts.ts`.

## Public API

- `measureLightReadouts(deps): LightMeasurement`
  - `deps.grid`: the heat grid's objects (mesh, outlines); `undefined` and
    invisible ones are skipped and left untouched.
  - `deps.withMargin`: whether to measure the margin (the second read).
  - `deps.drawScene()`: draws the scene to the canvas as a frame does
    (`prepareFrame` + `renderer.render`), without the AO.
  - `deps.ambientOcclusion`: `render()` and `reapply()` of the view's
    `AmbientOcclusion` (framework `visualization/ambient-occlusion`).
  - `deps.hiddenFromAo(object)`: the AO's exclusion rule
    (`hiddenFromAoNormals`), passed in because only `building-view.ts` may
    import the AO module (a source-text test pins that).
  - `deps.readFrame()`: the frame just drawn, RGBA (`gl.readPixels`).
  - `deps.requestFrame()`: schedules a frame.
  - Returns `{ litLuma, margin }`; `margin` is `null` without a shown grid or
    without `withMargin`. Errors from any dependency propagate.
- Types `LightMeasureDeps` and `LightMeasurement`.

## Invariants & assumptions

- **Read 1**: grid hidden, one scene render, one AO `render`, one readback;
  the brightness comes from it. **Read 2** (margin only): grid shown, one
  scene render, the AO REAPPLIED, one readback.
- **The AO is reused only when its input is unchanged.** Every mesh under
  every shown grid object must be left out of the AO's normal pass (the
  shipped see-through faces, `transparent` with no depth write, and the
  outlines, lines). An opaque grid preset (opacity 1 writes depth) is seen
  by the AO, so its AO is computed again. A refused `reapply` falls back to
  `render`. The AO of read 2 is then the identical AO multiplied onto the
  frame with the grid, so the numbers are those of a full recomputation.
- **No redraw when the canvas already shows the view as found**: after a
  margin read the canvas holds the frame with the grid shown, which is the
  restored state, and without a grid read 1 is the view itself. A frame is
  requested only when the grid is shown and the brightness alone was read,
  or when a render threw.
- The grid is restored as found (`finally`).
- Synchronous: each readback reads exactly the frame just drawn.

## Measured cost (headless Chromium, software rasteriser, 639 x 720 drawing buffer, June noon fixture, heat grid on)

Before (each read computed its own AO, and the redraw after the
measurement drew the same view again):

- One measurement, AO on: 2.6-2.8 s in one main-thread task. AO off:
  1.7-1.8 s.
  - Scene renders: about 850 ms each, two per measurement (1.69-1.80 s).
    Of one render, a single `MeshStandardMaterial` mesh took about
    1.0 s of 1.1 s and the sky 60 ms (per-object timing with a 1-pixel sync
    readback around each draw, which inflates the total a little). No
    shader recompiles (22 programs throughout).
  - AO: about 430-490 ms per read (normal/depth pass, GTAO, denoise,
    blend), two per measurement.
  - `readPixels` of the full buffer: 2-4 ms each. Pixel loops
    (`litSurfaceLuma`, `meanChroma` x 2): 6-14 ms together. Buffer
    allocation and `prepareFrame`: under 1 ms.
- The redraw afterwards blocked the main thread for one more render and AO
  (about 1.5 s with AO on), so the readout became observable 4.2-4.4 s
  after the click with AO on, 2.8-3.0 s off.

After:

- One measurement, AO on: one long task of 2.34-2.36 s (AO off
  1.86-1.89 s). Readout observable 2.4-2.7 s after the click with AO on,
  2.1-2.2 s off.
- Readouts unchanged: lit 24.5 and margin 1.59 with AO on, 26.0 and 1.99
  off, before and after.

What was NOT done, and why:

- **A smaller render target**: swept over the drawing-buffer scale (AO on,
  lit / margin): 1.0 gives 24.466 / 1.587 at 2.95 s; 0.75 gives 24.563 /
  1.579 at 2.04 s; 0.5 gives 24.621 / 1.491 at 1.19 s; 0.35 gives 24.618 /
  1.414; 0.25 gives 24.255 / 1.408. AO off: 26.010 / 1.993, 26.160 / 1.978,
  26.271 / 1.959, 26.364 / 1.937, 26.489 / 1.902. Already at 0.75 the
  displayed brightness moves by one step (24.5 to 24.6, 26.0 to 26.2) and
  the margin by 0.01, so no scale keeps the numbers the light is tuned by.
- **Scissoring read 2 to the grid's screen box**: the pixels the grid
  changes span 18 % of the frame, but their bounding box spans 80 %, so it
  would save about a fifth of one render for a projection that must be
  right in every pose.
- The remaining cost is the two scene renders, which are the picture being
  measured.

## Example

```ts
const { litLuma, margin } = measureLightReadouts({
  grid: [cellMesh, cellOutlines],
  withMargin: true,
  drawScene: () => renderer.render(scene, camera),
  ambientOcclusion: ao,
  hiddenFromAo: hiddenFromAoNormals,
  readFrame,
  requestFrame,
});
```

## Tests

- `light-measure.test.ts`: the work counted per measurement (two scene
  renders, one AO render, one reapply, two readbacks, no redraw); the AO
  recomputed when it sees the grid and when a reapply is refused; the
  brightness alone with one redraw; no grid; restore and redraw when a
  render throws; the numbers equal `light-readouts.ts`'s measures of fixed
  frames.
- `light-measure.property.test.ts`: over random grids and `withMargin`,
  reads equal renders, each read carries exactly one AO, the AO is computed
  twice only when it sees the grid, a redraw exactly when needed, every
  visibility restored.
- The readouts against the e2e sweep's own measures on the same view:
  `playwright-tests/scene-3d.spec.js` (the June noon parity step).
