# code-visit-combine.ts

## Purpose

One printed code's world pose from the poses several AR visits measured
(authoring plan `2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§3.3, milestone M3a). Each AR visit is its own WebXR session with its own
GPS alignment and its own GPS error, so each visit's measurement of the
code is an independent estimate; this module combines them the way the
M3a spike (`code-estimate-across-visits.test.ts`) measured best.

Pure (three.js math and the framework's `mintQrGeoPose`); no store, no
DOM. **Not wired anywhere**: the summary map (M3b) and any change to the
reference rule (D10b: the first stored pose stays the reference unless
explicitly replaced, M4) are owner decisions.

## Public API

- `combineCodeVisits(visits: readonly CodeVisitPose[]): CombinedCodePose | null`
  - `CodeVisitPose`: `geo` (the code through THAT visit's own alignment,
    not code-corrected), `gpsAccuracyM` (the visit's median reported
    accuracy), `baselineM` (the largest horizontal extent of the visit's
    walk).
  - `CombinedCodePose`: `geo` (minted by `mintQrGeoPose`, so it carries
    `rotation` and, for a near-vertical code, `headingDeg`), `visitCount`,
    `predictedHorizontalM`, `predictedHeadingDeg`, `maxOffsetM`,
    `maxHeadingOffsetDeg`.
  - Returns null when no visit is usable or the result cannot be minted.
- Constants: `CODE_YAW_NOISE_DEG` (2), `MIN_VISIT_ACCURACY_M` (1),
  `MIN_BASELINE_M` (1).

## The rule, and what it rests on

- **Position: weighted mean, weight 1/accuracy.** The spike compared the
  first visit (today's reference), the last, the unweighted mean, 1/a²
  (plan §3.3's "weighted by GPS quality"), 1/a and a coordinate median
  over 1-5 visits. With five visits whose biases point in independent
  directions (p50 horizontal error, yaw noise 3°):
  - bias follows the reported accuracy ("coupled"): first 9.2 m, mean
    4.0, 1/a² 2.9, 1/a 3.1;
  - bias independent of the reported accuracy: first 9.6 m, mean 3.8,
    1/a² 4.7, 1/a 4.0.
  - 1/a is within 0.2-0.3 m of the better of the two in both worlds;
    each of the others loses 0.9-1.1 m in one of them.
  - **Reverses when** field data shows the reported accuracy predicts a
    visit's GPS error well (then 1/a², about 0.2 m better) or not at all
    (then the plain mean, about 0.2 m better). Neither difference is
    worth acting on without recordings.
- **Heading: weighted circular mean, weight `1 / sigma²`**,
  `sigma = hypot(CODE_YAW_NOISE_DEG, atan(accuracy / baseline))`. Won in
  every arm: five visits p50/p90 2.2° / 5.4° against 3.0° / 9.3° for the
  mean and 5.0° / 19° for the first visit. The page measures the
  baseline itself, so this weighting does not depend on trusting the
  reported accuracy.
  - The combined rotation is the best-weighted visit's rotation turned
    about Up by the mean yaw; its tilt is kept (pose-solve noise; the
    settle never turns Up either, `visit-anchoring.ts`).
  - A visit whose yaw from the reference is undefined (a half turn about
    a horizontal axis) keeps its say in the position but not the heading.
- **Prediction**: `predictedHorizontalM = sqrt(k) / sum(1/a)` assumes each
  visit errs by about its accuracy, independently. Under correlated
  biases (visits minutes apart share satellites and multipath) it is
  optimistic: five visits reached 3.1 m p50 with independent bias
  directions, but 7.3 m at a 90° direction spread and 7.8 m at 0° (the
  first visit alone: about 9 m); what is left there is mostly the
  weighting picking the better-accuracy visits, not averaging.
  `predictedHeadingDeg` uses `atan(a / L)`, which the spike measured as a
  conservative bound: the alignment's real heading error was 0.1-0.4 of
  it at the median and 0.3-0.8 at p90 (worst GPS model up to 1.6).

## Invariants and defensive measures

- Order of the visits does not matter (property test).
- The position lies inside the visits' North/East extent, the heading
  inside their arc (property test).
- More visits never raise `predictedHeadingDeg`; `predictedHorizontalM`
  never exceeds the worst visit's accuracy (property test).
- Identical visits give that pose and `accuracy / sqrt(k)` (property test).
- Input is external data (a draft, a recording): a visit with non-finite
  numbers, a non-positive accuracy, a negative baseline, or neither a
  rotation nor a heading is skipped, not repaired. Accuracy is floored at
  `MIN_VISIT_ACCURACY_M` (an honest-looking 0.1 m would take all the
  weight), the baseline at `MIN_BASELINE_M` (keeps `atan` finite).
- Geo to metres goes through the first usable visit's lat/lon as the zero
  (`objectPoseNue`); altitude is weighted like the position.

## Examples

```ts
const combined = combineCodeVisits([
  { geo: visit1Geo, gpsAccuracyM: 4, baselineM: 35 },
  { geo: visit2Geo, gpsAccuracyM: 9, baselineM: 12 },
]);
if (combined !== null) {
  combined.geo; // the code's combined geo pose
  combined.predictedHorizontalM; // for a summary verdict
}
```

## Tests

- `code-visit-combine.test.ts`: one visit unchanged, 1/a position
  weighting, heading-model weighting, the ±180° wrap, the floors,
  unusable input, heading-only levels.
- `code-visit-combine.property.test.ts`: order, extent/arc, prediction
  monotonicity, identical visits.
- `code-estimate-across-visits.test.ts` ("the production combiner is the
  spike's hybrid strategy"): equals the spike's measured strategy on real
  fixture visits; the opt-in sweeps there (`CODE_ESTIMATE_SPIKE=1`) are the
  evidence for the numbers above.
