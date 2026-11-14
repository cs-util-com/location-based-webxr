# model-step.ts

**Purpose:** the 3D model step of the asset optimizer's Worker: a `.glb` read (`glb-file.ts`), its textures made smaller (`model-textures.ts`), its geometry quantized (`model-quantize.ts`), and written back as a `.glb` the tour accepts.

## Public API

- `optimizeModel(payload, settings, control, device)`:
  - `{ type: "done", blob, extension: "glb" }`, the blob typed `model/gltf-binary`;
  - `{ type: "kept", reason: "Kept as it is: ..." }` for a valid model this code leaves alone (an unknown extension, several buffers);
  - throws "it could not be read as a 3D model: ..." for a file the tour would refuse, "no 3D model was handed over" for a payload that is no `Blob`, "the smaller model would not open in a tour: ..." if the result failed the tour's check, and an `AbortError` once stopped.

## Invariants

- Order: read, textures (progress 0 to 0.85), quantize, write. A later level-of-detail pass belongs between reading and quantizing, while the positions are still floats.
- The output always passes `checkGlbInert`, so no decoder extension is ever added.
- The runner (`asset-shelf.ts`) judges the result: not at least 10 % smaller keeps the original. A glb-to-glb swap keeps the asset's path; the document counts swaps so the next save writes the new bytes.
- Runs in the Worker with `PICTURE_DEVICE` (`asset-optimizer.worker.ts`), on a phone too.

## Tests

- `model-step.test.ts`: the scanned rock comes back smaller than 0.9 of its bytes, accepted by the tour, drawn within the error budget; an unknown extension kept with words; a file that is no model and a payload that is no file fail; a stop.
- `playwright-tests/editor-asset-optimizers.spec.js`: the shipped row in a real Worker on the three scanned models, judged by three.js and by drawings from the same camera.
