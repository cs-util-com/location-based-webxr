# measure-blend.ts

- **Purpose:** the time-of-day blend measurement, `?measure=blend` (a throwaway readout on a spike branch). Once the city has not rebuilt for 8 s it measures what the blend's two design decisions rest on, then shows one large "Copy log" button with a plain-text report. When the clipboard is missing or refused it shows the report in a selectable text box.
- **Public API:**
  - `blendMeasureRequested(search)`: whether the link asks for it.
  - `startBlendMeasure({ view, scheme, chooseScheme })`: mounts the panel and returns `{ meshDrawn(mesh) }`, which the page calls with every full mesh.
  - `median(values)`: the median, NaN for an empty list; `quantile(values, q)` the same for any quantile (linear interpolation).
- **What it measures** (each timing reported as median, p90, min, max and n; uploads, transfers and tree mixes n = 7, sky calls n = 20, scheme switches n = 6):
  - the device's GPU name, WebGL limits (`MAX_VERTEX_UNIFORM_VECTORS`, `MAX_FRAGMENT_UNIFORM_VECTORS`, `MAX_TEXTURE_SIZE`, `MAX_VERTEX_ATTRIBS`);
  - vertex counts (buildings, barriers, roads, from the worker), tree placements and the scene's instanced meshes with instance colours;
  - the land-use window and its texture sizes (class raster, RGBA, with mips, two pair textures);
  - the sky's full rebuild, sun-only rebuild and bake (`AtmosphereRig.measureUpdates`) and a `setLightSettings` call, each followed by a one-pixel GPU read, so every number is the main thread's blocked piece (the visible hitch);
  - a sunset timelapse: 20 sun steps from 6 to -6 degrees elevation, one per frame, through today's `setSunAngles` (no blend), each step's blocked time listed, plus the long tasks over 50 ms seen during it;
  - `bufferSubData` of one look, of K = 4 looks and of today's Float32 colours, synced;
  - K worker buffers posted copied against transferred (`measure-blend-worker.ts`);
  - a CPU mix of K tree colours into every instance colour, and its upload (the scene's colours are restored);
  - six scheme switches, alternating, choice to mesh and to two frames later, with each worker build's `buildCity` time and its colouring share.
- **Invariants:** runs once; a failure ends with a report that says FAILED and why. It changes the scheme (the last switch returns to the starting one).
- **Tests:** none; a measurement tool on a spike branch, never merged.
