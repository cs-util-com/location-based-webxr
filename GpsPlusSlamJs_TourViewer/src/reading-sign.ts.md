# reading-sign.ts

## Purpose

A long text in the `reading` view (format minor 4) stands in the world as a
reading sign: a 2.5 m plate on a stem with an amber ring on the ground. The
plate shows the over-line `READ  ·  N MIN`, the text's title (a serif, at
most two lines) and the hint "Tap to open the text", and it turns toward
the viewer about the upright axis. A tap on a shown sign opens the whole
text in the reading sheet (`long-text-sheet.ts`). The look is the
prototype's (`public/prototypes/station-blocks-1-narrated-text/`).

## Public API

- `READING_SIGN`, `READING_SIGN_HEIGHT_M` - the canvas (1024 x 420) and the
  plate's size; the plate's height follows the canvas's aspect.
- `readingSignOverLine(minutes)` - `READ  ·  N MIN`.
- `READING_SIGN_HINT` - "Tap to open the text".
- `SignContext` - the part of `CanvasRenderingContext2D` the drawing uses.
- `drawReadingSign(g, { title, minutes })` - draws the plate's face. A blank
  title reads "Untitled"; a long one wraps to two lines within 760 px and
  the rest is dropped.
- `turnToward(plate, viewerLocal)` - sets the plate's yaw so its face
  (local +z) points at a viewer given in the plate's parent frame; pitch
  and roll stay 0.
- `buildReadingSign(map)` - `{ root ("reading-sign"), plate
("reading-sign-plate"), dispose }`. The plate's `onBeforeRender` turns it
  toward the camera, in the parent's frame, in the same frame.
- `mountReadingSign(block)` - draws the canvas texture (sRGB), builds the
  sign, registers its handle and returns `{ object, dispose }` for
  `content-placement.ts`'s `makeReadingSign`. The minutes come from
  `readMinutes(wordCount(body))` in `long-text-sheet.ts`.
- `readingSignUnderTap(handles, pick, tap)` - the handle whose plate the
  pick names, or `null`.
- `shownReadingSignUnderTap(scene, pick, tap, handles?)` - the same over the
  signs shown in the scene only (`shownIn` of `model-visitor.ts`); `null`
  without a scene.
- `readingSheetContent(stations, block)` - `{ over, title, body }` for the
  sheet: `over` is "Title · Station N", "Station N" for an untitled
  station, or "" when no station holds the block.

## Invariants and assumptions

- The sign's root carries the pose; only the plate turns. The stem reaches
  from the ground to the plate's lower edge, the plate's centre is 2.05 m
  up.
- A hidden station's sign is never offered to the pick, so a tap cannot
  open a text the visitor cannot see.
- `dispose` releases the geometry, material and texture and removes the
  handle from the registry.
- `mountReadingSign` throws without a 2D canvas context (a page without a
  DOM); its callers pass it only in a browser, and the tests build the
  sign with `buildReadingSign(null)` instead.

## Example

```ts
const stand = mountReadingSign({ id: "hall", title: "The hall", body });
stationGroup.add(stand.object);
// on a tap:
const sign = shownReadingSignUnderTap(scene, pick, tap);
if (sign) sheet.show(readingSheetContent(stations, sign.block));
```

## Tests

- `reading-sign.test.ts` - the drawing's words and positions, the wrap and
  "Untitled", the geometry, the facing from four sides and in the parent's
  frame through `onBeforeRender`, the shown-only pick, and
  `readingSheetContent`.
- `reading-sign.property.test.ts` - the plate faces any viewer; any title
  draws at most two lines within 760 px.
- `content-placement.test.ts`, `editor3d/editor3d-stations.test.ts` and
  `visitor-stations.test.ts` cover the sign's placement, the editor's pick
  and the tap order.
