# editor3d-fixture.js

## Purpose

What the 3D view's e2e specs share (`editor3d.spec.js`,
`editor3d-shell.spec.js`): the relief's and the map's hosts answered
locally, the editor page with the sample tour open in 3D, and the 3D view's
stats.

## Public API

- `answerHosts(page, { globeAssets, overpass, groundM, groundAt })` - a flat
  Terrarium relief at `groundM` (by default `SQUARE_GROUND_M`, 515.5 m, the
  sample square's ground), or with `groundAt(col, row)` each tile pixel at
  its own height (uneven ground, every tile alike), for Mapterhorn, a
  plain tile for OpenStreetMap, and the globe's whole-Earth imagery refused
  (or, with `globeAssets: "serve"`, answered by the dev server's
  `/globe-assets/` route, for the editor on the globe view); returns
  `{ asks }`, the count of imagery asks. The globe view's city worker is
  answered on the page's context: Overpass with `overpass` (no buildings
  by default), the project's tile host (`OSM_TILES_BASE_URL`, taken from
  the Osm package) with a 404 for every tile and fill, so the library
  hands each tile to the race at once, and the heights with the same flat
  ground. Nothing leaves the machine.
- `cityRequests` - `{ overpass, tileHost }`, the city worker's requests
  answered so far in this test process (height tiles are not counted).
- `openSampleIn3d(page)` - `/edit.html`, the sample tour open as a
  creator gets it: in the 3D view (`body[data-view="3d"]`), its three
  stations placed.
- `openZip(page, zip, name)` - a tour zip opened through the page's file
  input, as a dropped file.
- `view3d(page)` - `window.__tourEditor.view3d()`: the shown 3D view's
  stats, or null while it does not show.
- `noApproach(page)`, `noClouds(page)` - init scripts: the next globe open
  starts at street level, or without the heavy clouds.
- `capture(target, path)` - a page or locator screenshot, taken only with
  `PLAYWRIGHT_CAPTURE=1` (no assertion reads it; each one costs frames).

## Tests

Used by the specs above; not a test itself.
