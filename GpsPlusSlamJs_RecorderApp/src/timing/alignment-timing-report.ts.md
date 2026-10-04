# `alignment-timing-report.ts` - the two things the owner takes away

## Purpose

Joins a timing result to the arm table that produced it (the JSON blob), and
renders it as strings (the on-screen table). Pure.

## Public API

- `buildTimingReport({ result, arms, environment, recording, generatedAt }):
AlignmentTimingReport` - throws `Error` when the result names an arm the table
  does not define.
- `buildTimingTable(report): TimingTable` - `{ caption, header, rows, totals }`,
  all strings.
- Types: `AlignmentTimingReport`, `TimingReportArm`, `TimingEnvironment`,
  `TimingRecordingInfo`, `TimingTable`, `BuildTimingReportInput`.

## Invariants and assumptions

- **Every figure travels with the parameters it rests on.** The report carries
  the ladder, the repeat and warm-up counts, the fix count, each arm's actual
  overrides, the recording's name and span, and the device - a report a reader
  cannot falsify weeks later is not worth copying.
- **Every raw repeat is kept**, warm-up totals included, so the median can be
  recomputed and a throttled run recognised.
- **The first arm is the reference** of the `vs shipped` ratio column; the arm
  table puts the shipped configuration there and the loop preserves order. A
  zero or missing reference prints `n/a` rather than a division result.
- Times are printed at microsecond resolution (`toFixed(3)` milliseconds),
  which is the scale a single solve lives on early in a walk.
- `schema` is `alignment-timing/1`; bump it if a field changes meaning.

## Example

```ts
const report = buildTimingReport({
  result,
  arms: TIMING_ARMS,
  environment,
  recording: { fileName: 'walk.zip', fixCount: 471, durationSeconds: 251 },
  generatedAt: new Date().toISOString(),
});
const { caption, header, rows, totals } = buildTimingTable(report);
```

## Tests

`alignment-timing-report.test.ts` - arms joined with their overrides, the
parameters/recording/device envelope, raw repeats preserved, the refusal on a
mismatched arm, the table's shape and formatting, the caption's parameters, and
the totals with their ratio.

- **Four of the types above are MODULE-PRIVATE** (`TimingRecordingInfo`, `TimingReportArm`): nothing outside their file names them, an object literal satisfies them structurally, and knip fails the gate on an export nobody imports. Listed here because the sidecar is where a reader looks for the surface, and "documented but not exported" is the honest description.
