# new-file-item.ts

## Purpose

What a picture, a sound, a video or a 3D model starts as when it is added
from a file (`add-file-item.ts`): at a station's free spot, or as a story's
entry. It holds the starting sizes and the name taken from the file, so a
kind made from a file never needs a gesture to be valid.

## Public API

- `NEW_PICTURE_WIDTH_M` = 1 - a new picture's width, the same as a picture
  taken on site (`content-placement.ts`, its width for a captured picture).
- `NEW_MODEL_SIZE_M` = 2 - a new model's size, the stand-in size the
  model views check uses (`checks/model-views-check.ts`), so a new model
  reads at the size its placeholder already showed.
- `NEW_SOUND_RADIUS_M` = `NARRATION_DEFAULT_RADIUS_M` (6, `kinds/audio/sound-reach.ts`)
  - a new sound's narration circle, the same radius an item moved to the
    floor starts with.
- `FileItemSource` - `{ kind: FileAddKind, asset, fileName, poster? }`: the
  file brought in (`editor-session` `addFile`) and, for a video, its
  poster frame.
- `fileItemTitle(fileName, kind)` -> the item's title: the file name
  without its extension, runs of spaces, dashes and underscores made one
  space, cut to the kind's title cap (`TOUR_BLOCK_TEXT_RULES`, counted in
  code points, never inside one), the kind's add label when nothing is
  left ("Sound", "Video").
- `newFileItem(input, source)` -> `TourObject | null`: at the station's
  free spot (`new-pin.ts` `freeGeo`), in the first view the format's kind
  table lets a free block hold (`TOUR_KINDS[kind].freeViews`): a picture
  as a plane with its image inline (`imageAsset`), a sound as a narration
  circle (`spot`), a model placed at its size; `null` for a video (no
  free host draws one; the caller refuses with the kind's `storyOnly`
  words).
- `newFileStoryEntry(station, source, id)` -> `TourStoryBlock`: the shape
  every new entry starts in (`new-pin.ts` `storyEntryShell`: a card that
  moves on by a tap, at the station's free spot, never the anchor's own
  point), titled from the file, with its kind's file field (a video with
  its poster when it has one).

## Invariants & assumptions

- Every item it makes is a record the format reads back unchanged
  (`parseTourObject(tourObjectRecord(item))`), and stands inside its
  station's found radius.
- The sound's object is built as a `spot` audio; the format's object
  type still names a free audio's views by its card, so it is cast once,
  with a comment.
- Pure: no DOM, no clock (the caller passes `nowIso`), no ids made here.

## Examples

```ts
fileItemTitle("church_bells-1890.wav", "audio"); // "church bells 1890"
newFileItem(
  { station, id, nowIso, groundAt },
  { kind: "model", asset, fileName: "ferry.glb" },
);
// { kind: "model", view: "placed", asset: asset.id, sizeM: 2, ... }
```

## Tests

`new-file-item.test.ts`: titles (separators, empty names, a property that
every title passes its kind's rule), each kind's starting fields, no free
video, a format round trip per kind, and a sweep over station radii (3 to
60 m) and fills (0 to 12 items) that the item stands inside the circle;
story entries per kind at the station's free spot in the shape a
words' entry has, with and without a poster; each free kind in the
format's first free view.
`editor-session-add-file.test.ts` runs it inside a real session.
