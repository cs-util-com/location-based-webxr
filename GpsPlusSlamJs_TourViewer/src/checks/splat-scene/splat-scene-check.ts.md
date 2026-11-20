# splat-scene-check.ts

## Purpose

Wires `splat-scene-check.html`: builds a walk through the synthetic scene, renders its photos, zips it and reads it back with the splat trainer's reader, and says what it found.

## Public API

- `startSplatSceneCheck(doc, deps?) -> () => Promise<void>` - wires the page's controls and returns the build (tests call it directly). `deps.render` replaces the WebGL rendering (default `renderSceneFrames`). Throws when the page lacks one of its elements.

## Invariants & assumptions

- State is `#state[data-state]`: `idle`, `building` (with a progress line), `read`, `refused` (the reader's reason) or `error` (the build's message).
- The build button is disabled while building and enabled again on every outcome.
- Depth grid 8 x 8, captures 500 ms apart.
- Every object URL the page made (the zip, the first photo) is revoked before the next build.

## Tests

- `splat-scene-check.test.ts` (jsdom, with node's `Blob` so the zip can be streamed):
  - a loop walk read back, the button disabled while rendering, the zip and the first photo offered;
  - a failed render reported, the button freed;
  - a one-photo walk refused in words before any rendering.
- `playwright-tests/splat-scene-check.spec.js` - the page end to end in a browser.
