# frame-target.ts

## Purpose

The owner's frame target, checked from a run's exact threshold counts:
DEC-PERF-3 (2026-10-03) - in a warm run of the scripted zoom on the
owner's phone, no frame over 50 ms and at most 5 over 33 ms; "a handful"
also reported at 3 and 10. Globe zoom performance plan
`GpsPlusSlamJs_Docs/docs/2026-10-03-2017-globe-zoom-frame-hitches-performance-plan.md`
§4.1 and §12, PERF-0.

## Public API

- `FRAME_TARGET` - `{ hardMs: 50, softMs: 33, softAllowed: 5 }`.
- `FRAME_TARGET_HANDFULS` - `[3, 5, 10]`.
- `FrameTarget` - the target's type.
- `checkFrameTarget(over, target = FRAME_TARGET, handfuls = FRAME_TARGET_HANDFULS)`
  returns `{ pass, overHard, overSoft, target, handfuls: { allowed, pass }[] }`.
  `over` is `FrameHistogramSnapshot.over`.
  - `RangeError` when `over` lacks `hardMs` or `softMs` (an uncounted
    threshold would read as zero frames over it: a silent PASS), or when
    `softAllowed` or a handful is not a non-negative integer.

## Invariants & assumptions

- `pass` is `overHard === 0 && overSoft <= softAllowed`; each handful is
  the same check with its own allowance. The handful equal to
  `softAllowed` always agrees with `pass`, and passing at a smaller
  handful implies passing at every larger one (property test).
- `overSoft` includes the frames over `hardMs` (the counts are cumulative);
  any of those fails the check anyway.
- "Warm" (a run after one reload, tiles from the HTTP cache) is the
  caller's condition; this module only checks numbers.
- What "over 33 ms" means at a refresh rate whose periods land on 33.3 and
  50.0 ms is an open question (see `frame-histogram.ts.md`).

## Examples

```ts
checkFrameTarget(snapshot.over).pass; // PASS / FAIL on the page
```

## Tests

`frame-target.test.ts`: the declared target and handfuls; pass at the line,
fail one past it; the counts reported; the handful sweep; agreement and
monotonicity (property); refusal of uncounted thresholds and a malformed
target; another target with other handfuls.
