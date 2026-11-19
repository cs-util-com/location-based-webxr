# globe-debug-layer.ts

## Purpose

The debug layer on the 3D view on the globe: the recording's camera
captures as small thumbnails at their places, and the walk through them
as one line, under the tour's frame. It draws what the page's debug layer
drew on the map (`debug-capture-layer.ts`), read through the store's
`debugLayer` slice (`debug-layer-slice.ts`) and the page's thumbnail table
(`debug-thumbs.ts`) by `editor3d-globe.ts`. Debug data, never the tour's
content: nothing in it is picked, selected or saved.

## Public API

- `createGlobeDebugLayer(parent, surface?) : GlobeDebugLayer` - its group
  (`debug-layer`) under `parent` (the tour's frame); `surface` is the
  atlas's pixels, a canvas by default (the module's own), a fake in
  tests.
  - `set(captures, line)` - draw `{ image, at }[]` (`at` in the tour's
    frame), replacing any; null or none draws nothing. A capture without
    a finite point and a name drawn twice are dropped. `line` adds a line
    through them (two captures at least).
  - `thumb(image, { source, width, height })` - copy a thumbnail into its
    capture's atlas cell; false for a name not drawn, a picture without a
    size, or one already in.
  - `hasThumb(image)`, `show(on)`, `resize(widthPx, heightPx)` (CSS px).
  - `frame(now)` - uploads the atlas when thumbnails came, at most every
    250 ms.
  - `stats()` - `captures`, `thumbs`, `linePoints`, `shown`, `atlasPx`,
    `uploads`, `objects` (children of its group).
  - `dispose()` - frees geometry, materials and the texture, leaves the
    scene.
- `atlasLayout(count)` - the atlas's side (a power of two, at most
  `ATLAS_MAX_PX` = 2048) and its cells (up to 64 px, smaller for a walk of
  more than about a thousand captures).
- `atlasCell(layout, index, w, h)` - the largest rectangle of the
  picture's aspect in cell `index` (canvas pixels, top left) and its
  texture place (u, v of its bottom left and size; the texture is flipped).
- `THUMB_WIDTH_PX` (32, the map's), `ATLAS_MAX_PX`.

## Invariants and assumptions

- At most two objects whatever the walk's length: one instanced mesh
  (four vertices, one instance per capture, one draw) and one `Line2`.
- Each thumbnail is `THUMB_WIDTH_PX` CSS px wide on screen at any
  distance, its height by the picture's aspect: the vertex shader offsets
  the quad in clip space by the canvas's size (`resize`). A capture
  without its thumbnail is an 8 px white dot with a dark rim, as on the
  map.
- The thumbnails' quads are placed in the shader, so the mesh is never
  frustum-culled; depth-tested, so the ground and buildings in front hide
  them.
- The atlas is sized at `set` and its texture made anew; a thumbnail
  writes its cell and its instance's two attributes only, and the
  texture's upload waits for `frame` (one upload per 250 ms however many
  thumbnails came).
- The line is drawn only when asked: the tour's own walk is drawn by the
  arrival's marks (`globe-approach-marks.ts`), so the page asks for it
  for debug data added beside the tour only. Placed at the captures'
  heights lifted 5 cm, as the walk is (not draped on the ground).
- Colour: the atlas is an sRGB texture and the fragment shader ends in
  three's `colorspace_fragment`; not tone mapped.

## Examples

```ts
const debug = createGlobeDebugLayer(tourFrame);
debug.resize(canvas.clientWidth, canvas.clientHeight);
debug.set([{ image: "images/a.jpg", at: pointInTourFrame }], true);
debug.thumb("images/a.jpg", { source: img, width: 64, height: 48 });
// every frame:
debug.frame(performance.now());
```

## Tests

- `globe-debug-layer.test.ts` - the atlas's layout and cells, one mesh
  and one line under the frame, no line unless asked or for one capture,
  a thumbnail in its cell once at the map's width, the upload throttle,
  bad and repeated captures dropped, show and hide, geometry freed when
  replaced and everything on dispose, the size on screen.
- `globe-debug-layer.property.test.ts` - any walk length draws at most one
  mesh and one line and a clear leaves nothing; every capture's cell lies
  inside the atlas, apart from the others, at its picture's aspect.
- `editor3d-globe.spec.js` - a recording added as debug data over the
  globe view: two thumbnails and the line drawn, the atlas uploaded, View's
  switch hides and shows them, nothing pending.
