# model-import-words.ts

**Purpose:** every sentence a creator reads when a model file is converted for a tour, in one place, so the wording stays consistent and each test names the exact sentence its case must produce.

## Public API

- `refusal.*`: the model is not added.
  - `missingFile(model, needed)`, `outsideFolder(model, needed)`, `remotePart(model)`: a buffer that is not among the files, leaves them, or lives on the internet.
  - `compressed(kind)`: Draco, meshopt or KTX2 pictures (`compressionOf` gives the kind).
  - `unreadable(model)`, `notVersion2(model)`, `partTooShort(model, part)`, `brokenPart(model)`: a file that is not a readable glTF 2.0 model.
  - `tooLarge(model, bytes, cap)`: the file, or all its data together, above the size ceiling.
  - `textTooLarge(model, bytes, cap)`: the `.gltf`'s text without its `data:` URIs above the text cap.
  - `pictureTooLarge(model, picture, why)`: a picture above the pixel cap (`why` from `checkImageWithinCap`).
  - `notInert(model, why)`: the backstop when the result fails `checkGlbInert`.
- `note.*`: the model is added, without something.
  - `missingPicture`, `remotePicture`, `brokenPicture(picture)`, `unsupportedPicture(picture, shown)`: `shown` names the formats the converter in question carries (the glTF repack: PNG, JPEG, WebP and AVIF), so a note never promises a conversion that converter does not do.
- `compressionOf(extension)`: the creator's name for a compression extension, or null.
- `megabytes(bytes)` (module-private): MB for a sentence (one decimal below 10).

## Invariants

- Plain words, no extension or field names a creator would not know; every refusal says what to do next.
- Pure: no I/O.

## Tests

- Covered through the converters' tests, which compare against these functions (`gltf-repack.test.ts`).
