# model-lod.ts

**Purpose:** the model step's level-of-detail pass: each primitive ordered once by the progressive simplifier (`mesh-simplify.ts`), the author's level chosen by an error budget or by the shelf's slider, the vertex buffer cut down to what the saved levels use, and a chain of coarser levels saved for the renderer in `primitive.extras.lod`.

## Public API

- `simplifyModel(parts, settings, progress?)` returns a `LodReport`; `parts` is changed in place. `progress` hears the share of primitives done.
- `LodSettings` (part of `ModelSettings`):
  - `lodBudget`: the default level's largest deviation, as a share of the primitive's bounding box diagonal (0.0025 in `OPTIMIZER_SETTINGS`);
  - `lodMinTriangles`: a primitive with fewer triangles is left as it is (2 000);
  - `detailShare?`: the author's share of triangles kept (0..1, clamped), overriding the budget. Left out, or not a finite number, the budget decides.
- `LodReport`: `skipped` (why the whole model was left as it is, or null), `primitives`, `trianglesBefore`, `trianglesAfter` (of the primitives given levels), `deviation` (the author's level's, as a share of the size, the largest over the primitives), `size` (the largest primitive's box diagonal, model units), `automatic`, and `choices`: the slider's stops (`LOD_SHARES`), each `{ share, triangles, deviation }`, summed over the primitives (triangles) or their largest (deviation).
- Constants: `LOD_CHAIN_LEVELS` (4), `LOD_STOP_SAMPLES` (2 000, the slider's stops: an estimate shown before the author picks one), `LOD_SEARCH_SAMPLES` (5 000), `LOD_CHECK_SAMPLES` (20 000), `LOD_SHARES`.

## What is saved

```json
"primitives": [{
  "attributes": { "POSITION": 4, "NORMAL": 5, "TEXCOORD_0": 6 },
  "indices": 7,
  "extras": { "lod": { "indices": 9, "levels": [
    { "start": 0, "count": 7446, "error": 0.002281 },
    { "start": 7446, "count": 3723, "error": 0.003507 }
  ] } }
}]
```

- `indices` (the primitive's own) is the author's level: a viewer that does not read `extras.lod` draws it, and so does a renderer at close range.
- `extras.lod.indices` is a second accessor over the same buffer view: the author's level and then each coarser level, end to end. `levels[i]` is its draw range (`start`, `count` in indices) and its largest deviation as a share of the primitive's box diagonal. Relative, so it survives quantizing, which moves the positions into a scaled child node. 16-bit when the compacted buffer has at most 65 535 vertices (65 535 is the primitive restart value), else 32-bit.
- Every attribute of the primitive is cut down (`gatherAccessor`) to the vertices any saved level uses, in their original order; `min` and `max` are recomputed.
- The primitive's own extras are kept; `lod` is added beside them.
- No glTF extension: the file stays plain glTF for every viewer.

## How a level is chosen

- **Automatic (the default):** a search on the triangle count's log scale (`SEARCH_ROUNDS` halvings) with quick probes of `LOD_SEARCH_SAMPLES` points a side, then a check of the answer with `LOD_CHECK_SAMPLES`; a level that fails the check steps 15 % finer, up to `CHECK_RETRIES` times, else every triangle stays. The deviation reported and stored for the author's level is always the checked one, so it is within the budget by construction.
- **The author's share:** `stepsFor` the share of the triangles; its deviation is measured and shown, whatever it is.
- **The chain:** up to `LOD_CHAIN_LEVELS` levels at a half, a quarter, an eighth and a sixteenth of the author's triangles, stopping under 64 triangles or when the order allows no coarser level. Each level's error is measured with the quick probe against the full mesh, and never reads below a finer level's (sampling noise is clamped), so the renderer may walk the chain one way.
- Deviations are cached per (steps, samples), so the search, the slider's stops and the chain share their measurements.

## Left as they are

- **A skinned or animated model, whole** (`skipped` says which). Its deviation would have to be measured in its poses, not in its rest shape, and no such tour model exists yet to test that on. Not one byte of it changes.
- A primitive with morph targets, `JOINTS_n` or `WEIGHTS_n`, a mode other than triangles (4), an attribute or index accessor that anything else also reads (another primitive, a node extension), an accessor `readAccessor` cannot read, non-float or non-finite positions, an index naming a vertex it does not have, extras that are no object, or `extras.lod` already there (an optimized file optimized again keeps its levels).
- A primitive under `lodMinTriangles`.
- A primitive without indices gets `0, 1, 2, ...` and then a saved index list.

## Invariants

- Pure and synchronous apart from `progress`; it runs in the optimizer's Worker between the texture pass and quantizing, while positions are floats. One primitive's ordering cannot be interrupted: measured on a desktop, the 57 000-triangle boulder orders in about 0.8 s and one full-sampling probe takes about 0.8 s, one quick probe about 0.2 s; the whole pass on it takes a few seconds, a phone several times that.
- The weld merges render copies only where every attribute but the normal matches exactly (normals within 2 degrees), so a hard edge, a texture seam or a colour seam stays.

## Tests

- `model-lod.test.ts`: a scanned rock taken to its default level within the budget, its vertices compacted and a chain saved, measured again from the file as glTF-Transform reads it; the author's share followed and its deviation reported; share 1 keeps every triangle; a model under the floor untouched; a skinned and an animated model untouched to the byte; a primitive with morph targets, or whose positions another mesh shares, left alone; a primitive with levels not simplified again; the Khronos validator's verdict and the primitive's own extras kept.
- `model-lod.property.test.ts`: for random height fields and spheres, random budgets and random author's shares, every level indexes the compacted buffer, the levels lie end to end with falling counts and non-falling errors, no level has a degenerate triangle, and an automatic level stays within its budget, measured again from the written file.
- `model-step.test.ts`: the pass inside the step, its report on the answer.
