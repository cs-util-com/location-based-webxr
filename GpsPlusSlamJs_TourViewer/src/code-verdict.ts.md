# code-verdict.ts

## Purpose

The per-code verdict of the summary after Finish (authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§3.3, milestone M3b): "Good", or the first thing the author should do to
make the code's estimate good enough - computed from what
`combineCodeVisits` PREDICTS, since the page cannot know the actual error.

## Public API

- `codeVerdict(visits, combined, { averaging? }): CodeVerdict`
  - `CodeVerdict`: `kind` (`"good" | "walk-further" | "wait-for-gps" |
"scan-again" | "unknown" | "not-saved"`), `text` (from `VERDICT_TEXT`),
    `numbers` (visit count, how many the position combines, predicted
    horizontal and heading error, best accuracy, longest walk, how far the
    visits disagree; null when no visit measured the code), `walkM` (for
    "walk further": the walk one visit at the best accuracy needs; null
    otherwise).
  - No usable visit (or `combined` null): "scan-again" with no numbers.
  - `averaging: false` grades ONE saved pose (what visitors get, M3a/M3b
    review #2): visitors keep it whatever later visits do, so "scan it
    again" cannot help it, and a position short of Good with an honest
    heading reads "Wait for better GPS".
- `verdictWithoutNumbers("unknown" | "not-saved")`: the stored pose's
  verdict when no visit this device kept saved it ("Not known on this
  device"), or when the tour stores none ("No saved position yet").
- `walkNeededM(accuracyM)`: `a / tan(sqrt(12² - 2²) degrees)`, 4.77 x the
  accuracy (24 m at 5 m); 4.72 x at a code yaw sigma of 1 degree, 4.86 x
  at 3, 5.19 x at 5.
- Constants: `VERDICT_GOOD_HORIZONTAL_M` (5), `VERDICT_GOOD_HEADING_DEG`
  (12), `VERDICT_TEXT`; module-private `VERDICT_POOR_GPS_M` (8).

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
recording existed). Re-measured with the best-prefix position rule
(M3a/M3b review #3 and #4; 5,000 codes of 1-5 visits per row, yaw noise
3 degrees): with independent bias directions about 44 % of codes get
"Good"; of those 71 % are within 5 m and 5 degrees and 96 % within 8 m and
8 degrees (41 % and 78 % if the bias ignores the reported accuracy - 47 %
and 84 % before the subset rule, its cost in that world).

- **Swept** (M3a/M3b review #4): yaw noise 1/3/5 degrees moves that
  precision to 75 / 65 / 52 % (bias tracking the accuracy, a second pool;
  two pools of 320 visits differ by up to 6 points at the same setting);
  the code yaw sigma 1-5 degrees moves the Good share by at most 1 point.
  A hurried author (4-20 m GPS, 10-30 m walks) almost never gets "Good":
  the heading model asks for a longer walk, even where the real heading
  would pass (it is a conservative bound).
- **What would reverse them**: GPS biases sharing a direction across
  visits (at a 90 degree spread the share of "Good" codes within 5 m and 5
  degrees drops to 34 %, at 0 degrees to about 23 %). If field scatter between visits turns out small
  against their accuracy, the square-root-of-k gain in the prediction
  should not be credited and the best single visit's accuracy used instead.
- The target the thresholds were chosen for (5 m and 5 degrees) is an open
  owner question (M3a results, question 2).
- **No extra visit lowers a verdict** (M3a/M3b review #3; a property test
  over visits of any quality): the position combines only the best prefix
  of visits by accuracy (`combineCodeVisits`), so its prediction never
  rises, and the heading's inverse-variance prediction never rises
  either. Before, 30 m and 3.7 m was Good and a second 30 m visit made it
  "scan again".

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
order: a short walk under poor GPS asks for the walk first), no visit, one
saved pose never asked to scan again, the verdicts without numbers, the
4.77 x walk, a poor extra visit keeping a Good, and a property: never Good
past the thresholds, and one more visit of any quality never turns Good
away.
