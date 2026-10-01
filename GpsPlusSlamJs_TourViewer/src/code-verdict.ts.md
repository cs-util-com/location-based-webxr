# code-verdict.ts

## Purpose

The per-code verdict of the summary after Finish (authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§3.3, milestone M3b): "Good", or the first thing the author should do to
make the code's estimate good enough - computed from what
`combineCodeVisits` PREDICTS, since the page cannot know the actual error.

## Public API

- `codeVerdict(visits: readonly CodeVisitPose[], combined: CombinedCodePose | null): CodeVerdict`
  - `CodeVerdict`: `kind` (`"good" | "walk-further" | "wait-for-gps" |
"scan-again"`), `text` (from `VERDICT_TEXT`), `numbers` (visit count,
    predicted horizontal and heading error, best accuracy, longest walk,
    how far the visits disagree; null when no visit measured the code),
    `walkM` (for "walk further": the walk one visit at the best accuracy
    needs; null otherwise).
  - No usable visit (or `combined` null): "scan-again" with no numbers.
- `walkNeededM(accuracyM)`: `a / tan(sqrt(12² - 2²) degrees)`, about
  4.8 x the accuracy (24 m at 5 m).
- Constants: `VERDICT_GOOD_HORIZONTAL_M` (5), `VERDICT_GOOD_HEADING_DEG`
  (12), `VERDICT_POOR_GPS_M` (8), `VERDICT_TEXT`.

## The rule (M3a results, Q3)

- **Good** when the predicted horizontal error is at most 5 m AND the
  predicted heading at most 12 degrees.
- Otherwise the FIRST reason that applies:
  1. heading over 12 degrees: "Walk further from the code" (the walk's
     extent is the heading model's lever);
  2. the best visit's accuracy over 8 m: "Wait for better GPS";
  3. otherwise: "Scan it again in another AR visit".

## THE THRESHOLDS ARE PROVISIONAL

Measured on SYNTHETIC multi-visit replays only
(`2026-10-01-0354-code-estimate-across-visits-results.md`; no owner field
recording existed). With independent bias directions about 44 % of codes
got "Good"; of those 69 % were within 5 m and 5 degrees and 95 % within 8 m
and 8 degrees (47 % and 84 % if the bias ignores the reported accuracy).

- **What would reverse them**: GPS biases sharing a direction across
  visits (at a 90 degree spread the share of "Good" codes within 5 m and 5
  degrees drops to 18 %). If field scatter between visits turns out small
  against their accuracy, the square-root-of-k gain in the prediction
  should not be credited and the best single visit's accuracy used instead.
- The target the thresholds were chosen for (5 m and 5 degrees) is an open
  owner question (M3a results, question 2).
- **A poorer extra visit can lower a verdict** (a test pins it): under the
  adopted 1/accuracy weighting the predicted error `sqrt(k) / sum(1/a)`
  RISES when a visit much worse than the others is added (30 m and 3.7 m
  is Good, a second 30 m visit makes it "scan again"). One more visit like
  the best one never lowers it (property test). 1/accuracy² weighting would
  not have this; it is the M3a results' open question 1.

## Invariants & assumptions

- Pure; the visits are the same list handed to `combineCodeVisits`.
  Unusable accuracies are ignored, as the combiner ignores them.
- The reasons are checked in a fixed order; the text is one of the four.

## Examples

```ts
const poses = codeVisitPoses(log.entries(), levelId);
const verdict = codeVerdict(poses, combineCodeVisits(poses));
verdict.text; // "Walk further from the code"
verdict.walkM; // 24.0 (one visit at 5 m)
```

## Tests

`code-verdict.test.ts`: one case per branch with realistic visits (and the
order: a short walk under poor GPS asks for the walk first), no visit, the
24 m example, the poorer-extra-visit case, and a property: never Good past
the thresholds, and one more visit like the best never turns Good away.
