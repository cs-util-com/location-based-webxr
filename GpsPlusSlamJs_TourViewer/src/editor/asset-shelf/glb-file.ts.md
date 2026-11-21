# glb-file.ts

**Purpose:** a `.glb` taken apart into its JSON and the bytes of each buffer view, accessors read as numbers, and the parts put back together with only the buffer views something still names. The model optimizer's passes (`model-textures.ts`, `model-quantize.ts`) work on these parts.

## Public API

- `GltfObject`: a parsed glTF JSON object (untrusted; every field is checked where it is read).
- `GlbParts`: `{ json, views }`, `views[i]` the bytes of `json.bufferViews[i]`.
- `readGlb(bytes): GlbRead`:
  - `{ ok: true, parts }`;
  - `{ ok: false, why: "unreadable", reason }` when the tour's own check (`checkGlbInert`) refuses the file, a buffer view lies outside the binary chunk, or an accessor, a sparse part or an image names a buffer view the file does not have (past the end, negative, not a whole number): a rewrite renumbers the views by those names, so such a file would come out without its geometry;
  - `{ ok: false, why: "unsupported", reason }` for a valid model this code leaves as it is: more than one buffer, a buffer with a `uri`, or a glTF extension outside the known list.
- `appendView(parts, bytes, fields?)`: adds a buffer view (with `byteStride`, `target` and the like); its index.
- `writeGlb(parts)`: a `.glb` of one JSON chunk (padded with spaces) and, when any view is still named, one binary chunk (padded with zeros), each view starting on a 4-byte boundary. Views no accessor, sparse part or image names are left out and the rest renumbered in their order; `buffers[0].byteLength` is rewritten. `parts` is changed.
- `glbContainer(json, bin)`: the container alone: `json` as the JSON chunk (padded with spaces) and, unless `bin` is null, one binary chunk (padded with zeros to a 4-byte length). Nothing in `json` is checked or changed; `writeGlb` uses it after `packViews`, and the `.gltf` repack (`../model-convert/gltf-repack.ts`) uses it directly, because it must keep every buffer view at its index.
- `readAccessor(parts, index): AccessorData | null`: `{ size, count, values }`, strided and normalized data turned into values (normalized -32768 clamped to -1, as glTF says). Null for no such accessor, a sparse one, a `MAT2` or `MAT3` (a `MAT4` reads, 16 values an element, since it has no column padding), an unknown component type, no buffer view, or elements past the end of the view.
- `gatherAccessor(parts, index, keep)`: cuts an accessor down to the elements `keep` names, in that order, into a new packed view (each element padded to 4 bytes, `byteStride` set when the padding differs, the old view's `target` kept), with `count` set and `min` / `max` recomputed from the raw kept values when present. False with nothing changed for an accessor `readAccessor` refuses, an empty `keep`, or one naming an element the accessor does not have. The level-of-detail pass compacts a primitive's vertices with it.
- `listOf`, `objectOf`, `indexOf`: the defensive field readers the passes share.

## Invariants

- The chunks are read by the framework's `utils/glb-chunks` (`readGlbChunks`), the reader behind the tour's own check, after that check has passed; `glbContainer` writes the format words (`GLB_MAGIC`, `GLB_CHUNK_JSON`, `GLB_CHUNK_BIN`) from the same module, for `writeGlb` and the `.gltf` repack alike.
- The known extensions name no buffer view, so renumbering views cannot break them: `KHR_materials_*`, `KHR_texture_transform`, `KHR_lights_punctual`, `KHR_mesh_quantization`, `KHR_animation_pointer`, `KHR_xmp_json_ld`, `EXT_texture_webp`, `EXT_mesh_gpu_instancing` (its accessors are found by index, not view). Any other extension keeps the model as it is, since it may name a view. Draco, meshopt and Basis never get here: the tour's check refuses them.
- The JSON's other fields (extras, names, unknown keys of known objects) are kept as they were.
- An accessor without a buffer view (all zeros by glTF) stays as it is; the scanned test models carry four such orphans with a `byteOffset`, which the validator reports as an error on the original too.

## Tests

- `glb-chunk-readers.test.ts`: the tour's check, `readGlb` and the check page's `glbByteShares` on the same bytes (well-formed, unpadded, truncated, wrong magic or version, chunks past the end, a wrong header length, extra chunks, broken JSON) and as properties over generated GLBs and random bytes: what the tour refuses, no reader takes.
- `glb-file.property.test.ts`: any mix of valid and invalid buffer view names reads exactly when all are valid, and a rewrite of a readable one names only views it holds. The hand-written files come from `test-support/hand-glb.ts`.
- `glb-file.test.ts`: a round trip judged by glTF-Transform's reader and the Khronos validator; views nothing names dropped and the rest aligned; a model without buffers; unsupported and unreadable files, a buffer view named out of range, negative or not whole on an accessor, a sparse part and an image; `readAccessor` on strided normalized integers, floats, and every refused case; `gatherAccessor` reordering, padding a 2-byte element and keeping raw min and max of a normalized accessor, and refusing without a change; `glbContainer` stating a 3-byte binary chunk's padded length (4) in a file whose length is a multiple of 4.
- Indirectly every model test (`model-quantize*.test.ts`, `model-textures.test.ts`, `model-lod*.test.ts`, `model-step.test.ts`).
