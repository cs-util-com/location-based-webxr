# station-bands.ts

## Purpose

A station's effective radii for the visitor (tour kit plan K4, §8 D9): the
creator's activation and found radii, widened where the phone's measured
accuracy cannot resolve them, with the same absolute hysteresis convention
as the wayfinding HUD's arrival deadband. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `stationBands(station, accuracyM): StationBands` -
  `{ activateM, foundM, foundExitM }` in horizontal metres:
  - `foundM = max(foundRadiusM, FOUND_ACCURACY_FACTOR x accuracy,
STATION_POSE_FLOOR_M)` (5 m; K4 review R7);
  - band `= max(BAND_ACCURACY_FACTOR x accuracy, 1.5 m)`;
  - `foundExitM = foundM + band`;
  - `activateM = max(activateRadiusM, foundExitM)`: where the prefetch
    starts (plus its lead); nothing toggles on it (K4 review R10).
- (module-internal) `clampAccuracy` - null, non-finite or non-positive read
  as `ACCURACY_CEILING_M`; above it clamped to it.
- Constants: `FOUND_ACCURACY_FACTOR` (1.0), `BAND_ACCURACY_FACTOR` (1.0),
  `STATION_POSE_FLOOR_M` (5), `HUD_ARRIVAL_MIN_M` (1.5, the HUD's own
  default targets, `seams.ts`), `HUD_ARRIVAL_BAND_M` (1.5),
  `ACCURACY_CEILING_M` (25).

## Invariants & assumptions

- **Tied to the HUD (§8 D9, DEC-H3).** `foundM` / `foundExitM` are the
  station's wayfinding target `distanceMin` / `distanceMax`: the arrow hides
  as "arrived" exactly where the station is found, and comes back one band
  out. The band's floor is the HUD's field-validated deadband (1.5 m in
  AnchorStarter and WayfindingHudDemo); the found radius's floor is the
  station pose floor (5 m, below). One hysteresis convention in
  absolute metres, the HUD's own (DEC-H3), not a second fractional one.
- **Never tighter than the station's own pose (K4 review R7):** station
  poses are off by up to 3.6 m at p90 (D34), so the found radius is at
  least `STATION_POSE_FLOOR_M` (5 m). Its cost: every station is found from
  at least 5 m, the HUD's arrow hides there, and stations closer than
  about 10 m overlap under `any` order. A visitor who follows the arrow is
  found regardless of the bias (the arrow and the run share the stored
  spot); the floor is for one who stops at the landmark itself.
- `foundM < foundExitM <= activateM` for every input; all
  finite; never smaller than the authored radii; monotone in the accuracy.
- Never throws: the authored radii are already validated by
  `tour-stations.ts` (positive, found <= activate); a non-finite one reads
  as 0 here anyway.
- The ceiling only keeps the band finite; `station-run.ts` judges no
  distance on a fix above it.

## Evidence (`station-bands.sweep.test.ts`)

Simulated visitors under the framework's Gauss-Markov GPS error model at
three noise levels (the model's defaults; wander 0.45 / white 0.20 / 20 s;
wander 0.60 / white 0.30 / 20 s, the reported accuracy read as a 68 %
radius), accuracy 3-20 m, authored found radius 3-10 m:

- standing on the spot: found within 3 s at p90 in every cell (the worst
  of 120 visitors: 16 s under the noisiest model);
- walking past at three found radii: found by mistake at most 1.7 %;
- walking past at 1.5 found radii (K4 review R7): found by mistake up to
  15 % (fused), 52 % (mid), 73 % (raw), each worst at 20 m accuracy - a
  fix cannot tell 1.0 from 1.5 radii, so a story may start 1.5 found
  radii away; the run judges the fused position, so 15 % is the honest
  row;
- the station's pose off by 0 / 1 / 2 / 3.6 m (D34's p90), the visitor on
  the real spot (R7): at the 5 m floor found within 2 s at p90 (fused),
  11 s (mid), 14 s (raw) in the worst cell; the K4 floor of 1.5 m took
  108 / 34 / 33 s, and floors of 4 / 6 / 7 m were swept too (fused 6 / 0 /
  0 s);
- Reversed by: a found factor of 0.5 (25 s at p90 under the noisiest
  model), real noise above the noisiest model, or station poses
  measurably better than D34's (a lower floor would then do).
- The band factor is not swept any more: it was swept for the activation
  hysteresis that R10 removed, and now sets only where the breadcrumbs end
  and how early the prefetch starts.

## Examples

```ts
const b = stationBands({ activateRadiusM: 30, foundRadiusM: 3 }, 8);
// { foundM: 8, foundExitM: 16, activateM: 30 }
```

## Tests

- `station-bands.test.ts` - the rule by example, the HUD band floor, the
  station pose floor (R7), nonsense
  accuracies; properties: ordering and finiteness for any input,
  monotone in the accuracy.
- `station-bands.sweep.test.ts` - the simulation above.
