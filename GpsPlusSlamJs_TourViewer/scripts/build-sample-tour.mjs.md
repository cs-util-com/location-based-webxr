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
  (the knight says farewell). Written as `tour.json` version 4: each
  station has its own geo pose, its story's blocks (the knight a
  `character` and the arch a `model` on the stage, a story line a
  `longText` card titled with its station's title) and the steps that
  show them; the story places nothing in the world. It goes through the
  framework's `parseTourManifest` and `serializeTourManifest`, so a tour
  the reader refuses fails the build, and a build from before version 4
  refuses the file with "update the app".
- Each station's `alt` is ELLIPSOIDAL, as a phone's GPS reports it: the
  ground there plus the geoid's undulation N (EGM96, 45.68 m at the
  square). The ground was measured from Mapterhorn's z14 tile
  14/8718/5685 (fetched 2026-10-22, Terrarium-decoded, bilinear between
  pixel centres): 515.83 m at the column, 514.17 m at the gate, 516.23 m
  at the steps, so `alt` is 561.5, 559.9 and 561.9 m. The 3D editor draws
  a station at alt - N over the relief's orthometric heights; with the
  earlier 519 m every station stood about 42 m under the drawn ground.
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
parsers and checks (a valid version 4 tour, three geo stations 20-40 m
apart at Marienplatz, each within 0.5, 1 and 2 m of the measured ground as
the 3D editor draws it (the Globe's `drawnHeightM` with the Osm library's
`egm96Geoid`), every named asset present, allowed, within the image
cap and inert, entries uncompressed); `playwright-tests/sample-tour.spec.js`
opens it through the real page.
