# flight-travel.ts

The continuous flight's curve: from the camera's altitude down to the
landing, along one great circle, turning first and diving after, with the
view looking where the camera goes.

Source: round-2 plan
`GpsPlusSlamJs_Docs/docs/2026-10-07-2350-globe-flight-round-2-owner-feedback-plan.md`,
DEC-FR2-1 and DEC-FR2-2 as revised by its cold review (R1). `flight-path.ts`
flies it; it replaced van Wijk and Nuij's zoom-and-pan, whose descent ends
nearly vertical and so could not end at 45 degrees.

## Purpose

The owner, on r793 (2026-10-07): "the camera tilts to 45 degrees far too
early, and then does not fly where it looks. The camera must always look in
the direction of flight; that direction should END at 45 degrees", and
"first turn to the right starting point; it can be a curve, straight
towards the Earth's centre first, then bending".

## Public API

- `FLIGHT_TRAVEL`:
  - `bendM` 100 km: above the bend the camera travels straight down;
  - `bendLandings` 25: the bend is at least 25 landings up;
  - `landingAngleDeg` 45;
  - `turnPower` 3: the residual dies out as the cube of the log altitude
    left to its end;
  - `endMarginEFolds` 0.5: a start must be this far above an end to use it;
  - `horizonMarginDeg` 5;
  - `samples` 1,024 table intervals;
  - `radiusM` the mean radius.
- `bendAltitudeM(landingM)`: max(`bendM`, 25 x the landing).
- `travelLawDeg(altitudeM, landingM)`: the flight-path angle below the
  horizontal: 90 from the bend up, 45 at the landing and below, a smoothstep
  in the altitude's logarithm between. RangeError for a value that is not a
  positive number.
- `planTravel(h0, h1, arcRad, { landingM })` returns a `TravelCurve`:
  - `length`: path length in the CF1 measure (ds^2 = (d ln h)^2 +
    (ground / h)^2, ground on the mean radius);
  - `at(s)`: `{ share, h }`, the share of `arcRad` travelled and the
    altitude;
  - `pitchAt(s)`: the view's pitch, degrees;
  - `diveArcRad`: the dive's own ground track from the start (or the bend)
    down.
  - `landingM` is the law's landing (a hold that stops short of it passes
    the real one). A start at the landing's altitude is a level pan.
  - RangeError for altitudes that are not positive or an arc that is not
    finite.

## How it works

- **The dive's track.** A camera moving at the law's angle gains
  d(ground angle) = cot(angle) dh / (R + h). Integrated from the landing up,
  it is the ground left at each altitude; above the bend it adds nothing.
- **The curve**, in the altitude's logarithm: the ground left is the dive's
  track plus a residual (the rest of the arc) times q, which dies out as
  (log altitude left to its end)^3. The end is FIXED:
  - the bend, for a start at least half an e-fold above it (the residual is
    the turn, done above the bend);
  - else the bend's and the landing's geometric middle;
  - else the landing.
  - Self-similar: a replan from any point of the curve, to the same target
    and landing, flies on exactly. A turn eased over a window from the
    start reshaped the rest at every replan (measured while building R1).
- **A climb** (a landing raised over the camera) eases its residual over
  its whole path with a smoothstep: front-loaded, its sideways motion came
  at its lowest altitude.
- **The view.**
  - Above the bend: straight down (the turn the owner asked for first).
  - Below it, descending: the camera's actual direction of travel, the
    residual included, held between the horizon floor (dip + 5 degrees)
    and straight down (a start nearer than the dive's own track backs off,
    and the view does not turn round to look behind it).
  - A climb and a level pan look by the law of their altitude (45 degrees
    at a landing), so the flight ends without a snap: at the horizon floor,
    a replan in a flight's last milliseconds snapped the view up by about
    40 degrees.
- **By path length.** The length is a Simpson table of ds/dsigma; sigma by
  length is a cubic Hermite through it with the exact slopes, capped at 3
  (Fritsch and Carlson) so it stays monotone where the speed changes many
  times over within one interval.

## Invariants

Each one is tested (`flight-travel.test.ts`).

- The law is 90 above the bend, 45 at the landing, monotone between.
- The curve ends exactly; it descends all the way and never turns back,
  except a start nearer than the dive's own track, which backs off first.
- Below the bend the view is the direction of travel within half a degree
  (cases from 65,000, 25,600, 10,100 and 30,000 km).
- From a start above the bend, the turn is over by the bend: below it only
  the dive's own track is left, and the view is straight down above it.
- A start below the bend (a replan) absorbs a residual of -3 to 40 km and
  ends exactly, its view the travel (held at the horizon floor or straight
  down where those bind).
- The target stays on screen through the bend, at most 17.8 degrees from the
  view's centre for landings 2-12 km. Swept the bend at 30, 100 and 300 km:
  17.8, 17.7 and 17.6 degrees worst (the 25-landing floor keeps high
  landings in view); 100 km taken.
- The length is the CF1 measure to 1e-3; the motion has no kink.

## Tests

- `flight-travel.test.ts`; the flights built on it in `flight-path.test.ts`,
  `flight-path.property.test.ts`, `flight-replan.test.ts` and
  `pin-flight.test.ts`.
