# kept-look.ts

## Purpose

What a finished stretch keeps of its last look at the model, in place of
the full-size picture (several MB at the trainer's photo size, held until
closed): a small picture for its tile, and an encoded copy at the loupe's
size that the loupe decodes only while it is open. The browser's resize
and encode come in as `LookTools`, so the sizes are testable without a
canvas.

## Public API

- `TILE_LOOK_PX` - 480, the tile picture's longer side (the tile canvas
  is 480 wide); `LOUPE_LOOK_PX` - 1200, the loupe copy's (the loupe
  canvas is 1200 wide).
- `KeptLook` - `{ small: CanvasImageSource, sharp: Blob | null }`.
- `LookTools` - `{ shrink(picture, w, h) -> Promise<CanvasImageSource>,
encode(picture, w, h) -> Promise<Blob> }`.
- `fitWithin(width, height, maxPx) -> { width, height } | null` - the
  size scaled to `maxPx` on the longer side, the aspect kept, each side at
  least 1 px; null when the picture is no larger already (never
  enlarged). RangeError for a size or limit that is not a positive finite
  number.
- `lookKeeper(tools) -> (picture) => Promise<KeptLook>`:
  - a picture of no readable size, or no larger than `TILE_LOOK_PX`, is
    kept as it is with `sharp: null`;
  - otherwise `small` is shrunk to `TILE_LOOK_PX` and `sharp` encoded at
    up to `LOUPE_LOOK_PX` (a look between the two sizes at its own size);
  - an encode that fails leaves `sharp` null; a shrink that fails
    rejects. `picture` itself is never closed here: the caller owns it.
- `browserLookTools` - the page's tools: `createImageBitmap` with
  `resizeWidth`/`resizeHeight` (`resizeQuality: "medium"`) for the small
  picture, an `OffscreenCanvas` drawn at the size and
  `convertToBlob({ type: "image/jpeg", quality: 0.9 })` for the copy
  (about 0.2 MB at 1200 x 900).
- `closePicture(picture)` - calls `close()` where the picture has one;
  anything else, or a close that throws, is left to the garbage
  collector.

## Invariants & assumptions

- The copies are made in parallel; the caller (`trainer-page-store.ts`)
  closes the full-size look once they are made, and closes a small
  picture made for a look that was replaced meanwhile.
- The loupe's copy is a Blob, not a picture: encoded it holds a fraction
  of the pixels' memory, and the page (`trainer-page.ts`) decodes it
  only while the loupe shows that stretch.

## Example

```ts
const keep = lookKeeper(browserLookTools);
const { small, sharp } = await keep(bigLook); // 480 px bitmap, 1200 px JPEG
```

## Tests

`kept-look.test.ts`: the fitted sizes (landscape, portrait, a sliver), a
picture left alone, the refusals; the keeper's two sizes, a look between
them encoded at its own size, a small or sizeless look kept as it is, an
encode failure keeping the small picture, a shrink failure rejecting
without closing the look; the browser tools' width and height (with
stubbed `createImageBitmap` and `OffscreenCanvas`); `closePicture`.
`kept-look.property.test.ts`: over any size and limit, the result stays
within the limit, never enlarges, and keeps the aspect to within a pixel.
