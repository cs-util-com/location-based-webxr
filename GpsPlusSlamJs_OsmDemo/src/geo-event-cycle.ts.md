# `geo-event-cycle.ts`

## Purpose

Owns the demo's geo-event action end to end: capture intent, call the worker,
publish the result to the store, republish the work the search did, and report a
failure without destroying the map.

## Public API

- `createGeoEventCycle(options): () => Promise<void>` — builds the action. The
  returned function takes no arguments (intent is read from the store) and
  **never rejects**; its caller is a DOM listener, where a rejection would be
  unhandled.
  - `store`, `actions` — the demo store and its slice actions.
  - `worker` — narrowed to `call("geoEvent", { position, category, now })`, so a
    test can fake it without a `Worker`.
  - `setBusy(boolean)` — the one thing here that is not store state, because "a
    request is in flight" is a property of this cycle rather than of the data.
    `main.ts` wires it to the button's `disabled` **and** its label, since the
    label is derived from `(busy, position, geoEvent)`.
  - `republish()` — publishes a fresh snapshot. Wired to `refresh` from
    `refresh-cycle.ts` (DEC-W1a).
  - `now?` — the clock, defaulting to `Date.now`. Injectable for tests and for
    W6's picker, which will hand over a chosen instant instead of "now".

### Error modes

- **The search rejects** → `nonFatalError("geo-event failed: …")`, and the
  previously found event stays published. Deliberately **not** `fetchFailed`,
  which would clear the snapshot and all three selections (DEC-W2a).
- **The republish rejects** → `nonFatalError("geo-event republish failed: …")`,
  with the search's own result left standing. Unreachable with the real wiring,
  because `latestOnly` never rejects — which is why it has a test.
- **Nothing was found** → not an error. The empty event is published like any
  other, which is what takes the previous search's markers down and lets the
  label say "No event nearby · searched 7 tiles".

## Invariants & assumptions

- `position` and `category` are read **once, at dispatch**. The category is what
  the answer is compared against on arrival; the position is not used for the
  label at all any more, because the label re-derives from the current one.
- An answer whose **category no longer matches** the store is dropped without
  publishing. `categoryChanged` has already cleared the field, so publishing
  would silently refill it with the previous category's answer.
- The **position is not** re-checked. A geo-event is a pure function of tile and
  time, so it stays true after the user moves — walking towards it is the point.
- `setBusy(false)` runs in a `finally` around the **search only**, before the
  republish. The label reads "Finding…" while busy, and holding that across the
  ~1.9 s refresh would show it over markers already drawn. The refresh announces
  itself through `fetchStarted` instead. Pinned by an invocation-order assertion.
- Nothing here touches Leaflet or the DOM. `main.ts` subscribes to `geoEvent`
  and draws it; that is the only place the map layer is written.

## Examples

```ts
const findGeoEvent = createGeoEventCycle({
  store,
  actions,
  worker,
  setBusy: paintGeoEventButton,
  republish: () => refresh(),
});
geoEventButton.addEventListener("click", () => void findGeoEvent());
```

## Tests

`geo-event-cycle.test.ts` — nine cases against a fake worker held open by hand:
the request payload, the publish, both edges of the busy state and its ordering
against the republish, the empty-result publish, the non-blanking failure
channel, a thrown non-`Error`, the dropped stale answer, the republish on
success, its absence after a failure or a drop, and the separated republish
failure.

Around it: `event-label.test.ts` covers the derived label (including that it
re-reads as the user walks), `osm-view-slice.test.ts` covers when the store
clears the event, and `map-and-cells.spec.js` covers the button-to-map wiring
and that a category change takes the markers down.
