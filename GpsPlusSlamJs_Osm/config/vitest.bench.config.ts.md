# `config/vitest.bench.config.ts`

## Purpose

Standalone vitest project for `*.bench.ts` files, so benchmarks never run as
part of the package gate.

## Why it is separate

The plan's comparison harness (§4.2.1 of
[the OSM→H3 plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-28-0624-osm-h3-affordance-index-plan.md))
requires head-to-head benchmarks against reference libraries. Those are
measurement instruments, not correctness gates:

- they are slow and their numbers drift with machine load, so a gate that
  included them would be both slow and flaky;
- a benchmark result is a **question** ("why is theirs faster?"), not a
  pass/fail, so it must never block a commit.

## Invariants

- `include` matches only `src/**/*.bench.ts`. The unit config
  (`vitest.config.ts`) matches only `*.test.ts` / `*.spec.ts`, so the two
  projects never overlap.
- `src/**/*.bench.ts` is excluded from coverage in `vitest.config.ts` and from
  `tsconfig.app.json`, so benchmark code is never mistaken for production code.
- `testTimeout` is 600 s. Vitest 5 runs every benchmark inside a test, so
  the test timeout bounds it, where Vitest 4's bare `bench()` had no bound at
  all; the two ~2.9 s cases in `plates.bench.ts` spend ~45 s each under
  tinybench 2's ten-iteration budget and failed the 60 s default under load.
- A bench's measurement budget (`time`, `iterations`, the warm-up pair) goes
  to `.run(options)` under Vitest 5 - the second argument of `bench()` takes
  only tinybench's per-function hooks and silently ignores those keys.
  Vitest 5 bundles tinybench 6, whose defaults are 64 iterations after 16
  warm-ups (tinybench 2: 10 after 5); a bench whose medians were recorded
  under the old budget pins it, as `plates.bench.ts` does.

## Usage

```bash
pnpm run bench          # one-shot, all benchmarks
```

Record every comparison outcome in a dated `-findings` doc in
`GpsPlusSlamJs_Docs/docs/` — the plan is explicit that an unrecorded benchmark
has to be re-run by the next person.
