# gltf-repack.ts

**Purpose:** a `.gltf` and the files it names (`.bin` buffers, pictures, or `data:` URIs inside its text) repacked into the one self-contained `.glb` a tour may carry. Lossless and pure: no three.js, no re-encoding, every glTF field and extension kept as written.

## Public API

- `repackGltf(gltfPath, files, limits?): RepackResult`
  - `files`: every file the creator gave, keyed by its path in the bundle (the `.gltf` among them); references are resolved by `bundle-paths.ts`.
  - `{ ok: true, glb, notes, used }`: `notes` in words for what was left out or guessed; `used` the given files the model carries, besides the `.gltf`: a buffer file or a picture file that went into the `.glb`. A given file that was left out (a picture of a kind a `.glb` cannot carry, unreadable bytes) is not in it, so a caller that adds unused pictures as pictures of their own loses none.
  - `{ ok: false, reason }`: a refusal in words (`model-import-words.ts`).
- `RepackLimits` (a partial one overrides the module-private defaults):
  - `maxTextBytes` (16 MiB, the archive reader's `maxTextEntryBytes`): the text WITHOUT its `data:` URIs;
  - `maxBytes` (`ASSET_CEILING_BYTES` of `tour-files.ts`, 512 MiB): the `.gltf` file, and separately all its buffers and pictures together;
  - `maxImagePixels` (`TOUR_MAX_IMAGE_PIXELS`).

## How it works

1. The file is held to `maxBytes`, then its text to `maxTextBytes` twice. First on the raw bytes, before anything is decoded or parsed: every string literal starting with `data:` (in any letter case) is counted off (an escape-aware scan for the next unescaped quote). Every data URI is such a literal, so this refuses nothing the exact count would pass, and a structure-heavy text is refused before its parse could exhaust a Worker's memory. Then, after the parse, exactly: only the buffers' and pictures' `data:` URIs (by the framework's `isDataUri`, three's own test) are counted off. The text must be glTF 2.x; Draco, meshopt or KTX2 in `extensionsUsed` or `extensionsRequired` refuses in words.
2. Each buffer is fetched by its URI (a file or a `data:` URI): missing, remote (`https:`...), outside the given files, on another computer (`C:\...`, `file:`, `//server`), broken or shorter than its `byteLength` refuses. A buffer is never found by its file name alone (a wrong `.bin` would look like a broken model with nothing to say why); one found in another letter case is used with a note naming the file. An over-budget `data:` buffer refuses with the size it would have brought the data to. It is cut to its `byteLength`.
3. The buffers are laid end to end, each on a 4-byte boundary, and every buffer view's `buffer` becomes 0 and its `byteOffset` the buffer's start plus its own. **Every view is kept at its index**: that is why this does not use `glb-file.ts`'s `writeGlb`, whose `packViews` drops views no accessor or image names and renumbers the rest, which would break an unknown extension that names a view. The container itself is written by `glb-file.ts`'s `glbContainer`.
4. Each picture named by URI is found like a buffer, and also by its file name alone when that names exactly one file (a path on the artist's computer); every match that is not exact is noted with the file used. It is typed by its bytes (`image-sniff.ts`), measured against the pixel cap before anything could decode it (over the cap refuses), and appended as a new view after the original ones, with `mimeType` written and `uri` removed. Pictures already in a buffer view stay as they are.
5. A picture that is missing, remote, outside the given files (`../`), on another computer, undecodable embedded data, bytes that are no known picture (broken or of an unknown kind; one note for both, since they cannot be told apart) or of a type a `.glb` cannot carry (GIF, BMP, TIFF, KTX2 ...) is left out with a note of its own, and the image becomes a 1 x 1 PNG placeholder so no index changes. A texture is unlinked from the materials (any `{ index }` reference, `extras` aside) only when every picture it names (`source` and each extension's `source`) was left out. A texture that still names another picture is kept with a note: an extension naming the left-out picture is dropped from it, and a left-out `source` keeps the placeholder as the fallback.
6. The result must pass `checkGlbInert`, or it is refused (`notInert`).

## Invariants

- Nothing is fetched; nothing outside `files` is read.
- The same input gives the same bytes (the editor names files by content hash).
- The JSON keeps all its fields; only `buffers` (one, without `uri`; none, and no binary chunk, when there are no bytes and no view to name one: every buffer empty and no picture), the views' `buffer` / `byteOffset`, and URI pictures' `bufferView` / `mimeType` change, plus the unlinked texture references.
- glTF's alignment rules hold: buffer starts are 4-byte aligned, so every accessor keeps the alignment its offsets had in its buffer.
- Limits for now:
  - GIF, BMP and TGA pictures in a `.gltf` are left out with a note rather than converted to PNG (the converting picture step comes with the OBJ and STL converters).
  - All buffers collapse into one, which keeps the first buffer's other fields (`name`, `extras`, extensions); the others' are dropped.
  - The unlinking walks the whole material, so a vendor object under a material that has an `index` field naming such a texture is removed too, as a texture reference would be.
  - A texture used outside the materials (by an extension at the root or on a node, say) is not unlinked: it shows the placeholder, without a note of its own.

## Example

```ts
const result = repackGltf("chair/chair.gltf", files);
if (!result.ok) showFailure(result.reason);
else addFile(new Blob([result.glb]), "chair.glb", result.notes);
```

## Tests

- `gltf-repack.test.ts`: several buffers merged with every accessor, picture and view kept; data URIs moved in; a percent-encoded `.bin` name; a picture typed by its bytes; a missing `.bin`, a remote buffer and a `../` escape refused in words with a `fetch` spy never called; pictures missing, remote, outside the folder, unknown bytes, a cut PNG header, TIFF and broken data (in either letter case of `data:`) left out with their own notes and unlinked; the pixel cap; Draco, meshopt and KTX2; non-glTF text, glTF 1.0, a buffer without URI, a view outside its buffer; every buffer empty and no picture written without a binary chunk or buffer; a short file buffer, a short embedded buffer (no name quoted) and a broken one; the text cap without data URIs and the size ceiling; an upper-case `DATA:` buffer and picture (with `;BASE64`) read as embedded data under the text cap; a left-out picture file never reported as used; the text cap on the raw bytes with a `JSON.parse` spy never called, and the exact count after the parse for a `data:` string elsewhere; the real size in an over-budget data refusal; accessors aligned after odd-length buffers (Khronos validator); case and file-name matches noted; a buffer never found by file name, and one on another computer refused in words; a picture on another computer noted; a texture with a second picture kept with a note, either picture lost; an unknown extension naming a view; the same bytes twice; both real fixtures (Poly Haven, CC0) split and repacked to the same accessors and pictures with no new Khronos validator errors.
- `gltf-repack.property.test.ts`: random documents over 1-4 buffers (files or data URIs, lengths not always a multiple of 4) with pictures as files, data URIs or views, accessors at an offset inside their view, some with a stride, an optional sparse accessor, and an unknown extension naming a random view: one buffer, every view, accessor, picture and the extension's view unchanged, every accessor on glTF's alignment, inert, the same bytes twice; garbled `.gltf` text never throws. Dropping the 4-byte padding of the buffer starts turns both this and the unit alignment test red.
- Test support: `test-support/gltf-split.ts` (`splitGlb` takes a `.glb` apart into a `.gltf`, `.bin` files and pictures, optionally with padding after a buffer's last view; `misalignedAccessors` lists the accessors off glTF's alignment; `looseGlbParts` reads a result without `readGlb`'s refusals).
