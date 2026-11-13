# glb-file.ts

**Purpose:** a `.glb` taken apart into its JSON and the bytes of each buffer view, accessors read as numbers, and the parts put back together with only the buffer views something still names. The model optimizer's passes (`model-textures.ts`, `model-quantize.ts`) work on these parts.

## Public API

- `GltfObject`: a parsed glTF JSON object (untrusted; every field is checked where it is read).
- `GlbParts`: `{ json, views }`, `views[i]` the bytes of `json.bufferViews[i]`.
- `readGlb(bytes): GlbRead`:
  - `{ ok: true, parts }`;
  - `{ ok: false, why: "unreadable", reason }` when the tour's own check (`checkGlbInert`) refuses the file, its JSON does not parse, or a buffer view lies outside the binary chunk;
  - `{ ok: false, why: "unsupported", reason }` for a valid model this code leaves as it is: more than one buffer, a buffer with a `uri`, or a glTF extension outside the known list.
- `appendView(parts, bytes, fields?)`: adds a buffer view (with `byteStride`, `target` and the like); its index.
- `writeGlb(parts)`: a `.glb` of one JSON chunk (padded with spaces) and, when any view is still named, one binary chunk (padded with zeros), each view starting on a 4-byte boundary. Views no accessor, sparse part or image names are left out and the rest renumbered in their order; `buffers[0].byteLength` is rewritten. `parts` is changed.
- `readAccessor(parts, index): AccessorData | null`: `{ size, count, values }`, strided and normalized data turned into values (normalized -32768 clamped to -1, as glTF says). Null for no such accessor, a sparse one, a matrix type, an unknown component type, no buffer view, or elements past the end of the view.
- `listOf`, `objectOf`, `indexOf`: the defensive field readers the passes share. `COMPONENT_BYTES`, `TYPE_SIZE`: glTF's sizes.

## Invariants

- The known extensions name no buffer view, so renumbering views cannot break them: `KHR_materials_*`, `KHR_texture_transform`, `KHR_lights_punctual`, `KHR_mesh_quantization`, `KHR_animation_pointer`, `KHR_xmp_json_ld`, `EXT_texture_webp`, `EXT_mesh_gpu_instancing` (its accessors are found by index, not view). Any other extension keeps the model as it is, since it may name a view. Draco, meshopt and Basis never get here: the tour's check refuses them.
- The JSON's other fields (extras, names, unknown keys of known objects) are kept as they were.
- An accessor without a buffer view (all zeros by glTF) stays as it is; the scanned test models carry four such orphans with a `byteOffset`, which the validator reports as an error on the original too.

## Tests

- `glb-file.test.ts`: a round trip judged by glTF-Transform's reader and the Khronos validator; views nothing names dropped and the rest aligned; a model without buffers; unsupported and unreadable files; `readAccessor` on strided normalized integers, floats, and every refused case.
- Indirectly every model test (`model-quantize*.test.ts`, `model-textures.test.ts`, `model-step.test.ts`).
