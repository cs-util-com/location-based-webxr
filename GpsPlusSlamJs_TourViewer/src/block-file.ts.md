# block-file.ts

## Purpose

An item's file: which kind of file a block is made from, its file's asset
id, and the block with another file in its place. The one place that
knows each kind's file field, so the inspector's file field, a file
dropped on it and the session's `setItemFile` (with the document's
`storyFile` station edit) agree.

## Public API

- `blockFileKind(block)` -> `TourAssetKind | null`: `image` for a picture,
  `audio`, `video`, `model`; null for a block made of words.
- `blockFileId(block)` -> the asset id in that field, or null.
- `withBlockFile(block, assetId, posterId?)` -> the block with `assetId`
  in its file field, everything else kept; a video's `poster` becomes
  `posterId`, or is removed when none is given (the old poster showed the
  old clip). Null for a block made of words.

## Invariants & assumptions

- Pure, no I/O. The fields per kind: picture `image`, audio `audio`, video
  `video`, model `asset` (the format's own field names).
- A kind is looked up with `Object.hasOwn`, so an inherited key
  (`toString`) is no kind.
- It checks no asset: the caller (`tour-document.ts` `withStoryFile`, the
  session) checks the asset is one the tour lists, of the right kind.
- A free picture also carries an inline `imageAsset` record; the session
  sets it, since that record is not a field of a story block.

## Examples

```ts
withBlockFile({ kind: "video", video: "v1", poster: "p1" }, "v2");
// { kind: "video", video: "v2" }
```

## Tests

`block-file.test.ts`; through the session in
`editor/editor-session-add-file.test.ts` ("replacing an item's file").
