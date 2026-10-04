# globe-stencil-fill.ts

- Purpose: the stencil fill between the relief and the globe (round-6 plan
  2026-10-04-1050 G6-1; owner decision 2026-10-04 after the hole
  measurement). The relief draws first and marks every pixel it draws; the
  globe draws after it, only where no mark is, from the coarse tiles it
  always keeps. No pixel is left empty when the relief's tiles lag the
  camera (zooming out, fast dives), and none is drawn twice, so there is no
  z-fighting at sea level.
- Public API:
  - `asStencilWriter(material)`: the relief's role (always pass, replace
    with `GLOBE_STENCIL.ref`).
  - `asStencilFill(material)`: the globe's role (pass where not equal to the
    ref, keep).
  - Both return the material.
- Invariants: the page needs a stencil buffer (`WebGLRenderer({ stencil:
true })`, which three does not create by default) and must draw the
  relief's group first (`renderOrder` -1). The globe compiled for the fill
  (`patchGlobeSurfaceShader` option `fill`) has no `discard`, so a GPU's
  early stencil test can reject its fragments before its shader runs.
- Cost: at the hold, 1.61-1.68 x a frame with the fill against without it,
  under SwiftShader (a CPU rasteriser that runs the fragment shader before
  the stencil test); a GPU's early stencil test should make it far smaller.
  The owner's phone measures it with the Debug panel (`bandFill=0` against
  the default).
- Tests: `globe-stencil-fill.test.ts` (both roles' stencil state); the
  lab's `globe-handover.smoke.spec.mjs` (no hole with the fill, holes
  without it, and the cost, logged).
