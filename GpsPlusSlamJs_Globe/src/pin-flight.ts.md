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
  - The data's time left is `assumedDataMs` (45 s) less the time since it
    started (its fix or link), and once that has run out, half again as
    long as it has taken. Partial progress is not extrapolated (DEC-FR2-9,
    below).
  - The high stretch's rate is the flight time left to the gate's ease
    zone over `arrivalMargin` (1.25) x the data's time left, between
    `minRate` (0.05) and 1: the camera reaches the zone about when the data
    is in, and only data later than predicted meets the ease into the gate.
  - The ease zone lasts `gateEaseMs` + 2 x `rateLagMs` of page time at the
    rate the clock actually runs at (sized in flight time it braked for
    data that was on time; sized by the target rate alone, a camera still
    fast met a small zone and stopped at the clamp).
  - With DEC-FR2-9's floor, `assumedDataMs` is a schedule: the camera
    reaches the gate about 1.15 x it after the data started. At 55 s that
    is after the 60 s cap, so it never waits at the gate, whatever the data
    takes (tested over four progress shapes, 20-90 s, from 65,000, 43,600
    and 10,100 km); later data is released by the cap. The R2 milestone
    review measured 45 s waiting about 5.5 s for data of 55 s or more.
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
  - while holding, `coldRate` (0.15);
  - while approaching, DEC-CF-6's stretch, never below the highest it has
    reached (`paceFloor`), times smoothstep(time to the gate / the ease
    zone); the clock never passes a closed gate, even in one long frame.
- **DEC-FR2-9** (round-2 plan 2026-10-07-2350 §8; the owner saw "fast, then
  a stop, then slow", measured in the browser as the rate following the
  data's lumpy progress: 0.5, 0.14, 0.78, 0.27, 1):
  - a press that knows its target starts at its stretch, not at the cold
    rate;
  - while approaching the pace only rises, except into the gate;
  - partial progress is not extrapolated: weighted by bytes, one Overpass
    tile is most of it, and extrapolating a 0.9 step that stalls cost 3-15
    s at the gate (none without; swept over four progress shapes and 2-90
    s of data, from 43,600 and 65,000 km). The cost: steady data lands a
    few seconds later (24 s instead of 20 s at 10 s of data);
  - the hold's pace is about the stretch a fix then sets (0.15; swept
    0.1-0.2), so the pace does not brake at the fix (0.5 braked by about
    3x). The camera's speed holds at a fix too, near or far, from 10,100,
    5,000 or 3,000 km (at least 0.9 of the speed before; 0.95 worst
    measured): on the round-2 travel curve the turn is part of the path.
    On CF1's path it dipped to 0.18-0.85 (R2 milestone review).
    The hold is slow: about 80 s to 2,000 km; a failed hold finishes at full
    pace;
  - a press whose data is already in starts at full pace.
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
  speed under 10 % of the median, no stop-and-go at 0.2); no data shape
  over 20-90 s waits at the gate.
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

## The meteor (round-3 plan 2026-10-08-2345, F1 and F1b)

`pressPin` takes `meteorDeg` (default 90, R1). The hold keeps its vertical
law. At the first plan to a target the flight takes the asked beta when
its arc has room for the line's sweep (a link started on the line), else
the flattest beta, no flatter than asked, that fits the arc (a press over
its own place: the arc is about 0, so R1, backing off no more than R1's
own dive track). Every flight of a meteor press lands at the asked angle
(`meteorLandDeg`, DEC-R3-12): a fitted steeper line and R1 ease to it below
the bend. The chosen beta is kept on the pin (`meteorDeg`) and by every
replan. A "full meteor" over the press's own place was tried and removed
(the milestone review).

`meteorLinkStart(ellipsoid, target, from, fromAltitudeM, landingM,
meteorDeg)`: where a link starts, ON its line and looking along it (the
path's own view: the flight never turns the camera to its line). Placed by
its arc from the target: the line's sweep (0.01 % more) plus the landing's
look-back at beta, at the target's radius (the plan review: the start's
own radius left it 0.2-0.5 degrees off on WGS84). Returns a `FlightStart`
with its `position` (the lab places its camera there).

Tests: a link on the asked meteor, a landing raise keeping it, a press
over its own place fitting a steeper line, a meteor link's pace without
stop and go, a link's view direction in space within 0.1 degree of its
first for the whole flight (beta 15-45, landings 1-5 km, from the south and
from the north), and a press landing at the asked angle whatever line it
fits (its own place, 300 km, 1,500 km; asked 30 and 45).

## The pace's lag (round-3 plan 2026-10-08-2345 §21; the owner on r810)

"A meteor, not a spaceship": when the data is in or the gate opens, the
clock's rate goes from its stretched pace to full pace. `pressPin`'s
`paceLagMs` (default `rateLagMs`, 800) and `paceStages` (1 or 2, default 1)
set how: one stage is a first-order lag that starts at its steepest; two
are critically damped stages of half the lag each, an S-curve that starts
with no acceleration (r(t) = T + (B + A t / tau) e^(-t / tau)), integrated
exactly per frame like the one stage. The pin carries `rateLagMs`,
`rateStages` and the first stage's `rateLead`; the gate's ease zone is
sized by the pin's own lag. Measured on a link from 65,000 km released by
the 60 s cap: the steepest rate change is 1.08 per second today, 0.26 at
2.5 s in two stages, 0.13 at 5 s, 0.08 at 8 s. The defaults are the flight
before until the owner's A/B pick. Tests: the defaults unchanged, the
S-curve's zero start and the spread, 30 against 60 Hz, the refusals.
