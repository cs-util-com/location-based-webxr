# `src/map-view.ts`

## Purpose

The Leaflet view: res-13 affordance cells and region outlines over the OSM
raster basemap.

## Public API

- `class MapView` — `map`, `setPosition(position)`,
  `render(cells, regions, category, threshold, showBelowThreshold?): HeatScale`,
  `renderFetchTiles(tiles)`, `clear()`, `describeScale`
- `OSM_ATTRIBUTION`

## Invariants & assumptions

- **Hover shows the score; CLICK shows the evidence.** Cells carry a score-only
  `bindTooltip` and a `bindPopup` with the provenance list. This was a tooltip
  alone until 2026-07-29, and Leaflet tooltips are non-interactive by design
  (`interactive: false`, plus `pointer-events: none` on `.leaflet-tooltip`) — so
  the `<a href="…openstreetmap.org/way/12345">` links the demo advertises as its
  core debugging affordance **had never once been clickable**, under an e2e that
  asserted they were _present_. Presence is not reachability; the test now
  clicks.
- **Links target the openstreetmap.org BROWSE page** (`/way/12345`), matching the
  C# reference and `debugUrlForKey`. Not the iD editor — that would be a change
  _from_ the reference, not a match to it (DEC-8).
- **Contributors are ranked by `|log(factor)|`, and truncation is announced.**
  See `contributor-order.ts.md`: the old descending sort put a `0` veto last and
  cut it off first. The popup shows 8 and appends `+N more` — never a silent
  truncation, because a shortened provenance list reads as a complete one.
- **Sub-threshold cells are drawn only when asked, in three distinct bands (DEC-7).** The old code skipped everything at or below the threshold while a comment claimed it skipped only the identity — a broader rule than it described, and the reason a vetoed cell was the one cell that could not be clicked to ask why it was vetoed. With the checkbox on, `0` is solid and off-palette (a veto is a categorical statement, not a low score), `1` is an outline with no fill (it must not paint a claim the data does not support), and `0 < s <= threshold` is a dimmed fill. Rendering `0` and `1` alike would answer the question with the same picture for either answer.
- **Cell clicks are reported, not handled.** `onCellClick` hands the H3 id to the caller; the map does not know the details panel exists.
- **`clear()` is what a failed refresh calls.** Cells, region outlines and the
  red fetch boxes all describe one specific scored working set; leaving any of
  them up after that set is gone makes the map assert a state nothing produced,
  which is the defect round-1 feedback reported. The user marker and the basemap
  survive: "where the user is" is still true, and the basemap was never a claim
  about scoring.

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
- **Clear and rebuild rather than diff.** A working set is ~931 cells; a diff
  would be a second source of truth about what is on screen, which is the last
  thing a view built to be trusted by eye should have.
- **The POPUP is the debugging surface.** Provenance — the OSM elements and
  their factors, each linked to openstreetmap.org — is what turns "that cell
  looks wrong" into "that cell is wrong because of way/12345" in one click. It
  is the reason the C# reference kept a contributing-entries map.
- **ODbL attribution is required**, and doubly so here: the view shows both the
  basemap tiles and data derived from OSM.
- **Everything interpolated into a tooltip or popup is escaped** — see
  [`escape-html.ts.md`](./escape-html.ts.md). `bindTooltip` and `bindPopup` render HTML, and
  `category` is a column header from the publicly editable rule sheet; the
  20-character name limit does not exclude `<svg onload=x>`. Feature keys are
  escaped too, belt-and-braces, because they land in an `href` attribute.

## Examples

```ts
const view = new MapView({
  container,
  centre,
  onCellClick: (cell) => select(cell),
});
const scale = view.render(cells, regions, "walkable", threshold, showBelow);
```

## Tests

None directly (Leaflet needs a DOM); the data it draws is tested in
`demo-pipeline`, the colours in `heat-colours.test.ts`, the band classifier in
`legend-model.test.ts`, the contributor ordering in `contributor-order.test.ts`,
and the escaping in `escape-html.test.ts`. What only a browser can show — that
the popup opens and its links are clickable, and that the checkbox reveals three
distinct bands — is covered in `playwright-tests/osm-demo.spec.js`.
