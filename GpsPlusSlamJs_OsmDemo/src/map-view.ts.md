# `src/map-view.ts`

## Purpose

The Leaflet view: res-13 affordance cells and region outlines over the OSM
raster basemap.

## Public API

- `class MapView` — `map`, `setPosition(position)`,
  `render(cells, regions, category, threshold, showBelowThreshold?): HeatScale`,
  `renderFetchTiles(tiles)`, `clear()`, `centreOn(position)`, `describeScale`
- `OSM_ATTRIBUTION`

## Invariants & assumptions

- **`setPosition` moves the marker; `centreOn` moves the marker AND the viewport.** Two callers want opposite things. A map click already happens where the user is looking, so recentring under their cursor would yank the map away. A GPS fix is usually somewhere else entirely — at zoom 18 anything more than ~200 m off is outside the viewport — so leaving it put shows an unchanged basemap with the marker, the new grid and the fetch box all off screen, which looks exactly like a button that does nothing.
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
- **Every vector this view draws is `interactive: false`; the map itself is the only click target.** Leaflet makes a `circleMarker` interactive by default, and an interactive vector with nothing bound to it does not add behaviour — it **removes** some, by taking `pointer-events` and swallowing a click that should have reached the map handler. The user marker was the one that had been left on the default (#267 review), which put a dead spot on exactly where the user currently is, i.e. where they are most likely to click next. It was latent only because the cell paths are added by `render()` after the constructor and so happen to paint over it — **an accident of construction order, not a guarantee**, and one `bringToFront()` or pane change away from mattering. The e2e asserts the absence of `leaflet-interactive` rather than clicking the marker, for that exact reason.
- **The winner marker will regularly sit on a cell that looks unremarkable, and that is not a drawing bug.** It was reported as one: the marker on a cell whose tooltip read `battleArea = 1`, with visibly higher-scoring cells beside it. `climbToLocalMaximum` maximises the sum over a cell AND its neighbours, so being surrounded by strength beats being strong — and **this view has no way to show that metric**, because every cell is painted by its own score. The marker's tooltip already reports `heat`, which IS the neighbourhood sum, but it is not labelled as such, so it reads as a third unrelated number. See `geo-event.ts.md`; the behaviour is pinned in `geo-event.test.ts`.
  - The sharpest version of the mismatch: the chosen cell is often drawn as an **outline** — the `identity` band, score exactly 1, whose whole point is "no rule said anything here". A gold quest marker on a cell that explicitly asserts nothing is jarring even when the arithmetic behind it is right.
- **The geo-event winner is the one thing here that is NOT a vector.** It is an `L.marker` carrying a `divIcon` (`quest-marker.ts`), because a `circleMarker` is an SVG `<path>` and no amount of CSS turns a path into a glyph — and DEC-G6 asked for a gold exclamation mark, not another coloured circle. Its `iconAnchor` is centred rather than left at Leaflet's default top-left, or the event would draw half a marker north-west of where it is. It keeps the `geo-winner` class so the e2e still selects on it, and it stays interactive because it carries the heat tooltip; the candidates around it are ordinary non-interactive vectors.
- **The map's four marker colours live in `surface-colours.ts`, not in the stylesheet.** The reported defect (G8) was that the user dot, both fetch outlines and both geo-event markers were one red — a collision that survived because the colours were split between a CSS rule and two TS literals, where nothing could compare them. `marker-palette.test.ts` now asserts they differ, and that only works while there is one definition. `index.html` keeps the parts that really are presentation: the candidates' opacity and the `divIcon` chrome reset.
- **`clear()` is what a failed refresh calls.** Cells, region outlines and the
  red fetch boxes all describe one specific scored working set; leaving any of
  them up after that set is gone makes the map assert a state nothing produced,
  which is the defect round-1 feedback reported. The user marker and the basemap
  survive: "where the user is" is still true, and the basemap was never a claim
  about scoring.
  - **The geo-event layer is deliberately not in `clear()`** (W2). A geo-event
    is not derived from a snapshot, so it is not this method's business: it is a
    projection of `geoEvent` in the store, and `fetchFailed` — the only action
    that makes the snapshot `undefined`, and therefore the only route into
    `clear()` — clears that field too. Adding `eventLayer.clearLayers()` here
    would be a second mechanism for one piece of state, and two mechanisms can
    only ever disagree. It was missing before W2 for the ordinary reason: nobody
    had thought about it, and the markers survived a failed refresh on a map
    that had been emptied of everything else.

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
  - **This class owns the attribution line; Leaflet's control is switched off**
    (`attributionControl: false`, round three, DEC-W1). Leaflet's own control
    rebuilds its `innerHTML` on every credit change — which happens on every
    terrain apply — so the expander the thirteenth session asked for could not
    survive inside it. Switching it off also disposes of its courtesy "Leaflet"
    prefix link, which the same session asked to drop, without needing
    `setPrefix(false)` as a second mechanism. See
    [`attribution-view.ts.md`](./attribution-view.ts.md).
  - **It is registered FIRST of this corner's controls**, because Leaflet
    _prepends_ into a bottom corner — so the first control added ends up lowest,
    with the AR and locate buttons stacking above the credit rather than over
    it. An e2e asserts that by bounding-box arithmetic.
  - **`setTerrainAttribution` takes entries, not a string**, and an empty list
    is how the elevation credits are removed. The OSM credit is not the
    caller's to add or remove: this class always carries it.
  - ⚠️ **A layer's `attribution:` option is now SILENTLY INERT.** Leaflet
    guards with `&& this._map.attributionControl`, so a tile layer or plugin
    added with one does not throw — its credit simply never appears. Nothing in
    the suite catches that today; it is recorded here rather than only in a code
    comment because the person who hits it will be adding a second layer, not
    reading `map-view.ts`'s constructor. **Every credit must go through
    `AttributionView`.**
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
distinct bands — is covered in `playwright-tests/`.

## The underground layer

`renderUnderground(outlines)` draws the features `isBelowSurface` excluded from
scoring and from the mesh, in lat/lng, dashed and in `UNDERGROUND_COLOUR` —
**shared with the 3D view** rather than written twice.

**The colour was previously a claim, not an implementation.** The paths carried a
`className` with no CSS rule behind it anywhere — the demo has no stylesheet, and
`index.html`'s `<style>` block has no such rule — so Leaflet drew its `Path`
default blue while this very sidecar said otherwise. Review on #256 caught it.
A unit test now pins the colour's distinctness from the rest of the palette.

**`clear()` clears this layer too.** The underground features describe the same
scored working set the cells do, so leaving them up after a failed refresh is
precisely the defect `clear()` exists to prevent.

**Why the map draws them at all.** This view answers **where** the excluded
ground is — whether the thing that vanished is the U-Bahn line under the street
or something that was on the surface all along. The 3D view answers what
**shape** it was. Neither answers the other's question, which is why both draw
it.

**A lone point is a node**, which has no outline to trace, so it becomes a
circle marker rather than a zero-length polyline. The 3D view has the same case
and solves it differently (a vertical tick) for the same reason: silently
dropping nodes would hide a whole class of excluded feature — bins, subway
entrances, shafts — from the diagnostic whose job is showing what was silently
dropped.

## `panTo` (F4c, DEC-U12 — 2026-08-19)

- `panTo(position)` — slides the viewport to `position` at the current zoom.

**It is deliberately NOT `centreOn`, and reusing that one here would be a live
bug.** `centreOn` calls `setPosition` first, so panning to a quest would also
teleport the user's own marker onto it. `centreOn` is for a DECLARED position
change — the location picker, the locate button — where moving the marker is
exactly right; `panTo` is for looking somewhere.

Holding the zoom is what makes this a pan rather than the viewport takeover F56
declined.
