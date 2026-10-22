# station-bands.ts

## Purpose

A station's effective radii for the visitor (tour kit plan K4, §8 D9): the
creator's found radius exactly as authored (tour editor plan D16: a station
is reached by its radius alone), the HUD's arrival band around it with the
same absolute hysteresis convention as the wayfinding HUD's deadband, and
where the prefetch starts. Plans:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`,
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md` (D16).

## Public API

- `stationBands(station, accuracyM): StationBands` -
  `{ activateM, foundM, foundExitM }` in horizontal metres:
  - `foundM = foundRadiusM`, at every accuracy (D16; no accuracy
    widening, no pose floor);
  - band `= max(BAND_ACCURACY_FACTOR x accuracy, 1.5 m)`;
  - `foundExitM = foundM + band`;
  - `activateM = max(activateRadiusM, foundExitM)`: where the prefetch
    starts (plus its lead); nothing toggles on it (K4 review R10).
- `judgedStationBands(station, precision): StationBands` - the bands at a
  position of this precision (`PositionPrecision` of the framework's one
  rule, `gps-plus-slam-app-framework/state/position-precision`; PR #642
  review: the run, the line, the prefetch, the HUD and the breadcrumbs read
  one rule): a code-held position (`'code'`) takes `HUD_ARRIVAL_BAND_M`
  whatever the raw fixes say (`stationBands` reads an unknown accuracy as
  the ceiling, the widest band there is); a GPS one
  `stationBands(station, accuracyM)`; nothing to judge by (`'none'`) the
  widest, as an unknown accuracy always had.
- (module-internal) `clampAccuracy` - null, non-finite or non-positive read
  as the framework's `POSITION_PRECISION_CEILING_M` (25 m); above it
  clamped to it.
- Constants: `BAND_ACCURACY_FACTOR` (1.0), `HUD_ARRIVAL_MIN_M` (1.5, the HUD's own
  default targets, `seams.ts`), `HUD_ARRIVAL_BAND_M` (1.5). The ceiling
  and the "too weak" verdict are the framework's
  (`POSITION_PRECISION_CEILING_M`, `PositionPrecision.tooWeak`); this file
  had its own copies until M2 of the shared position-precision plan
  (`GpsPlusSlamJs_Docs/docs/2026-10-19-1345-shared-position-precision-plan.md`).

## Invariants & assumptions

- **Tied to the HUD (§8 D9, DEC-H3).** `foundM` / `foundExitM` are the
  station's wayfinding target `distanceMin` / `distanceMax`: the arrow hides
  as "arrived" exactly where the station is found, and comes back one band
  out. The band's floor is the HUD's field-validated deadband (1.5 m in
  AnchorStarter and WayfindingHudDemo). One hysteresis convention in
  absolute metres, the HUD's own (DEC-H3), not a second fractional one.
- `foundM < foundExitM <= activateM` for every input; all
  finite; never smaller than the authored radii; the band and the
  activation monotone in the accuracy; `foundM` independent of it.
- **The radius is a promise of precision (D16).** The K4 rule widened the
  found radius by the accuracy and floored it at 5 m for the station's own
  pose error (K4 review R7); D16 removed both, so a creator's small radius
  now asks for a position as good as itself (a code just scanned, a good
  fix), and a poor one waits - measured below.
- Never throws: the authored radii are already validated by
  `tour-stations.ts` (positive, found <= activate); a non-finite one reads
  as 0 here anyway.
- The ceiling keeps the band finite, and it is the one line between a
  usable and an unusable GPS position: a `'gps'` precision above it
  (`tooWeak`) makes the guide say "GPS too weak to guide you" AND the run
  judge no arrival, so the two never disagree (PR #640 review: a ±500 m
  cold-start fix inside a 10 m station latched "found" while the line said
  the GPS was too weak). D16 still holds below the ceiling: the accuracy
  never widens the radius. A code-held position (`'code'`) is never too
  weak: the raw fixes' accuracy says nothing about a code's position (M5c
  review #1). Nothing to judge by (`'none'`) judges no arrival either.
- **Aligned is not trusted (r881).** The library creates a session's GPS
  data with an alignment at the first zero (no rotation, at the first fix
  of any accuracy), so every live position is "aligned" from the first
  fix. Until r881 every aligned position was judged like a code's (null
  accuracy, the HUD's own band): the "too weak" line could never show,
  and a ±500 m cold-start fix inside a station latched "found" - the
  PR #640 case again. Only a code (`tour-flow.ts` `codeLinedUp`, the
  guide's `codeHold`) earns the trust now; the guide also waits for a ready alignment before it
  judges an aligned position at all (`alignmentReady`).

## Evidence (`station-bands.sweep.test.ts`)

Simulated visitors under the framework's Gauss-Markov GPS error model at
three noise levels (fused, mid, raw), accuracy 3-20 m, authored found radius
3 / 5 / 10 / 25 m, the station's own pose off by 0 / 1 / 2 / 3.6 m (D34's
p90), 120 seeds per cell:

