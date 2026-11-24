# build-anchor-test-tour.mjs

## Purpose

Writes the anchor field-test tour to `public/samples/anchor-test-tour.zip`:
the tour the phone test of the deferred anchors walks. Vite copies
`public/` into the build, so a branch preview serves it at
`/tour/samples/anchor-test-tour.zip`, and the test needs no PC: open

`/tour/?qr=<preview origin>/tour/samples/anchor-test-tour.zip&relocate=here&debug=1`

(`&anchors=ab` for the frame-time comparison, staying about 90 s, `&devWorldJumpM=2` or
`&devWorldJumpDeg=5` for a synthetic world jump; `anchor-test-switches.ts`).

## What it writes

- Three stations at the sample tour's spots (a well-known public square,
  `build-sample-tour.mjs.md`, so no private location reaches the public
  repository), 25-30 m apart, in any order. `?relocate=here` moves the
  stations and their content to the phone (`tour-relocation.ts`).
  - "A: the tower": a free `model` block in the `placed` view, an 8 m mast
    whose arm on top swings through 60 degrees and back (clip `swing`, 2 s,
    looping, `animation: { name: "swing", autoplay: true }`). A tall model
    whose drawn shape changes every frame.
  - "B: the pins": twelve free `shortText` pins in a 4 m ring around the
    spot, the first with a 40-character label (the caption's limit), so
    one label is as wide as a pin's label gets.
  - "C: the edge hint": a free `shortText` in the `edgeHint` view 4 m east
    of the spot, and a story with one step: the knight (`character`,
    `bubble`) facing the way from B.
- Written as `tour.json` version 5 through the framework's
  `parseTourManifest` and `serializeTourManifest`, so a tour the reader
  refuses fails the build.
- Every asset is generated: the sample tour's pixel-art knight PNG and a
  tower GLB (two grey boxes, one JSON and one binary chunk, no URIs, one
  rotation channel). Entries are stored uncompressed with the sample
  tour's entry options (`ZIP_ENTRY_OPTIONS`: a fixed local date, no
  extended timestamp), so a rebuild with unchanged content gives identical
  bytes in every time zone.
- It reuses `build-sample-tour.mjs`'s exported helpers (`knightPng`,
  `boxGeometry`, `glbOf`, `geoAt`, `facingFrom`, `headingTo`,
  `ZIP_ENTRY_OPTIONS`).

## Usage

From `GpsPlusSlamJs_TourViewer`: `node scripts/build-anchor-test-tour.mjs`
(after `pnpm run build:framework`), then commit the zip.

## Tests

- `src/anchor-test-tour.test.ts` reads the COMMITTED zip through the
  viewer's parsers: three stations in any order written back to the same
  bytes, 20-40 m apart, A's model and its clip on the mast's top, B's ten
  or more pins with a 40-character label, C's edge hint and character
  story, the knight within the image cap, entries uncompressed, and the
  same bytes as `buildAnchorTestTourZip()`, so the script and the zip
  cannot drift apart.
- `playwright-tests/anchor-test-tour.spec.js` opens it through the phone
  test's link: moved to the phone, its tower offered about 15 m away, and
  the debug log's anchor section with its verdict.
