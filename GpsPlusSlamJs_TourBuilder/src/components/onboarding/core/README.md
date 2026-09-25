# onboarding/core — the pure permissions gate

Framework-free, browser-API-free. No `getUserMedia`, no `geolocation`, no
`AudioContext` — those live in `view/onboarding-adapter.ts` and
`view/onboarding-view.ts`. Same `(state, action)` → same next state.

## Public API (`permission-gate.ts`)

```ts
gateReducer(state: GateState, action: GateAction): GateState

createInitialGateState(required?: PermissionKind[]): GateState  // default: camera + gps
canGrantAccess(state: GateState): boolean   // no required item is 'requesting'
canStart(state: GateState): boolean         // every required item is 'granted'
explanationFor(state: GateState, kind: 'camera' | 'gps'): string | null
```

- **`GateState`** — `{ camera, gps, cameraMessage?, gpsMessage?, audioUnlocked, required }`.
  `required` lists the kinds Start waits on and Grant Access prompts for
  (authoring: `['gps']`; viewing: both).
  `camera`/`gps` are each `'unknown' | 'requesting' | 'granted' | 'denied'`.
- **`GateAction`** — `grantAccessRequested` (required kinds → `'requesting'`, clears any
  stale message), `permissionResult` (one kind → `'granted'`/`'denied'` +
  message), `audioUnlocked` (only ever flips that one flag).

## Invariants

1. **Real permission state only.** There is no action that lets a caller mark
   an item granted without going through `permissionResult` — the adapter is
   the only place that dispatches it, driven by the browser's own answer.
2. **No core-invented copy.** `explanationFor` returns exactly whatever
   `message` the caller passed on `permissionResult`; the core never
   hardcodes user-facing text. One source of truth (the framework's
   `PermissionStatus.error`), never two copies drifting apart.
3. **`audioUnlocked` is independent of `camera`/`gps`.** Start being enabled
   (`canStart`) and Start having been clicked are different facts — the
   reducer never conflates them.
4. **Re-requesting clears stale messages.** `grantAccessRequested` resets
   `cameraMessage`/`gpsMessage` to `undefined`, so a lingering red
   explanation from a previous denial doesn't show through a fresh
   `'requesting'` state.

## Tests

`permission-gate.test.ts` — initial state, the requesting transition, partial
resolution (one kind settles while the other is still pending), both-granted
enabling Start, a denied result's message surfacing unchanged, a stale
message clearing on retry, and `audioUnlocked` not touching `camera`/`gps`.
