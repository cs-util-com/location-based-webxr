# model-lod.ts

**Purpose:** the model step's level-of-detail pass: each primitive ordered once by the progressive simplifier (`mesh-simplify.ts`), the author's level chosen by an error budget or by the shelf's slider, the vertex buffer cut down to what the saved levels use, and a chain of coarser levels saved for the renderer in `primitive.extras.lod`.

## Public API

- `simplifyModel(parts, settings, progress?)` returns a `LodReport`; `parts` is changed in place. `progress` hears the share of primitives done: after each primitive, and the same share again during one, after its ordering, after its grids are built and after each pose's measurement, so the optimizer's Worker keeps reporting through a long primitive (the page counts a silent Worker as crashed).
- `dropCoarsestLevel(parts)`: drops the coarsest saved level of every primitive with a chain, and the whole `extras.lod` where only the author's level would be left; the chain accessor's count and its buffer view are cut to the levels kept (the view only when no other accessor reads past the new end), so the bytes leave the file. The author's index list is never touched. A chain whose levels, accessor or component type do not read is skipped. Returns whether anything was dropped. The model step calls it while the file is above the shelf's `keepAbove` line; it applies to a chain the file came with too.
- `LodSettings` (part of `ModelSettings`):
  - `lodBudget`: the default level's largest deviation, as a share of the primitive's bounding box diagonal (0.0025 in `OPTIMIZER_SETTINGS`);
  - `lodMinTriangles`: a primitive with fewer triangles is left as it is (2 000);
  - `detailShare?`: the author's share of triangles kept (0..1, clamped), overriding the budget. Left out, or not a finite number, the budget decides.
