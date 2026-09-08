# visitor-screen.ts

## Purpose

The visitor's one screen (guided-setup plan DEC-N2, §2.1): shows the
consent copy for a `?qr=` launch, hides the creator's setup, re-words the
AR hint, and owns the LOCATION GATE the AR entry consults before a tap may
start a session.

## Public API

- `wireVisitorScreen({ mode, seams, dom, renderArEntry }): { locationGate }`
  - `dom`: `screen` (hidden for a creator), `creatorOnly` (hidden for a
    visitor), `arHint` (re-worded for a visitor), `errorBox`.
  - `renderArEntry` is called whenever the gate's state changes so the AR
    button re-labels ("Allow location" / "Start the tour").
- `LocationGate`: `pending()` (a tap should request the location rather
  than start AR) and `request()` (the location-only tap; resolves true when
  a position was obtained).
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
- A refused or failed request keeps the gate pending and writes the
  reason to `errorBox` (visible pre-AR; it is outside the DOM overlay).
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

## Tests

`visitor-screen.test.ts` - the pure rule (property over the four states),
creator mode leaves everything visible with the gate cleared, visitor mode
hides the setup and clears the gate on a granted query, and the
prompt → refused → granted sequence with the error text.
