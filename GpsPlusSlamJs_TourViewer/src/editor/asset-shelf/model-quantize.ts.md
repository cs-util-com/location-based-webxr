# model-quantize.ts

**Purpose:** a model's geometry stored in fewer bytes with `KHR_mesh_quantization`, which three.js and every common glTF viewer read without a decoder (the tour's GLB policy allows it).

## Public API

- `QuantizeSettings`: `{ positionBits: 8 | 16, normalBits: 8 | 16, texcoordBits: 8 | 16, maxPositionError }` (a share of the box diagonal). `ModelSettings` (`optimizer-settings.ts`) carries them.
- `quantizeModel(parts, settings): QuantizeReport`: changes `parts` in place; reports how many accessors became integers per attribute (`positions`, `normals`, `tangents`, `texcoords`, `indices`) and the largest errors (`positionError` as a share of the diagonal, `normalErrorDeg`, `texcoordError`).

## What it does

- **Positions:** meshes that share a position accessor form one group with one box. Each position becomes a SHORT (16 bits) or BYTE (8 bits) normalized integer around the box's centre, with ONE scale for all axes (the largest half extent), so the normal matrix stays a rotation and normals stay right. POSITION `min` and `max` hold the integers, as the validator wants.
- **The undo transform:** each node that carries such a mesh hands it to a NEW child node with `translation = centre` and `scale = [s, s, s]`. The carrier keeps its own transform, children, animation and name; nothing that targets it changes.
- **Normals and tangents:** BYTE or SHORT normalized unit vectors (a tangent's w as plus or minus the largest value).
- **Texture coordinates:** UNSIGNED_SHORT or UNSIGNED_BYTE normalized, only when every value lies within 0..1 (1e-6 of slack).
- **Indices:** UNSIGNED_INT lists whose largest index is at most 65534 become UNSIGNED_SHORT (core glTF; 65535 is WebGL 2's primitive restart index for 16-bit lists).
- Every integer vertex attribute gets its own view with an explicit `byteStride` padded to 4 bytes, as glTF requires; the extension is added to `extensionsUsed` and `extensionsRequired` once anything was quantized.

## Left as they are

- Positions of a mesh with morph targets, one drawn by a skinned node (a skin ignores the node's transform), by a node with an extension (GPU instancing), or by no node; every attribute of a mesh with morph targets.
- An accessor something else reads too (animation, skin, morph target, node extension) or used in two roles; a sparse one; one already of integers; non-finite values.
- A group whose largest position error exceeds `maxPositionError`.

## Invariants and measurements

- 16-bit positions err at most sqrt(3) / (4 x 32767) of the box diagonal, about 0.0013 % (property test); on the repo's scanned models 0.00096 to 0.0011 %. 8-bit positions err about 0.25 to 0.29 % there. The default budget, 0.01 %, passes 16 bits and refuses 8.
- 8-bit normals err about 0.37 to 0.38 degrees, 16-bit ones 0.0015 degrees for 4 more bytes a vertex.
- 8-bit texture coordinates take as many bytes as 16-bit ones (4-byte padding), so 16 is the default.
- Measured on the scanned models with the default settings and no texture change: rock 679 492 to 593 764 bytes, coast-rock 1 275 096 to 852 820, boulder 1 617 364 to 1 092 044.

## For a later level-of-detail pass

A simplifier must run BEFORE this pass, on float positions (`model-step.ts` orders it so). A chain of levels in one file would need each level's index list narrowed on its own; this pass narrows per accessor already.

## Tests

- `model-quantize.test.ts`: positions, normals and texture coordinates under a rotated, scaled, moved node, judged by glTF-Transform's reader and the validator; the error budget; shared position lists and two instances of one mesh; an animated carrier; skinned, morphed and GPU-instanced meshes kept; tiled texture coordinates kept; the 65534 index limit; the scanned models over position bits x budget and normal bits (rows written to the file `MODEL_SWEEP_LOG` names).
- `model-quantize.property.test.ts`: random point clouds under random transforms stay within the reported error, which stays within the 16-bit bound, and validate.
