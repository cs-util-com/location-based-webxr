# vitest.bench.config.ts

## Purpose

Dedicated Vitest configuration for running benchmarks (`*.bench.ts` files) via `vitest bench`. Kept separate from the main test config (`vitest.config.ts`) so benchmarks never run during `pnpm test`. Mirrors the library harness (`GpsPlusSlamJs/config/vitest.bench.config.ts`) 1:1, per the bench-infra plan.

## Public API (config exports)

- `test.benchmark.include` — globs for benchmark files (`src/**/*.bench.ts`). Note this does NOT match the pre-existing env-gated `*.bench.test.ts` wall-clock tests — those are plain vitest tests run via `test:unit` with `BENCH=1` and are unrelated to this harness.
- No results file: Vitest 5 dropped `benchmark.outputJson`; a bench that needs a persisted result passes `writeResult` itself, and nothing read the old JSON (harness-majors plan M1b, 2026-09-07).

## Invariants & assumptions

- Benchmarks are **not** part of the standard test suite. They run on-demand via `pnpm bench` and never gate CI.
- Coverage is intentionally omitted — benchmarks measure throughput, not code paths. The main test config excludes `src/**/*.bench.ts` from coverage.

## Usage

```bash
cd GpsPlusSlamJs_AppFramework
pnpm bench           # single run, outputs JSON
pnpm bench:watch     # interactive watch mode
```

## Related

- [vitest.config.ts](vitest.config.ts) — main test config
- `GpsPlusSlamJs_Docs/docs/2026-07-09-0936-bench-infra-plan.md` — the plan this harness implements
- `GpsPlusSlamJs/docs/vitest-bench-integration-plan.md` — the library harness this replicates

## Tests

No dedicated tests — the config is validated by running `pnpm bench` and verifying output.
