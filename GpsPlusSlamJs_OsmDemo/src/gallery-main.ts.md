# `src/gallery-main.ts`

## Purpose

The entry point `gallery.html` loads. It exists so that `gallery.ts` does not
have to run on import.

## Public API

None — it is a side effect.

## Invariants & assumptions

- **The side effect lives here so `gallery.ts` stays importable.** A module that
  constructs a `WebGLRenderer` at module scope cannot be imported by a unit test,
  and the grid layout is the one part of the gallery that can be wrong without a
  GPU.
- **The disposer is held at module scope, and that is load-bearing.** Written as
  a bare `buildGallery(container)` the return value is discarded and nothing
  references the renderer any more; the canvas stays alive because the DOM holds
  it, the renderer is collected, and the GL context goes with it. The symptom is
  a correct first render followed by a permanently blank canvas, with nothing
  logged — losing a context that way is the collector doing its job, not an
  error. `main.ts` avoids the same trap by accident: its `BuildingView` stays
  reachable through the store subscriptions it registers.
- **Released on `pagehide`, not `unload`.** `unload` is deprecated and does not
  fire for the back/forward cache.

## Examples

```html
<script type="module" src="/src/gallery-main.ts"></script>
```

## Tests

Covered end to end by `playwright-tests/osm-demo.spec.js` › _"the POI model
gallery"_ — if this file failed to hold the renderer, that test's polled pixel
count would fall back to zero.
