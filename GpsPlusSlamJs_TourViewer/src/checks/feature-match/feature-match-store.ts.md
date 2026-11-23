# feature-match-store.ts

## Purpose

The store of the feature matching check page (`configureStore` over `feature-match-slice.ts`) and its side effects: the run plan and the flat progress read back at start and written by listeners, the side tables beside the state kept in step with it, and the mirror of the run's photos, measured results and log into the browser's database, so a reload brings them back. One tab at a time holds the run.

## Public API

- `createFeatureMatchStore({ storage, session, revokeUrl, photoDb?, photoDbFailed?, previewOf?, lock? })` returns:
  - `store`: the Redux store.
  - `sides`: the side tables, keyed by the ids the state holds: `photos` (a plan photo's PNG, a `Promise<Blob>`, held only until its write succeeded), `previews` (a plan photo's small `Frame` for the views, `PREVIEW_EDGE` on the long side), `results` (a measured pair's matches JSON by result key, held until written), `urls` (the Blob URL of the prepared flat zip), `flatFrames` (the reference being marked and its preview), `flatPhotos` (each surface's photos, by surface id).
  - `restore()`: the start below. Never rejects. Runs once per store: a later call returns the first call's promise, so the run zip awaits it before it reads the state.
  - `readPhoto(id)`: a photo's PNG from the database, else from memory (a write refused or pending); rejects `the photo <id> is not stored` when neither holds it.
  - `readMatches(key)`: a measured pair's matches JSON from the database, else from memory, else undefined.
  - `flushLog()`: writes the log now (the page calls it on `pagehide` and when hidden).
  - `newId(prefix)`: a fresh side table key, `<prefix>-<session>-<n>`: the page session is new at every load, so an id handed out after a reload never equals a restored photo's id.
  - `photosOf(id)`: a surface's photos, created empty on first use.
  - `accepted(action)`: dispatches and returns whether the reducer took it (a refused reducer returns the same state object).
  - `put(table, entries, action)`: sets the entries in `table` and dispatches `action` in one step, returning `accepted`; an entry a refused action does not name is dropped by the reconcile it triggers, a URL revoked.
  - `oldPlanDiscarded`: the stored plan was of the earlier pair-slot version and was dropped (no migration); the page logs it. The store writes the empty plan in its place at once.
  - `dispose()`: stops the listeners and the log timer and revokes every URL.
- `holdTabLock(locks)`: takes `TAB_LOCK` with `ifAvailable` and keeps it for the page's life (a promise that never settles); resolves false when another tab holds it, true when it got it, when `locks` is missing or when the request fails. A refused tab does not wait for the lock: its plan and log were read at load and are stale once the other tab closes, so its text asks for a reload (`OTHER_TAB_TEXT`).
- `flatHasUnsaved(state, sides)`: whether any surface has captures, or an attached original, that exist only in this page.
- Constants: `FLAT_PROGRESS_KEY`, `PLAN_KEY` (the `localStorage` keys), `PHOTO_DB` (`feature-match-check-photos`), `PHOTO_STORE` (`photos`), the database keys `photoKey(id)` (`photo:<id>`), `resultDbKey(key)` (`result:<result key>`) and `LOG_KEY` (`log`), `LOG_DELAY_MS` (1000), `TAB_LOCK` (`feature-match-run`), `shotKey(pose, q)`.
- Types `KeyValueStorage`, `SurfacePhotos`, `ResultRecord { entry, matches? }`, `TabLocks`, `FeatureMatchSides`, `FeatureMatchStoreDeps`, `FeatureMatchStore`.

## Invariants and assumptions

- **Persistence is a listener.** The flat progress and the run plan are written when they changed. Reading and writing run in try/catch: with storage blocked the page starts over and its progress lasts as long as the page. After a reload only downloaded flat captures remain (`afterReload`). The run plan (`run-plan.ts`) is written as `planText` whenever it changed and read back through `parsePlan`; a plan of the earlier version is dropped (`isOldPlan`, `oldPlanDiscarded`).
- **What the database holds (`photoDb`, IndexedDB in the page):**
  - `photo:<id>`: a plan photo's PNG Blob, for every photo id the plan's shots hold;
  - `result:<result key>`: `{ entry, matches? }` for every ready pair whose result is kept (`entry.persisted`; a crash is not kept, so the pair is measured again);
  - `log`: the page log as text.
