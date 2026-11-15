# optimizer-settings.ts

**Purpose:** the "smaller files" values in one place, so they can be retuned after a listening and viewing check.

## Public API

- `OPTIMIZER_SETTINGS: OptimizerSettings`:
  - `picture`: longest side 1600 px, `image/webp`, quality 0.75 (never enlarged);
  - `speech`: Opus 24 kbps mono; `music`: Opus 64 kbps stereo (music and ambience);
  - `model` (`ModelSettings`, `model-step.ts`): textures at most 1024 px on the longest side, colour textures as JPEG 0.85, data textures (normal, roughness and metalness, occlusion) as JPEG 0.92 or kept PNG; 16-bit positions, 8-bit normals and tangents, 16-bit texture coordinates; an error budget of 0.0001 (0.01 % of a mesh's box diagonal). Swept in `model-quantize.test.ts` and the optimizer e2e: 16-bit positions err at most about 0.0013 % (0.00096 to 0.0011 % on the scanned models), so the budget passes them from 0.01 % up and a budget of 0.001 % refuses some; 8-bit positions err about 0.25 to 0.29 % and pass only a 1 % budget; 16-bit normals cost 4 more bytes a vertex for 0.0015 degrees against 0.38; 8-bit texture coordinates save nothing (a vertex attribute is padded to 4 bytes either way). What would reverse the budget: a model whose detail is smaller than 0.01 % of its size, seen from close up.
  - Levels of detail (`model-lod.ts`): a default level within 0.25 % of a primitive's box diagonal (`lodBudget` 0.0025), primitives under 2 000 triangles left alone (`lodMinTriangles`), and `detailShare` left out (the shelf's slider sets it per run). Swept on the three scanned models: at 0.1 % the rock keeps all its 9 932 triangles, the coast rock 53 %, the boulder 82 %; at 0.15 % 97 %, 38 %, 68 %; at 0.25 % 80 %, 17 %, 34 % (the boulder's deviation 5.7 mm); at 0.5 % 36 %, 7 %, 12 %; at 1 % 7 %, 4 %, 5 %. The boulder halves its triangles between 0.15 and 0.25 %, so the budget is the one number that most changes what a tour draws. The floor: the scans first thinned to 500 to 4 000 triangles and then given a default level keep 91 to 100 % of them, so a model near the floor has almost nothing to gain. What would reverse it: a hand-made model of a few thousand triangles drawn far less efficiently than a thinned scan.
  - `keepAbove`: 0.9 - a result larger than this share of the original keeps the original ("at least 10 % smaller").
- `OPTIMIZER_SLOTS`: jobs at once, `{ phone: 1, desktop: 2 }`, provisional until measured on a phone.
- Type `OptimizerSettings` (its picture and sound parts are module-private shapes).

## Invariants

- Nothing else hard-codes a size, quality or bitrate: optimizers read their part from the `settings` of their context (`asset-optimizers.ts`), and the Worker receives them with each run (`optimizer-protocol.ts`).

## Tests

Values only; read by `asset-shelf.test.ts` (the 10 % rule).
