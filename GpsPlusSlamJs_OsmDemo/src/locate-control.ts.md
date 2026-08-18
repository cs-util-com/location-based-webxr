# `locate-control.ts`

**Purpose.** A "my location" button in the map's corner, driving `map.locate()` and reporting the outcome.

## Public API

- `class LocateControl`
  - `constructor({ map, onLocated, onError })` — adds itself to the map at `bottomleft`.
  - `startWatch()` / `stopWatch()` — follow the user continuously instead of
    taking one fix (AR milestone 3). Both idempotent.
  - `dispose()` — cancels the pending label reset.
- `LocatedFix` — the shape handed to `onLocated`: `{ lat, lng, accuracyM?,
altitude, altitudeAccuracy, heading, speed, timestamp }`.
  - **WIDENED 2026-08-14 from `{ lat, lng, accuracyM? }`.** The vertical and
    temporal fields were being discarded at this boundary even though Leaflet
    copies every numeric `coords` property onto its event. That is why the
    fusion's vertical solve could never work: `applyAltitudeOverride` fits
    `ref[1] - odom[1]` weighted by `altitudeAccuracy`, so with neither field
    `alignmentMatrix[13]` stays structurally zero and the AR HUD reports a
    confident `0.00 m`. `gps-registration.ts` is the consumer that needs them.
  - The four optional fields are normalised to `null`, not left `undefined`:
    `@types/leaflet` declares them as plain `number`, but Leaflet only copies
    what the browser provided, so they are absent on most indoor and all desktop
    fixes. The framework's `GpsPosition` wants `null`, and `undefined` reaching
    the weight maths would produce `NaN` rather than a skipped term.
  - `timestamp` falls back to `Date.now()` for the same reason: a synthetic
    `locationfound` may omit it, and a `NaN` timestamp poisons time weighting.
- The button carries `data-state` (a `LocateState`) and class `locate-button`; both are the e2e's handles.

## Invariants & assumptions

- **It is a SQUARE ICON BUTTON, bottom-right (DEC-R2-3).** An inline SVG map pin —
  not an emoji (renders differently per platform, cannot inherit `currentColor`)
  and not an image (a network request for four path commands). Bottom-right is the
  maps convention the feedback named; Leaflet puts its attribution control in the
  same corner, so the button stacks ABOVE it and the ODbL credit stays visible.
- **The label is no longer the visible text, and that is the risky part.** It used
  to be `textContent`, so removing it would have left a button that says nothing
  to a screen reader and nothing on touch (where `title` never appears). The four
  states now drive THREE channels: `data-state` for the CSS (a pulsing pin is the
  in-progress state `CLAUDE.md` requires), `title` + `aria-label` + `aria-busy`
  for the wording and for AT, and the status line for the failures. Because a
  collapsed header hides the status line, DEC-R2-15 makes an error expand it.
- **The old button changed SIZE when it failed** — "my location" to "location
  permission denied". A fixed square cannot.

- **No new dependency.** Leaflet has no built-in locate _button_, but `map.locate()` is built in and wraps `navigator.geolocation` with `locationfound` / `locationerror`, so this is a div, a click handler and two listeners rather than a plugin.
- **The watch reuses `map.locate`, so there is only ever ONE source of position**
  (AR milestone 3). `locationfound` already flows to `onLocated`, which is the
  one place a new position enters the store; a parallel `watchPosition` would be
  a second source for the same fact, and the two could disagree about which fix
  is current.
  - **`watch: true` does NOT mean "refetch on every fix".** Leaflet delivers
    roughly 1 Hz, the scoring pass takes 15–90 s, and `refresh` is `latestOnly`
    — so acting on every fix aborts every run and nothing ever publishes.
    [`ar-walk-controller.ts`](ar-walk-controller.ts.md) is what makes this safe
    to turn on; turning it on without that controller IS the §2.6 starvation
    bug.
  - **The watch does not drive the BUTTON.** A background follow that flashed
    "Located" once a second, for something the user never pressed, would be
    wrong — and it would re-arm a reset timer each time. The button belongs to
    the one-shot it was pressed for, which is exactly `state === "locating"`.
  - **A watch error is reported ONCE per outage.** `watchPosition` re-fires its
    error callback on every timeout, so an unguarded path pushes a toast a
    second for as long as the user stays indoors, burying every other message
    the app has. The next successful fix rearms it, so a second outage is
    reported again.
  - **`stopLocate()` also cancels a one-shot in flight** and fires no event,
    which is the other reason `stopWatch` leaves the button alone: a `locating`
    button would otherwise stay pulsing with nothing left to end it.
- **`disableClickPropagation` is load-bearing.** Without it a click on the button also reaches the map underneath, which reads it as "the user clicked here to move" — so pressing "my location" would first teleport them to the button's own position.
- **`setView: false`, and the app must then actually pan.** Moving the map is the app's decision rather than a side effect of asking where we are — but for a while nothing made that decision, and a fix left the viewport at the start position with the marker, the new grid and the fetch box all off screen at zoom 18. A working button and a dead one looked identical. `main.ts` now calls `MapView.centreOn` on the **locate path only**: a map click already happens where the user is looking, and recentring there would yank the map out from under them. The fix still dispatches the same `positionChanged` a click does, so there is no second refresh path.
- **Disabled only while in flight.** Every terminal state, including the failures, is immediately retryable; a permission the user has just granted in browser settings should work on the next tap.
- **A failure must never blank the map.** A refused GPS permission says nothing about the data on screen. The error is dispatched through the action that preserves the snapshot.
- The button relaxes back to `idle` after `MESSAGE_LINGER_MS`, so a stale failure message does not sit on screen forever. `dispose()` cancels that timer.

## Examples

```ts
new LocateControl({
  map: mapView.map,
  onLocated: (position) => store.dispatch(actions.positionChanged(position)),
  onError: (message) => store.dispatch(actions.nonFatalError(message)),
});
```

## Tests

The labels and error mapping are unit-tested in `locate-state.test.ts`. The DOM and Leaflet wiring are covered end to end in `playwright-tests/boot-and-shell.spec.js`, both paths as the async-feedback rule requires: _"moves the user to a real fix, and says so while it is working"_ (with a granted permission and a set geolocation, asserting the button reaches a terminal state and the refresh ran) and _"reports a denied permission instead of hanging on 'locating…'"_ (asserting the error reaches the status line).
