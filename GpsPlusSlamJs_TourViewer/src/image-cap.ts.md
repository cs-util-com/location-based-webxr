# image-cap.ts

## Purpose

The tour pixel cap for a picture the browser decodes itself, in an `<img>`
(tour kit K4 review R2,
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`
§14): the size is read from the picture's header first, and one over
`TOUR_MAX_IMAGE_PIXELS` (4096 x 4096, the framework's `ar/tour-media`), or
one whose size cannot be read, is not shown.

## Public API

- `pictureProblem(blob): Promise<string | null>` - why the picture may not
  be shown, in plain words ("it is W x H pixels, more than a phone can
  safely decode", "its size could not be read from its file"), or null.

## Invariants & assumptions

- Reads only the Blob's first bytes (`imageInfoOfBlob`, 1 MiB); never
  decodes. Never throws.
- One cap for every decode path of a tour image: the story panel's picture
  (`scene-view.ts` via `visitor-stations.ts`) and the archive gallery
  (`archive-open.ts`) ask here; a figure (`station-prefetch.ts`
  `decodeFigure`), the photo planes and the ring (`decodeFrameTexture`'s
  `maxPixels`) and a model's textures (`checkGlbInert`) hold the same cap
  on their own paths.

## Examples

```ts
const problem = await pictureProblem(blob);
if (problem !== null)
  status.textContent = "The picture is too large to show here.";
```

## Tests

`image-cap.test.ts` - a 12 MP picture passes; a 48 MP one and an
unmeasurable one are named.