- the 25 m default (`STATION_RADIUS_M` in `station-assign.ts`,
  provisional) finds a visitor standing on the spot within 1 s at p90 in
  every cell, and a visitor walking past at three radii never;
- a small radius is slow at a poor accuracy (worst p90 fused / mid / raw:
  3 m 108 / 71 / never in 120 s; 5 m 33 / 43 / 57 s; 10 m 2 / 18 / 25 s),
  and fast with a good position (5 m at 3-5 m accuracy: 3 s fused);
- passing a small station at three radii is found by mistake once the noise
  outgrows it (3 m at 20 m accuracy: 24-38 %); at 1.5 radii a fix cannot
  tell the difference (up to 70 % raw at 20 m for 25 m), as under the old
  rule.
- The radius measurement of 15-40 m (tour editor plan, after M5a) refines
  the default.

The judged path (r881; since M2 of the shared position-precision plan
through the framework's precision rule, with an identical table): the
shipped run's `observe` fed by the precision of an aligned position with
that raw accuracy, held by a code or not, raw accuracy 3-500 m, found radius 5 m (the sample tour)
and 25 m (the default), 120 seeds, a visitor standing on the spot for
120 s and one walking past at three radii. Without a code this is the
aligned position once tracking is ready, and the fresh device fix before
(the `raw` model; review H1: readiness may never come). The `raw` model
reports one accuracy for every fix; it has no single outlier fix, so the
case the guide guards against before readiness - one ±40 m Wi-Fi fix after
a run of ±5 m GPS fixes, judged by the worse of the median and its own
accuracy (`fixAccuracyM`, r881 re-review M-A) - is not simulated here but
pinned in `station-guide.test.ts`:

- without a code, at or below the 25 m ceiling: as above (standing found
  in 99-100 % of runs; passing a 5 m station at 3 radii found by mistake
  0-52 % by noise model and accuracy, a 25 m one 0-2 %); above it nothing
  latches, standing or passing (0 %);
- with a code (its position modelled as the fused noise at 1 / 3 / 5 m, an
  assumption): standing found 100 %, passing 0 %, identical at every raw
  accuracy - the raw accuracy does not enter;
- the rule it replaced (every aligned position trusted, its error the raw
  fixes'): above the ceiling, passing at three radii was found by mistake
  in up to 55 % of runs at 5 m (raw 30-40 m) and 88 % at 25 m (raw
  100 m).

## Examples

```ts
const b = stationBands({ activateRadiusM: 30, foundRadiusM: 3 }, 8);
// { foundM: 3, foundExitM: 11, activateM: 30 }
```

## Tests

- `station-bands.test.ts` - the authored radius at every accuracy with no
  floor (D16), the HUD band floor, nonsense accuracies; properties:
  ordering and finiteness for any input, the band monotone in the accuracy;
  `judgedStationBands` is the HUD's own band at several radii for a code,
  `stationBands` at the accuracy for GPS, the widest for none. Through `station-guide.test.ts`: a code-lined-up
  visitor's prefetch, HUD band and breadcrumb stop are not widened by a raw
  fix of ±5-100 m or none, and an aligned one with no code keeps the raw
  accuracy's.
- `station-bands.sweep.test.ts` - the simulation above, the judged path
  included.
- The "too weak" verdict through `station-run.test.ts` (the latch flips
  exactly at the ceiling, swept 10-500 m; a code's position is judged,
  `'none'` is not) and `station-guide.test.ts` (the line and the latch
  agree on a ±500 m and a ±60 m fix). `station-guide.parity.test.ts`
  holds the guide's outputs to the ones frozen before the switch.
