# size-tally.ts

## Purpose

The `?qrperf` size section (QR size consensus plan
`GpsPlusSlamJs_Docs/docs/2026-09-27-0350-qr-size-consensus-plan.md`, §7-§8,
S2): per run, the code's printed size from parallax (the framework's
`estimateQrSizeFromParallax`) beside its size from depth, and a flag when
they part by a 2x-class margin. Log only: nothing acts on it yet - which
source to trust is chosen after field logs show which one is biased.

## Public API

- `createSizeTally()` → `{ add(sample), summary() }`
  - `add({ parallax, turning, depth? })`: one lock's sample - the parallax
    estimate or `null` when it refused, whether the motion detector read the
    code as turning, and the depth `SizeState` (`motion-tally.ts`).
  - `summary()` → `SizeTallySummary`: parallax `windows`, `refused`,
    `skippedTurning`, `p10Cm`/`p50Cm`/`p90Cm`, `baselineP50Cm`; depth
    `status`, `latestCm`, the range while `estimated`; `ratio` (parallax
    median / latest estimated depth) and `conflict`.
- `sizeLines(summary)` → the report line (`size: parallax p50 ... | depth
... | ratio ...`, with ` | CONFLICT` appended when flagged).

## Invariants & assumptions

- **Parallax assumes a still code.** A sample taken while the code was
  turning is counted in `skippedTurning` and never enters the numbers (the
  turn signal is the size-free check; the move signal needs a size). A
  refused estimate (no scale) is counted in `refused`, likewise kept out.
- **Conflict is symmetric:** the larger of the two sizes over the smaller
  above 1.25 (plan §7: 2x-class misprints, above the ~5 % bias floor and the
  tracker's own scale error).
- The depth range covers only `estimated` readings: test E on r744 showed it
  drifting 15.4-18.6 cm while "estimated" (pose plan §79).
- The ratio needs an `estimated` depth size; otherwise `null`, no conflict.

## Tests

`size-tally.test.ts` - the summary and ratio, turning and refused windows
kept out and counted, the conflict flag both ways, the estimated-only depth
range, and the exact report line with and without data.
`qrperf-instrument.test.ts` - the section reaches the report and the JSON.
