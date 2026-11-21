# gltf-repack.ts

**Purpose:** a `.gltf` and the files it names (`.bin` buffers, pictures, or `data:` URIs inside its text) repacked into the one self-contained `.glb` a tour may carry. Lossless and pure: no three.js, no re-encoding, every glTF field and extension kept as written.

## Public API

- `repackGltf(gltfPath, files, limits?): RepackResult`
  - `files`: every file the creator gave, keyed by its path in the bundle (the `.gltf` among them); references are resolved by `bundle-paths.ts`.
  - `{ ok: true, glb, notes, used }`: `notes` in words for what was left out; `used` the given files the model read, besides the `.gltf`.
  - `{ ok: false, reason }`: a refusal in words (`model-import-words.ts`).
- `RepackLimits` (a partial one overrides the module-private defaults):
  - `maxTextBytes` (16 MiB, the archive reader's `maxTextEntryBytes`): the text WITHOUT its `data:` URIs;
  - `maxBytes` (`ASSET_CEILING_BYTES` of `tour-files.ts`, 512 MiB): the `.gltf` file, and separately all its buffers and pictures together;
  - `maxImagePixels` (`TOUR_MAX_IMAGE_PIXELS`).

## How it works

1. The text is capped, parsed, and must be glTF 2.x; Draco, meshopt or KTX2 in `extensionsUsed` or `extensionsRequired` refuses in words.
2. Each buffer is fetched by its URI (a file or a `data:` URI): missing, remote (`https:`, `file:`...), outside the given files, broken or shorter than its `byteLength` refuses. It is cut to its `byteLength`.
3. The buffers are laid end to end, each on a 4-byte boundary, and every buffer view's `buffer` becomes 0 and its `byteOffset` the buffer's start plus its own. **Every view is kept at its index**: that is why this does not use `glb-file.ts`'s `writeGlb`, whose `packViews` drops views no accessor or image names and renumbers the rest, which would break an unknown extension that names a view. The container itself is written by `glb-file.ts`'s `glbContainer`.
4. Each picture named by URI is typed by its bytes (`image-sniff.ts`), measured against the pixel cap before anything could decode it (over the cap refuses), and appended as a new view after the original ones, with `mimeType` written and `uri` removed. Pictures already in a buffer view stay as they are.
5. A picture that is missing, remote, undecodable or of a type a `.glb` cannot carry (GIF, BMP, TIFF, KTX2 ...) is left out with a note: every texture showing it (by `source` or an extension's `source`) is unlinked from the materials (any `{ index }` reference, `extras` aside), and the image becomes a 1 x 1 PNG placeholder so no index changes.
6. The result must pass `checkGlbInert`, or it is refused (`notInert`).

## Invariants

- Nothing is fetched; nothing outside `files` is read.
- The same input gives the same bytes (the editor names files by content hash).
- The JSON keeps all its fields; only `buffers` (one, without `uri`), the views' `buffer` / `byteOffset`, and URI pictures' `bufferView` / `mimeType` change, plus the unlinked texture references.
- glTF's alignment rules hold: buffer starts are 4-byte aligned, so every accessor keeps the alignment its offsets had in its buffer.
- Limit for now: GIF, BMP and TGA pictures in a `.gltf` are left out with a note rather than converted to PNG (the converting picture step comes with the OBJ and STL converters).

## Example

```ts
const result = repackGltf("chair/chair.gltf", files);
if (!result.ok) showFailure(result.reason);
else addFile(new Blob([result.glb]), "chair.glb", result.notes);
```

## Tests

- `gltf-repack.test.ts`: several buffers merged with every accessor, picture and view kept; data URIs moved in; a percent-encoded `.bin` name; a picture typed by its bytes; a missing `.bin`, a remote buffer and a `../` escape refused in words with a `fetch` spy never called; pictures missing, remote, TIFF and broken left out with notes and unlinked; the pixel cap; Draco, meshopt and KTX2; non-glTF text, glTF 1.0, a buffer without URI, a view outside its buffer; a short and a broken buffer; the text cap without data URIs and the size ceiling; an unknown extension naming a view; the same bytes twice; both real fixtures (Poly Haven, CC0) split and repacked to the same accessors and pictures with no new Khronos validator errors.
- `gltf-repack.property.test.ts`: random documents over 1-4 buffers (files or data URIs) with pictures as files, data URIs or views and an unknown extension naming a random view: one buffer, every view, accessor, picture and the extension's view unchanged, inert, the same bytes twice; garbled `.gltf` text never throws.
- Test support: `test-support/gltf-split.ts` (`splitGlb` takes a `.glb` apart into a `.gltf`, `.bin` files and pictures; `looseGlbParts` reads a result without `readGlb`'s refusals).
