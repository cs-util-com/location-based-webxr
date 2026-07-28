# E2E tests

Run with `pnpm run test:e2e` (never `npx playwright test` — the repo's timing
wrapper owns the invocation). `pnpm run test:e2e:headed` to watch it.

## What these assert, and why they are not unit tests

Every failure mode this demo has is **silent**:

- Leaflet paints all vectors into one shared `<svg>`, so a wrong paint order
  hides the grid under its own region outlines and nothing errors.
- A WebGL pane that renders nothing looks exactly like a pane with no buildings
  nearby.
- An OPFS path that never caches looks exactly like one that does, unless you
  count requests.

So the suite asserts what is **drawn** and what went **over the wire** — not
that a function returned. Two assertions here are the kind this repo has a scar
from skipping: the pixel-level canvas check (a status line built from the same
objects the presenter mutates is blind to render-wiring bugs) and the
request count across a reload.

## Offline by construction

Overpass, the Google-Sheet rule table and the OSM basemap are all intercepted in
`fixtures.js`. That is about **donated infrastructure** before it is about
determinism: the public Overpass instances allow roughly two slots per client
IP, recovering in ~30 s, and a CI suite hitting them on every push would be an
abuse rather than a flaky test.

Interception is at the **HTTP layer**, so `OverpassSource`, the parser,
`CachingSource`, the OPFS store, the index, the scorer, the region builder and
the mesh extruder all run for real. A seam inside the app would have been easier
and would have tested the seam.

**One trap worth remembering:** route patterns must match the **hostname**, not
a substring of the URL. `/overpass/` looks obviously right and intercepts the
app's own `overpass-source.js` module, which the browser then refuses for its
MIME type — leaving the app stuck on "starting…" with no other symptom.

## Positioning

The park fixture is centred ~2 km from the demo's default start, where the
working set overlaps none of it and every grid assertion would be vacuously
true of an empty map. `AT_FIXTURE` uses the app's `?lat=&lng=` override to stand
exactly on the data.
