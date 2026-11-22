# feature-match-store.ts

## Purpose

The store of the feature matching check page (`configureStore` over `feature-match-slice.ts`) and its side effects: the progress read back at start and written by listeners, and the side tables beside the state, kept in step with it.

## Public API

- `createFeatureMatchStore({ storage, session, revokeUrl })` returns:
  - `store`: the Redux store.
  - `sides`: the side tables, keyed by the ids the state holds: `frames` (camera photos by `PhotoMeta.id`), `results` (the camera run's results by `resultsId`), `urls` (Blob URLs of offered files and of the prepared flat zip), `flatFrames` (the reference being marked and its preview), `flatPhotos` (each surface's photos, by surface id).
  - `newId(prefix)`: a fresh side table key.
  - `photosOf(id)`: a surface's photos, created empty on first use.
  - `dispose()`: stops the listeners and revokes every URL.
- `flatHasUnsaved(state, sides)`: whether any surface has captures, or an attached original, that exist only in this page.
- `PROGRESS_KEY`, `FLAT_PROGRESS_KEY` (the `localStorage` keys), `shotKey(pose, q)`, types `KeyValueStorage`, `SurfacePhotos`, `FeatureMatchSides`, `FeatureMatchStoreDeps`, `FeatureMatchStore`.

## Invariants and assumptions

- **Persistence is a listener.** The running number, pair and spot are written when one of them changed; the flat progress when it changed. Reading and writing run in try/catch: with storage blocked the page starts over and its progress lasts as long as the page. After a reload only downloaded flat captures remain (`afterReload`).
- **Reconcile after every action.** An entry the state no longer names is dropped and its URL revoked: a photo retaken, a run withdrawn, offered files withdrawn, a stale prepared zip, a surface's removed shot. So a view puts an entry in place in the same step as the action that names it; any action in between would drop it.
- **Freeing.** Selecting or adding a surface frees the photos of every other surface with nothing left to download; an attached original counts as not downloaded (`unsavedCount`) until its surface's zip was saved.
- The camera, canvases, ORT sessions and timers are not here: they belong to the views that use them.

## Example

```ts
const { store, sides, newId } = createFeatureMatchStore({
  storage: localStorage,
  session,
  revokeUrl: (u) => URL.revokeObjectURL(u),
});
const id = newId("photo");
sides.frames.set(id, saved);
store.dispatch(
  featureMatchActions.photoTaken({ which: "a", photo: { id, ...meta } }),
);
```

## Tests

`feature-match-store.test.ts`: the stored start and the writes (only on change), the flat progress write, blocked storage, reconcile dropping frames and results and revoking offered and prepared zip URLs, freeing that keeps a surface with an attached original, and `dispose`.
