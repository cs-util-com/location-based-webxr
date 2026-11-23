# run-plan.ts

## Purpose

The photo test run as plain data, shared by every view of the feature matching check (the guided view and the cockpit): one record per shot of the run (its photo and take), the run's size and position, and the capture settings. The scenes, shots and derived pairs come from `scenes.ts`; `planReducer` holds the rules; `feature-match-slice.ts` wraps each action, and `feature-match-store.ts` persists the plan and mirrors its photos.

## Public API

- Types:
  - `PhotoMeta`: a taken photo's id, size, camera size and grey mean (0-255); its pixels are in the store's `frames` table under the id.
  - `PlanSettings`: `capture` (`"auto"`: the cockpit's hands-off shots take themselves; `"tap"`), `countdown` (0, 3 or 5 s), `sound`.
  - `RunPlan`: `{ spots, extra, current, shots, settings, shotsTaken }`. `shots` maps a shot id to `{ photo, take }` (`take` is 1 for the first photo, raised by each retake); a shot without a record has no photo. `shotsTaken` counts every photo, retakes included.
  - `PlanAction`: the actions below.
- `planReducer(plan, action)` returns the new plan; a refused action returns the very same `plan`.
  - `size {spots, extra}`: clamped by `shotList`; refused when nothing changes or when it would drop a shot holding a photo; `current` stays inside the list.
  - `move {index}`: a listed index other than the current one.
  - `photo {shot, photo}`: a listed shot and a valid photo; a new take of that shot. A photo of the current shot whose light check passes moves `current` to `nextOpen` (wrapping to the first open shot, staying when none is open); a failed light check keeps it current for the retake. A photo of another shot leaves `current` alone.
  - `lost {shot}`: a photo the browser no longer holds (after a reload) is dropped.
  - `settings {settings}`: known values only; one unknown value refuses the whole change, as does a change to the same values.
  - `reset`: Start over: back to `EMPTY_PLAN`, the settings kept.
- `planShots(plan)`: the shots in run order. `planPhotos(plan)`: the photos by shot id, as the `scenes.ts` rules read them. `planPhotoIds(plan)`: every photo id, for the side tables.
- `planText(plan)` / `parsePlan(text)`: versioned JSON (version 2). `parsePlan` returns undefined for missing, damaged or foreign text and for any other version (no migration); a bad record or setting is dropped alone; `current` outside the list reads as 0.
- `isOldPlan(text)`: the text is a plan of the earlier pair-slot version (version 1), which is not read; the store drops it and says so.
- `EMPTY_PLAN`, `DEFAULT_SETTINGS` (`capture: "auto"`, `countdown: 3`, `sound: true`).

## Invariants and assumptions

- Every record belongs to a shot of `shotList(spots, extra)`; `current` is inside the list.
- `take` is at least 1 and rises by one per photo of that shot; `shotsTaken` rises by one per accepted photo and only `reset` lowers it.
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

- `run-plan.test.ts`: the plan by shots (the auto-move, a failed light check staying, photos of other shots, the wrap to an open shot, retakes and takes, refusals, lost photos, resizing and moving, settings, reset) and across reloads (round trip, bad text, the old version, bad records dropped alone).
- `run-plan.property.test.ts`: for any action sequence, `current` and every record stay inside the list, refused actions keep identity, and the text reads back unchanged.
