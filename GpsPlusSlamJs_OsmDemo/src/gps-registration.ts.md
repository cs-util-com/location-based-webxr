# `gps-registration.ts`

## Purpose

Turns arriving GPS fixes into the framework's alignment loop: session lifecycle,
the coordinator handler, and both compass sensors. This is the block the demo
was missing — it had fixes and spent them only on fetching.

## Public API

- `createGpsRegistration({ store, getArPose, seams, now? }) → GpsRegistration`
  - `start(): Promise<void>` — dispatches `startSession`, builds the
    coordinator handler, requests the orientation permission and starts both
    sensor watches. **Idempotent.** Never rejects: a refused orientation
    permission degrades to GPS-only yaw rather than aborting AR entry.
  - `stop(): void` — dispatches `endSession` and stops both watches.
    **Idempotent.**
  - `onFix(position: GpsPosition): void` — hands a fix to the coordinator.
    **A no-op before `start` and after `stop`.**
- `toGpsPosition(fix: LocatedFix) → GpsPosition` — the demo→framework rename at
  the boundary (`lng`→`lon`, `accuracyM`→`accuracy`).
- `GpsRegistrationSeams<TStore, TPose>` / `GpsRegistrationOptions<TStore, TPose>`
  / `StoreAction`.

## Invariants & assumptions

- **`startSession` first, or nothing happens at all.**
  `createGpsPositionHandler` returns early unless `recording.isRecording`
  (`gps-event-coordinator.ts:184-187`), so a loop wired without it runs on every
  fix and produces no event, no alignment and no error. That silence is the
  exact bug this module fixes; it would be trivially reintroduced by anyone who
  reads the dispatch as bookkeeping.
- **`endSession` on stop is NOT optional here**, and `AnchorStarter` — the app
  this otherwise mirrors — omits it. It never leaves AR, so it never pays. This
  demo returns to a live map whose locate watch keeps running, so without the
  dispatch every later desktop fix would register against a null AR pose:
  growing `gpsElements`, a re-solved alignment per click, a warning per fix.
- **One watch, never two.** This module takes a fix rather than fetching one.
  Calling `startGpsWatch` on AR entry (as `AnchorStarter` and the `RecorderApp`
  do) would open a second `watchPosition` beside Leaflet's, and two sources for
  the same fact can disagree about which fix is current — the alignment would be
  solved against positions the scene was never fetched for. A guard in
  `ar-walk-wiring.test.ts` asserts `startGpsWatch` appears nowhere in `main.ts`.
- **Registration is per-fix; refetching is per-100 m.** They were the same thing
  while fixes only moved the map. Gating registration behind the refetch
  distance would re-solve the alignment once per 100 m of walking, so the city
  would lurch at each gate opening instead of tracking the user.
- **Both compass mechanisms, because they feed different fields.**
  `DeviceOrientation` supplies the event's device rotation;
  `AbsoluteOrientationSensor` supplies `absoluteOrientation`, and the library's
  cold-start yaw override — **default ON** — engages only when that is non-null.
  Starting one and not the other leaves the override inert with nothing
  reporting it, which is the state every consumer except the Recorder is in.
- **The absolute-orientation watch is fire-and-forget**, as the Recorder does
  it: the sensor is unavailable off Chrome Android and its absence is a clean
  no-op. Awaiting it would make AR entry wait on a sensor that may never arrive.
- **The seams are generic, not `unknown`.** `unknown` is contravariantly wrong
  for the store and the compiler says so; the first draft used a cast at the
  call site and it was hiding two genuine mismatches (the store type and the
  orientation handler's parameter).
- **`toGpsPosition` defaults a missing accuracy to `Infinity`.** `accuracy` is
  required and the library's horizontal weighting divides by it, so the missing
  case must become a number. Infinity drives the weight to zero — "this fix says
  nothing about where we are" — while any small default would make the least
  trustworthy fixes the most influential.

## Example

```ts
const registration = createGpsRegistration({
  store,
  getArPose: getCurrentArPose,
  seams: { createGpsPositionHandler, startSession, endSession, ... },
});

// AR entry, beside the watch that feeds it:
void registration.start();
// every fix, ungated:
registration.onFix(toGpsPosition(fix));
// AR exit:
registration.stop();
```

## Tests

`gps-registration.test.ts` — session dispatched on start and ended on stop; a
fix reaches the coordinator; fixes before start and after stop are ignored; both
sensors started and both stopped; a refused orientation permission still leaves
the GPS half live; idempotent start/stop; and `toGpsPosition`'s field mapping
including the `Infinity` accuracy default.

`ar-walk-wiring.test.ts` covers the connection to `main.ts` — that registration
happens before the refetch gate, that start/stop are paired with the watch, that
no second GPS watch exists, and that `onRestarted` is passed in `ar-mode.ts`.
Those are source-text guards: they prove the calls are written, not that they
run. See that file's header for why `main.ts` cannot be unit-run.

## Not covered here

Whether the city ends up in the right place on a real phone. Everything above is
headless: dispatch counts, call ordering, payload fields. The visual
confirmation needs a device and is explicitly the owner's step.
