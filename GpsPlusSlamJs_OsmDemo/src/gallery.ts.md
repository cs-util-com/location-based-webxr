# `src/gallery.ts`

## Purpose

Draws every procedural POI model on its own neutral pad, at true relative scale,
with a human-height reference beside each one (W7, DEC-R5-5). It is the contact
sheet DEC-R4-14 declined and **F28** asked for.

**It is a CATALOGUE, not a comparison (DEC-R7b-2a, round 8).** For one round it
also showed each kind's liked alternatives receding behind the shipped model, so
the owner could choose between them. They chose; the 29 winners were adopted into
`POI_MODELS`; the losing geometry was deleted. One pad, one model, one label —
and this page is now the only place in the repo that shows what every POI kind
actually looks like at real scale.

## Public API

- `buildGallery(container: HTMLElement): () => void` — builds the scene into
  `container` and returns a disposer. **The disposer must be held** — see the
  invariant below.
- `gridPositions(count): { x, z }[]` — the layout, exported so it can be tested
  without a GPU.

## Invariants & assumptions

- **A separate page, not a button in the demo (DEC-R5-5).** The round-5 notes
  proposed spawning all fifty models into the live scene 40–50 m up and left the
  choice open. Three reasons it is a page instead, and none is taste:
  - In-scene it would need a layer/pick/details registry entry or a deliberate
    exception to one; those registries are exhaustive over their unions by
    construction, which is what stops a layer existing that nothing can toggle.
  - It would perturb the draw-call readout and the difference-count e2e proxies,
    both of which read the live scene.
  - **Relative scale is the whole point and a city hides it** — DEC-R4-14 said so
    when it declined the contact sheet.
- **No store, no worker, no Overpass, no terrain.** `POI_MODELS` is pure data
  from the package. If this page ever needs a network stub in its e2e, it has
  grown a dependency it exists to avoid.
- **Ranking order, not alphabetical.** `poi-ranking.ts` chose these fifty by
  global usage, so reading top-left to bottom-right is reading most-common to
  least — the order in which a wrong model matters most.
- **THE RETURNED DISPOSER MUST BE HELD BY THE CALLER.** It closes over the
  renderer; drop it and nothing references the `WebGLRenderer` any more. The
  canvas survives because the DOM holds it, the renderer becomes garbage, and the
  GL context goes with it — a blank page, with nothing logged, some time after a
  correct first render. `gallery-main.ts` keeps it at module scope for exactly
  this reason.
- **The GPU context can arrive AFTER the first frame, and on a page that paints
  once that is fatal.** Measured here: immediately after load `isContextLost()`
  is true, `webglcontextlost` fires, and the context is restored ~1 s later. A
  page with a permanent rAF loop never notices. This one draws a single frame, so
  it must `preventDefault()` the loss (the spec requires it before the browser
  will restore) and redraw on `webglcontextrestored`.
  - **The demo does not hit this by accident**: its async boot — rule table,
    worker, fetch, terrain — schedules frames for a second or two afterwards.
- **`preserveDrawingBuffer: true`**, for the same reason as `building-view.ts`:
  frames are on demand, so by the time a test reads the canvas nothing is
  repainting and the buffer would already be cleared.
- **First paint is synchronous.** Everything else in `buildGallery` is, so the
  status line reports "50 POI models" the instant the module evaluates. Deferring
  the only necessary frame leaves a window in which the page claims to be ready
  and the canvas is untouched.
- **Labels are sprites, not DOM.** Fifty absolutely-positioned elements would need
  re-projecting on every camera move — a second render loop competing with the
  first. A sprite is part of the scene and follows for free.

## Examples

```ts
const dispose = buildGallery(document.getElementById("gallery")!);
window.addEventListener("pagehide", dispose, { once: true });
```

## Tests

- `gallery.test.ts` — the layout arithmetic, which is what can be wrong without a
  GPU: every model gets its own place, pads cannot overlap, the sheet is centred
  on the origin (the default camera looks at it), it stays roughly square rather
  than a 1×50 strip, and the degenerate counts do not divide by zero.
- `playwright-tests/` › _"the POI model gallery"_ — the page
  loads, reports fifty from the data rather than a hard-coded number, draws
  non-background pixels, and logs no error.
- `gps-plus-slam-osm`'s `poi-models.contract.test.ts` — that the models
  themselves are non-degenerate. That is the other half of F28 and it lives with
  the data.
