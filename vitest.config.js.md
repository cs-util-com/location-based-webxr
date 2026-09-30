# vitest.config.js (root)

## Purpose

Vitest configuration for **root-level repo-meta tests only**. Per-package tests still run via each workspace's own vitest config (e.g. [`GpsPlusSlamJs_AppFramework/config/vitest.config.ts`](GpsPlusSlamJs_AppFramework/config/vitest.config.ts)).

## Public API

Default-exports a Vitest config object. Consumed by `pnpm run test:repo-config`.

## Invariants

- `include` is restricted to `tests/**/*.test.js` plus the root `scripts/` tooling tests — root-level vitest must not pick up workspace-package tests, which have their own runners and configs.
- `environment: 'node'` because every repo-meta test reads files from disk; nothing here needs a DOM.
- `isolate: false` (2026-09-30): a worker runs many test files instead of one fresh process per file. Measured on a quiet machine: 79 -> 24 processes, about 22 -> 10 CPU-s and 7.6-8.1 -> 4.3-4.7 s wall per run (about 33 -> 17 CPU-s beside a sustained 3D suite). It does NOT keep the suite green beside a sustained 3D browser suite at 90 %+ machine load (5 of 5 runs failed on timeouts before and after). It is also what lets `tests/repo-config/tracked-tree.js` hand one `git ls-files` listing and one read per file to every guard in a worker. It is safe only while no test mutates shared state: the guards only read, and the `scripts/` tests use temp dirs and restore the one env var they set. Checked with three shuffled file/test orders (seeds 11, 22, 33), all green. A new test that mutates globals, `process.env` or a module-level cache without restoring it breaks this invariant; `tests/repo-config/tracked-tree.test.js` pins the setting so turning isolation back on is a visible choice.

## Examples

```bash
pnpm run test:repo-config           # one-shot
pnpm exec vitest --config vitest.config.js  # watch mode
```

## Tests

Exercises every `tests/repo-config/*.test.js` guard and the root `scripts/` tooling tests. Future repo-meta tests can land under `tests/**/*.test.js` and will be picked up automatically. Why `isolate: false` and the shared tracked-tree helper exist: the 2026-09-28 follow-up on repo-config guards failing under load (`GpsPlusSlamJs_Docs/docs/2026-09-28-1913-repo-config-guards-under-load-followup.md`, private repo).
