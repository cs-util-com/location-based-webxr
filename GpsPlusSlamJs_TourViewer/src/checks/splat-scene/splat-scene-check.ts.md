# splat-scene-check.ts

## Purpose

Wires `splat-scene-check.html`: builds a walk through the synthetic scene, renders its photos, zips it and reads it back with the splat trainer's reader, and says what it found.

## Public API

- `startSplatSceneCheck(doc, deps?) -> () => Promise<void>` - wires the page's controls and returns the build (tests call it directly). `deps.render` replaces the WebGL rendering (default `renderSceneFrames`). Throws when the page lacks one of its elements.

## Invariants & assumptions

- State is `#state[data-state]`: `idle`, `building` (with a progress line), `read`, `refused` (the reader's reason) or `error` (the build's message).
- The build button is disabled while building and enabled again on every outcome.
- Depth on the recorder's reconstruction grid (`DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE`, 24 x 24), captures 500 ms apart.
- At most 400 frames per walk, whatever the field holds (its `max` is only a hint).
- Every object URL the page made (the zip, the first photo) is revoked before the next build.

## Tests

- `splat-scene-check.test.ts` (jsdom, with node's `Blob` so the zip can be streamed):
  - a loop walk read back, the button disabled while rendering, the zip and the first photo offered;
  - a failed render reported, the button freed;
  - a one-photo walk refused in words before any rendering;
  - the depth read back on the reconstruction grid;
  - a typed 5000 frames capped at 400.
- `playwright-tests/splat-scene-check.spec.js` - the page end to end in a browser, including the photo's colour matching the surface `sceneHitAt` names at a 12 x 12 grid.
