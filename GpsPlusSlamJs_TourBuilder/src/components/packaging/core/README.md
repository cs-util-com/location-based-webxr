# packaging/core — pure logic

Framework-free, deterministic, unit-tested logic for the authoring-side export
step. **No Three.js, no GPS, no DOM** — `generate-qr` produces SVG _markup as a
string_ and never touches the document. The `view/` layer applies the results as
browser side effects (download, render).

## Modules

### `pack-tour.ts` — the ZIP builder

`packTour(tour, assetFiles: Map<AssetId, File>) → Promise<Blob>` plus
`PackagingError`.

- **Store mode, never DEFLATE.** Every entry is written `{ level: 0 }` so
  component 6 can range-read one asset as a plain byte slice with no
  decompression step. Compression would buy almost nothing regardless — GLB,
  MP3/OGG and JPG/PNG are already compressed.
- **Keyed by `AssetId`, not filename**, so a rename in the authoring UI cannot
  silently mismatch bytes to entries.
- **Schema validation is a precondition, not a step.** `tour` is typed and
  normally comes from `selectExportedTour`. What _is_ checked is the ZIP layout,
  because those failures are invisible in the artifact:
  - **missing asset bytes** → throws listing **all** missing ids at once;
  - **duplicate `filename`** → throws. Entries are keyed by path, so a duplicate
    would silently drop an asset and still produce a valid archive. Catching it
    is what makes contract Invariant 3 true.
  - **unusable paths** (absolute, drive-lettered, `..` segment, backslash, empty,
    or colliding with `tour.json`) → throws.
- Both checks run **before any bytes are read**, so a rejected call never leaves
  a partial archive.
- `tour.json` is written at the ZIP root; assets at `AssetEntry.filename`
  verbatim (component 6 does no translation).
- Uses fflate's **async** `zip`, not `zipSync`: a 40 MB GLB must not freeze the
  tab. Peak memory is ~2× total bytes; if that ever bites, swap in fflate's
  streaming `Zip` + `ZipPassThrough` behind this same signature.

### `asset-filename.ts` — the naming convention

`assetFilename(id, file) → "assets/<id>.<lowercased-ext>"`. Pure.

Called by the authoring UI when it builds an `AssetEntry`; `packTour` then writes
to that string and component 6 reads it back. Nothing re-derives the name later,
so two edge rules exist to stop distinct assets collapsing onto one entry path:
a **leading dot is a dotfile** (`.glb` → no extension, not `.glb`), and the
extension is **lowercased** (`MODEL.GLB` and `model.glb` are one key, not two
that a case-insensitive filesystem confuses).

No validation of `id` — `packTour`'s path check is the single enforcement point.

### `build-tour-url.ts` — the mode seam

`buildTourUrl(appBaseUrl, zipUrl) → "<base>?tour=<encoded zipUrl>"`.

`?tour=` is what switches the app into viewing mode at bootstrap (contract D13).
The value is itself a URL — usually presigned, carrying `?` and `&` — so it must
be percent-encoded (`URLSearchParams` does it). Skipping that truncates the ZIP
link at its first separator, and the QR then encodes a broken URL that only fails
once someone scans it outdoors.

### `generate-qr.ts` — the hand-off

`generateQr(tourUrl) → Promise<string>` (SVG markup). Thin wrapper over
`qrcode.toString`; does no URL work — pass it a `buildTourUrl` result.

Options are pinned in the module (`QR_OPTIONS`), not caller-supplied:
`errorCorrectionLevel: "M"` because a presigned URL already pushes the symbol to
a high version and `Q`/`H` would add modules to a code that is dense enough to
strain a phone camera; `margin: 2` (quiet zone); `width: 512`.

## Tests

One colocated `*.test.ts` per module:

- `pack-tour.test.ts` — content + `validateTour` round-trip, the
  authoring-slice → `selectExportedTour` → `packTour` path, missing ids (single
  and batched), duplicate filename, six unusable paths, and the **store-mode
  check against raw ZIP bytes**: method `0x0000` in both the local header and the
  central directory, `compressedSize === uncompressedSize`. The byte readers are
  written by hand rather than reusing fflate, so a shared misreading of the format
  cannot cancel itself out. Verified to fail (`expected 8 to be +0`) when the
  level is flipped to 6 — while every content assertion still passes, which is
  exactly why the raw check exists.
- `asset-filename.test.ts` — extension kept/absent, dotfile, multi-dot, lowercasing.
- `build-tour-url.test.ts` — param round-trip, presigned URL with `?`/`&`,
  existing query + hash preserved, existing `tour` param replaced.
- `generate-qr.test.ts` — `vi.mock("qrcode")` (an ESM default export's methods
  are not writable, so `vi.spyOn` does not work), asserting the URL reaches the
  encoder byte-identical and that failures propagate rather than yielding blank
  markup.
  The text→`Tour` gate the demo's "use your own tour" input goes through
  (`parseTourJson`) lives in `src/store/parse-tour-json.ts` — it is contract-level
  (also used by the cloud-loader), not packaging logic.

Run: `pnpm test:unit` (or `pnpm test:watch`).
