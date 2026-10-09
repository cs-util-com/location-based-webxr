# code-visit-combine.ts

## Purpose

One printed code's world pose from the poses several AR visits measured
(authoring plan `2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§3.3, milestone M3a). Each AR visit is its own WebXR session with its own
GPS alignment and its own GPS error, so each visit's measurement of the
code is an independent estimate; this module combines them the way the
M3a spike (`code-estimate-across-visits.test.ts`) measured best.

Pure (three.js math and the framework's `mintQrGeoPose`); no store, no
DOM. The summary after Finish (M3b, `summary-model.ts`) shows it as what
the visits now suggest; it never replaces the stored reference (D10b: the
first stored pose stays the reference unless explicitly replaced, M4) -
that is an owner decision.

## Public API

- `combineCodeVisits(visits: readonly CodeVisitPose[]): CombinedCodePose | null`
  - `CodeVisitPose`: `geo` (the code through THAT visit's own alignment,
    not code-corrected), `gpsAccuracyM` (the visit's median reported
    accuracy), `baselineM` (the largest horizontal extent of the visit's
    walk).
  - `CombinedCodePose`: `geo` (minted by `mintQrGeoPose`, so it carries
    `rotation` and, for a near-vertical code, `headingDeg`), `visitCount`
    (every usable visit; all of them weigh in the heading),
    `positionVisitCount` (how many the position combines),
    `predictedHorizontalM` (over those), `predictedHeadingDeg`,
    `maxOffsetM`, `maxHeadingOffsetDeg` (over every usable visit).
  - Returns null when no visit is usable or the result cannot be minted.
- `visitHeadingSigmaDeg(accuracyM, baselineM)` - the heading model's sigma
  for one visit in degrees, `hypot(CODE_YAW_NOISE_DEG, atan(a / L))` with
  the accuracy and the walk credited as the combiner credits them. The
  combiner's own weights use it, and so does the settle's turn limit
  (`visit-settle.ts` `turnLimitDeg`, field test 3).
- Constants: `CODE_YAW_NOISE_DEG` (2), `MIN_VISIT_ACCURACY_M` (1),
  `MIN_BASELINE_M` (1).

## The rule, and what it rests on

- **Position: weighted mean, weight 1/accuracy, over the best prefix.**
  The visits are sorted by accuracy (ties by position, so the order of
  the input never matters) and the first k are combined, k minimising
  `sqrt(k) / sum(1/a)`. For each k the k most accurate visits give the
  smallest prediction, so this is the best subset of any size; one more
  visit only adds a candidate, so the prediction NEVER rises (M3a/M3b
  review #3, property test). Over every visit it did: 3.7 m alone, with a
  30 m visit 4.66 m, with two 5.14 m - and the summary's "scan it again"
  then made the code look worse.
  - The spike compared the first visit (today's reference), the last, the
    unweighted mean, 1/a² (plan §3.3's "weighted by GPS quality"), 1/a,
    the best-prefix 1/a and a coordinate median over 1-5 visits (a pool of
    320 visits, 2,000 trials per cell). Five visits, yaw noise 3°, p50
    horizontal (p90):
    - bias tracks the reported accuracy, independent directions: first
      9.2 m, mean 4.0, 1/a² 2.9, 1/a 3.1 (6.0), best prefix 3.1 (6.0);
    - bias ignores the reported accuracy: first 9.6 m, mean 3.8, 1/a²
      4.7, 1/a 4.0 (7.1), best prefix 4.3 (8.1);
    - bias tracks the accuracy, directions within 90°: 1/a² 6.3, 1/a 7.3,
      best prefix 6.9; the same direction: 6.6 / 7.8 / 7.3.
    - (yaw noise 1° and 5° give the same horizontal numbers.)
  - So the subset ties 1/a when the accuracy predicts the bias, gains
    0.4-0.5 m when the visits' biases also share a direction, and costs
    0.3 m (1.0 m at p90) when the accuracy says nothing about the bias -
    the price of a prediction that never rises.
  - **Reverses when** field data shows the reported accuracy predicts a
    visit's GPS error well (then 1/a², about 0.2 m better) or not at all
    (then the plain mean over every visit, 0.5 m better than the subset).
    Neither difference is worth acting on without recordings.
- **Heading: weighted circular mean, weight `1 / sigma²`**,
  `sigma = hypot(CODE_YAW_NOISE_DEG, atan(accuracy / baseline))`. Won in
  every arm: five visits p50/p90 2.2° / 5.4° against 3.0° / 9.3° for the
  mean and 5.0° / 19° for the first visit. The page measures the
  baseline itself, so this weighting does not depend on trusting the
  reported accuracy.
  - It takes EVERY usable visit, not the position's subset: its weights
    are the inverse variance of its own model, so its prediction cannot
    rise with another visit, and a poor-GPS visit with a long walk is a
    good heading witness. Taking it over the subset only measured 0.1-0.2°
    worse at p50.
  - `CODE_YAW_NOISE_DEG` (2°, an assumption) swept 1/2/3/5°: the Good
    share moved by at most 1 point and the combined heading by at most
    0.1° p50 (5,000 codes per row, yaw noise 1/3/5°, four bias arms, two
    visit mixes); it moves the "walk further" distance from 4.72 x to
    5.19 x the accuracy.
  - The combined rotation is the best-weighted visit's rotation turned
    about Up by the mean yaw; its tilt is kept (pose-solve noise; the
    settle never turns Up either, `visit-anchoring.ts`).
  - A visit whose yaw from the reference is undefined (a half turn about
    a horizontal axis) keeps its say in the position but not the heading.
- **Prediction**: `predictedHorizontalM = sqrt(k) / sum(1/a)` assumes each
  visit errs by about its accuracy, independently. Under correlated
  biases (visits minutes apart share satellites and multipath) it is
  optimistic: five visits reached 3.1 m p50 with independent bias
  directions, but 6.9 m at a 90° direction spread and 7.3 m at 0° (the
  first visit alone: about 9 m); what is left there is mostly the
  weighting picking the better-accuracy visits, not averaging.
  `predictedHeadingDeg` uses `atan(a / L)`, which the spike measured as a
  conservative bound (200 visits per walk length and shape and GPS arm):
  the alignment's real heading error was 0.09-0.40 of it at the median
  and 0.21-1.11 at p90; with white-noise-only GPS 0.22-0.69 and up to
  1.96.

## Invariants and defensive measures

- Order of the visits does not matter (property test).
- The position lies inside the visits' North/East extent, the heading
  inside their arc (property test).
- More visits never raise `predictedHeadingDeg` nor
  `predictedHorizontalM`; `predictedHorizontalM` never exceeds the worst
  visit's accuracy (property test).
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
  weighting, the best prefix (a 30 m visit left out of a 3.7 m one, a 5 m
  one kept with a 4 m one), heading-model weighting, the ±180° wrap, the floors,
  unusable input, heading-only levels.
- `code-visit-combine.property.test.ts`: order, extent/arc, prediction
  monotonicity, identical visits.
- `code-estimate-across-visits.test.ts` ("the production combiner is the
  spike's subset strategy"): equals the spike's measured strategy on real
  fixture visits, with a proper subset; the opt-in sweeps there (`CODE_ESTIMATE_SPIKE=1`) are the
  evidence for the numbers above.
