# add-file-item.ts

## Purpose

The add of a picture, a sound, a video or a 3D model from a file, as one
flow the page (`edit-main.ts` `addFromFile`) wires to its session: the
tree's add menu, the Ctrl+K palette and a dropped file all go through it.

## Public API

- `FileAddTarget` - `{ kind: "station", stationId }` (the station's free
  spot) or `{ kind: "story", storyId }` (the story's end).
- `FileAddDeps` - what the page lends: `pick(kind)` (the file picker, null
  when cancelled), `busy(fileName)` (starts the in-progress state, returns
  its end), `addFile(file, name, kinds)` (the session's, which puts the
  file on the asset shelf), `place(target, source)` (one step).
- `FileAddOutcome` - `cancelled`, `added { id, fileName, backedUp }`, or
  `refused { reason }`.
- `addFileItem(kind, target, deps, file?)` -> `Promise<FileAddOutcome>`:
  `file` when given (a drop), else the one picked; never rejects.
- `placeFileItem({ target, source, stations, id, nowIso, groundAt, place,
addEntryToStory })` - makes the item (`new-file-item.ts`) and places
  it: through `place` (the tour's own checks) at a station, through
  `addEntryToStory` in a story (the entry at the free spot of the
  story's station, at the story's end or, with the target's `at`, before
  its child there; a story gone meanwhile is refused with
  `FILE_STORY_GONE`).
- `FILE_ADD_FAILED` ("That file could not be added."), `FILE_STATION_GONE`
  ("That station is no longer in this tour - nothing was added."),
  `FILE_STORY_GONE` ("That story is no longer in this tour - nothing was
  added.").
- `FILE_NOT_KEPT`: said when a file brought in is in the tour but this
  browser could not keep a copy of it (a reload before a save would lose
  it); the page and the shelf's page actions say it.

## Invariants & assumptions

- A cancelled picker adds nothing and shows nothing (`busy` is not
  called).
- `busy`'s end runs exactly once on every outcome after a file is chosen,
  a throw included.
- The file is taken only as the kind's own asset kind (`KIND_EDIT[kind].add.file`):
  a sound picked for a model is refused by `addFile` in words.
- The file itself takes no undo step (`addFile` does not), so the add is
  one step: undoing it removes the item, and the file stays on the shelf
  until the shelf drops it.
- A video at a station is refused with its row's `storyOnly` words, and
  nothing is placed.

## Examples

```ts
const outcome = await addFileItem(
  "audio",
  { kind: "station", stationId },
  deps,
);
if (outcome.kind === "refused") toast(outcome.reason);
```

## Tests

`add-file-item.test.ts` (each outcome, the busy state ended on each, a
dropped file and a poster, throws at every step; `placeFileItem` at a
station, in a story, a gone story, a gone station, a video at a station, the tour's
refusal) and `editor-session-add-file.test.ts` (a real session: one undo
step, the file on the shelf while it runs, the file resolving before and
after the smaller one replaced it, a save, a refusal leaving the revision
unchanged).
