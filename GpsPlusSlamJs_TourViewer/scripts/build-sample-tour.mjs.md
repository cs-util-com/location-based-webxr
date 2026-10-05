# build-sample-tour.mjs

## Purpose

Writes the sample station tour to `public/samples/marienplatz-tour.zip`
(owner decision S-D9, 2026-10-05): the owner's first phone test of stations
(tour kit K4) before in-app authoring (K6a) exists. Vite copies `public/`
into the build, so a branch preview serves it at
`/tour/samples/marienplatz-tour.zip`.

## What it writes

- Three stations at Marienplatz, Munich (a well-known public place, so no
  private location reaches the public repository), fixed order, 25-30 m
  apart: "The column" (the Mariensaeule, a knight who greets and asks a
  choice), "The old gate" (a grey arch as a `.glb`), "The town hall steps"
  (the knight says farewell).
- Every asset is generated here, so there is nothing to license: a
  pixel-art knight PNG (24 x 40 cells, 8 px each), a three-note fanfare WAV
  (16 kHz mono), and an arch GLB (two pillars and a lintel, one grey
  material, one JSON and one binary chunk, no URIs).
- Entries are stored uncompressed with a fixed date, so a rebuild with
  unchanged content gives identical bytes.

## Usage

From `GpsPlusSlamJs_TourViewer`: `node scripts/build-sample-tour.mjs`, then
commit the zip. To try it anywhere, open
`/tour/?qr=<the zip's URL>&relocate=here` (`src/tour-relocation.ts`).

## Tests

`src/sample-tour.test.ts` reads the COMMITTED zip through the viewer's own
parsers and checks (a valid version 2 tour, three geo stations 20-40 m
apart at Marienplatz, every named asset present, allowed, within the image
cap and inert, entries uncompressed); `playwright-tests/sample-tour.spec.js`
opens it through the real page.
