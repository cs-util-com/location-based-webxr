# `locate-state.ts`

**Purpose.** The behaviour every "my location" button shares: its states'
labels, the mapping from a geolocation error to a state, the fix each failure
names, and one request for a position that never leaves a button stuck.

Moved here from the OSM demo (`GpsPlusSlamJs_OsmDemo/src/locate-state.ts`)
when the globe lab's pin needed the same contract (round-2 plan
2026-09-26-2055 M3g; DEC-H3: shared behaviour has one home). The OSM demo's
Leaflet control imports the labels and the mapping; the globe lab (served
through the design system's `/fw/` route) uses all of it.

## Public API

- `LocateState`: `idle | locating | located | denied | timeout | unavailable`.
- `LocateFailure`: the three failures, `denied | timeout | unavailable`.
- `labelFor(state): string`: the button's accessible label. Every state has
  a distinct, non-empty label; the texts are the ones the OSM demo shipped
  with (its `title` / `aria-label`), unchanged by the move.
- `locateAdvice(state): string`: the fix a failure names, for the line under
  the button; `""` for `idle`, `locating` and `located`.
  - `denied`: allow location for the site in the browser's settings.
  - `timeout`: try again outdoors or by a window, with a view of the sky.
  - `unavailable`: this device or browser cannot tell where it is (no
    settings to send the user to).
- `stateForError(code): LocateFailure`: a `GeolocationPositionError.code`
  (1 denied, 3 timeout, anything else unavailable).
- `locateOnce(geolocation, { timeoutMs }): Promise<LocateOutcome>`: one
  `getCurrentPosition` with `maximumAge: 0`, high accuracy and the browser's
  own timeout. `LocateOutcome` is `{ kind: "located", fix: { lat, lng,
accuracyM, timestamp } }` or `{ kind: "failed", state }`.

## Invariants & assumptions

- **`locating` must not read like `idle`.** `CLAUDE.md`'s async-feedback rule
  requires a distinguishable in-progress state, and a GPS fix routinely takes
  seconds.
- **The three failures stay three failures,** each with its own fix. A shared
  "location failed" would drop the only actionable part of the message.
- **Unknown codes degrade to `unavailable` rather than throwing**: the error
  object is whatever the browser hands over, and a button that throws inside
  its own error handler stays on "locating…" forever.
- **`locateOnce` never rejects for anything the browser does**: no
  `geolocation` at all, a request that throws (an insecure context), any
  error code, a fix with a non-finite or out-of-range latitude or longitude,
  and a second callback all resolve (failures as `unavailable` unless the
  code says otherwise; the first answer wins). It rejects with a
  `RangeError` only for a caller's mistake: a `timeoutMs` that is not a
  positive number.
- **A pending permission prompt keeps it pending.** The browser starts its
  timeout only once permission is granted, so a button awaiting this keeps
  saying it is locating while the prompt is open, which is true.
- A non-finite accuracy becomes `undefined`, never `NaN`.
- Related, NOT unified yet: `sensors/permission-checker.ts` carries its own
  error strings for the same three codes (a permission check, not a locate
  button). A follow-up can route them through `locateAdvice`.

## Examples

```ts
import {
  labelFor,
  locateAdvice,
  locateOnce,
} from 'gps-plus-slam-app-framework/utils/locate-state';

button.disabled = true;
button.textContent = 'Finding you...';
const outcome = await locateOnce(navigator.geolocation, { timeoutMs: 15_000 });
button.disabled = false;
if (outcome.kind === 'failed') {
  errorLine.textContent = `${labelFor(outcome.state)}: ${locateAdvice(outcome.state)}`;
}
```

## Tests

- `locate-state.test.ts`: idle and in-progress differ; every state has a
  label, and the labels are the OSM demo's texts; three failures, three
  labels and three different fixes (settings, the sky, none); the three spec
  codes and an unknown one; `locateOnce` with a mocked geolocation: granted
  (the fix and the options passed), each error code, no geolocation, a
  request that throws, coordinates that are not a place, a missing accuracy,
  a double callback, and a bad timeout.
- `locate-state.property.test.ts`: any code (or none) lands on a failure with
  a label and a fix.
