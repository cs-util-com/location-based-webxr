# fused-path.bench.ts

## Purpose

Tinybench smoke benchmark for [`computeFusedPath`](fused-path.ts) — the first `*.bench.ts` file in the framework, proving the `pnpm bench` harness on a real code path (deliverable of the 2026-07-09 bench-infra plan: capability, not coverage).

## What it measures

- `computeFusedPath` over 1 000 and 10 000 odometry positions (≈1.5 min and ≈15 min of 10 Hz recording) with a realistic yaw+translation alignment matrix.
- The function runs over the full trajectory whenever the session-summary map is built, so cost scales with recording length; the two sizes expose that scaling.

## Invariants & assumptions

- `computeFusedPath` is pure — inputs are reused across iterations without a `setup` callback (unlike the library's `addGpsObservation` bench, which must clone state per iteration).
- Inputs are deterministic; no PRNG needed.
- Wall-clock numbers are machine-dependent — this is a measurement instrument, never an assertion gate. The versioned `docs/perf-baselines/bench-results.json` is a **frozen
  pre-Vitest-5 artefact**: Vitest 5 dropped `benchmark.outputJson`, so
  nothing writes it any more and its numbers are a 2026-07 snapshot, not
  current. It is kept as historical evidence (it is what settles arguments
  about what a bench measured BEFORE the upgrade), not as a baseline to
  compare against. A bench that needs a comparison persists its own result
  through `writeResult`.

## Usage

```bash
cd GpsPlusSlamJs_AppFramework
pnpm bench
```

## Related

- [fused-path.ts](fused-path.ts) / [fused-path.ts.md](fused-path.ts.md) — the code under measurement
- [../../config/vitest.bench.config.ts.md](../../config/vitest.bench.config.ts.md) — the bench harness config
- `GpsPlusSlamJs_Docs/docs/2026-07-09-0936-bench-infra-plan.md` — plan and decisions

## Tests

Not a test itself; excluded from test discovery (`*.bench.ts` does not match the test config's includes) and from coverage. Validated by running `pnpm bench`.
