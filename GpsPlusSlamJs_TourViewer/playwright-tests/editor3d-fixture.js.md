# editor3d-fixture.js

## Purpose

What the 3D view's e2e specs share (`editor3d.spec.js`,
`editor3d-shell.spec.js`): the relief's and the map's hosts answered
locally, the editor page with the sample tour open, and the 3D view's
stats.

## Public API

- `answerHosts(page)` - a flat Terrarium relief at `SQUARE_GROUND_M`
  (515.5 m, the sample square's ground) for Mapterhorn, a plain tile for
  OpenStreetMap, and the globe's whole-Earth imagery refused; returns
  `{ asks }`, the count of imagery asks.
- `openSample(page)` - `/edit.html`, ready, the switch disabled without a
  tour, then the sample tour open (three rows in the rail).
- `view3d(page)` - `window.__tourEditor.view3d()`: the shown 3D view's
  stats, or null on the map.

## Tests

Used by the specs above; not a test itself.
