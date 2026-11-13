# optimizer-settings.ts

**Purpose:** the "smaller files" values in one place, so they can be retuned after a listening and viewing check.

## Public API

- `OPTIMIZER_SETTINGS: OptimizerSettings`:
  - `picture`: longest side 1600 px, `image/webp`, quality 0.75 (never enlarged);
  - `speech`: Opus 24 kbps mono; `music`: Opus 64 kbps stereo (music and ambience);
  - `model` (`ModelSettings`, `model-step.ts`): textures at most 1024 px on the longest side, colour textures as JPEG 0.85, data textures (normal, roughness and metalness, occlusion) as JPEG 0.92 or kept PNG; 16-bit positions, 8-bit normals and tangents, 16-bit texture coordinates; an error budget of 0.0001 (0.01 % of a mesh's box diagonal). Swept in `model-quantize.test.ts` and the optimizer e2e: 16-bit positions err at most about 0.0013 % (0.00096 to 0.0011 % on the scanned models), so the budget passes them from 0.01 % up and a budget of 0.001 % refuses some; 8-bit positions err about 0.25 to 0.29 % and pass only a 1 % budget; 16-bit normals cost 4 more bytes a vertex for 0.0015 degrees against 0.38; 8-bit texture coordinates save nothing (a vertex attribute is padded to 4 bytes either way). What would reverse the budget: a model whose detail is smaller than 0.01 % of its size, seen from close up.
  - `keepAbove`: 0.9 - a result larger than this share of the original keeps the original ("at least 10 % smaller").
- `OPTIMIZER_SLOTS`: jobs at once, `{ phone: 1, desktop: 2 }`, provisional until measured on a phone.
- Type `OptimizerSettings` (its picture and sound parts are module-private shapes).

## Invariants

- Nothing else hard-codes a size, quality or bitrate: optimizers read their part from the `settings` of their context (`asset-optimizers.ts`), and the Worker receives them with each run (`optimizer-protocol.ts`).

## Tests

Values only; read by `asset-shelf.test.ts` (the 10 % rule).
