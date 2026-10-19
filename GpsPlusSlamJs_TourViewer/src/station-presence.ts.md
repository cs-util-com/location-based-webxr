# station-presence.ts

## Purpose

Which ONE station the visitor is at: the station whose content shows (visitor
plan `GpsPlusSlamJs_Docs/docs/2026-10-18-2349-visitor-station-content-at-radius-plan.md`
§3, M1; D7, D9, V-D0, V-D5). Separate from "found", which stays the story's
latch (`station-run.ts`): presence comes and goes as the visitor walks. Pure;
the store applies it (`visitor-guide-slice.ts`), the guide feeds it
(`station-guide.ts`).

## Public API

- `nextPresentStation(presentId, candidates, marginM): string | null` - the
  present station after one judged position.
  - `candidates: PresenceCandidate[] | null` - every station measured at the
    judged position (`{ id, distanceM, foundM, foundExitM }`); null when
    nothing may be judged: the result is `presentId` unchanged.
  - `marginM` - the takeover margin (`takeoverMarginM`); NaN or negative
    reads as 0.
- `takeoverMarginM(judgedAccuracyM): number` - the margin for a judged
  position: the judged accuracy (the raw fixes' without a code, null with
  one), at least `TAKEOVER_MARGIN_MIN_M` (1 m), at most the accuracy
  ceiling (25 m). Null or NaN: the floor.
- `TAKEOVER_MARGIN_MIN_M` - 1 m, the floor (see Evidence).
- `presenceCandidates(stations, distances, bandsOf)` - every station with a
  distance, with its found radius and found exit from `bandsOf` (the
  guide passes `judgedStationBands`); null when none has a distance.
- `type PresenceCandidate`.

## Invariants & assumptions

- **Enter** inside the found radius (`distanceM <= foundM`; V-D0: the
  circle the editor shows).
- **Leave** past the found exit (`distanceM > foundExitM`), the found radius
  plus the band (`station-bands.ts`: the raw accuracy, at least 1.5 m,
  without a code; exactly 1.5 m with one).
- **One at a time** (D9). A neighbour B takes over from the present A only
  when B's found radius holds the position AND A is past its exit or
  `d_B + m < d_A` (strict). With none present (or A past its exit), the
  nearest station whose found radius holds the position; list order on a
  tie.
- **Hold** on `candidates === null`. A present station absent from a
  non-null list (no longer in the tour) or with a non-finite number is
  dropped; a candidate with a non-finite number never becomes present.
- **Not the order** (V-D5): the candidates are every station of the tour,
  offered or not, found or done. The story still starts only at an offered
  station (`station-run.ts`).
- Guarantees, pinned by the property tests: never more than one station
  present; the present station's exit holds the judged position; none
  present only while no found radius holds it; a visitor standing still
  under noise below half the band and half the margin never goes back to a
  station it left and never back to none.

## Evidence (`station-presence.sweep.test.ts`)

A visitor walks a row of five stations, dwells at each and walks on. wrong =
share of steps inside some found radius (by the TRUE position) on which a
different station is present; extra = present-station changes per station
visited beyond the true sequence's own (above 0 is flicker). Measured
2026-10-19:

- **Museum, a code (band 1.5 m in production, swept 0.5-3 m), 5 cm AR
  jitter**, overlapping and tangent circles (spacing 3-6 m, radius 1-3 m,
  drift 0-2 m):
  - m 0: wrong 8.9 %, extra 0.33 (up to 2.6 per visit in single cells);
  - m 0.5: 9.4 %, -0.20; m 1: 10.8 %, -0.20; m 1.5: 13.3 %; m 2: 17.0 %;
    m 3: 26.2 %. Every margin from 0.5 m stops the flicker; each further
    0.5 m keeps the previous exhibit 1-4 points longer.
  - Circles apart: m changes nothing up to 1 m (wrong 2.4 %).
  - Drift decides the wrong rate, not m: at the floor 1.6 % with no drift,
    5.3 % at 1 m, 15.1 % at 2 m (and 31.7 % missed: the drifted position
    leaves a small circle). The creator's fix is a smaller radius or more
    codes (plan §6).
- **Museum jitter** (band 1.5 m, drift 0/1/2 m): the parameter that
  reverses the indoor verdict, with no field figure yet.
  - 0.05 m: 0.5 m and 1 m both stop the flicker (wrong 10.1 / 11.7 %).
  - 0.25 m: 0.5 m flickers (extra 0.14), 1 m does not (-0.15, wrong
    10.4 %).
  - 0.5 m: 1 m flickers (0.61), 1.5 m nearly not (0.17), 2 m 0.06.
- **Outdoor, no code, R 25 m** (spacing 25-50 m, `raw` Gauss-Markov noise,
  band factor 1):
  - accuracy 3/5 m: every margin is fine (extra at most 0.38).
  - 8 m: fixed 0-3 m leave 1.68-0.54 extra switches per visit; the
    accuracy as margin 0.04, wrong 3.2 % against 3.0-3.4 %.
  - 12 m: fixed 4.47-2.40; the rule 0.17, wrong 5.9 % against 6.5-7.2 %.
  - 20 m: fixed 10.8-8.0; the rule 1.16, wrong 14.9 % against 16.9-17.6 %.
  - The band factor (0.5/1/2 x accuracy) does not reverse it: over all
    outdoor cells the rule gives extra 0.79/0.26/0.14 against 2.66/2.18/2.06
    at m 3, wrong 5.4-5.7 % against 5.9-6.1 %. (An exploratory run with
    m = the band at factor 2, i.e. twice the accuracy, overshot: wrong up to
    34 % at 20 m.)
- **Verdict:** no single value in 0-3 m serves both. The shipped rule is
  `takeoverMarginM`: the judged accuracy, floor 1 m.
  - Cells where another value wins: 0.5 m indoors at 5 cm jitter (1.4
    points less wrong); 1.5-2 m indoors at 0.5 m jitter; outdoors at 3-5 m
    accuracy any value is as good.
  - Reversed by: a field measurement of the code-aligned position's jitter
    (below about 0.1 m: 0.5 m; about 0.5 m: 1.5 m), or field data showing
    the raw accuracy understates the noise (then the outdoor margin would
    need a factor above 1).
  - Not simulated: the alignment re-solving on a GPS fix (a jump, not
    jitter), several codes, and a visitor looking at an exhibit from
    outside its circle.

## Examples

```ts
const next = nextPresentStation(
  "a",
  presenceCandidates(stations, distances, (s) =>
    judgedStationBands(s, rawAccuracyM, codeLinedUp),
  ),
  takeoverMarginM(judgedAccuracy(rawAccuracyM, codeLinedUp)),
);
```

## Tests

- `station-presence.test.ts` - enter, leave, the nearest on entry, the
  takeover by `m` (strict) and past the exit, hold on no position, a
  station gone from the list, non-finite input, the flicker at m 0 that the
  margin removes, `takeoverMarginM`'s floor, ceiling and nonsense, and the
  candidates (every station, V-D5; null when none measured).
- `station-presence.property.test.ts` - one present at most with its exit
  holding the position, on any walk with gaps; no flicker under noise below
  half the band and half the margin (fails with the margin removed); noise
  up to four times the band with production's judged bands and margin.
- `station-presence.sweep.test.ts` - the Evidence above
  (`STATION_PRESENCE_SWEEP_OUT=<file>` writes every cell).
- `station-guide.test.ts` ("the present station") - the guide's wiring.