- **The mirror.** After every plan or results change each newly named record is written once and a record no longer named is deleted. A record counts as stored only after its write succeeded: then a photo's PNG leaves memory and `photoStored(id)` names it in `state.storedIds`, a result's matches leave memory. A refusing database is tried again sparingly: when a new record comes or a write succeeds, and then only the oldest unstored record still named, one retry at a time. Each new record's own write starts at once beside that retry, so the writes in flight are the new records not yet written plus at most one retry; the store test "runs one retry at a time beside every new photo's own write" shows four at once (three new photos and one retry). Each record's failure is reported once (`photoDbFailed`) however often it is retried; while any named record is not stored `photoStoreChanged(true)` sets `state.photoStoreFailing`. A failed write of a record no longer named (retaken, or a photo whose PNG could not be encoded) is neither kept nor reported. A record dropped while its write ran is deleted once the write ends; a failure of that cleanup delete is reported but does not count as unstored.
- **Memory.** A photo is in memory as its PNG only until stored, and always as its preview (`PREVIEW_EDGE` 320: 320x180x4 bytes, about 230 KB for a 16:9 photo), so a full run of 13 photos holds about 3 MB of previews instead of 13 full frames (about 48 MB at 1280x720).
- **The log.** Written `LOG_DELAY_MS` after a change, only once the stored log was read back (`state.restored`), so a new load never overwrites the old log before it was read. A load whose log read failed (reported through `photoDbFailed`) writes no log at all: the stored log keeps the earlier loads' lines for the next start, and the screen still shows this load's. A failed write is reported once until a write succeeds.
- **The start, `restore()`:**
  1. Takes the tab lock (`lock`); a tab that does not get it dispatches `otherTabFound` (every plan action is then refused) and reads and writes nothing.
  2. Sweeps the database, only when a current plan was read back or an old one was discarded (with no stored plan at all a sweep would delete the photos of a plan that could not be read): every key but the log, the keys being written, the records the state names and the results of the current ready pairs goes. A key is checked at the moment of its delete, so a photo taken during the sweep is kept.
  3. Reads each named photo: a Blob gives its preview (`previewOf`) and counts as stored; a missing one (or one stored as something other than a Blob) dispatches `planShotLost`, so the shot asks for that photo again. A read or preview that fails is not a lost photo: the shot stays (so the next start's sweep keeps its PNG), the failure goes to `photoDbFailed` and `photoStoreFailing` stays on until that shot is retaken. A photo replaced while its read was pending is left alone.
  4. Reads the kept results of the current ready pairs and the stored log, and dispatches `restoreFinished({ stored, results, log })` once: the log of the earlier load comes first, then a `page reloaded` line.
- Without a database (`photoDb` null, IndexedDB missing or refused) every stored photo reads as lost, and `state.photoStoreFailing` is on while the plan names any photo; every database failure goes to `photoDbFailed` and never stops the page.
- **Reconcile after every action.** An entry the state no longer names is dropped and its URL revoked: a photo retaken (its PNG and preview), a result gone stale, a stale prepared zip, a surface's removed shot. So a view puts an entry in place with `put`, in the same step as the action that names it.
- **Freeing.** Selecting or adding a surface frees the photos of every other surface with nothing left to download; an attached original counts as not downloaded (`unsavedCount`) until its surface's zip was saved.
- **Known limit.** A result entry that changes for a key already in the database is not written again; the on-phone measuring writes each key once.
- The camera, canvases, ORT sessions and the views' timers are not here.

## Example

```ts
const fm = createFeatureMatchStore({
  storage: localStorage,
  session,
  revokeUrl: (u) => URL.revokeObjectURL(u),
  photoDb,
  previewOf: async (png) => previewFrame(await blobFrame(png)),
  lock: () => holdTabLock(navigator.locks),
});
void fm.restore();
const id = fm.newId("photo");
fm.sides.previews.set(id, previewFrame(frame));
fm.put(
  fm.sides.photos,
  [[id, framePng(frame, "photo")]],
  featureMatchActions.planShotTaken({
    shot: "light-s1/L1",
    photo: { id, ...meta },
  }),
);
```

## Tests

- `feature-match-store.test.ts`: the stored start and the writes (only on change), the flat progress write, blocked storage, `accepted` and `put`, reconcile, the prepared zip's URL, freeing, `dispose`; the run's database: PNG writes that drop the held copy, `readPhoto` from storage then memory, the restore of photos, results and log, the sweep rule (no plan, an old plan, a current plan), no database or a failing one, a photo read that fails once kept (and found by the next start), ids unique across loads, a failed write retried sparingly with the not-stored flag, the overlap of new writes and the one retry, the cleanup delete, a photo taken during the sweep kept, results written or not by `persisted` and stale ones deleted, the log's delay, flush and nothing written before the restore or after a failed log read, one restore shared between calls, and the tab lock (held by a promise that stays pending).
- `feature-match-store.property.test.ts`: random photos, retakes and resets against a database that refuses some writes: the database's photo keys equal `storedIds`, stored plus held is exactly the named photos, and a reload restores exactly the stored ones with their previews.
