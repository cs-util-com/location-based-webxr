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
  - `marginPerTurn` 0.1, `endMarginEFolds` 0.01, `maxMarginEFolds` 0.5: a
    start must lie above its turn's end by e-folds in proportion to the turn
    it has left (its sideways distance over its altitude, x 0.1), between
    0.01 and 0.5, else the next end down (the R1 re-review's sweep: 0.5 and
    at most 2 spilled big turns below the bend for starts up to 739 km, the
    view 70-89 degrees off the travel there). A big turn from just above the bend
    crammed into a sliver of descent turned into the dive at a corner (the
    speed read 0.79 there); none at all stalled a start a hair above the
    bend in a window of 1e-15; a fixed 0.5 snapped the view at the bend
    (the R1 milestone review). Along an existing curve the turn left at a
    replan is tiny, so a replan finds the same end;
  - `horizonMarginDeg` 5;
  - `samples` 1,024 table intervals, half of them inside the residual's
    window;
  - `radiusM` the mean radius.
- `bendAltitudeM(landingM)`: max(`bendM`, 25 x the landing).
- `travelLawDeg(altitudeM, landingM)`: the flight-path angle below the
  horizontal: 90 from the bend up, 45 at the landing and below, a smoothstep
  in the altitude's logarithm between. RangeError for a value that is not a
  positive number.
- `planTravel(h0, h1, arcRad, { landingM })` returns a `TravelCurve`:
  - `length`: path length in the CF1 measure (ds^2 = (d ln h)^2 +
    (ground / h)^2, ground on the mean radius);
  - `at(s)`: `{ share, angle, residualLeft, h }`: the share of `arcRad`
    travelled, the SIGNED ground angle travelled along the course (the
    camera turns by it: R1 milestone review finding 1), the share of the
    residual still to fly (the caller fades a start's offset from the
    course's plane with it), and the altitude;
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
  - the bend, for a start far enough above it (by its margin: the residual
    is the turn, done above the bend);
  - else the bend's and the landing's geometric middle;
  - else the landing.
  - Self-similar: a replan from any point of the curve, to the same target
    and landing, flies on along the very same curve (tested: replans
    of a flight from 10,100 km, from 1,000 down to 10 km, within 0.2 % of
    the altitude; of one from 500 km, 0.11-0.26 %, and 1.43 % for a replan at
    8 km, inside the 1.5 s velocity join, gone when it ends: filed). A turn eased over a window from the
    start reshaped the rest at every replan (measured while building R1).
- **A climb** (a landing raised over the camera) spreads its residual
  evenly over its whole path (linear in sigma): front-loaded, its sideways
  motion came at its lowest altitude; a smoothstep, whose slope is 0 at the
  start, left straight up and turned sideways within about a millisecond, a
  corner a replan's join could not hide (14 of 138 climb replans jumped up
  to 28 % in velocity; R4/R5 milestone review, 2026-10-08). Linear has no
  corner at the start, and the clock's settle brakes its end.
- **The view.**
  - Above the bend: straight down (the turn the owner asked for first).
  - Below it, descending: the camera's actual direction of travel, the
    residual included, but never shallower than the law, held between the
    horizon floor (dip + 5 degrees) and straight down (a start nearer than
    the dive's own track backs off, and the view does not turn round to
    look behind it). In the dive itself travel and law agree; where the
    camera still moves sideways (a turn below the bend, a residual low
    down, a nearly level replan at the end) a view on the travel looked at
    the horizon and snapped at the end (the R1 milestone review: up to 75
    degrees in a frame at the bend, 38.6 at a late replan).
  - A climb and a level pan look by the law of their altitude (45 degrees
    at a landing), so the flight ends without a snap.
- **The table** has half its knots inside the residual's window, so a short
  window is resolved as finely as a whole curve.
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
  on the design flights (cases from 65,000, 25,600, 10,100 and 30,000 km),
  and never shallower than the law anywhere.
- From a start far enough above the bend (by its margin), the turn is over
  by the bend: below it only
  the dive's own track is left, and the view is straight down above it.
- A start below the bend (a replan) absorbs a residual of -3 to 40 km and
  ends exactly, its view the travel or the law, the steeper (held at the
  horizon floor or straight down where those bind).
- A pan at the landing's altitude looks as the landing does (45 degrees).
- The target stays on screen through the bend, at most 17.8 degrees from the
  view's centre for landings 2-12 km. Swept the bend at 30, 100 and 300 km:
  17.8, 17.7 and 17.6 degrees worst (the 25-landing floor keeps high
  landings in view); 100 km taken.
- The length is the CF1 measure to 1e-3; the motion has no kink.

## Tests

- `flight-travel.test.ts`; the flights built on it in `flight-path.test.ts`,
  `flight-path.property.test.ts`, `flight-replan.test.ts` and
  `pin-flight.test.ts`.

## The meteor (round-3 plan 2026-10-08-2345, F1 and F1b)

The owner on r805: "very steep, then 45 rather late; like a meteor"; on
r807: "a continuous direction, never bending abruptly", with his decisions
DEC-R3-8..12. `travelLawDeg(h, landing, meteorDeg, landDeg?)` with beta
below 90 is a straight line through space meeting the landing at beta,
cos(gamma) = (R + landing) cos(beta) / (R + h). `landDeg` is the angle it
lands at: by default beta itself, so the law is the line all the way down
(no bend: DEC-R3-9), and 45 for R1 (beta 90, the default, R1 exactly). A
different landing angle (a press that fitted a steeper line than asked,
landing at the asked angle: DEC-R3-12; R1 in a meteor press) keeps the line
above the bend and eases from the line's own angle at the bend to it below
(continuous). `planTravel` takes `meteorDeg` and `meteorLandDeg`: a meteor
looks along its travel at every altitude with no horizon floor (DEC-R3-10;
R1 looks straight down above the bend and keeps the floor).

- `meteorDiveArcRad(h0, landing, beta, landDeg?)`: the ground arc the law
  sweeps from h0 to the landing (Simpson in ln h): about 41.4 degrees from
  65,000 km at beta 45, about 16 km for R1.
- `fitMeteorDeg(h0, landing, arc, beta)`: the flattest beta, no flatter
  than asked, whose sweep fits the arc, every candidate landing at the
  asked angle, so the family is whole up to R1 and the sweep falls
  strictly with beta (bisection): a press over its own place gets 90 (R1,
  easing to the asked angle).

Tests: the law (R1 at 90, the line at every altitude ending at beta, a
fitted line and R1 easing continuously to an asked landing angle, the
angles' range), the sweep and the fit (properties: the sweep falls with
beta among the lines, and up to R1 at a fixed landing angle), and a curve
on the line looking along it at every altitude, landing at beta.
