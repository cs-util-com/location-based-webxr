# pin-flight.ts

The pin's flight from the press to the landing. It is pure, and it is driven
by events and frames.

Source: continuous-flight plan
`GpsPlusSlamJs_Docs/docs/2026-10-07-0941-globe-continuous-flight-plan.md`,
CF3. It builds on `flight-path.ts` and `flight-replan.ts`.

## Purpose

The owner's decisions that this module puts into practice:

- **DEC-CF-4b.** The flight starts at the press.
  - Without a target it holds above `holdM` (about 2,000 km), over where
    the camera already looks. It never makes a sideways guess: the intro's
    fallback target is New York.
  - When a fix arrives, the flight flies on. That is a replan above the
    band, which CF2 proved continuous, at any distance.
  - When the fix fails, the flight ends at the hold.
- **DEC-CF-3b.** "The speed of the fly-down should start so slow that there
  is guaranteed enough time for the data to load before the camera arrives."
  - With a target, the flight flies its final path at once, and its own
    clock is gated.
  - While the data is not ready, the clock runs at `coldRate` (0.5). It
    eases to a stop over `gateEaseMs` of flight time just before the path
    reaches `commitM` (about 100 km).
  - The data opens the gate: the rate returns to 1, with `rateLagMs`.
  - Below `commitM` the clock always runs at 1, so nothing near the ground
    changes speed with the data.
- **DEC-CF-5.** `safetyCapMs` (60 s) after the press, the gate opens
  regardless.
- **Cancelling.** A touch cancels in every moving phase, because the camera
  belongs to the controls.

## Public API

- `PIN_FLIGHT`: `holdM`, `commitM`, `safetyCapMs`, `coldRate`, `rateLagMs`,
  `gateEaseMs`, `gateSamples`.
- `pressPin(ellipsoid, nowMs, camera, { target, landingM, progress })`
  returns a `PinFlight`.
  - `camera` is a `FlightStart`, as the intro left the camera.
  - `target` is null until a fix (or a link) arrives.
  - `progress` is the data's progress so far, from 0 to 1.
  - Throws a RangeError for a non-finite time or a landing that is not
    positive.
- `pinFix(pin, nowMs, target)`: while holding, flies on to the fix.
- `pinFailed(pin, nowMs)`: while holding, ends at the hold (phase `failed`).
- `pinProgress(pin, nowMs, progress)`: the data's progress, ratcheted. At 1
  the gate opens.
- `pinLanding(pin, nowMs, landingM)`: a new landing (the target's height
  tile arrived and the floor rose, cold review finding 11) replans the
  flight to it while approaching or descending (a CF2 replan; the gate is
  found again). RangeError for a landing that is not positive.
- `pinTouch(pin, nowMs)`: cancels in `holding`, `approaching` and
  `descending`.
- `pinFrame(pin, nowMs)` returns `{ pin, camera }`.
  - It advances the clock, lets the cap open the gate, and marks `landed`
    at the flight's end.
  - `camera` is null once the flight is cancelled.
- Phases: `holding`, `approaching` (gated), `descending`, `landed`,
  `failed`, `cancelled`.

## How it works

- The flight clock (`clockMs`) is the CF2 `Flight`'s time axis.
- Each event or frame advances it at a rate that steers towards the target
  rate with a first-order lag. The lag is integrated exactly, so two frame
  rates agree.
- The target rate:
  - 1 once released or descending;
  - before that, the cold pace, `coldRate` + (1 - `coldRate`) x
    `progress`;
  - in `approaching`, multiplied by smoothstep((gate - clock) /
    `gateEaseMs`), and the clock never passes a closed gate.
- The gate is the flight time where the path first reaches `commitM`. It is
  found with a 256-sample scan followed by bisection.
- Why one path and no replan for the data: a replan from a commit point
  cross-faded two geodesics and dipped the speed (measured during CF3).

## Invariants

Each one is tested, simulated at 60 Hz on the camera.

- Without a target, the flight holds above `holdM`, within about 600 km of
  where it looked, and it does move from the press.
- With a target, the camera never goes below `commitM` before the data is
  ready.
- After 60 s it goes on regardless and lands.
- **The flight is continuous when the fix and the data come during it.**
  - The fix can arrive during the hold, from a hold over New York, for Bern,
    Tokyo, Sydney (near-antipodal) and New York.
  - Criteria checked: (a) at 0.3 (the cold pace's half speed is by design),
    (b) at 0.2, and (c).
  - The window runs from a second after the fix to the final settle.
  - The camera lands about one landing behind its target.
- Cold data slows the stretch down to 1,000 km by more than 1.5 x.
  Below `commitM`, a late progress report changes nothing.
- A failure ends at the hold, and the camera is still drawn.
- A touch cancels in every moving phase.
- A landing raised mid-flight (at 3, 8 and 12 s) lands exactly there,
  without a stop-and-go.

## Tests

`pin-flight.test.ts`.
