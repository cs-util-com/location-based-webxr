# ref-points-slice.bench.ts

## Purpose

Tinybench smoke benchmark for [`ref-points-slice.ts`](ref-points-slice.ts)'s `selectKnownAnchorsByCell` grouping transform — the first `*.bench.ts` file in the recorder app, proving the `pnpm bench` harness on a real code path (deliverable of the 2026-07-09 bench-infra plan: capability, not coverage).

## What it measures

- The pure grouping body (`resultFunc`) of `selectKnownAnchorsByCell` at 100 and 2 000 entries (~4 entries per H3 cell, a share of named imports). The selector re-runs on every Capture tap / sidecar import and feeds `findNearbyGeoAnchor`, so cost scales with entry count.
- `resultFunc` is benched instead of the memoized selector — reselect would return the cached result for a fixed entries reference, measuring the cache hit rather than the transform.

## Invariants & assumptions

- The transform is pure (fresh `Map` + output array per call) — inputs are reused across iterations without a `setup` callback.
- Fixtures are deterministic; no PRNG. Synthetic H3-shaped ids are fine — the grouping never parses them.
- No gps-plus-slam-js license activation needed (app-level pure transform only).
- Wall-clock numbers are machine-dependent — a measurement instrument, never an assertion gate. The versioned `docs/perf-baselines/bench-results.json` is a **frozen
  pre-Vitest-5 artefact**: Vitest 5 dropped `benchmark.outputJson`, so
  nothing writes it any more and its numbers are a 2026-07 snapshot, not
  current. It is kept as historical evidence (it is what settles arguments
  about what a bench measured BEFORE the upgrade), not as a baseline to
  compare against. A bench that needs a comparison persists its own result
  through `writeResult`.

## Usage

```bash
cd GpsPlusSlamJs_RecorderApp
pnpm bench
```

## Related

- [ref-points-slice.ts.md](ref-points-slice.ts.md) — the slice under measurement
- [../../config/vitest.bench.config.ts.md](../../config/vitest.bench.config.ts.md) — the bench harness config
- `GpsPlusSlamJs_Docs/docs/2026-07-09-0936-bench-infra-plan.md` — plan and decisions

## Tests

Not a test itself; excluded from test discovery (`*.bench.ts` does not match the test config's includes) and from coverage (hard thresholds stay unaffected). Validated by running `pnpm bench`.
