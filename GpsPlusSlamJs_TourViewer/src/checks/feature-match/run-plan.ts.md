# run-plan.ts

## Purpose

The photo test run as plain data, shared by every view of the feature matching check (the guided view and the cockpit): one record per plan slot, the pair zips kept on the page until Download all, the run's size and position, and the capture and save settings. `planReducer` holds the rules; `feature-match-slice.ts` wraps each action, `feature-match-store.ts` persists the plan and mirrors its photos.

## Public API

- Types (`PhotoMeta`, `PlanSettings`, `RunPlan` and `PlanAction` exported; the others are the shapes inside them):
  - `PhotoMeta` - a taken photo's id, size, camera size and grey mean (pixels in the store's `frames` table).
  - `SlotRecord` - `{ seq, a, b, light, downloaded }`: the newest take's running number, photos A and B, the light check (light pairs, once both exist), and whether this take's files were downloaded.
  - `KeptFile` - `{ id, name, slot, seq, downloaded }`: a pair zip waiting on the page (Blob in the store's `blobs` table).
  - `PlanSettings` - `save` (`"each"`: every pair's zip downloads at once; `"end"`: kept until Download all), `capture` (`"auto"` or `"tap"`), `countdown` (0, 3 or 5 s), `sound`.
  - `RunPlan` - `{ spots, extra, current, slots, kept, settings, downloads, shots }`.
  - `PlanAction` - the actions below.
- `planReducer(plan, sequence, action)` returns `{ plan, sequence }`; a refused action returns the very same `plan` and `sequence`.
  - `size {spots, extra}` - clamped by `slotList`; refused when it would drop a slot holding a photo or a kept file; `current` stays inside the list.
  - `move {index}` - a listed index other than the current one.
  - `photo {slot, which, photo}` - a listed slot, a valid photo, B only after A. A slot's first photo, and the first photo after its take was downloaded, start a new take with `sequence + 1`. A new A after a download clears B; a retake of A before it keeps B; a new B keeps A. The light check is redone whenever both photos exist. `shots` counts every photo.
  - `lost {slot, which}` - a photo the browser no longer holds (after a reload): set to null, the light check with it.
  - `keep {id, name, slot}` - a complete pair's zip, under a fresh id and a name.
  - `downloaded {ids}` - those kept files, and their slots when the file holds the slot's newest take, are downloaded; `downloads` stays: it counts the run zip only, so a single file never reads as "Download again" or drops "(not downloaded yet)".
  - `run-downloaded` - the guided view's one zip: every complete pair is downloaded; `downloads` + 1; refused with no complete pair.
  - `drop-downloaded` - forgets downloaded kept files (frees their Blobs).
  - `settings {settings}` - known values only; one unknown value refuses the whole change.
  - `reset` - Start over: back to `EMPTY_PLAN`, the settings kept.
- `keptState(plan, slotId)` - `"warn"` (a failed light check) before `"saved"`, `"kept"`, `"done"`, `"half"`, `"missing"`: the cockpit's pair list.
- `planSlots(plan)`, `planPhotoIds(plan)`, `maxSequence(plan)`.
- `planText(plan)` / `parsePlan(text)` - versioned JSON; `parsePlan` returns undefined for missing, damaged or foreign text and drops a bad record, kept file or setting alone.
- `planAfterReload(plan)` - kept files are forgotten (their Blobs lived in memory).
- `EMPTY_PLAN`, `DEFAULT_SETTINGS` (`save: "end"`, `capture: "auto"`, `countdown: 3`, `sound: true`), `COUNTDOWNS`.

## Invariants and assumptions

- Every slot record and kept file belongs to a slot of `slotList(spots, extra)`; kept ids are unique; `current` is inside the list.
- No record's `seq` passes the running number; the running number never falls. It is the page's one `progress.sequence`, shared with the pair selector's flow, so no two takes of either share file names.
- Plain, serializable data only; pixels and Blobs are side tables keyed by the ids held here.
- **Photos across reloads (decided):** the plan is stored in `localStorage` and its photos in IndexedDB, keyed by the photo ids the slots hold (`feature-match-store.ts`). A run of a few dozen photos takes long enough that a discarded tab is likely; losing it would cost the tester the whole run. Kept zips are not stored: after a reload a complete pair without its zip reads `"done"`, and its zip is made again from the restored photos.

## Example

```ts
let { plan, sequence } = { plan: EMPTY_PLAN, sequence: 0 };
({ plan, sequence } = planReducer(plan, sequence, {
  type: "photo",
  slot: "1a-s1",
  which: "a",
  photo,
}));
keptState(plan, "1a-s1"); // "half"
```

## Tests

- `run-plan.test.ts`: numbering and retakes, new takes after a download, refusals, lost photos, resizing and moving, kept files and their states, the run download, settings, reset, and the stored text (round trip, bad text, bad records dropped alone, after a reload).
- `run-plan.property.test.ts`: for any action sequence, refused actions keep identity, numbers never fall or pass the running number, everything stays in the list, kept ids are unique, and the text reads back unchanged.
