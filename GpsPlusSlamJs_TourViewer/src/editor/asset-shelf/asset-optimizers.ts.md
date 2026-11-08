# asset-optimizers.ts

**Purpose:** the asset shelf's optimizer contract and its table, one row per asset kind.

## Public API

- `OptimizeOutcome`: `{ kind: "optimized", blob, extension, width?, height? }` or `{ kind: "kept", reason }`.
- `OptimizeControl`: `{ signal, progress(fraction) }`; `OptimizeContext` adds `settings` and `host`.
- `OptimizerHost`: `run(kind, payload, settings, control)` and `close()`, implemented by `optimizer-client.ts`. `run` rejects with `OptimizerCrashed` when the Worker died and with an `AbortError` once aborted.
- `AssetOptimizer`: `optimize(source, ctx)`; a throw is a failure the shelf shows with Retry.
- `OptimizerTable`: `Record<TourAssetKind, AssetOptimizer | null>`.
- `ASSET_OPTIMIZERS`: this build's table - every row null (no optimizer yet).
- `optimizerShrinks(table)`: `(kind) => boolean`, whether a file of the kind can be made smaller here; `editor-session.ts` passes it to `readTourFile` as `shrinks`.
- `OptimizerCrashed`: the error a dead Worker turns into.

## Invariants

- A plain object literal, no registry: adding the picture row is a one-line edit here, and nothing in the shelf's panel changes.
- An optimizer runs on the PAGE and may do a step there before handing the heavy part to the Worker through `ctx.host`; the Worker has a matching step in `asset-optimizer.worker.ts`.
- A null row means no job runs (the file is kept, with words), and a file of that kind over the entry or pixel cap is refused when it comes in.
- Results are judged by the runner (`asset-shelf.ts`), not by the optimizer: not 10 % smaller keeps the original; still over the cap fails.

## Tests

`asset-shelf.test.ts` drives a fake row (`test-support/fake-optimizer.ts`); the session's over-cap tests cover `shrinks`.
