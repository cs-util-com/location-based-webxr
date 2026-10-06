# visitor-screen.ts

## Purpose

The visitor's one screen (guided-setup plan DEC-N2, §2.1): shows the
consent copy for a `?qr=` launch, hides the creator's setup, re-words the
AR hint, and owns the LOCATION GATE the AR entry consults before a tap may
start a session.

## Public API

- `wireVisitorScreen({ mode, seams, dom, renderArEntry }): { locationGate }`
  - `dom`: `screen` (hidden for a creator), `measureStep` (step 4, opened
    for a visitor - it is a `<details>` since the flow rework and its
    summary is creator-only, so nothing else could ever open it, and its
    content is the visitor's Start button), `creatorOnly` (hidden for a
    visitor), `arHint` (re-worded for a visitor), `errorBox`.
  - `renderArEntry` is called whenever the gate's state changes so the AR
    button re-labels ("Allow location" / "Start the tour").
- `LocationGate`: `pending()` (a tap should request the location rather
  than start AR), `busy()` (a request is in flight; the button says so),
  and `request()` (the location-only tap; resolves the outcome).
- `gateAfterRequest(outcome)` - pending stays only on `"denied"`: a
  granted permission without a fix ("unavailable": indoors, a timeout)
  clears the gate, because the session's own watch tolerates a slow fix
  and locking the visitor out would be the worse failure (M2 review #1).
- `locationRequestNotice(outcome): { error, hint }` - an `error` (the
  alert box) only for a denial (browser settings); otherwise a `hint` that
  replaces the text above the button and says what the next tap does and
  what to do once AR starts: "Location allowed - now tap Start the tour,
  then point your phone at the tour's code (on the poster)." or "No GPS fix yet - that is
  fine outdoors ... Tap Start the tour." (UI round 1, U1, review F11: the
  second tap used to be silent, and the benign no-fix note read as a red
  alert). The visitor hint names "the tour's code (on the poster)", not
  "the printed code you scanned" (a link-opener scanned none, review F15).
- `type LocationRequestOutcome = "granted" | "denied" | "unavailable"`.
- `locationTapNeeded(permission): boolean` - pure: true for anything but
  `"granted"`.
- `type LocationPermission = "granted" | "prompt" | "denied" | "unknown"`.

## Invariants & assumptions

- **Why the gate exists:** a WebXR session needs a user activation, and the
  framework's `enable()` awaits the geolocation prompt before `initAR`; a
  visitor answering the prompt spends the activation. Requesting the
  location on its own tap first makes `enable()`'s request resolve without
  a prompt.
- Pessimistic until `seams.queryGeolocationPermission()` answers: a tap
  that arrives first requests the location (harmless), never starts AR.
- Only a DENIED request keeps the gate pending; the reason goes to
  `errorBox` (visible pre-AR; it is outside the DOM overlay). One request
  runs at a time (`busy`).
- In creator mode the gate is never pending and nothing is hidden.

## Examples

```ts
const visitor = wireVisitorScreen({
  mode,
  seams,
  dom,
  renderArEntry: () => hooks.renderArEntry(),
});
// in ar-entry: if (locationGate.pending()) { await locationGate.request(); return; }
```

- **The intro asks the visitor to keep the code in view while moving
  slowly** (plan §67 #4). Not because the gate needs angles - it needs 5
  views that fit within 1.5 px, and a wall code held still can settle -
  but because views from different angles resolve the code's tilt (plan
  §16 #1). An angular-diversity gate from b7 would make it a requirement.

## Tests

`visitor-screen.test.ts` - the pure rule (property over the four states),
creator mode leaves everything visible with the gate cleared, visitor mode
hides the setup and clears the gate on a granted query, and the
prompt → refused → granted sequence with the error text.
