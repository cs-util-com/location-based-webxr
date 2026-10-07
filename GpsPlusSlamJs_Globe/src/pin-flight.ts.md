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
  - The clock never carries the camera down through `commitM` (about
    100 km) before the data is ready. The gate is where the path comes down
    through it from above; a press already below it has no gate (CF3 review
    finding 7: a gate at the start froze the camera).
  - The data opens the gate: the rate climbs to 1 with `rateLagMs`, so a
    camera stretched slow crosses the gate still accelerating. Once
    released nothing changes the speed with data.
- **DEC-CF-6** (owner, after the CF3 milestone review measured a stop at
  about 110 km when the data took longer than the flight): predict and
  stretch.
  - The data's time left is its progress so far extrapolated over the
    time since it started (its fix or link); before any progress,
    `assumedDataMs` (45 s) less the time passed, and once that has run out,
    half again as long as it has taken.
  - The high stretch's rate is the flight time left to the gate's ease
    zone over `arrivalMargin` (1.25) x the data's time left, between
    `minRate` (0.05) and 1: the camera reaches the zone about when the data
    is in, and only data later than predicted meets the ease into the gate.
  - The ease zone lasts `gateEaseMs` + 2 x `rateLagMs` of page time at the
    rate the clock actually runs at (sized in flight time it braked for
    data that was on time; sized by the target rate alone, a camera still
    fast met a small zone and stopped at the clamp).
  - Swept on 2026-10-07 (data over 2-60 s, fix at 0, 1.5 and 5 s): data
    that reports progress flies without a wait from 2 to 60 s (no
    stop-and-go at 0.3; at 0.1-0.2 only 45-60 s of data, a mild slow-then-
    faster, worst 0.89 of the median, where the 60 s cap opens the gate
    first); data that arrives all at once (one big tile) cannot be
    predicted beyond the assumption: no stop-and-go at 0.2 up to 30 s with
    45 s assumed (10 and 20 s with 20 and 30 s assumed), an eased wait
    beyond. The guarantee held in every case.
- **DEC-CF-5.** `safetyCapMs` (60 s) after the press, the gate opens
  regardless.
- **Cancelling.** A touch cancels in every moving phase, a failed hold
  still moving included (CF3 review finding 6), because the camera belongs
  to the controls.
- **The data's progress** belongs to the target: none is taken while
  holding, and a fix starts its own from nothing (CF3 review finding 9).
- **The hold** sits over where the camera looks: its view's ray against
  the surface under it, or straight down when it looks past the Earth
  (CF3 review finding 10).

## Public API

- `PIN_FLIGHT`: `holdM`, `commitM`, `safetyCapMs`, `coldRate` (the hold's
  rate), `rateLagMs`, `gateEaseMs`, `gateSamples`, `assumedDataMs`,
  `minRate`, `arrivalMargin`.
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
- `pinTouch(pin, nowMs)`: cancels in `holding`, `approaching`,
  `descending` and `failed` (a failed hold still moves).
- `pinFrame(pin, nowMs)` returns `{ pin, camera }`.
  - It advances the clock, lets the cap open the gate, and marks `landed`
    at the flight's end.
  - `camera` is null once the flight is cancelled.
- Phases: `holding`, `approaching` (gated), `descending`, `landed`,
  `failed`, `cancelled`.
  - A flight whose path never comes down through `commitM` has no gate
    and is `descending` from the start: nothing waits for its data, so it
    reports `landed` when it lands (PR #560 review); so is a flight whose
    new landing (`pinLanding`) removes its gate, at once.

## How it works

- The flight clock (`clockMs`) is the CF2 `Flight`'s time axis.
- Each event or frame advances it at a rate that steers towards the target
  rate with a first-order lag. The lag is integrated exactly, so two frame
  rates agree.
- The target rate:
  - 1 once released or descending;
  - while holding, `coldRate`;
  - while approaching, DEC-CF-6's stretch times smoothstep(time to the
    gate / the ease zone); the clock never passes a closed gate, even in
    one long frame.
- The gate is the flight time where the path first comes down through
  `commitM` from above (a 256-sample scan, then bisection), or none.
- Not `flight-pace`'s `stepPace`, which the plan's CF3 named: it paces
  one fixed path as a fraction, and this clock spans replans and a
  prediction. The lag integration is the same in form.
- Why one path and no replan for the data: a replan from a commit point
  cross-faded two geodesics and dipped the speed (measured during CF3).

## Invariants

Each one is tested, simulated at 60 Hz on the camera.

- Without a target, the flight holds above `holdM`, within about 600 km of
  where it looked, and it does move from the press.
- With a target, the camera never goes below `commitM` before the data is
  ready (also a property over random presses, targets, landings, fix times
  and data, steady or all at once: `pin-flight.property.test.ts`).
- Data over 15, 30 and 45 s (steady) is met at the gate without a wait (no
  speed under 10 % of the median, no stop-and-go at 0.2); data all at once
  after 40 s waits at the gate, never below it.
- After 60 s it goes on regardless and lands.
- **The flight is continuous when the fix and the data come during it.**
  - The fix can arrive during the hold, from a hold over New York, for Bern,
    Tokyo, Sydney (near-antipodal) and New York.
  - Criteria checked: (a) at 0.3 (the hold and the press's ramp run at
    half speed by design, and the window starts a second after the fix),
    (b) at 0.2, and (c).
  - The window runs from a second after the fix to the final settle.
  - The camera lands about one landing behind its target.
- Cold data slows the stretch down to 1,000 km by more than 1.5 x.
  Below `commitM`, a late progress report changes nothing.
- A failure ends at the hold, and the camera is still drawn.
- A touch cancels in every moving phase, a failed hold included.
- A press below `commitM` moves, data or not; the rate climbs at release
  with its lag; one long frame never passes a closed gate; the gate is
  eased into (no frame loses a tenth of its speed); a fix starts its data
  from nothing; a tilted camera holds over where it looks.
- A landing raised mid-flight (at 3, 8 and 12 s) lands exactly there,
  without a stop-and-go.

## Tests

`pin-flight.test.ts`, `pin-flight.property.test.ts`.