- `LodReport`: `skipped` (why part of the model was left as it is, or null: set when a skinned primitive could not be posed; that primitive is left alone and the others are still given levels), `primitives`, `trianglesBefore`, `trianglesAfter` (of the primitives given levels), `deviation` (the author's level's, as a share of the size, the largest over the primitives), `size` (the largest primitive's box diagonal: a still primitive's in model units, a skinned one's in its rest pose), `automatic`, and `choices`: the slider's stops (`LOD_SHARES`), each `{ share, triangles, deviation }`, summed over the primitives (triangles) or their largest (deviation).
- Constants: `LOD_CHAIN_LEVELS` (2) and `LOD_CHAIN_RATIO` (4), see "Choosing the chain"; internal to the module: `LOD_STOP_SAMPLES` (2 000, the slider's stops: an estimate shown before the author picks one), `LOD_SEARCH_SAMPLES` (5 000), `LOD_CHECK_SAMPLES` (20 000), `LOD_SHARES`.

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
- **The chain:** up to `LOD_CHAIN_LEVELS` (2) levels, each at `1 / LOD_CHAIN_RATIO` (a quarter) of the triangles of the one before (a quarter and a sixteenth of the author's), stopping under 64 triangles or when the order allows no coarser level. Each level's error is measured with the quick probe against the full mesh, and never reads below a finer level's (sampling noise is clamped), so the renderer may walk the chain one way. While the made file would be above the shelf's `keepAbove` line, the model step drops the coarsest levels again, down to none (`dropCoarsestLevel`).
- Deviations are cached per (steps, samples), so the search, the slider's stops and the chain share their measurements.

## Choosing the chain

Swept on the three scanned models, at the default level and at share 1,
by `model-lod-chain.sweep.test.ts` (opt-in, `LOD_CHAIN_SWEEP=1`): the
spacing (halving, a third, quartering) against the level count (1 to 4).
The file is the whole made file as a share of the original; the drawing
cost is the triangles drawn at the 1 px and 2 px budgets at screen sizes
of the box diagonal from 25 to 800 px, weighted by how often a size occurs
(P^-2, P^-1 and flat: every size as likely), relative to halving with 4
levels.

- No chain: rock 0.833 (default level), 0.874 (share 1).
- Halving, 1 to 4 levels:
  - rock 0.868 / 0.886 / 0.894 / 0.899, at share 1 0.918 / 0.940 / 0.951 / 0.957;
  - coast-rock 0.237 / 0.247 / 0.254 / 0.254 (the order stops at 1 582);
  - boulder 0.367 / 0.385 / 0.394 / 0.398;
  - 3 levels draws up to 1.95 times 4 levels' triangles under P^-2.
- Quartering, 1 to 3 levels:
  - rock 0.851 / 0.855 / 0.856, at share 1 0.896 / 0.902 / 0.903;
  - coast-rock 0.228 / 0.235 / 0.235;
  - boulder 0.349 / 0.354 / 0.356 (19 312 / 4 828 / 1 206 triangles);
  - 2 levels reach the same sixteenth as halving's 4 and, under P^-2 and
    P^-1, draw 1.01 to 1.33 times its triangles; a third level (a 64th)
    saves under 1 % of the file and is seldom drawn.
- A third of the triangles a level, 2 levels: rock 0.864, coast-rock
  0.238, boulder 0.363, between the two.
- Chosen: quartering with 2 levels, the cheapest in bytes for about the
  same drawing under P^-2 and P^-1 (at share 1 halving with 4 levels put
  rock over the 0.9 line at 0.957).
- **What it costs, and what would reverse it.** Under the flat weight it
  draws 1.08 to 1.34 times halving-4's triangles at the 1 px budget, up to
  1.71 times at 2 px (boulder, share 1). The cost sits in the 200 to 400
  px band, which is an ordinary size for a model in AR a few metres away,
  not a rare one: there quartering draws the author's level where halving
  drew its half (boulder at 200 px: 19 312 against 9 656 triangles at the
  default level, 14 360 against 7 180 at share 1; coast-rock at share 1:
  11 895 against 5 948). In absolute terms that is under about 10 000
  triangles a model, against the 2 to 14 % of the original's bytes that
  halving-4 adds to the file (coast-rock 0.235 against 0.254 at the
  default level, boulder 0.742 against 0.875 at share 1). A scene of many such models seen at that size, on a device
  bound by triangles rather than by download, would reverse the choice;
  halving with 2 or 3 levels is then the better trade.

## Skinned and animated models

- **A skinned primitive is measured in its poses.** `skin-pose.ts` gives the rest pose and up to three poses sampled from the clips (each clip at a third, two thirds and its end, spread evenly over all clips). A level's deviation is the largest over those poses, each against the full mesh skinned into the same pose, and every pose's as a share of the rest pose's box diagonal: the size the shelf shows (`size`, in the units the model is posed in, so a model stored in centimetres under a 0.01 armature reads in metres) and the box the viewer picks a level by do not change with the pose. A clip pose that moves none of the primitive's skin's joints (a door beside a character) is not measured, and does not count as a clip for that primitive. So a level that is fine at rest and tears where the model bends is refused, by the same search and check as a still model.
- **The ordering sees the poses.** The progressive simplifier gets each vertex's place in every clip pose (its skinned position, as a share of the rest pose's box diagonal) as an attribute of weight `SKIN_WEIGHT` (1), so a collapse that is flat at rest but moves a corner of the bent shape costs what that corner's error would. It works from where a vertex goes, not from its raw `WEIGHTS_n`: an exporter sorts each vertex's joints by weight, so two vertices fully on different bones both read `[1, 0, 0, 0]`, and only their `JOINTS_n` differ. Measured on the tube: with every vertex on one bone (a hinge), the default level keeps 108 of 1 280 triangles with the poses in the order and 1 112 without them (raw weights in their place: 1 177); on the smoothly weighted tube 308 against 1 176 (raw weights: 802). Swept over `SKIN_WEIGHT` 0.25, 0.5, 1, 2, 4: 108 for the hinge at every value, 260 to 324 for the smooth tube; 0 is the 1 112 and 1 176 above. The ordering keeps the bind shape's positions as its geometry; the measurement is posed.
- **No clip that moves its skin:** only the rest pose can be measured, and how the model will bend is unknown, so the automatic level keeps at least `SKINNED_REST_SHARE` (half) of the triangles. The author's share overrides that, as for any model.
- **An unskinned mesh in an animated file** is measured at rest: node animation moves it rigidly, which a relative deviation does not change. An animated non-uniform scale would stretch it and is not measured.
- **Cost:** measured on a loaded desktop with three clip poses: the 1 280-triangle tube in about 3 s; a 57 600-triangle tube (the boulder's size, 401 rings of 72) in 9.6 to 9.7 s at the default level and 5.3 s at an author's share, against a budget of 10 s a model (a desktop figure). A phone takes several times that. Swept by `model-lod-silence.sweep.test.ts` (opt-in, `LOD_SILENCE_SWEEP=1`) on the skinned tube with its clip, at the default level, on a heavily loaded desktop (the 57 600-triangle tube took 71.8 s there against 9.7 s on a lighter load, so read the times as about seven times a quiet desktop's): 57 600 triangles in 71.8 s with 95 progress reports, the longest gap between two 4.9 s; 230 400 (801 rings of 144) in 106.4 s, 95 reports, longest gap 15.0 s; 921 600 (1 601 rings of 288) in 516.7 s, 91 reports, longest gap 56.8 s. The longest gap grows about three to four times for four times the triangles; the progress reports keep each one far below the whole pass. Should it pass the budget, the search could probe only the pose that was worst so far and leave every pose to the full-sampling check.
- **Limits, stated plainly:**
  - The test model is synthetic: a smooth tube of 1 280 triangles with two bones and one bending clip. No real skinned tour model has been run through the pass yet; many bones, sharp weight changes, or several clips are not covered by a test.
  - Poses between the sampled times are not measured, so a clip whose worst bend falls between them can still show a larger deviation there.
  - A cubic spline clip is sampled linearly between its key values.
  - Morph targets are not posed (a primitive with them is left as it is anyway).
  - The renderer picks a level from the mesh's bind-space box, so a pose that grows the model on screen keeps the level picked for its rest size.

## Left as they are

- **A skinned primitive that cannot be posed** (`skipped` says so): its bones, skin or clips do not read (`skin-pose.ts`), or its mesh is used by nodes with different skins. That primitive keeps every byte, since a level judged in a pose it cannot compute might tear; the model's other primitives are still given levels.
- A primitive with a `JOINTS_n` that has no matching `WEIGHTS_n` (or the other way round) is left alone too, silently: it is malformed rather than unposable, and `skipped` stays null for it.
- A primitive with morph targets, a mode other than triangles (4), an attribute or index accessor that anything else also reads (another primitive, a clip's sampler, a skin's inverse bind matrices, a morph target, a node extension; counted with `otherReaders` from `model-quantize.ts`), an accessor `readAccessor` cannot read, an attribute whose count is not the positions' (the rest of the model is still given levels), non-float or non-finite positions, an index naming a vertex it does not have, extras that are no object, or `extras.lod` already there (an optimized file optimized again keeps its levels).
- A primitive under `lodMinTriangles`.
- A primitive without indices gets `0, 1, 2, ...` and then a saved index list.

## Invariants

- Pure and synchronous apart from `progress`; it runs in the optimizer's Worker between the texture pass and quantizing, while positions are floats. One primitive's ordering cannot be interrupted: measured on a desktop, the 57 000-triangle boulder orders in about 0.8 s and one full-sampling probe takes about 0.8 s, one quick probe about 0.2 s; the whole pass on it takes a few seconds, a phone several times that.
- The weld merges render copies only where every attribute but the normal matches exactly (normals within 2 degrees), so a hard edge, a texture seam or a colour seam stays.

## Tests

- `model-lod.test.ts`: a scanned rock taken to its default level within the budget, its vertices compacted and a chain saved, measured again from the file as glTF-Transform reads it; the author's share followed and its deviation reported; share 1 keeps every triangle; a model under the floor untouched; no empty level saved, even at share 0; a skinned tube whose rest-only level tears when bent: its posed level, posed by the JOINTS_0 and WEIGHTS_0 the file saved, stays within the budget at rest and at 30, 45, 60 and 90 degrees; a skinned tube with every vertex on one bone ordered by its clip poses (more than four times fewer triangles than without them); a skinned model whose only clip moves no joint of its skin kept at half or more; a skinned model sized by its rest pose whether its bind shape is in metres or centimetres; a skinned model without clips keeps at least half its triangles unless the author's share says otherwise; an animated unskinned model given levels; a skinned model whose joint or skin does not read left untouched to the byte, with `skipped` saying so; a primitive with morph targets, or whose positions another mesh shares, left alone; a primitive whose accessor a clip's sampler or a skin's inverse bind matrices also reads left alone; a primitive whose normals are one short of its positions left alone while the other is given levels; every original vertex of a default level within the budget, by a brute-force distance in the test; a 32-bit chain for a triangle soup of 66 000 kept vertices; the author's share and share 1 on a 2 048-triangle bumpy sphere; a primitive with levels not simplified again (dropping its coarser levels is pinned in `model-step.test.ts`); the Khronos validator's verdict and the primitive's own extras kept.
- `model-lod.property.test.ts`: for random height fields and spheres, random budgets and random author's shares, every level indexes the compacted buffer, the levels lie end to end with falling counts and non-falling errors, no level has a degenerate triangle, and an automatic level stays within its budget, measured again from the written file.
- `skin-pose.test.ts`, `skin-pose.property.test.ts`: the poses themselves (see `skin-pose.ts.md`).
- `model-step.test.ts`: the pass inside the step, its report on the answer.
