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
- `presentAfterWeakFix(presentId, candidates, accuracyM): string | null` -
  the present station after a fix too weak to guide by (above the accuracy
  ceiling, `tooWeakToGuide`; PR review S1): never enters or hands over, but
  returns null when `d_present - accuracy > foundExit` (an underpass fix that
  places the visitor well away). Holds on no candidates, the present station
  missing from them, or a nonsense distance or accuracy.
- `takeoverMarginM(judgedAccuracyM, codeLinedUp): number` - the margin for a
  judged position: the floor for a code's position; otherwise the reported
  accuracy, at least `TAKEOVER_MARGIN_MIN_M` (1 m), at most the accuracy
  ceiling (25 m), with a missing, zero, negative or NaN accuracy read as
  the ceiling (as `stationBands`' clamp reads it; PR review N1).
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
- **Hold** on `candidates === null` (plan §3: a tracking drop, a stale
  fix). A present station absent from a non-null list (no longer in the
  tour) or with a non-finite number is dropped; a candidate with a
  non-finite number never becomes present.
- **Not a hold** (PR review S1): a fix too weak to guide by applies the exit
  only (`presentAfterWeakFix`); the caller (`station-guide.ts`) clears a
  station a code made present once the code goes and nothing else can judge
  (a moved poster's veto), and at the AR session's end. Before the review
  presence held on both, so a vetoed poster's station stayed present for
  the rest of the session.
- **Not the order** (V-D5): the candidates are every station of the tour,
  offered or not, found or done. The story still starts only at an offered
  station (`station-run.ts`).
- **No cap below the spacing** (PR review S4): where the margin exceeds the
  stations' spacing a takeover is impossible (`d_A - d_B <= |AB|`), and the
  sweep found a cap at half the spacing changes nothing but the flicker
  (Evidence). It ships uncapped until V-D2.
- Guarantees, pinned by the property tests: never more than one station
  present; the present station's exit holds the judged position; none
  present only while no found radius holds it; a visitor standing still
  under noise below half the band and half the margin never goes back to a
  station it left and never back to none.

## Evidence (`station-presence.sweep.test.ts`)

A visitor walks a row of five stations, dwells at each and walks on.

- wrong = share of steps inside some found radius (by the TRUE position) on
  which a different station is present; miss = share on which none is.
- flicker = switches of the present station while the true station has not
  changed since the previous switch, per station visited, counted directly
  (PR review S2: the earlier "extra switches" was net of the true sequence,
  so a missed station could hide a flicker).
- returns = switches back to a station left at most N s before, N 2/5/10 s.
  A margin HOLDS when returns stay at most 0.05 per visit for every N.
- The whole sweep runs in about 2-2.5 s (measured 1.94-2.47 s, 2026-10-19).

Measured 2026-10-19 (16-24 seeds per outdoor cell, 10 per museum cell):

- **Museum, a code** (band 1.5 m, the margin the floor), overlapping and
  tangent circles (spacing 3-6 m, radius 1-3 m, drift 0/1/2 m), by the
  aligned position's white jitter - the parameter that decides the floor,
  with no field figure yet:

  | jitter | m         | wrong  | flicker/visit | returns/visit (2/5/10 s) |
  | ------ | --------- | ------ | ------------- | ------------------------ |
  | 0.05 m | 0         | 10.9 % | 0.50          | 0.41 / 0.44 / 0.46       |
  | 0.05 m | 0.5       | 11.5 % | 0.02          | 0.00 / 0.00 / 0.00       |
  | 0.05 m | 1 (floor) | 12.9 % | 0.02          | 0.00 / 0.00 / 0.00       |
  | 0.05 m | 1.5       | 15.4 % | 0.02          | 0.00 / 0.00 / 0.00       |
  | 0.05 m | 2         | 19.3 % | 0.03          | 0.00 / 0.00 / 0.00       |
  | 0.05 m | 3         | 30.1 % | 0.04          | 0.00 / 0.00 / 0.00       |
  | 0.25 m | 0.5       | 8.9 %  | 0.38          | 0.23 / 0.29 / 0.31       |
  | 0.25 m | 1 (floor) | 9.6 %  | 0.07          | 0.01 / 0.01 / 0.02       |
  | 0.25 m | 1.5       | 11.8 % | 0.07          | 0.00 / 0.00 / 0.00       |
  | 0.5 m  | 1 (floor) | 10.0 % | 0.79          | 0.47 / 0.58 / 0.64       |
  | 0.5 m  | 1.5       | 10.7 % | 0.36          | 0.12 / 0.18 / 0.21       |
  | 0.5 m  | 2         | 12.4 % | 0.25          | 0.05 / 0.07 / 0.08       |
  - The 1 m floor holds to 0.25 m of jitter; 0.5 m holds only at 5 cm (where
    it shows 1.4 points fewer wrong stations); at 0.5 m of jitter the floor
    flickers and 1.5-2 m win. The verdict does not move with the return
    window (2, 5 or 10 s).
  - Drift decides the wrong rate, not m (all geometries, 5 cm jitter, the
    floor): 1.7 % with no drift, 5.5 % at 1 m, 16.3 % at 2 m (and 29.5 %
    missed: the drifted position leaves a small circle). The creator's fix
    is a smaller radius or more codes (plan §6).
  - Circles apart: m changes nothing (wrong 2.2 %).

- **Museum, GPS only** (PR review S4: no code, spacing 3-6 m, accuracy
  5/8/12/20 m, the `raw` model): the right station shows 8-36 % of the time (falling with the accuracy)
  whatever the margin (wrong 22-31 %, miss 33-71 %); no margin moves the
  wrong rate by more than about a point against the rule, and the cap at
  half the spacing adds flicker (0.97 against 0.53 per visit at 5 m,
  1.18 against 0.53 at 8 m) for under a point fewer wrong stations at best
  (0.7 at 5 m; 1.1 more at 8 m). The position's noise, several spacings, is what
  fails: such a museum needs a code, or V-D2.
- **Outdoor, no code, R 25 m** (spacing 25-50 m, accuracy 3-20 m, and 25 m
  at spacing 25/30 m; `raw` Gauss-Markov noise), the report honest (1x):

  | accuracy | fixed 0-3 m flicker/visit | rule flicker/visit | fixed wrong | rule wrong |
  | -------- | ------------------------- | ------------------ | ----------- | ---------- |
  | 3 m      | 0.29-0.12                 | 0.12               | 1.1-1.2 %   | 1.2 %      |
  | 5 m      | 0.61-0.17                 | 0.10               | 1.9 %       | 2.2 %      |
  | 8 m      | 1.84-0.73                 | 0.22               | 3.1-3.3 %   | 3.2 %      |
  | 12 m     | 4.67-2.64                 | 0.46               | 6.4-7.0 %   | 6.0 %      |
  | 20 m     | 10.8-7.97                 | 1.26               | 16.6-17.4 % | 14.0 %     |
  | 25 m     | 18.1-13.9                 | 1.73               | 33.1-34.0 % | 32.9 %     |

- **Outdoor margin factor x reported/true accuracy** (PR review S3), rule
  flicker/visit and wrong:
  - Honest (1x): 0.75x flickers more (0.31 / 0.81 / 2.04 / 3.16 at
    8 / 12 / 20 / 25 m, against 0.22 / 0.46 / 1.26 / 1.73), 1.5x shows more
    wrong stations (4.1 / 6.7 / 21.4 / 36.2 % against 3.2 / 6.0 / 14.0 /
    32.9 %): 1x is the trade.
  - The phone reports HALF its error (0.5x): the rule flickers like a fixed
    margin (0.57 / 1.71 / 5.60 / 8.93); 2x halves it (0.29 / 0.82 / 3.59 /
    5.39) within a point of the wrong rate. Reverses the factor to about 2.
  - The phone reports DOUBLE its error (2x): the rule shows more wrong
    stations (5.5 / 10.4 % at 8 / 12 m); 0.5x gives 3.2 / 6.0 % with flicker
    0.19 / 0.41. Reverses the factor to about 0.5. At 20-25 m true the report
    passes the ceiling and nothing is judged in (miss 100 %, the gate).
  - The cap at half the spacing: binds only at 20-25 m; there it flickers
    more (1.89 against 1.26 at 20 m, 5.31 against 1.73 at 25 m) for 0.1-2.6
    points fewer wrong stations. Not shipped.
- **Verdict:** the shipped rule is `takeoverMarginM`: the reported accuracy,
  floor 1 m, ceiling 25 m, no cap.
  - Cells where another value wins: 0.5 m indoors at 5 cm jitter (1.4
    points fewer wrong); 1.5-2 m indoors at 0.5 m jitter; outdoors at 3-5 m
    accuracy any value is about as good (the rule a few tenths of a point
    more wrong at 5 m).
  - Reversed by, in each direction: the code-aligned position's jitter
    (below about 0.1 m: a 0.5 m floor; about 0.5 m: 1.5-2 m); the ratio of
    reported to true raw error (about 0.5: a factor of 2; about 2: a factor
    of 0.5).
  - Not simulated: the alignment re-solving on a GPS fix (a jump, not
    jitter), several codes, a reported accuracy that varies within a walk,
    and a visitor looking at an exhibit from outside its circle.

## Examples

```ts
const next = nextPresentStation(
  "a",
  presenceCandidates(stations, distances, (s) =>
    judgedStationBands(s, rawAccuracyM, codeLinedUp),
  ),
  takeoverMarginM(judgedAccuracy(rawAccuracyM, codeLinedUp), codeLinedUp),
);
// A fix above the ceiling only ends presence:
const after = presentAfterWeakFix("a", candidates, 40);
```

## Tests

- `station-presence.test.ts` - enter, leave, the nearest on entry, the
  takeover by `m` (strict) and past the exit, hold on no position, a
  station gone from the list, non-finite input, the flicker at m 0 that the
  margin removes, `takeoverMarginM`'s floor, ceiling and nonsense (the
  ceiling without a code), `presentAfterWeakFix` (the exit by the accuracy,
  never an entry or a takeover, holds on what it cannot read), and the
  candidates (every station, V-D5; null when none measured).
- `station-presence.property.test.ts` - one present at most with its exit
  holding the position, on any walk with gaps; no flicker under noise below
  half the band and half the margin (fails with the margin removed); noise
  up to four times the band with production's judged bands and margin.
- `station-presence.sweep.test.ts` - the Evidence above
  (`STATION_PRESENCE_SWEEP_OUT=<file>` writes every cell).
- `station-guide.test.ts` ("the present station") - the guide's wiring,
  the veto and the underpass.
