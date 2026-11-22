# flat-progress.ts

## Purpose

The progress of the flat target capture as a pure reducer: which surfaces were started, their class, the accepted reference taps, every photo's pose, shot number, light bin and whether it was downloaded. Kept across reloads as JSON in `localStorage` by `flat-capture.ts`; the photos themselves stay in the page's memory.

## Public API

- `SURFACES_PER_CLASS` (5, 15 in all) and `DIM_BINS_PER_POSE` (2): a pose is complete with its full-light shot and photos in at least two darker bins.
- Types `ReferenceTaps`, `ShotRecord`, `SurfaceProgress`, `FlatProgress`, `EMPTY_PROGRESS`, `FlatAction`.
- `flatReducer(progress, action)`:
  - `add-surface { cls, original }`: id = count + 1, selected at once.
  - `select { id | null }`: null is the overview; an unknown id changes nothing.
  - `set-reference { id, reference }`: refused once the surface has shots (a new reference would not match them).
  - `add-shot { id, pose, greyMean }`: the first shot of a pose is its full-light shot (b1, ratio 1) and is ignored when below `LIGHT_FLOOR_A`; later shots get `lumaRatio` against it and their bin. Ignored before the reference exists. Shot numbers count up per pose and are never reused.
  - `remove-last-shot { id, pose }`: only an unsaved shot.
  - `saved { id }`: the reference and every shot marked downloaded.
- `usableFullLight(mean)`.
- `afterReload(progress)`: drops unsaved shots and an unsaved reference (their photos were in memory).
- `poseSummary`, `surfaceSummary` (poses complete, photos, captures not yet downloaded, reference included), `classSummary` (started and complete against the target per class).
- `flatProgressText(p)` and `parseFlatProgress(text)`: the stored form; any unreadable part gives `EMPTY_PROGRESS`, never a throw.

## Invariants and assumptions

- Actions on an unknown surface return the same object.
- A surface's shots exist only after its reference; a pose's first shot is always its only full-light shot.
- The parser checks every field (ids in order, known classes, poses and bins, finite numbers, four corners), so a hand-edited or old value cannot put the page in a state the reducer would never produce.

## Example

```ts
let p = flatReducer(EMPTY_PROGRESS, {
  type: "add-surface",
  cls: "busy",
  original: false,
});
p = flatReducer(p, { type: "set-reference", id: 1, reference });
p = flatReducer(p, { type: "add-shot", id: 1, pose: "w40-t0", greyMean: 120 });
surfaceSummary(p.surfaces[0]!).unsaved; // 2
```

## Tests

`flat-progress.test.ts`: surface numbering and selection, the full-light shot and the bins of later ones, a too-dark full-light shot, shots before the reference and unknown surfaces, removing only unsaved shots, a reference refused once shots exist, reload semantics, pose and class summaries, damaged stored text, and a property test over random action sequences (full-light shot first per pose, no shot before the reference, a round trip through the stored text).
