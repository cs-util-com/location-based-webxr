# model-step.ts

**Purpose:** the 3D model step of the asset optimizer's Worker: a `.glb` read (`glb-file.ts`), its textures made smaller (`model-textures.ts`), its triangles thinned to a level of detail with a coarser chain saved (`model-lod.ts`), its geometry quantized (`model-quantize.ts`), and written back as a `.glb` the tour accepts.

## Public API

- `optimizeModel(payload, settings, control, device)`:
  - `{ type: "done", blob, extension: "glb", model }`, the blob typed `model/gltf-binary`, `model` the `ModelReport` `{ textures, lod, quantize }` of the passes (`TextureReport`, `LodReport`, `QuantizeReport`);
  - `{ type: "kept", reason: "Kept as it is: ..." }` for a valid model this code leaves alone (an unknown extension, several buffers);
  - throws "it could not be read as a 3D model: ..." for a file the tour would refuse, "no 3D model was handed over" for a payload that is no `Blob`, "the smaller model would not open in a tour: ..." if the result failed the tour's check, and an `AbortError` once stopped.

## Invariants

- Order: read, textures (progress 0 to 0.45), levels of detail (0.45 to 0.95, per primitive), quantize, write. The level-of-detail pass measures deviations on float positions, so it runs before quantizing. Its ordering of one primitive cannot be interrupted, so a stop lands after it.
- **The chain never costs the file its savings:** the shelf keeps the original when the file is above `keepAbove` of it, so while the written file is above that line the coarsest saved level of every primitive is dropped (`dropCoarsestLevel`), down to no chain at all; the author's level is never touched. Each size is measured on a copy written from a clone of the JSON (`writeGlb` renumbers the views of the JSON it writes).
- The output always passes `checkGlbInert`, so no decoder extension is ever added.
- The runner (`asset-shelf.ts`) judges the result: not at least 10 % smaller keeps the original. A glb-to-glb swap keeps the asset's path; the document counts swaps so the next save writes the new bytes.
- Runs in the Worker with `PICTURE_DEVICE` (`asset-optimizer.worker.ts`), on a phone too.

## Tests

- `model-step.test.ts` (a textureless height field, cheap to order, in place of a scan; the scans run in `model-lod.test.ts` and the e2e): every triangle kept (share 1) comes back accepted by the tour, drawn within the quantize budget; dropped as it is, a 16-bit textureless field (where the chain weighs most) is thinned to its default level within the level-of-detail budget, the whole file smaller than 0.9 of its bytes, with forward-only progress; just under the line of the full chain's file, the coarsest levels go and the rest of the chain stays a prefix of it, and far under it the whole chain goes, the author's index list the same in both; the done answer carries the passes' reports (a box gets no levels); an unknown extension kept with words; a file that is no model and a payload that is no file fail; a stop.
- `playwright-tests/editor-asset-optimizers.spec.js`: the shipped row in a real Worker on the three scanned models, judged by three.js and by drawings from the same camera.
