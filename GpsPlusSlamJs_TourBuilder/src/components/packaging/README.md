# Component 5 — Tour packaging & QR code

The **authoring-side export step**: take a `Tour` (from `selectExportedTour`)
plus the author's asset `File`s, bundle them into a single **uncompressed**
`tour.zip`, and turn the hosted ZIP's URL into a scannable viewing-mode link.

Run it alone: `pnpm dev` → <http://localhost:8185/src/components/packaging/>.

## Why uncompressed

ZIP "store" mode (no DEFLATE) is the whole reason this component exists as a
deliberate design rather than a one-liner. Component 6 range-reads an individual
asset out of the hosted ZIP as a cheap byte slice; a DEFLATEd entry would force a
decompression step and defeat that. The cost is nil: tour assets are
already-compressed formats (GLB, MP3/OGG, JPG/PNG), so compressing them again
saves almost nothing.

That property is invisible in a working archive — a deflated ZIP unzips fine and
passes every content test — so `pack-tour.test.ts` asserts it against the **raw
ZIP bytes**, in both the local headers and the central directory.

## Layout

```
core/    pure logic, no DOM: packTour · assetFilename · buildTourUrl · generateQr · parseTourJson
view/    browser side effects: renderQrSvg (download is downloadZip from
         gps-plus-slam-app-framework/storage)
demo.ts  the control panel wiring both together
```

See [`core/README.md`](./core/README.md) for the API, the invariants each
function enforces, and the test list; [`view/README.md`](./view/README.md) for
the two DOM helpers.

## The two seams this component owns

- **`AssetEntry.filename`** — `assetFilename(id, file)` decides it, the authoring
  UI stores it in `tour.json`, `packTour` writes the entry at exactly that path,
  component 6 looks it up unchanged. One string, four hands, no translation.
- **`?tour=<zip url>`** — `buildTourUrl` builds it, the QR carries it, the
  bootstrap reads it to switch into viewing mode (contract D13).

## Demo

**Left — tour input.** "Load sample tour" renders `sampleTour` **and** loads it
into an editable tour.json textarea. That textarea is the one input surface for
any tour — filled by typing, pasting, or picking a `.json` file (the file picker
just reads the file's text into it); nothing changes until "Use this tour"
parses it with `parseTourJson` and swaps it in as the working tour, re-rendering
the asset inputs for whatever assets _that_ tour declares. A `TourValidationError`
(bad JSON syntax or a failed invariant) shows in its own status line and leaves
the previous tour active. Below that, one file input **per declared asset** (so
it generalises to a fixture with several assets of one type). Picking a file
rebuilds that asset's `filename` through `assetFilename`, visible live in the
JSON — the same path component 10 will take. "Pack tour" runs the real
`packTour` and downloads the result, or shows the `PackagingError` message
(missing ids, bad paths) in the status line.

**Right — QR.** App base + hosted ZIP URL → `buildTourUrl` → `generateQr` →
inline SVG, with the built URL printed underneath so the `?tour=` encoding can be
checked without a phone. The app base defaults to this page, so scanning the code
from the dev server round-trips to a real URL.

### Known gap

The "use placeholder bytes" toggle (on by default) fills in zero-filled stand-ins
for assets with no file picked, so the demo packs a structurally real ZIP out of
the box. Those bytes are **not** playable assets — they exercise the ZIP
structure, not the content. Real sample assets under `public/packaging/`, fetched
into `File`s, are still to come; see the plan's "Known gap" note.

## Verifying by hand

1. Open the demo → "Pack tour" → `tour.zip` downloads.
2. Open it in any ZIP inspector: every entry must show **Store**, not Deflate.
3. Extract `tour.json` → it validates through `validateTour` unchanged.
4. Paste a real upload URL → "Generate QR" → scan → the `?tour=` param arrives intact.
5. Edit the textarea to a different valid tour → "Use this tour" → asset inputs
   and the preview update to the new tour's assets.
6. Break the JSON, or violate an invariant (e.g. `prefetchRadius < activeRadius`)
   → "Use this tour" → the error line shows the problem, the previous tour stays
   active and packable.

## Plan

[`plans/2026-07-14-packaging-plan.md`](../../../plans/2026-07-14-packaging-plan.md)
(initial implementation + the 2026-07-24 load-your-own-tour iteration)
· contract: [`plans/Shared-Contract.md`](../../../plans/Shared-Contract.md) §1
(schema + Invariant 3), D13.
