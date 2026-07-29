# `refresh-cycle.ts`

**Purpose.** Run the demo's one async action — fetch, score, publish — and classify its two kinds of failure so only one of them clears the picture.

## Public API

- `createRefreshCycle({ store, actions, pipeline })` → `LatestOnly<void>`
  - Takes **no arguments** when called. Reads `position` and `category` from the store at call time.
  - Dispatches `fetchStarted` → (`snapshotReady` | `fetchFailed`).
  - Coalesced through `latestOnly`: at most one run in flight, only the newest waiting intent survives, never rejects.
- `renderSafely({ store, actions }, label, draw)` — runs one view's draw; on a throw dispatches `renderFailed` with `"<label>: <message>"` and returns normally.
- Types: `RefreshPipeline` (the narrowed `DemoPipeline` surface, so tests can fake it), `StoreAccess`, `RefreshCycleOptions`.

## Invariants & assumptions

- **A data failure and a view failure are different events and get different treatment.** The old `doRefresh` wrapped fetch-and-score _and_ both view renders in one `try`, so an Overpass 429 and a lost WebGL context arrived at the same `catch`. A data failure means nothing new was produced, so anything still drawn is a claim nothing supports — `fetchFailed` clears it. A view failure means the snapshot is valid and the other view drew it correctly — `renderFailed` leaves it alone. Blanking a correct map because the 3D pane threw is the same class of lie in the other direction.
- **`renderSafely` is also what stops one broken pane from blanking the app.** Store subscribers run synchronously inside `dispatch`, so an exception escaping one would propagate out of the dispatch that fed them all and skip every later subscriber.
- **The cycle takes no arguments on purpose.** A coalesced run may start long after the click that queued it; reading intent from the store at call time means the surviving run always fetches for the _current_ position and category. Capturing them at call time would let a superseded position win — the failure mode `latest-only.ts` exists to prevent, reintroduced one layer up.
- **The error path here is not reachable from a network stub.** `DemoPipeline.update` collects refused tiles into `missingTiles` rather than throwing, so an HTTP 400 produces a successful, empty refresh. Only a fault in the scoring/data step reaches `fetchFailed`, which is why this file's unit tests are the primary proof and the e2e says so in a comment.
- `messageOf` handles a thrown non-`Error`: a rejected fetch can throw anything, and `String(error)` is more useful than `undefined`.

## Examples

```ts
const refresh = createRefreshCycle({ store, actions, pipeline });

subscribe(
  (view) => view.position,
  () => void refresh(),
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
