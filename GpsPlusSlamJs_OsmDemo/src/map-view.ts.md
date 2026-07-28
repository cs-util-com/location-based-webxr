# `src/map-view.ts`

## Purpose

The Leaflet view: res-13 affordance cells and region outlines over the OSM
raster basemap.

## Public API

- `class MapView` — `map`, `setPosition(position)`,
  `render(cells, regions, category, threshold): HeatScale`,
  `renderFetchTiles(tiles)`, `describeScale`
- `OSM_ATTRIBUTION`

## Invariants & assumptions

- **2D first, not AR.** §8.4 of the plan: the AR overlay is a gross-failure
  detector because OSM footprints carry low-metre absolute error, plausibly
  larger than the fusion error being measured. On a 2D map a mis-scored lawn is
  unambiguously a scoring fact rather than a pose question.
- **Regions are drawn OVER cells**, and the fetch extent over both. A 2 px
  stroke occludes essentially nothing, while a stroke _under_ 55 %-opacity fills
  is washed out precisely where the boundary matters. (This entry previously
  claimed the opposite of what the code does — the e2e ordering assertion,
  "draws region outlines, and draws them OVER the cells", is what settles it.)
- **The fetch extent is drawn as a stroke-only red box, plus the hexagon.** The
  box is what Overpass was asked for; the dashed hexagon is what the index keys
  on. Both, because drawing only the box invites the reading the display exists
  to correct — that the box _is_ the tile. Measured 1.39× over-fetch at res 7;
  see `fetch-extent.ts.md`. No fill, so it never competes with the heat grid.
- **Cells at the identity are not drawn at all** — see `heat-colours.ts.md`.
- **Clear and rebuild rather than diff.** A working set is ~931 cells; a diff
  would be a second source of truth about what is on screen, which is the last
  thing a view built to be trusted by eye should have.
- **The tooltip is the debugging surface.** Provenance — the OSM elements and
  their factors, each linked to openstreetmap.org — is what turns "that cell
  looks wrong" into "that cell is wrong because of way/12345" in one click. It
  is the reason the C# reference kept a contributing-entries map.
- **ODbL attribution is required**, and doubly so here: the view shows both the
  basemap tiles and data derived from OSM.
- **Everything interpolated into a tooltip is escaped** — see
  [`escape-html.ts.md`](./escape-html.ts.md). `bindTooltip` renders HTML, and
  `category` is a column header from the publicly editable rule sheet; the
  20-character name limit does not exclude `<svg onload=x>`. Feature keys are
  escaped too, belt-and-braces, because they land in an `href` attribute.

## Examples

```ts
const view = new MapView({ container, centre });
const scale = view.render(cells, regions, "walkable", threshold);
```

## Tests

None directly (Leaflet needs a DOM); the data it draws is tested in
`demo-pipeline`, the colours in `heat-colours.test.ts`, and the tooltip
escaping in `escape-html.test.ts`.
