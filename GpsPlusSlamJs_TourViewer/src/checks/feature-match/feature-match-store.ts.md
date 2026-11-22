# feature-match-store.ts

## Purpose

The store of the feature matching check page (`configureStore` over `feature-match-slice.ts`) and its side effects: the progress read back at start and written by listeners, and the side tables beside the state, kept in step with it.

## Public API

- `createFeatureMatchStore({ storage, session, revokeUrl, photoDb?, photoDbFailed? })` returns:
  - `store`: the Redux store.
  - `sides`: the side tables, keyed by the ids the state holds: `frames` (camera photos by `PhotoMeta.id`, the run plan's photos included), `blobs` (the run plan's kept pair zips, by kept file id), `results` (run results by the camera run's `resultsId` or the plan run's `planRun.resultsId`), `urls` (Blob URLs of offered files and of the prepared flat zip), `flatFrames` (the reference being marked and its preview), `flatPhotos` (each surface's photos, by surface id).
  - `restorePhotos()`: reads the run plan's photos back from `photoDb` into `frames` (see below). Never rejects.
  - `newId(prefix)`: a fresh side table key, `<prefix>-<session>-<n>`: the page session is new at every load, so an id handed out after a reload never equals a restored photo's id.
  - `photosOf(id)`: a surface's photos, created empty on first use.
  - `accepted(action)`: dispatches and returns whether the reducer took it (a refused reducer returns the same state object).
  - `put(table, entries, action)`: sets the entries in `table` and dispatches `action` in one step, returning `accepted`; an entry a refused action does not name is dropped by the reconcile it triggers, a URL revoked.
  - `dispose()`: stops the listeners and revokes every URL.
- `flatHasUnsaved(state, sides)`: whether any surface has captures, or an attached original, that exist only in this page.
- `PROGRESS_KEY`, `FLAT_PROGRESS_KEY`, `PLAN_KEY` (the `localStorage` keys), `PHOTO_DB`, `PHOTO_STORE` (the IndexedDB database and object store of the plan's photos), `shotKey(pose, q)`, types `KeyValueStorage`, `SurfacePhotos`, `FeatureMatchSides`, `FeatureMatchStoreDeps`, `FeatureMatchStore`.

## Invariants and assumptions

- **Persistence is a listener.** The running number, pair and spot are written when one of them changed; the flat progress when it changed. Reading and writing run in try/catch: with storage blocked the page starts over and its progress lasts as long as the page. After a reload only downloaded flat captures remain (`afterReload`). The run plan (`run-plan.ts`) is written as `planText` whenever it changed and read back through `parsePlan` and `planAfterReload` (kept zips are forgotten).
- **The run plan's photos survive a reload (decided).** A run of a few dozen photos is long enough for the browser to discard the tab, so the photos are mirrored into `photoDb` (a `KeyValueStore`, IndexedDB in the page) as the plain `SavedFrame` values, keyed by the photo ids the plan's slots hold:
  - after every plan change a newly named photo is written once and a photo no longer named is deleted; an id counts as stored only after its write succeeded; a refusing database is tried again sparingly: only when a new photo comes, and then only for the oldest photo not stored, one write at a time, and each photo's failure is reported once (`photoDbFailed`) however often it is retried; while any named photo is not stored `photoStoreChanged(true)` sets `state.photoStoreFailing`. A photo dropped from the plan while its write ran is deleted once the write ends, and a failure of that cleanup delete is reported but does not count the photo as unstored (it is no longer named);
  - `restorePhotos()` at start deletes stored keys the plan does not name at the moment of each delete (not when the key list was read), so a photo taken during the sweep is kept, then reads each named photo: a valid value goes into `frames` (no action), a missing or damaged one dispatches `planPhotoLost`, so the slot asks for that photo again; a photo replaced while the read was pending is left alone;
  - without a database (`photoDb` null, IndexedDB missing or refused) every stored photo reads as lost, and `state.photoStoreFailing` is on while the plan names any photo; every database failure goes to `photoDbFailed` and never stops the page.
  - Cost: every photo of the run is held in memory too (about 3.7 MB for a 1280x720 frame).
- **Reconcile after every action.** An entry the state no longer names is dropped and its URL revoked: a photo retaken, a run withdrawn, offered files withdrawn, a stale prepared zip, a surface's removed shot. So a view puts an entry in place with `put`, in the same step as the action that names it; any action in between would drop it.
- **Freeing.** Selecting or adding a surface frees the photos of every other surface with nothing left to download; an attached original counts as not downloaded (`unsavedCount`) until its surface's zip was saved.
- The camera, canvases, ORT sessions and timers are not here: they belong to the views that use them.

## Example

```ts
const { sides, newId, put } = createFeatureMatchStore({
  storage: localStorage,
  session,
  revokeUrl: (u) => URL.revokeObjectURL(u),
});
const id = newId("photo");
put(
  sides.frames,
  [[id, saved]],
  featureMatchActions.photoTaken({ which: "a", photo: { id, ...meta } }),
);
```

## Tests

`feature-match-store.test.ts`: the stored start and the writes (only on change), the flat progress write, blocked storage, `accepted` and `put` (kept when named, dropped and revoked when refused), reconcile dropping frames and results, the flat reference and preview and removed shots, and revoking offered and prepared zip URLs, freeing that keeps a surface with an attached original, `dispose`, and the run plan's storage (the plan written and read back without kept files, photos mirrored and deleted, restored, lost when missing or damaged or without a database, orphans removed), ids unique across two loads, a failed write retried with the not-stored flag and no write loop, and a photo taken during a slow orphan sweep kept.
