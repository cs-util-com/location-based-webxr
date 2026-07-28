# gps-plus-slam-osm demo

Two views of the same OSM data, side by side:

- **Left, Leaflet** — the res-13 affordance grid and its region outlines over the
  OSM raster basemap. Click the map to move the simulated user.
- **Right, three.js** — the buildings extruded from exactly the same merged
  features, so a discrepancy is geometry rather than data.

```bash
pnpm run dev     # http://localhost:5186
pnpm test        # typecheck + unit tests
```

## What this demo is for

Everything below it is verified against fixtures and the C# oracle, which proves
the port is faithful and says nothing about whether the result is _right for a
real place_. Four questions need eyes:

1. **Is `AFFORDANCE_RES = 13` (4.09 m edge) the right grain?** Too coarse and a
   footpath vanishes into its surroundings; too fine and the grid reads as noise.
2. **Are the unbounded scores practically thresholdable?** The model is
   multiplicative and deliberately unbounded, so a cell overlapped by five mapped
   features outscores the identical surface with one. The colour ramp is
   **logarithmic above the threshold** — equal ratios, equal colour steps — which
   is the honest presentation of a product; the scale is printed in the header so
   the picture can be checked against the arithmetic.
3. **Do regions land in the right places?** The arithmetic is verified; the
   geography is not.
4. **Does the mesh layer produce sane buildings?** Wall normals, `building:part`
   suppression, roof shapes. The 3D material is deliberately **double-sided** so
   a wrongly-wound wall shows up as a shading oddity rather than disappearing.

Hover any cell for its score and the OSM elements that produced it, each linked
to openstreetmap.org — the provenance map is what turns "that looks wrong" into
"that is wrong because of way/12345".

## What it deliberately is not

- **Not an AR view.** §8.4 of the plan is explicit that the AR overlay is a
  gross-failure detector: OSM footprints carry low-metre absolute error,
  plausibly larger than the fusion error one would be measuring. On a 2D map a
  mis-scored lawn is unambiguously a scoring fact.
- **Not a product.** No offline area management, no route prefetch, no settings.

## Structure

Everything that can be wrong in an interesting way is pure and unit-tested:

- `demo-pipeline.ts` — fetch → `AffordanceIndex` → cells + regions. No DOM.
- `heat-colours.ts` — the log ramp and the scale description.
- `map-view.ts`, `building-view.ts`, `main.ts` — drawing and wiring only.

## Attribution

OSM data is ODbL. Both the basemap and the derived grid are shown here, so the
`© OpenStreetMap contributors` attribution on the map is required, not optional.

## Network

Fetches live Overpass on first use and caches to OPFS (falling back to memory).
A res-7 tile is tens of MB; **do not clear the cache casually** — the public
instances are donated infrastructure with a shared budget.
