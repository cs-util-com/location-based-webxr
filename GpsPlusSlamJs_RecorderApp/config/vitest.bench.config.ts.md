# vitest.bench.config.ts

## Purpose

Dedicated Vitest configuration for running benchmarks (`*.bench.ts` files) via `vitest bench`. Kept separate from the main test config (`vitest.config.ts`) so benchmarks never run during `pnpm test`. Mirrors the library harness (`GpsPlusSlamJs/config/vitest.bench.config.ts`), per the 2026-07-09 bench-infra plan.

## Public API (config exports)

- `resolve.alias['gps-plus-slam-app-framework']` — maps the framework to the sibling source tree, matching the main test config.
- `test.benchmark.include` — globs for benchmark files (`src/**/*.bench.ts`).
- No results file: Vitest 5 dropped `benchmark.outputJson`; a bench that needs a persisted result passes `writeResult` itself, and nothing read the old JSON (harness-majors plan M1b, 2026-09-07).

## Invariants & assumptions

- Benchmarks are **not** part of the standard test suite. They run on-demand via `pnpm bench` and never gate CI.
- No `setupFiles` — the main test config has none either; benched paths must not require gps-plus-slam-js license activation (pure app-level transforms). If a future bench needs it, mirror the AppFramework bench config's setup.
- Coverage is intentionally omitted; the main test config excludes `src/**/*.bench.ts` from coverage so uncovered bench files cannot erode its hard thresholds.

## Usage

```bash
cd GpsPlusSlamJs_RecorderApp
pnpm bench           # single run, outputs JSON
pnpm bench:watch     # interactive watch mode
```

## Related

- [vitest.config.ts.md](vitest.config.ts.md) — main test config
- `GpsPlusSlamJs_Docs/docs/2026-07-09-0936-bench-infra-plan.md` — the plan this harness implements

## Tests

No dedicated tests — the config is validated by running `pnpm bench` and verifying output.
