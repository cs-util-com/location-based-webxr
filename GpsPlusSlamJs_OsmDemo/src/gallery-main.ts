/**
 * The gallery page's entry point (W7).
 *
 * SEPARATE FROM `gallery.ts` FOR ONE REASON: a module that builds a
 * `WebGLRenderer` at import time cannot be imported by a unit test, and the grid
 * layout is the one part of the gallery that can be wrong without a GPU. Keeping
 * the side effect here leaves `gallery.ts` importable.
 *
 * @see gallery-main.ts.md
 */

import { buildGallery } from "./gallery.js";

const container = document.getElementById("gallery");
if (container === null) {
  throw new Error("Missing #gallery in gallery.html");
}

/**
 * HELD AT MODULE SCOPE, AND THAT IS LOAD-BEARING RATHER THAN TIDINESS.
 *
 * `buildGallery` returns a disposer that closes over the renderer, the scene and
 * the controls. Written as a bare `buildGallery(container)` the return value is
 * discarded and **nothing in the program references the renderer any more** — the
 * canvas stays alive because the DOM holds it, but the `WebGLRenderer` becomes
 * garbage, and when it is collected the GL context goes with it.
 *
 * The symptom is horrible to diagnose and was hit while writing this page: the
 * scene renders correctly (three reports 200 draw calls and `readPixels` returns
 * real colour), and then some time later the canvas is blank, `isContextLost()`
 * is true, and `toDataURL()` returns an empty image. Nothing is logged, because
 * losing a context this way is not an error — it is the collector doing its job.
 *
 * The demo does not have this problem for an accidental reason: `main.ts` keeps
 * its `BuildingView` reachable through the store subscriptions it registers.
 */
const dispose = buildGallery(container);

// Released on navigation away rather than left to the collector — which is the
// same thing the module-scope reference above exists to prevent happening
// unpredictably. `pagehide` rather than `unload`: it fires for the back/forward
// cache too, and `unload` is deprecated.
window.addEventListener("pagehide", dispose, { once: true });
