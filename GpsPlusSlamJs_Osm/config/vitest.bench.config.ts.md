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

## Usage

```bash
pnpm run bench          # one-shot, all benchmarks
```

Record every comparison outcome in a dated `-findings` doc in
`GpsPlusSlamJs_Docs/docs/` — the plan is explicit that an unrecorded benchmark
has to be re-run by the next person.
