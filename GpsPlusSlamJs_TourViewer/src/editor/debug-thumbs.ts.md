# debug-thumbs.ts

## Purpose

The debug layer's decoded thumbnails, keyed by their capture's picture
entry name: the side table beside the store's `debugLayer` slice
(`debug-layer-slice.ts`), which holds the names and places but never a
decoded picture (a blob URL is an imperative resource, not app state).

## Public API

- `createDebugThumbs(free = revokeDebugThumbnail): DebugThumbs`
  - `set(image, picture)` - keep the `<img>` of capture `image`; an empty
    name is ignored; one it replaces is freed.
  - `get(image)` - the thumbnail, or undefined.
  - `clear()` - free and forget them all.
  - `version()` - a number that changes with every `set` and every
    `clear` of a non-empty table.
  - `size` - how many are kept.
- `DebugThumbsRead` - `get` and `version`, what a view reads (the 3D
  view's `Editor3dDeps.debugThumbs`).

## Invariants and assumptions

- Owns its thumbnails: each one it drops (a clear, a replacement) is
  freed (`free`, the page's `revokeDebugThumbnail`), so no blob URL
  outlives its tour; one the layer decoded after a stop never reaches the
  table and is freed by the layer's `discard`.
- The page clears it whenever the layer draws anew or clears
  (`edit-main.ts`), so it never outlives its captures.
- A view polls `version()` once a frame; nothing subscribes.

## Examples

```ts
const thumbs = createDebugThumbs();
thumbs.set("images/frame-1.jpg", img);
if (thumbs.version() !== seen) redrawMissing(thumbs);
```

## Tests

- `debug-thumbs.test.ts` - kept by name, version changes on set and on
  clear (not on an empty clear), a nameless thumbnail ignored, every
  dropped thumbnail freed once.
