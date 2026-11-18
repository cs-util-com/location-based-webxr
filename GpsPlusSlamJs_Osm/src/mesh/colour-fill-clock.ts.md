# colour-fill-clock.ts

- **Purpose:** a spike instrument. It sums the wall time `buildCity` spends on colouring (the per-feature colour choice, the per-vertex colour fill in `chunkMeshes`, the sRGB-to-linear pass and the road colour choice), so the time-of-day blend measurement can set the colouring share against the whole build.
- **Public API:**
  - `colourFillClock`: `{ ms }`, the summed milliseconds; the caller sets `ms = 0` before a build and reads it after.
  - `timedColourFill(work)`: runs `work`, adds its wall time, returns its result; an exception still adds the time and is rethrown.
- **Invariants:** module state, one clock per JS realm (a worker has its own). It does not include tree colours (one packed integer per tree) or the land-use raster (scheme-independent).
- **Tests:** none; a measurement instrument on a spike branch, never merged.
