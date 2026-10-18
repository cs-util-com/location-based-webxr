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

- `tooWeakToGuide(accuracyM): boolean` - a known accuracy above
  `ACCURACY_CEILING_M` (25 m): the guide's line and the run's arrival both
  read it.
- `stationBands(station, accuracyM): StationBands` -
  `{ activateM, foundM, foundExitM }` in horizontal metres:
  - `foundM = foundRadiusM`, at every accuracy (D16; no accuracy
    widening, no pose floor);
  - band `= max(BAND_ACCURACY_FACTOR x accuracy, 1.5 m)`;
  - `foundExitM = foundM + band`;
  - `activateM = max(activateRadiusM, foundExitM)`: where the prefetch
    starts (plus its lead); nothing toggles on it (K4 review R10).
- (module-internal) `clampAccuracy` - null, non-finite or non-positive read
  as `ACCURACY_CEILING_M`; above it clamped to it.
- Constants: `BAND_ACCURACY_FACTOR` (1.0), `HUD_ARRIVAL_MIN_M` (1.5, the HUD's own
  default targets, `seams.ts`), `HUD_ARRIVAL_BAND_M` (1.5),
  `ACCURACY_CEILING_M` (25).

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
  usable and an unusable position: `tooWeakToGuide(accuracyM)` (a known
  accuracy above it) makes the guide say "GPS too weak to guide you" AND
  the run judge no arrival, so the two never disagree (PR #640 review: a
  ±500 m cold-start fix inside a 10 m station latched "found" while the
  line said the GPS was too weak). D16 still holds below the ceiling: the
  accuracy never widens the radius. Unknown (null) is not too weak, and
  the guide passes null for an alignment's position: the accuracy is the
  raw fixes' and speaks only for the raw fix (M5c review #1).

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

## Examples

```ts
const b = stationBands({ activateRadiusM: 30, foundRadiusM: 3 }, 8);
// { foundM: 3, foundExitM: 11, activateM: 30 }
```

## Tests

- `station-bands.test.ts` - the authored radius at every accuracy with no
  floor (D16), the HUD band floor, nonsense accuracies; properties:
  ordering and finiteness for any input, the band monotone in the accuracy.
- `station-bands.sweep.test.ts` - the simulation above.
- `tooWeakToGuide` through `station-run.test.ts` (the latch flips exactly at
  the ceiling, swept 10-500 m; null is judged) and `station-guide.test.ts`
  (the line and the latch agree on a ±500 m and a ±60 m fix).
