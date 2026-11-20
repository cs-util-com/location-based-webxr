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
- `drawReadingSign(g, { title, minutes, voice? })` - draws the plate's
  face. A blank title reads "Untitled"; a long one wraps to two lines
  within 760 px and the rest is dropped. With `voice` (a narrated
  text) a chip at the bottom right names the voice's state in
  `READING_SIGN_VOICE_WORDS` (the prototype's words, its `#f9a8d4`).
- `ReadingSignVoice` - "idle" | "playing" | "paused" | "ended".
- `turnToward(plate, viewerLocal)` - sets the plate's yaw so its face
  (local +z) points at a viewer given in the plate's parent frame; pitch
  and roll stay 0.
- `buildReadingSign(map)` - `ReadingSignParts`: the tree is `root`
  ("reading-sign", the renderer's pose and scale) > `grow`
  ("reading-sign-grow", the growth while words hang under the sign) >
  the stem, the ring and `turn` ("reading-sign-turn") > the sign
  `plate` ("reading-sign-plate") and the `words` plate
  ("reading-sign-words") as siblings. Either plate's `onBeforeRender`
  turns `turn` toward the camera, in `grow`'s frame, in the same
  frame.
  - `attachWords(texture, { widthM, heightM })` hangs the words plate
    (a unit plane scaled to the size) centred under the sign, its top
    `TRAVEL_PLATE.gapM` under the sign's lower edge and
    `TRAVEL_PLATE.frontM` in front of it; throws a RangeError on a size
    that is not positive. `detachWords()` takes it off.
  - `update({ viewer, growth? })` - while words hang, sets `grow` to
    `growth` when given (the caller's knob: 1 grows nothing), else to
    `signGrowth` of the horizontal distance in the root's parent frame
    (so a scaled folder is accounted for); a growth that is not a
    positive finite number grows nothing. Turns `turn` toward the
    viewer either way.
  - `dispose()`.
- `mountReadingSign(block, open?)` - draws the canvas texture
  (`world-part.ts` `canvasTexture`, sRGB), builds the sign, mounts it in the
  one world-part set and returns a `ReadingSignHandle` (a `WorldPart`:
  `block`, `object`, `tapTarget` = the plate, `wordsPlate`,
  `update`, `attachWords`, `detachWords`, `setVoiceState`, `dispose`) for
  `content-placement.ts`'s `makeReadingSign`. With `open` (the visitor's
  reading sheet, `viewer-placement.ts` `openReading`) its `tap()` opens
  the block's text; without it the sign takes no tap (the 3D editor's).
  The minutes come from `readMinutes(wordCount(body))` in
  `long-text-sheet.ts`.
- `mountedReadingSign(blockId, parts = mountedWorldParts())` - the
  mounted sign standing for the text `blockId`, or null: `main.ts`
  finds a narrated text's sign by it to start its words' travel and set
  its voice chip (`captions-follow.ts`). Only a part `mountReadingSign`
  made counts (a module `WeakSet`), whatever another part's fields.
- `readingSheetContent(stations, block)` - `{ over, title, body }` for the
  sheet: `over` is "Title · Station N", "Station N" for an untitled
  station, or "" when no station holds the block.

## Invariants and assumptions

- The sign's root carries the pose; only `turn` turns, and only `grow`
  grows (never while no words hang, so the editor's sign never grows).
- The words plate never takes a tap: its raycast is a no-op, and a tap
  through it reaches nothing (it is not the tap target nor its child).
- `setVoiceState` repaints the face only when the state changes, so a
  frame loop may call it every frame. The stem reaches
  from the ground to the plate's lower edge, the plate's centre is 2.05 m
  up.
- A hidden station's sign is never offered to the pick
  (`tapShownWorldPart`), so a tap cannot open a text the visitor cannot
  see.
- `dispose` releases the geometry, material and texture and removes the
  handle from the world-part set.
- `mountReadingSign` throws without a 2D canvas context (a page without a
  DOM); its callers pass it only in a browser, and the tests build the
  sign with `buildReadingSign(null)` instead.

## Example

```ts
const stand = mountReadingSign({ id: "hall", title: "The hall", body }, (b) =>
  sheet.show(readingSheetContent(stations, b)),
);
stationGroup.add(stand.object);
// on a tap (main.ts): tapShownWorldPart(scene, pick, tap) calls stand.tap()
```

## Tests

- `reading-sign.test.ts` - the drawing's words and positions, the wrap and
  "Untitled", the geometry, the facing from four sides and in the parent's
  frame through `onBeforeRender`, `mountReadingSign` as a world part (the
  plate takes the tap and opens the text, none without an opener, mounted
  until disposed; found by its text's id only while mounted),
  `readingSheetContent`, the voice chip, the words
  plate (its place in the tree, its turning, the growth only while
  attached, on top of a folder's scale, the tap target's centre kept),
  a tap through the words plate opening nothing, and the chip repainted
  only on a change.
- `reading-sign.property.test.ts` - the plate faces any viewer; any title
  draws at most two lines within 760 px; the words plate keeps the box's
  aspect.
- `content-placement.test.ts`, `editor3d/editor3d-stations.test.ts` and
  `visitor-stations.test.ts` cover the sign's placement, the editor's pick
  and the tap order.
