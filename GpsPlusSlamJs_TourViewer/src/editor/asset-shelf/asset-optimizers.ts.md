# asset-optimizers.ts

**Purpose:** the asset shelf's optimizer contract and its table, one row per asset kind.

## Public API

- `OptimizeOutcome`: `{ kind: "optimized", blob, extension, width?, height? }` or `{ kind: "kept", reason }`.
- `OptimizeControl`: `{ signal, progress(fraction) }`; `OptimizeContext` adds `settings` and `host`.
- `OptimizerHost`: `run(kind, payload, settings, control, transfer?)` and `close()`, implemented by `optimizer-client.ts`. `run` rejects with `OptimizerCrashed` when the Worker died and with an `AbortError` once aborted.
- `AssetOptimizer`: `optimize(source, ctx)`; a throw is a failure the shelf shows with Retry.
- `OptimizerTable`: `Record<TourAssetKind, AssetOptimizer | null>`.
- `PICTURE_OPTIMIZER`: the `image` row; hands the file to the Worker's picture step (`picture-step.ts`).
- `MODEL_OPTIMIZER`: the `model` row; hands the `.glb` to the Worker's model step (`model-step.ts`).
- `ASSET_OPTIMIZERS`: this build's table - `image` the picture row, `audio` the sound row (`sound-optimizer.ts`), `model` the model row, `video` null.
- `optimizerShrinks(table)`: `(kind) => boolean`, whether a file of the kind can be made smaller here; `editor-session.ts` passes it to `readTourFile` as `shrinks`.
- `OptimizerCrashed`: the error a dead Worker turns into.

## Invariants

- A plain object literal, no registry: adding a row is a one-line edit here, and nothing in the shelf's panel changes.
- An optimizer runs on the PAGE and may do a step there before handing the heavy part to the Worker through `ctx.host`; the Worker has a matching step in `asset-optimizer.worker.ts`.
- A null row means no job runs (the file is kept, with words), and a file of that kind over the entry or pixel cap is refused when it comes in. Since the model row exists, a `.glb` over the entry cap comes in to be made smaller; one whose embedded textures are over the pixel cap is still refused by `readTourFile` (the save could not tell it is over a cap).
- Results are judged by the runner (`asset-shelf.ts`), not by the optimizer: not 10 % smaller keeps the original; still over the cap fails.
- `transfer` lists buffers the payload hands to the Worker instead of copying them (a sound's samples).

## Tests

`asset-shelf.test.ts` drives a fake row (`test-support/fake-optimizer.ts`); the session's over-cap tests cover `shrinks`.
