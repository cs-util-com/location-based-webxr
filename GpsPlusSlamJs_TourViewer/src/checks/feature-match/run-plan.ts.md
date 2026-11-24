# run-plan.ts

## Purpose

The photo test run as plain data, shared by every view of the feature matching check (the guided view and the cockpit): one record per shot of the run (its photo and take), the run's size and position, and the capture settings. The scenes, shots and derived pairs come from `scenes.ts`; `planReducer` holds the rules; `feature-match-slice.ts` wraps each action, and `feature-match-store.ts` persists the plan and mirrors its photos.

## Public API

- Types:
  - `PhotoMeta`: a taken photo's id, size, camera size, grey mean (0-255) and grey standard deviation `greySd` (0-255, the contrast; optional, so a plan stored before it was recorded is still read and its photos kept, where a required field would drop them and the next sweep delete their PNGs) and the optional `camera` report (`camera-report.ts`; a photo or stored plan whose report has unknown fields or wrong types keeps the photo and only the known fields, through `knownCameraReport`; a report with nothing known left, an empty one included, is stored as absent); its PNG is in the browser's database under `photo:<id>` (and in the store's `photos` table until stored), its preview in `previews`.
  - `PlanSettings`: `capture` (`"auto"`: the cockpit's hands-off shots take themselves; `"tap"`), `countdown` (0, 3 or 5 s), `sound`.
  - `RunPlan`: `{ spots, extra, current, shots, skipped, settings }`. `shots` maps a shot id to `{ photo, take }` (`take` is 1 for the first photo, raised by each retake); a shot without a record has no photo. `skipped` lists the shots the tester left for now ("Skip photo", "Skip scene"), each a listed shot without a photo, named once.
  - `PlanAction`: the actions below.
- `planReducer(plan, action)` returns the new plan; a refused action returns the very same `plan`.
  - `size {spots, extra}`: clamped by `shotList`; refused when nothing changes or when it would drop a shot holding a photo; `current` stays inside the list.
  - `move {index}`: a listed index other than the current one, or the current one while it is skipped; a move to a skipped shot ends its skip.
  - `skip {shots}`: the listed open shots named (no photo, not skipped yet) join `skipped`; refused when none does. When the current shot is among them, `current` moves to the next open shot (`planNextOpen`), staying when none is open. A skip of the current shot while it is skipped already moves to the next open shot, or is refused when none is open.
  - `photo {shot, photo}`: a listed shot and a valid photo; a new take of that shot. For an accepted photo of shot `index`: when `index` is `current`, `current` becomes `index` again if its light check fails (`needsRetake`), else `planNextOpen(plan, index) ?? index` (the next open shot, neither taken nor skipped, wrapping to the first, staying when none is open); a photo of a skipped shot ends its skip; a photo of any other shot leaves `current` unchanged. The take is the previous take plus 1. A failed check of L3 or L4 against an almost black L1 (`too-dark-a`) also stays current: the views lead back to L1 from there (`guided-model.ts`, `fixAt`).
  - `lost {shot}`: a photo the browser no longer holds (after a reload) is dropped.
  - `settings {settings}`: known values only; one unknown value refuses the whole change, as does a change to the same values.
  - `reset`: Start over: back to `EMPTY_PLAN`, the settings kept.
- `planNextOpen(plan, from = current)`: the next open shot after `from` (no photo, not skipped), else the first one before it; null when no other shot is open. The guided view's walk and the slice's "last shot closed" rule read it.
- `planShots(plan)`: the shots in run order. `planPhotos(plan)`: the photos by shot id, as the `scenes.ts` rules read them. `planPhotoIds(plan)`: every photo id, for the side tables. `planRetakes(plan)`: the takes past the first, summed over the shots (a lost photo is not a retake: its record is gone and the next photo is take 1).
- `planText(plan)` / `parsePlan(text)`: versioned JSON (version 2). `parsePlan` returns undefined for missing, damaged or foreign text and for any other version (no migration); a bad record or setting is dropped alone, as is a skipped id that is unknown, taken or repeated; `current` outside the list reads as 0.
- `isOldPlan(text)`: the text is a plan of the earlier pair-slot version (version 1), which is not read; the store drops it and says so.
- `EMPTY_PLAN`, `DEFAULT_SETTINGS` (`capture: "auto"`, `countdown: 3`, `sound: true`).

## Invariants and assumptions

- Every record and every skipped id belongs to a shot of `shotList(spots, extra)`; a skipped shot has no photo; `current` is inside the list.
- `take` is at least 1 and rises by one per photo of that shot.
- Plain, serializable data only; pixels are a side table keyed by the ids held here.
- **Photos across reloads:** the plan is stored in `localStorage` and its photos in IndexedDB, keyed by photo id (`feature-match-store.ts`). A run of 13 or more photos takes long enough that a discarded tab is likely; losing it would cost the tester the whole run.

## Example

```ts
let plan = planReducer(EMPTY_PLAN, {
  type: "photo",
  shot: "light-s1/L1",
  photo,
});
planShots(plan)[plan.current]?.id; // "light-s1/L2"
```

## Tests

- `run-plan.test.ts`: the plan by shots (the auto-move, a failed light check staying, photos of other shots, the wrap to an open shot, retakes and takes, refusals, lost photos, resizing and moving, settings, reset), the skipped shots (one, a scene, refusals, un-skipped by a move or a photo, staying put when nothing else is open, stored and read back) and across reloads (round trip, bad text, the old version, bad records dropped alone), and retakes counted from the takes, a lost photo not counted.
- `run-plan.property.test.ts`: for any action sequence, `current` and every record stay inside the list and the text reads back unchanged; and the walk: every photo action either is refused (an unknown shot or an invalid photo, the very same plan returned) or raises the take by one and sets `current` by the photo rule above.
