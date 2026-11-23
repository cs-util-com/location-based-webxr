# worker-spike-model.ts

## Purpose

The pure rules and words of the worker spike page (`feature-match-check.html?spike=worker`, drawn by `worker-spike.ts`): the frame-gap statistics and the camera verdict, the run plan, the progress model (step x of y, the bar, the time left, the status line), and the result card's answers. No DOM, no clock, no worker: every input is passed in, so each rule is unit-tested.

## Public API

- `GAP_FACTOR` (1.25) and `GAP_CAP_MS` (250): the camera rule.
- `gapStats(gaps)` -> `GapStats { count, p95, p99, max }`: nearest-rank percentiles (`nearestRankPercentile` from the framework utils) of the gaps between camera frames; non-finite and negative gaps are dropped.
- `cameraVerdict(run, base, factor?, cap?)` -> `"smooth" | "stutter" | "unknown"`: smooth when the run's p95 and p99 are at most `factor` x the baseline's and no gap is over `cap`; unknown when either side has no frame.
- `verdictSweep(run, base)`: the verdict at factors 1.1, 1.25 and 1.5 against caps 150, 250 and 400 ms, as one log line (`factor 1.1: nnY, ...`), so a reader sees which parameter value would flip the verdict.
- `SpikePlan { baselineMs, pairs, photoGapMs, sizes }`, `DEFAULT_PLAN` (10 s at rest, 6 pairs, 500 ms between photos, sizes 320/480/640), `spikePlanFrom(search)` (`?baseline=` 1-60 s and `?pairs=` 1-12, anything else falls back to the default), `planMinutes(plan)` (the intro's "about N minutes").
- `SpikeStep` (baseline, photos, pairs, xfeat) and `spikeProgress({ plan, step, stepStartedAt, pairMs, live, now })` -> `{ step, of, fraction, leftMs, left, status }`: `of` is 3 + pairs; the time left uses the measured pair times once there are some, a guess before; `left` is "about N s left" (5 s steps), "about N min left" or "almost done".
- `REASON_MAX` (140) and `shortReason(text)`: an error's first line without the `init:` prefix, cut to `REASON_MAX`.
- `methodTimes(pairs)` -> `MethodTime[]`: per method, the median pair time (2 x extract median + match median over the sizes that ran, load left out) and the first load, or "could not run: reason" with an empty backend.
- `xfeatOutcome(results, error)` -> `XFeatOutcome { started, text }`: "Started: X s per pair on backend." or "Could not start: reason".
- `xfeatTimedOut(seconds)`: `started: null`, "Not known: no answer in N s." (a probe still downloading did not fail to start).
- `plainError(where, e)` -> `PlainError { message, todo }`: a plain sentence and what to do, for the camera (blocked, missing, busy, other), the worker, the models, a hidden page and a page error.
- `spikeSummary({ run, base, xfeat, methods, workerCrashed?, hidden? })` -> `SpikeResult { camera, xfeat, methods, notice }`.

## Invariants and defensive measures

- The verdict never reads NaN: `gapStats` drops broken gaps and an empty side gives "unknown".
- A stutter names the rule it broke: one gap over the cap ("the worst frame gap was X ms ... the limit is 250 ms"), or late frames under the cap, quoting the p95 when that rule broke and the p99 otherwise ("95% of gaps within X ms, at rest Y ms (the limit is 1.25x)").
- No pair measured (no method, or every method failed) gives "unknown" ("Not known: no pair was measured."): with no load on the phone, smooth frames answer nothing. An empty window on either side gives "Not known: there were no camera frames to compare."
- The card's notice has one priority: a hidden page first (its numbers are throttled), then models that never loaded (every method failed), then a worker crash.
- The progress never goes back and never passes 1: `fraction` is clamped and the pair count is capped at the plan.
- Texts carry no stack: `shortReason` keeps one line; the stacks go to the log.

## Example

```ts
const verdict = cameraVerdict(gapStats(runGaps), gapStats(restGaps));
const result = spikeSummary({
  run,
  base,
  xfeat: xfeatOutcome(null, "init: x"),
  methods: methodTimes(pairs),
});
```

## Tests

- `worker-spike-model.test.ts`: the percentiles, each arm of the verdict, the sweep line, the plan from the URL, the progress texts per step and the time left, the short reason (including the module worker `importScripts` refusal kept whole), method times, the XFeat outcome, each plain error, and the summary's camera texts and notice priority.
- `worker-spike-model.property.test.ts`: gap stats stay ordered (p95 <= p99 <= max) for any input, a smooth verdict stays smooth when every gap shrinks, the progress stays within 0-1 and the bar only moves forward, any URL gives a plan in range, and a short reason is one line within `REASON_MAX`.
