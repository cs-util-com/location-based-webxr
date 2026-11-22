# zip-bundle.ts

**Purpose:** a zip of a model's folder read into the files a conversion needs, and the list of the models a zip holds. `readZipBundle` runs in the converter's Worker, `listZipModels` on the page; tested in node.

## Public API

- `listZipModels(zip)`: the models of the zip by path, sorted as `readZipBundle` takes them (macOS and system files left out); `[]` for a zip it refuses whole (a tour's, one naming an entry twice, one that is no readable zip). Reads only the directory; never rejects. The model import queues one import per model it lists.
- `readZipBundle(zip, zipName, options?, signal?)`: a `ZipBundle`; `options` the `ZipBundleLimits` and `model`, the model to make by its path (then `others` is empty and no note names other models):
  - `{ ok: true, kind: "gltf", model, files, others, skipped }`: `model` the `.gltf`'s path, `files` every entry it may name (its text, companions, pictures) by path;
  - `{ ok: true, kind: "glb", model, glb, others, skipped }`: a `.glb` inside, taken as it is (the shelf then checks and optimizes it);
  - `{ ok: false, reason }`: in words (`refusal.zipIsTour`, `zipNoModel` (also for a `model` the zip does not hold), `zipNamedTwice`, `zipUnreadable`, `zipTooManyFiles`, `tooLarge`, and for the archive caps `zipTooManyEntries` (`entry-count`) or `zipTooLarge` (every byte cap: the archive, its directory, an entry, the inflation budget)).
    Rejects only when `signal` aborted.
- `zipBundleNotes(bundle, used)`: the notes a model made from a bundle carries: the other models (`note.otherModels`) and the entries it did not use (`note.unusedFiles`, up to five named).
- `ZipBundleOptions` limits (its `ZipBundleLimits` part, not exported): `maxFiles` (default 1000 entries a model brings along), `maxBytes` (default `ASSET_CEILING_BYTES`, their bytes together).

## Invariants

- The directory is read through `withZipBlobDirectory` (`zip-blob.ts`, under `withCappedZipEntries` and one `DecompressionBudget` for the archive); macOS metadata (`isMacOsMetadataName`), `.DS_Store`, `Thumbs.db` and `desktop.ini` are skipped. A name the zip carries twice (after those are skipped) refuses the zip (`zipNamedTwice`): which of the two a model names is unclear, so neither is read first-wins.
- A zip holding a `tour.json` (at any depth) is a tour and refused: the start page opens it.
- A zip inside the zip is never opened; it is listed as skipped.
- Several models: with `model`, that one is made; without it, the first by path, the others named in a note (only when the page could not list the models first).
- The entries it reads are counted and their declared sizes summed against the caps before any is inflated; each read is capped at what the bundle has left, since a directory can understate a size, and the bytes read are summed against `maxBytes` after each read (a read cap is at least one byte, so the sum, not the read cap, is what holds the bundle's cap exactly).
- A zip past an archive cap (`ArchiveLimitError`) is refused in size words, never as unreadable; anything else that is no readable zip refuses with `zipUnreadable`.

## Tests

`zip-bundle.test.ts`: a folder zip with metadata, a `.glb` inside, several models, the model asked for (and one it lacks), a name carried twice, the inflation budget and the entry count in size words (a 64 MiB inflate and a hand-written zip of 20 001 empty entries), `listZipModels` (and none for a zip refused whole), a tour's zip, a nested zip with no model, bytes that are no zip, both caps, abort, the notes, and a property over random entry names (a tour's zip always refused as a tour, each entry claimed once, no metadata kept, only entries of the zip read).
