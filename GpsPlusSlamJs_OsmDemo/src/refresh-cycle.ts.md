# `refresh-cycle.ts`

**Purpose.** Run the demo's one async action — fetch, score, publish — and classify its two kinds of failure so only one of them clears the picture.

## Public API

- `createRefreshCycle({ store, actions, worker, onMesh, anchors })` → `LatestOnly<void>`
  - Takes **no arguments** when called. Reads `position` and `category` from the store at call time.
  - Dispatches `fetchStarted` → (`snapshotReady` | `fetchFailed`).
  - Coalesced through `latestOnly`: at most one run in flight, only the newest waiting intent survives, never rejects.
- `renderSafely({ store, actions }, label, draw)` — runs one view's draw; on a throw dispatches `nonFatalError` with `"<label>: <message>"` and returns normally.
- `isFinalRing(radius)` — whether a snapshot of this radius is the LAST one a refresh will publish. Exported from here rather than computed by callers because this file owns `PROGRESSIVE_RADII`, and "last" must not be able to go stale somewhere else when that list changes. `>=` rather than `===`, so a radius the cycle never scores reads as finished — an unexpected value should be a cosmetic bug, not a permanent "still widening" in the UI.
- **`anchors` is READ, never decided here.** This cycle used to own the scene-anchor decision, and that was a defect: a position change drives three consumers of the frame — the camera pivot, the terrain load and this — and this one runs LAST, so the other two read the outgoing anchor whenever it moved. The holder is advanced once by `main.ts`'s position subscriber and everything downstream reads the same value. A refresh with no position change (a category switch, a layer toggle, the initial load) therefore re-sends the held origin rather than re-deriving one from wherever the user happens to be. See `scene-anchor.ts.md`.
  - This is also why the cycle no longer takes a `declared` flag: the flag belongs to the position change, and so does the decision it feeds.
- Types: `StoreAccess`, `RefreshCycleOptions`. The narrowed worker surface (`RefreshWorker`) is module-private — it exists so `refresh-cycle.test.ts` can drive the cycle without a worker.
- **`onMesh` is called BEFORE `snapshotReady` is dispatched**, and the order is load-bearing: the mesh cannot live in the store (`Float32Array` vertex data, which RTK rejects), but the 3D view draws from a snapshot subscription — so a dispatch first would draw the new snapshot against the previous position's buildings. Pinned by its own test, because both orders end in the same final state and only the intermediate frame differs.

## Invariants & assumptions

- **A data failure and a view failure are different events and get different treatment.** The old `doRefresh` wrapped fetch-and-score _and_ both view renders in one `try`, so an Overpass 429 and a lost WebGL context arrived at the same `catch`. A data failure means nothing new was produced, so anything still drawn is a claim nothing supports — `fetchFailed` clears it. A view failure means the snapshot is valid and the other view drew it correctly — `nonFatalError` leaves it alone. Blanking a correct map because the 3D pane threw is the same class of lie in the other direction.
- **`renderSafely` is also what stops one broken pane from blanking the app.** Store subscribers run synchronously inside `dispatch`, so an exception escaping one would propagate out of the dispatch that fed them all and skip every later subscriber.
- **The cycle takes no arguments on purpose.** A coalesced run may start long after the click that queued it; reading intent from the store at call time means the surviving run always fetches for the _current_ position and category. Capturing them at call time would let a superseded position win — the failure mode `latest-only.ts` exists to prevent, reintroduced one layer up.
- **The error path here is not reachable from a network stub.** `DemoPipeline.update` collects refused tiles into `missingTiles` rather than throwing, so an HTTP 400 produces a successful, empty refresh. Only a fault in the scoring/data step reaches `fetchFailed`, which is why this file's unit tests are the primary proof and the e2e says so in a comment.
- `messageOf` handles a thrown non-`Error`: a rejected fetch can throw anything, and `String(error)` is more useful than `undefined`.
- **The cycle asks for the cell array only when something draws it (round 10, stage B), and reads that PER RING rather than once.** `includeCells` comes from `isLayerEnabled(selectLayers(...), "cells")` inside the loop, so toggling the layer mid-widening takes effect on the next ring instead of being decided by whatever was true when the click landed. This is the same principle as the point above about taking no arguments: intent is read at the moment it is used, not captured. The saving is real — the array clones in a measured 27–35 ms at the cache cap, three times per move, and the `cells` layer is off by default — but it lives entirely in _asking correctly_, so the two directions are unit-tested here rather than left to the pipeline's own test.
- **The cycle publishes once per ring, and every publish sets `loading: idle`.** `PROGRESSIVE_RADII` is `[2, 3, 4]` and `snapshotReady` is `{ ...state, snapshot, loading: IDLE }`, so a subscriber that treats `idle` as "the answer is final" is wrong twice out of three times. That is not a bug in the reducer — the first ring genuinely IS a usable answer, which is the whole point of W16 — but it means **"is this the last one?" has to be asked of the snapshot's `radius`, never of `loading`**. Before `isFinalRing` existed, the status line presented ring 2's counts exactly as it presents the final ones and the e2e helper inferred the end of widening from 500 ms of status quiescence, which worker contention defeated: one run scored 845 cells where another scored 1692 from the same fixture (F42).

## Examples

```ts
const anchors = createAnchorHolder(start);
const refresh = createRefreshCycle({ store, actions, worker, onMesh, anchors });

subscribe(
  (view) => view.position,
  (position) => {
    // THE ANCHOR MOVES FIRST, AND EXACTLY ONCE. Everything below reads the
    // holder, so the camera, the terrain load and the refresh cannot disagree
    // about which frame this position is drawn in.
    anchors.advance(position, { declared });
    buildingView.recentre(enuFrameAt(anchors.origin).toEnu(position));
    // Concurrently, not chained: they are independent work on the same worker,
    // and the worker joins them on the far side (`worker/terrain-gate.ts`).
    void loadTerrain({ centre: position, frameOrigin: anchors.origin });
    void refresh();
  },
);
subscribe(
  (view) => view.category,
  () => void refresh(),
);

subscribe(
  (view) => view.snapshot,
  (snapshot) => {
    renderSafely(access, "map", () => drawMap(snapshot));
    renderSafely(access, "3D view", () => drawScene(snapshot));
  },
);
```

## Tests

`refresh-cycle.test.ts`, against a fake pipeline and a real store — the phase sequence is observable _during_ the fetch (two independent witnesses); intent is read at call time, not captured; overlapping refreshes coalesce to the most recent intent; a data failure clears the snapshot and reports the message; a thrown non-`Error` still reports; the next successful refresh recovers; and `renderSafely` reports a view failure **without** discarding the snapshot, does not touch the store on success, and lets one failing view fail without stopping the next.
