# editor/editor-map.ts

## Purpose

The desktop editor's full-window map (M6 E1): its own Leaflet map with
the framework's OSM tiles (`visualization/osm-tile-layer`), a marker per
code, pin and photo of an `EditorModel`, selection and hover, and the
window pixel a card is anchored to. Not the summary's shell, which
refuses an empty tour, pads for no rail and keeps its map private (M6 E1
plan review #4).

## Public API

- `createEditorMap(container, { onSelect, onHover, onBackground, onView }): EditorMap`
  - `show(model, padding)` - replaces the markers and frames the tour
    (`fitBounds` with the rail's and top bar's padding, max zoom 19); a
    tour with no position shows a world view.
  - `update(model)` - updates the markers in place after an edit: a
    marker whose item is still there stays (under the pointer, draggable
    mid-Move) and moves only when its position changed, never under a
    drag; the rest go or are added; the view and the selection stay (M6
    E2a, E2a review #3, #4).
  - `drag(id, onDrop | null)` - makes the marker draggable (Leaflet's
    marker drag) and reports where it was dropped; null ends it.
  - `select(id | null)`, `hover(id, on)` - the `sel` / `hover` classes.
  - `anchorOf(id)` - the marker's ground point in window pixels, or null.
  - `reveal(id, padding)` - pans the marker inside the window minus
    `padding` (`popover-place.ts` `revealPadding`, which keeps the box
    from turning inside out on a narrow window).
  - `debugDraw(captures)`, `debugThumb(image, picture)`,
    `debugVisible(on)`, `debugClear()` - the debug layer's markers
    (`debug-capture-layer.ts`): one per capture, a dot until its
    thumbnail lands, in a layer group the switch adds and removes.
  - `destroy()`.

## Invariants & assumptions

- The debug layer's markers are never the tour's: a pane of their own
  (`debugCaptures`, z-index 550, below the marker pane's 600, with
  `pointer-events: none`), `interactive: false` and `keyboard: false`
  (no `leaflet-interactive` class, no tabindex), no tooltip, a zero-size
  icon box the element centres itself on. A thumbnail's blob URL is
  revoked when its marker is dropped or its picture replaced.
- A tour with nothing to frame opens at the world view, and its debug
  captures, once drawn, are framed instead: once per open, and never
  after the creator moved the view (r901 review #9). The move is read from
  the map element's own input (`pointerdown`, `wheel`, `keydown`), not
  from Leaflet's `movestart`/`zoomstart`, which fire for the page's own
  `setView` and `fitBounds` too (and an animated zoom a frame later).

- Markers are `divIcon`s built from ELEMENTS (`textContent` for a code's
  number), never HTML strings: a label comes from a zip anyone can write.
- Codes are drawn above notes (`zIndexOffset` 500, the owner's stacking
  default), the selected marker above both (1000). A station at a code's
  point (`onCode`, within 1 m of it: version 3 has no code link, D9) is
  drawn beside the code, to the upper right over its edge, and above it
  (600), so both can be clicked (PR #609 review; the e2e clicks each).
- The zoom control sits top right, under the top bar (the prototype's
  place); the map's own keyboard handling is Leaflet's default.
- Imports Leaflet statically: this module belongs to `edit.html` alone
  (dependency-cruiser `viewer-not-to-editor`).

## Tests

`editor-map.test.ts` (Leaflet replaced by a recording fake): the debug
captures framed once per open, and not after a pointer, wheel or key input
moved the view. `playwright-tests/editor.spec.js` counts
the markers, selects through them and measures the card against the
selected marker, and counts the debug markers (no tabindex, not
interactive, no tooltip, hidden and shown by the switch).
