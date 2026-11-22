# zip-bundle.ts

**Purpose:** a zip of a model's folder read into the files a conversion needs. Runs in the converter's Worker; tested in node.

## Public API

- `readZipBundle(zip, zipName, limits?, signal?)`: a `ZipBundle`:
  - `{ ok: true, kind: "gltf", model, files, others, skipped }`: `model` the `.gltf`'s path, `files` every entry it may name (its text, companions, pictures) by path;
  - `{ ok: true, kind: "glb", model, glb, others, skipped }`: a `.glb` inside, taken as it is (the shelf then checks and optimizes it);
  - `{ ok: false, reason }`: in words (`refusal.zipIsTour`, `zipNoModel`, `zipUnreadable`, `zipTooManyFiles`, `tooLarge`).
    Rejects only when `signal` aborted.
- `zipBundleNotes(bundle, used)`: the notes a model made from a bundle carries: the other models (`note.otherModels`) and the entries it did not use (`note.unusedFiles`, up to five named).
- `ZipBundleLimits`: `maxFiles` (default 1000 entries a model brings along), `maxBytes` (default `ASSET_CEILING_BYTES`, their bytes together).

## Invariants

- The directory is read through `withZipBlobDirectory` (`zip-blob.ts`, under `withCappedZipEntries` and one `DecompressionBudget` for the archive); macOS metadata (`isMacOsMetadataName`), `.DS_Store`, `Thumbs.db` and `desktop.ini` are skipped, a name the zip carries twice is read once.
- A zip holding a `tour.json` (at any depth) is a tour and refused: the start page opens it.
- A zip inside the zip is never opened; it is listed as skipped.
- Several models: the first by path is made, the others named in a note (a loose drop gives each model its own row instead).
- The entries it reads are counted and their declared sizes summed against the caps before any is inflated; each read is capped at what the bundle has left, since a directory can understate a size.
- Anything that is no readable zip (or past the archive caps) refuses with `zipUnreadable`.

## Tests

`zip-bundle.test.ts`: a folder zip with metadata, a `.glb` inside, several models, a tour's zip, a nested zip with no model, bytes that are no zip, both caps, abort, the notes, and a property over random entry names (each entry claimed once, no metadata kept, only entries of the zip read).
