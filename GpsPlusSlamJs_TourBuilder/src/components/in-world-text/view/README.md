# in-world-text/view — Three.js view layer

Composes the pure `core/` into meshes, textures, and picking. This layer touches
Three.js and the DOM; its rendering is exercised via the demo, while the
fallback-selection logic is unit-tested (see below).

## Modules

### `text-surface.ts` — the swappable backend seam

The `TextSurface` interface (a `THREE.Texture` + async `render`/`settled`/
`dispose`) and `SurfaceFactory` type, plus `createMeasure(fontPx, fontFamily)` —
the offscreen-canvas `measureText` shared by both backends so wrapping matches.

### `canvas-text-surface.ts` — Canvas backend (fallback)

Draws the `PanelDrawModel` into a 2D canvas → `CanvasTexture`. Fully synchronous
(`settled()` resolves at once). Mipmaps + anisotropy keep text crisp at distance
and grazing angles.

### `html-text-surface.ts` — HTML-in-3D backend (primary)

Builds an offscreen, self-contained DOM subtree from the `PanelDrawModel` and
rasterizes it with `three-html-render`. `three-html-render` is **lazily imported**
on first render (it patches DOM globals at import time, so it must never load in a
non-DOM context — this keeps the factory's unit tests node-safe). Rasterization is
async and double-buffered (the previous image stays until the new one lands);
`settled()` exposes the latest raster promise.

### `in-world-text.ts` — the label factory (composition unit)

`createInWorldText(options)` → the billboarded label. It hosts the page state,
yaws to face the user (shared billboard math), and renders through a
`TextSurface`. **The fallback lives here:** it tries the HTML backend, and if a
render throws or does not settle within `htmlRenderTimeoutMs` it swaps that
surface to Canvas and re-renders — at construction _or_ later (every render is
guarded). The surface factory and the measurer are injectable, which is what makes
the fallback unit-testable with no DOM/GPU.

### `text-interaction.ts` — pointer picking (demo)

Raycasts the label planes on a tap and reports the hit label id + UV; a drag guard
distinguishes a tap from an orbit. The demo swaps this for the WebXR `select` ray,
reusing the same `label.hitTest(uv)` — the ray-production seam component 8 reuses.

## Tests

`in-world-text.test.ts` pins the **fallback wiring** (the reason two backends
exist): with an injected surface factory that throws / rejects / times out /
succeeds, it asserts the resulting `activeBackend` and that a page still renders —
all in the node environment, no GPU. The surfaces' actual pixel output is
view-layer and verified via the demo.
