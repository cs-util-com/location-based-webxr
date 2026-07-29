# `locate-control.ts`

**Purpose.** A "my location" button in the map's corner, driving `map.locate()` and reporting the outcome.

## Public API

- `class LocateControl`
  - `constructor({ map, onLocated, onError })` — adds itself to the map at `bottomleft`.
  - `dispose()` — cancels the pending label reset.
- The button carries `data-state` (a `LocateState`) and class `locate-button`; both are the e2e's handles.

## Invariants & assumptions

- **No new dependency.** Leaflet has no built-in locate _button_, but `map.locate()` is built in and wraps `navigator.geolocation` with `locationfound` / `locationerror`, so this is a div, a click handler and two listeners rather than a plugin.
- **`disableClickPropagation` is load-bearing.** Without it a click on the button also reaches the map underneath, which reads it as "the user clicked here to move" — so pressing "my location" would first teleport them to the button's own position.
- **`setView: false`.** Moving the map is the app's decision, made from the store once the position lands, not a side effect of asking where we are. A fix dispatches `positionChanged` — the same action a map click dispatches, so there is no second code path that could disagree with the first.
- **Disabled only while in flight.** Every terminal state, including the failures, is immediately retryable; a permission the user has just granted in browser settings should work on the next tap.
- **A failure must never blank the map.** A refused GPS permission says nothing about the data on screen. The error is dispatched through the action that preserves the snapshot.
- The button relaxes back to `idle` after `MESSAGE_LINGER_MS`, so a stale failure message does not sit on screen forever. `dispose()` cancels that timer.

## Examples

```ts
new LocateControl({
  map: mapView.map,
  onLocated: (position) => store.dispatch(actions.positionChanged(position)),
  onError: (message) => store.dispatch(actions.renderFailed(message)),
});
```

## Tests

The labels and error mapping are unit-tested in `locate-state.test.ts`. The DOM and Leaflet wiring are covered end to end in `playwright-tests/osm-demo.spec.js`, both paths as the async-feedback rule requires: _"moves the user to a real fix, and says so while it is working"_ (with a granted permission and a set geolocation, asserting the button reaches a terminal state and the refresh ran) and _"reports a denied permission instead of hanging on 'locating…'"_ (asserting the error reaches the status line).
