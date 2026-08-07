# `geo-event-cycle.ts`

## Purpose

Owns the demo's geo-event action end to end: capture intent, call the worker,
draw the result, label the button, republish the work the search did, and report
a failure without destroying the map.

## Public API

- `GEO_EVENT_IDLE_LABEL` / `GEO_EVENT_BUSY_LABEL` — the button's resting and
  in-progress labels. Exported so `index.html`'s initial markup, the unit tests
  and the e2e all name the same strings instead of three copies drifting apart.
- `createGeoEventCycle(options): () => Promise<void>` — builds the action. The
  returned function takes no arguments (intent is read from the store) and
  **never rejects**; its caller is a DOM listener, where a rejection would be
  unhandled.
  - `store`, `actions` — the demo store and its slice actions.
  - `worker` — narrowed to `call("geoEvent", { position, category, now })`, so a
    test can fake it without a `Worker`.
  - `render(event | undefined)` — draws the event. `undefined` clears the layer.
  - `setLabel(text)` — the cycle owns all three label states.
  - `setBusy(boolean)` — disables the button for the duration.
  - `republish()` — publishes a fresh snapshot. Wired to `refresh` from
    `refresh-cycle.ts` (DEC-W1a).
  - `now?` — the clock, defaulting to `Date.now`. Injectable for tests and for
    W6's picker, which will hand over a chosen instant instead of "now".

### Error modes

- **The search rejects** → `nonFatalError("geo-event failed: …")` and the label
  returns to resting. Deliberately **not** `fetchFailed`, which would clear the
  snapshot and all three selections (DEC-W2a).
- **The republish rejects** → `nonFatalError("geo-event republish failed: …")`,
  and the search's own result and label are left standing. Unreachable with the
  real wiring, because `latestOnly` never rejects.
- **Nothing was found** → not an error. `describeGeoEvent` words it, and the
  layer is still re-rendered so the previous search's markers come down.

## Invariants & assumptions

- `position` and `category` are read **once, at dispatch**. The label's distance
  and bearing are measured from where the user asked, not from wherever they
  ended up 8 seconds later.
- An answer whose **category no longer matches** the store is dropped without
  rendering. The event was computed against the old category's scores and
  threshold, and once W2 clears the markers on a category change, a late arrival
  would otherwise put them back.
- The **position is not** re-checked. A geo-event is a pure function of tile and
  time, so it stays true after the user moves; only the category changes what was
  computed.
- `setBusy(false)` runs in a `finally`, so no path can leave the button disabled.
- The republish happens **after** the render and the label — those are what the
  user pressed the button for, and the refresh is ~1.9 s behind them.

## Examples

```ts
const findGeoEvent = createGeoEventCycle({
  store,
  actions,
  worker,
  render: (event) => mapView.renderGeoEvent(event),
  setLabel: (text) => (geoEventButton.textContent = text),
  setBusy: (busy) => (geoEventButton.disabled = busy),
  republish: () => refresh(),
});
geoEventButton.addEventListener("click", () => void findGeoEvent());
```

## Tests

`geo-event-cycle.test.ts` — nine cases against a fake worker held open by hand:
the request payload, the terminal label, both edges of the busy state, the
"nothing found" wording, the non-blanking failure channel, a thrown non-`Error`,
the dropped stale answer, the republish on success, the absence of a republish
after a failure or a drop, and the separated republish failure.

`event-label.ts` covers the label arithmetic; `demo-pipeline.test.ts:466-620`
covers what the worker actually computes. Neither needs a DOM.
