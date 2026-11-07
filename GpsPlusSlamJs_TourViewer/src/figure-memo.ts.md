# figure-memo.ts

## Purpose

Remembers the die-cut figures painted so far, by the file they came from, so a figure coming back, or a second figure of the same file, stands from the first painting. Every `scene-stage.ts` of the visitor's stations shares one.

## Public API

- `createFigureMemo(limit = 12): FigureMemo`
  - `get(image, sheet)` - the poses of `image` read as a frames sheet or as one pose, or null. A hit counts as a use.
  - `set(image, sheet, poses)` - keeps a painting. What was used longest ago goes to make room; a painting larger than the whole bound is not kept.
  - `clear()` - the tour or the session is over.
- The bound, by default 12: twelve single poses or three frames sheets.

## Invariants and assumptions

- The key is the `Blob` object, not its bytes: the same file comes back as the same object while `station-prefetch.ts` holds it. Another object is a miss and costs one painting, never a wrong figure.
- One entry per file: a file is read as a sheet or as one pose, so reading it the other way replaces the entry.
- The bound counts poses, because each pose keeps two canvases: about 5 MB for a 1:2 figure at the 1024 px height cap, about 9 MB for a square one. The bound holds about 60 MB of plain figures.
- A station with more poses than the bound repaints on every return. That is the value that would reverse the choice of 12: raise it if a real tour stands more than three frames sheets in one station.
- The canvases are shared and never changed: each look makes its own textures from them, and disposing a look leaves them alone.

## Why it exists

Measured 2026-11-07 in headless Chromium on the development machine (software canvas), one figure of 512x1024 px: 220 ms of main-thread paint unthrottled, 1580 ms at 4x CPU throttling, 2436 ms at 6x. Uploading its two canvases afterwards took 3 ms, 23 ms and 32 ms. A hitch over 50 ms counts here, so the paint is the cost and the upload is not. A real phone rasterises a canvas on its GPU, so these numbers are a proxy, not a phone measurement.

With the poses shared, building one look took 3 ms unthrottled and 16 ms at 4x once the paper stage became lazy (`character-look.ts`), and six in one task 115 ms at 4x, which is why `free-items.ts` stands one per tick. A figure's first arrival still paints once.

## Examples

```ts
const figures = createFigureMemo();
const stage = createSceneStage({ ...deps, figures });
```

## Tests

`figure-memo.test.ts` covers a hit, a sheet against one pose, the order of leaving, the oversized painting and `clear`. `figure-memo.property.test.ts` holds the bound through any order. `scene-stage.test.ts` "a figure painted before" covers the stage's use.
