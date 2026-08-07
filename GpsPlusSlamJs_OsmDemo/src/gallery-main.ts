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

// NOT RELEASED ON `pagehide`, and that is deliberate after a second look. An
// earlier version did exactly that, reasoning that `pagehide` is the modern
// `unload`. It also fires when the page enters the BACK/FORWARD CACHE — and with
// no `pageshow` counterpart to rebuild, navigating back to the gallery restores
// a document whose renderer and controls are already disposed: a frozen,
// non-interactive canvas with nothing logged. Precisely the failure this file's
// other comment is about, reintroduced by the cleanup meant to be tidy.
//
// A real teardown reclaims the context anyway. So the disposer is HELD rather
// than wired to anything — which is also what keeps the renderer reachable.
void dispose;
