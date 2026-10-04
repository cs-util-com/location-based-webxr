# station-bands.ts

## Purpose

A station's effective radii for the visitor (tour kit plan K4, §8 D9): the
creator's activation and found radii, widened where the phone's measured
accuracy cannot resolve them, with the same absolute hysteresis convention
as the wayfinding HUD's arrival deadband. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `stationBands(station, accuracyM): StationBands` -
  `{ activateM, activateExitM, foundM, foundExitM }` in horizontal metres:
  - `foundM = max(foundRadiusM, FOUND_ACCURACY_FACTOR x accuracy, 1.5 m)`;
  - band `= max(BAND_ACCURACY_FACTOR x accuracy, 1.5 m)`;
  - `foundExitM = foundM + band`;
  - `activateM = max(activateRadiusM, foundExitM)`, `activateExitM =
activateM + band`.
- `clampAccuracy(accuracyM): number` - null, non-finite or non-positive read
  as `ACCURACY_CEILING_M`; above it clamped to it.
- Constants: `FOUND_ACCURACY_FACTOR` (1.0), `BAND_ACCURACY_FACTOR` (1.0),
  `HUD_ARRIVAL_MIN_M` (1.5), `HUD_ARRIVAL_BAND_M` (1.5),
  `ACCURACY_CEILING_M` (25).

## Invariants & assumptions

- **Tied to the HUD (DEC-F4, DEC-H3).** `foundM` / `foundExitM` are the
  station's wayfinding target `distanceMin` / `distanceMax`: the arrow hides
  as "arrived" exactly where the station is found, and comes back one band
  out. The floors are the HUD's field-validated deadband (1.5 m / 3.0 m in
  AnchorStarter and WayfindingHudDemo). One hysteresis convention, absolute
  metres, as the community PR verdicts asked (DEC-F4 resolved: no second
  fractional convention).
- `foundM <= foundExitM <= activateM < activateExitM` for every input; all
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
- standing on the activation radius: at most 7 toggles in two minutes at
  p90 (noisiest model).
- Reversed by: a found factor of 0.5 (25 s at p90 under the noisiest
  model), a band factor of 0.5 (5-18 toggles), or real noise above the
  noisiest model.

## Examples

```ts
const b = stationBands({ activateRadiusM: 30, foundRadiusM: 3 }, 8);
// { foundM: 8, foundExitM: 16, activateM: 30, activateExitM: 38 }
```

## Tests

- `station-bands.test.ts` - the rule by example, the HUD floors, nonsense
  accuracies; properties: ordering and finiteness for any input,
  monotone in the accuracy.
- `station-bands.sweep.test.ts` - the simulation above.
