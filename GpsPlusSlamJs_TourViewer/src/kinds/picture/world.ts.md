# `kinds/picture/world.ts` - a picture's part in the world

## Purpose

Puts a framed print (`framed.ts`) or a cut-out (`cutout.ts`) behind the one
world door (`world-part.ts`), so the renderer (`content-placement.ts`) and
the 3D editor's stations layer draw it as any other kind's part. It is the
picture row's `world` in `play-kinds.ts`. In play a tap opens the
picture's sheet (`picture-sheet.ts`) on the page's screen.

## Public API

- `pictureWorld(block, env, deps?) -> WorldPart | null`
  - the views shown from a viewpoint are `viewpoint-world.ts`'s part
    (`viewpointWorld`); null for one without a viewpoint.
  - null for `plane` (the renderer draws it itself) and `card` (stands
    nothing).
  - `object` - a group the renderer places and turns at the block's pose;
    the look lands in it once the image is read and decoded, built at
    `PICTURE_REFERENCE_WIDTH_M` and scaled uniformly by
    `widthM / PICTURE_REFERENCE_WIDTH_M`, with the place-scale mark of
    `widthM` (`placement/place-scale.ts`).
  - `tapTarget` - the look's frame, print and plate, or the cut-out and
    its tag (never its shadow).
  - `tap()` - only in `play` with a page screen: opens the sheet, a framed
    print's with the picture (an object URL made inside the screen's
    build, revoked in its clean-up, so a pushed-aside sheet rebuilds
    cleanly), a cut-out's with its words only. A tap while it shows does
    nothing.
  - `update(frame)` - a cut-out fades for `frame.viewer` (below).
  - `ready` - rejects when the file cannot be read or the decode gives
    null (too large, not an image); the renderer then takes the part out.
  - `dispose()` - closes the sheet, frees the look (`disposeObject3D`,
    the picture's texture included). An image read after it is freed and
    never added.
- `PictureWorldDeps` - `decode` (default: the tour's capped decode,
  `decodeFrameTexture` at half size against `TOUR_MAX_IMAGE_PIXELS`, as a
  picture plane's, sRGB) and `painters` (default: canvas painters).

## Invariants and assumptions

- The image's aspect is the decoded texture's `height / width` (1 when it
  states none).
- A cut-out's tag follows `showTag`; absent means shown.
- The parts never move `object`; they read its pose (the cut-out's facing).

## Examples

```ts
const part = pictureWorld(block, env);
await part?.ready;
part?.tap?.(); // play: the sheet opens on env.screen
```

## Tests

- `world.test.ts` - the views it stands, the look's parts and their
  layout, uniform scale, the tag switch, the facing fade, the sheet per
  view and per mode, the rejected ready, dispose (also before load), and a
  property test of `cutoutFacingFade`.
- `placement/placement.contract.test.ts` - every picture view's row:
  posed, turning, and its drawing doubling with `widthM`.
