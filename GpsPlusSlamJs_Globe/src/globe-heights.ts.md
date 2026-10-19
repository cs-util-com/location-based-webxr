# globe-heights.ts

- Purpose: heights between a GPS fix and the globe's drawn ground (tour
  editor plan `2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`
  §13 "Heights", G1 step 3; G0 spikes Q1 "The geoid", both in the primary
  repo's `GpsPlusSlamJs_Docs/docs/`). The globe draws the relief's
  ORTHOMETRIC heights (Terrarium and Mapterhorn keep national height
  systems) over the ellipsoid; a phone's GPS altitude, and a tour's `alt`,
  is ELLIPSOIDAL. The two differ by the geoid's undulation N: 45.68 m at
  Marienplatz, about 49 m in Lucerne. Without it an item floats about 46 m
  up; with the sign wrong it sinks as far.
- Public API:
  - `GlobeHeightPlace` `{ lat, lng }` (degrees) and `GlobeGeoid`
    `{ id, undulationMetres({ lat, lng }) }`: the Osm library's `LatLng`
    and `GeoidModel` structurally, so `egm96Geoid()` fits as it is.
  - `drawnHeightM(ellipsoidalM, at, geoid, offsetM = 0)`: the height the
    globe draws a point at, `ellipsoidalM - N(at) + offsetM`; `offsetM`
    is the scene's vertical offset (a tour's calibration).
  - `ellipsoidalHeightM(drawnM, at, geoid, offsetM = 0)`: the inverse
    (what a moved item saves).
  - Both: RangeError for a non-finite height or offset, a latitude
    outside [-90, 90], a non-finite longitude, or a geoid answering a
    non-finite N (named by its `id`).
- Invariants & assumptions:
  - Pure, no imports. The geoid is passed in: the Globe package depends on
    neither the Osm library nor the framework (an app passes
    `egm96Geoid()` from `gps-plus-slam-osm/elevation`).
  - "Drawn" means metres over the ellipsoid in the globe's frame at
    exaggeration 1 (the relief's `heightScale`); a caller drawing at
    another exaggeration multiplies the orthometric part itself.
  - The two directions are exact inverses at the same place, geoid and
    offset (property-tested), so opening and saving never drifts an item.
- Example:

  ```ts
  import { egm96Geoid } from "gps-plus-slam-osm/elevation";
  const geoid = egm96Geoid();
  const drawn = drawnHeightM(fix.altitude, fix, geoid, tour.offsetM);
  // after a drag:
  item.alt = ellipsoidalHeightM(drawnAfterDrag, item, geoid, tour.offsetM);
  ```

- Tests: `globe-heights.test.ts` (the spikes' Marienplatz numbers, the
  offset, the place asked, the inverse, refusals),
  `globe-heights.property.test.ts` (round trip, offset one for one, a
  higher altitude drawn higher by the same amount, over random places,
  smooth fake geoids and offsets), and the design system's
  `labs/globe/globe-heights-geoid.test.mjs` (the Osm library's real
  `egm96Geoid()`: N within 1 m of 45.68 at Marienplatz, a different N in
  Lucerne).
