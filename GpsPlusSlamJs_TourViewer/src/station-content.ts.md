# station-content.ts

## Purpose

The visitor's content per station (visitor plan 2026-10-18-2349 §3, M2):
a side table that keeps each station's three.js handles by station id, so
only the stations the page asks for stand in the scene. The store decides
WHICH (`visitor-guide-slice.ts`: the present station, or every station
under "show all"); this module never reads the store.

## Public API

- `createStationContent(deps): StationContent`
  - `deps.scene` - where a shown station's group is added (the scene root).
  - `deps.now()` - the page clock (ms), read when a fade changes direction.
  - `deps.fadeMs?` - the fade's length; default `CONTENT_FADE_MS` (400 ms,
    `content-fade.ts`).
  - `deps.registerFrame?(fn)` - the AR frame loop
    (`registerFrameUpdate`): registered once for the table's life, it calls
    `update` every rendered frame (a few comparisons while nothing fades);
    unregistered on `dispose`, and cleared with the AR session's frame loop,
    whose end disposes the table anyway. Absent, fades advance on `update`
    only.
  - `deps.onMounted?(stationId, rendered, part)` - a part's render was kept
    for a shown station, once per render (the viewing log's `placed`).
  - `deps.onFailed?(stationId, part, error)` - a part's render threw; the
    part is left out, the rest of the station shows.
- `StationContent`
  - `setPart(stationId, key, part | null)` - set or remove one named part.
    A part replaced or removed is disposed; one added to a station already
    shown renders at once into its group (and takes the group's opacity).
  - `show(ids)` - the stations whose content should show.
  - `update(nowMs)` - advance the fades and let ready stations enter.
  - `has(kind)` / `shown(kind)` - whether any station holds a part of that
    kind; the count and skipped ids standing for the stations shown now.
  - `dispose()` - everything out and freed; later calls do nothing.
- `ContentPart { kind: "content" | "capture-spots" | "ring"; render(parent, alive) }`
  and `RenderedPart { count, skipped, dispose }`.
- `contentStatus(content | null)` - the status line's view of the tour's
  items: `{ kind: "none" }` until a station holds one, then
  `{ kind: "placed", count, skipped }` for the stations shown now (0 with no
  station shown).
- A station's group is named `station-content:<id>` (what the e2e suite
  reads).

## Invariants & assumptions

- **Nothing is decoded until a station is shown**; a shown station renders
  its parts into a detached group and enters the scene at opacity 0 once
  every part settled, then fades in.
- **One station group in the scene at a time**: a group enters only while
  no other station is still fading out. The next station DECODES during the
  fade-out (off the scene), so a switch holds two stations' textures at its
  peak and never more. "Show all" enters every station at once.
- **Leaving**: fade out, then out of the scene and every part disposed
  (textures, materials, geometries). Shown again during the fade-out: fades
  back in without decoding again. Shown again later: decodes again (from
  the stations' prefetch cache while it still holds the files).
- **Late renders are dropped**: a render that lands after its station was
  left, its part replaced, or the table disposed is disposed at once
  (a per-entry token) and never enters the scene. `alive()` lets a long
  decode stop early.
- **One render at a time** (a keyed chain), in the order asked: "show all"
  on a long tour never decodes every photo at once.
- A fade that changes direction starts from the moment it changed, however
  long since the last frame (no jump).
- The station ids come from the tour; the caller's own loose group uses an
  id with a ":" no tour id has.

## Measured: a generated 100-station tour (`station-content.scale.test.ts`)

- One station present (two pins, two photos): 7 objects and 2 textures in
  the scene.
- A switch: one group in the scene throughout; 4 textures at the peak.
- Show all: 700 objects and 200 textures.

## Example

```ts
const content = createStationContent({ scene, now: Date.now, registerFrame });
content.setPart("gate", "items", {
  kind: "content",
  render: (parent, alive) =>
    renderTourStation(gate, { ...deps, scene: parent, alive }),
});
content.show(new Set(["gate"]));
content.update(Date.now());
```

## Tests

- `station-content.test.ts` - mounting only the shown station, the fades,
  textures freed after the fade-out, a late render dropped, one station at
  a time, a return during the fade-out without a re-render, show all, a
  late part's opacity, replace/remove disposal, one render at a time, counts
  per kind, `contentStatus`, `onMounted` once, a throwing render.
- `station-content.scale.test.ts` - the 100-station object count.
- `station-content.sweep.test.ts` - the fade length's sweep.
- End to end: `playwright-tests/stations.spec.js` (the walk from the gate
  to the well, and `?allstations=1`).
