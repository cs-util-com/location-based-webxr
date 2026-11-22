# model-import-words.ts

**Purpose:** every sentence a creator reads when a model file is converted for a tour, in one place, so the wording stays consistent and each test names the exact sentence its case must produce.

## Public API

- `refusal.*`: the model is not added.
  - `missingFile(model, needed)`, `outsideFolder(model, needed)`, `otherComputer(model, needed)`, `remotePart(model)`: a buffer that is not among the files (where the model says), leaves them, points to a file on another computer, or lives on the internet.
  - `compressed(kind)`: Draco, meshopt or KTX2 pictures (`compressionOf` gives the kind).
  - `unreadable(model)`, `notVersion2(model)`, `partTooShort(model, part)`, `embeddedPartTooShort(model)`, `brokenPart(model)`: a file that is not a readable glTF 2.0 model. A part inside the text (a `data:` URI) is never quoted by a name: it has none, only a payload.
  - `tooLarge(model, bytes, cap)`: the file, or all its data together, above the size ceiling.
  - `textTooLarge(model, bytes, cap)`: the `.gltf`'s text without its `data:` URIs above the text cap.
  - `pictureTooLarge(model, picture, why)`: a picture above the pixel cap (`why` from `checkImageWithinCap`).
  - `notInert(model, why)`: the backstop when the result fails `checkGlbInert`.
  - `loneModelPart(part)`, `lonePictureKind(picture)`: a `.bin` or `.mtl`, or a `.tga` or `.bmp`, dropped with no model that could use it (`import-plan.ts`).
  - `zipIsTour(zip)`, `zipNoModel(zip)`, `zipUnreadable(zip)`, `zipTooManyFiles(zip, count, cap)`: a zip that is a tour, holds no glTF model (a zip inside it is not opened), is no readable zip, or brings more files than a model may (`zip-bundle.ts`); `zipTooManyEntries(zip, cap)`, `zipTooLarge(zip, cap)`: a zip past the archive's entry count or one of its byte caps; `zipNamedTwice(zip, name)`: a zip with two entries of one name; `namedTwice(model, name)`: two loose files of one name dropped with a model (a folder arrives flat, by file name).
- `failure.*`: a conversion that did not finish; the model is not added, and Retry is offered.
  - `crashed(model, why)`: the converter's Worker died or went silent (likely out of memory).
  - `broken(model, why)`: any other failure.
- `note.*`: the model is added, without something, or with a guess the creator should know about.
  - `missingPicture`, `remotePicture`, `brokenPicture`, `outsidePicture`, `otherComputerPicture`, `unreadablePicture(picture)`, `unsupportedPicture(picture, shown)`: `outsidePicture` for a path that leads out of the given files (`../`), `brokenPicture` for embedded data that does not decode, `unreadablePicture` for bytes that are no picture this knows (broken, or an unknown kind: the two cannot be told apart, so it claims neither), `unsupportedPicture` for a known kind a tour does not show; `shown` names the formats the converter in question carries (the glTF repack: PNG, JPEG, WebP and AVIF), so a note never promises a conversion that converter does not do.
  - `otherPictureShown(picture)`: a texture lost one of its pictures but still shows another one it names.
  - `stoodIn(named, used)`: a name found only in another letter case or by its file name alone, and the file used for it.
  - `unusedFiles(files)`: the files the model did not use (up to five named, then how many more).
- `compressionOf(extension)`: the creator's name for a compression extension, or null.
- `megabytes(bytes)` (module-private): MB for a sentence (one decimal below 10).

## Invariants

- Plain words, no extension or field names a creator would not know; every refusal says what to do next.
- Pure: no I/O.

## Tests

- Covered through the converters' tests, which compare against these functions (`gltf-repack.test.ts`, `import-plan.test.ts`, `zip-bundle.test.ts`, `import-step.test.ts`, `model-import-runner.test.ts`).
