# debug-capture-layer.ts

## Purpose

The desktop editor's debug layer (M1 of the debug-captures plan): the
walk's camera captures - the frames a recording captured by itself -
placed by the capture-time join (`debug-captures.ts`) once the tour has
opened, and drawn on the map as small thumbnails behind a "Show debug
data" switch. They are debug data, never the tour's content: this module
reaches only its view and its status line, never the tour document, a
save or the draft. The phone has no such layer
(`config/.dependency-cruiser.cjs`, `debug-captures-editor-only`).

## Public API

- `createDebugCaptureLayer<T>(deps): DebugLayer` - the controller, pure of
  the DOM; `T` is the view's picture (an element in the page).
  - `deps.read({ shouldContinue })` - the join over the open tour
    (`debugCapturesOf`); `shouldContinue` turns false once stopped.
  - `deps.loadPicture(image)` - a capture's picture by its entry name.
  - `deps.pictureProblem(blob)` - the tour's pixel cap (`image-cap.ts`).
  - `deps.thumbnail(blob)` - the downscaled decode
    (`decodeDebugThumbnail`).
  - `deps.view` - `draw(captures)`, `thumb(image, picture)`,
    `visible(on)`, `clear()` (the editor map's `debug*` methods).
  - `deps.status(line)` - the layer's status line.
  - `DebugLayer.start()` - says `DEBUG_READING_LINE`, reads, then draws
    one marker per capture, applies the switch, says `debugShownLine(n)`,
    and decodes a thumbnail per capture, one at a time, in capture order.
    A decline says `debugDeclinedLine(reason)`; a read that throws says
    `debugDeclinedLine("the recording could not be read (<message>)")`.
    Settles when done or stopped; never rejects.
  - `DebugLayer.setVisible(on)` - the switch (also before the draw).
  - `DebugLayer.stop()` - the tour closed: the replay stops, no further
    picture is read or decoded, nothing more lands in the view, and its
    markers are removed. Idempotent.
- `DEBUG_READING_LINE` ("Reading the debug data..."), `debugDeclinedLine`
  ("No debug data shown: <reason>."), `debugShownLine` ("Debug data: N
  camera captures on the map.").
- A thumbnail is 32 CSS pixels wide (`DEBUG_THUMB_WIDTH_PX`, module-internal).
- `decodeDebugThumbnail(blob): Promise<HTMLImageElement>` - the browser's
  downscaled decode (`createImageBitmap` with `resizeWidth`, twice the
  width on a high-density screen), drawn once into a scratch canvas,
  re-encoded as a small JPEG and shown as a decorative `<img>` (`alt=""`)
  from a blob URL; the bitmap and the canvas are freed at once. Rejects
  when the decode or the encode fails.
- `revokeDebugThumbnail(picture)` - frees a thumbnail's blob URL (the
  editor map calls it for every thumbnail it drops or replaces).
- Types: `DebugLayer`, `DebugLayerDeps` (its `view` is the module-internal
  `DebugLayerView`).

## Invariants & assumptions

- **Never the tour's content.** No store, no save, no draft: the layer is
  view state, and toggling it leaves nothing pending.
- **Out of reach**: the editor map puts its markers in a pane of their
  own below the tour's markers, with `interactive: false` and
  `keyboard: false` (no tabindex, no `leaflet-interactive`), no tooltip,
  and `pointer-events: none` on the pane and the marker.
- **One decode at a time**, so a walk of a thousand frames never holds
  more than one full-size picture decoded at once; each thumbnail keeps
  only a small image (about 32 x 75 CSS pixels).
- **Images, not canvases, on the map** (measured in the layer-cost
  results, M1 of the debug-captures plan, headless Chromium on a desktop):
  with 1035 thumbnails a pan frame took 133-150 ms at the median as
  canvases against 50 ms as images (33 ms with plain dots, 17 ms empty).
- **Measured before decoded**: a picture over the tour's pixel cap, or
  one whose size cannot be read, keeps a plain marker (a dot); so does
  one whose read or decode fails - one frame lost, never the layer.
- **The page's words never say "photo"** for these: "debug camera
  captures", "debug data".
- **After the open**: the page starts it only once the tour is on screen,
  for a file that carries a walk, so the replay never holds up the open.

## Examples

```ts
const layer = createDebugCaptureLayer<HTMLElement>({
  read: (options) => debugCapturesOf(session, options),
  loadPicture: (image) => session.loadEntry(image),
  pictureProblem,
  thumbnail: decodeDebugThumbnail,
  view: {
    draw: map.debugDraw,
    thumb: map.debugThumb,
    visible: map.debugVisible,
    clear: map.debugClear,
  },
  status: (line) => (statusEl.textContent = line),
});
void layer.start();
// later: layer.setVisible(false); layer.stop();
```

## Tests

`debug-capture-layer.test.ts`: the lines in order (reading, drawn, shown,
a thumbnail each) with at most one decode in flight; a decline and a
throwing read ending in a decline line with nothing drawn; a picture over
the cap and an unreadable one never decoded, their markers kept; a failing
decode kept to its frame; a stop while reading (the replay told to stop,
nothing drawn) and while decoding (no further decode, nothing lands); the
switch before and after the draw; a property over any mix of readable,
over-cap, unreadable and undecodable pictures (one marker each, a
thumbnail for exactly the readable ones, in order); the lines never
saying "photo". The page's use: `playwright-tests/editor.spec.js` ("shows
a walk's camera captures as debug data ...", "says why a walk shows no
debug data ...").
