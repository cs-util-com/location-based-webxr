# station-content.ts

## Purpose

The visitor's content per station (visitor plan 2026-10-18-2349 §3, M2):
a side table that keeps each station's three.js handles by station id, so
only the stations the page asks for stand in the scene. The store decides
WHICH (`visitor-guide-slice.ts`: the present station, or every station
under "show all"); this module never reads the store.

## Public API

- `stationAnchorKey(stationId)` - `station:<id>`, the deferred-anchor key
  a shown station stands under; the story figure (`scene-stage.ts`) stands
  under the same key.
- `createStationContent(deps): StationContent`
  - `deps.scene` - where a shown station's group is added (the scene root).
  - `deps.anchorParent?()` - where a shown station stands as a deferred
    anchor instead (`deferredAnchor(parent, stationAnchorKey(id))`, key
    `station:<id>`, which the story figure shares, `scene-stage.ts`; of
    `gps-plus-slam-app-framework/ar/deferred-anchors`): the AR world group
    once its alignment binding exists. Read as each station enters; absent
    or null, the station goes on `scene` as a plain group (non-AR callers,
    the e2e fakes). An anchor that cannot take the group (no binding yet) is
    logged and the station goes on `scene`.
  - `deps.onAnchorCommit?(group)` - an anchored station's group was placed
    (its world matrices fresh, the frame not yet rendered); the visitor
    re-ticks that station's camera-relative parts (the edge hint's tag).
  - `deps.now()` - the page clock (ms), read when a fade changes direction.
  - `deps.fadeMs?` - the fade's length; default `CONTENT_FADE_MS` (400 ms,
    `content-fade.ts`).
  - `deps.registerFrame?(fn)` - the AR frame loop
    (`registerFrameUpdate`): registered once for the table's life, it calls
    `update` every rendered frame (a loop over the stations held and no
    material write while nothing fades: a settled fade writes nothing);
    unregistered on `dispose`, and cleared with the AR session's frame loop,
    whose end disposes the table anyway. Absent, fades advance on `update`
    only.
  - `deps.onMounted?(stationId, rendered, part)` - a part's render was kept
    for a shown station, once per render (the viewing log's `placed`).
  - `deps.onFailed?(stationId, part, error)` - a part's render threw; the
    part is left out for the table's life (not built again on the next
    entry, so said once), the rest of the station shows. A throwing
    `onMounted` is logged and never strands its station loading.
- `StationContent`
  - `setPart(stationId, key, part | null)` - set or remove one named part.
    A part replaced or removed is disposed; one added to a station already
    shown renders at once into its group (and takes the group's opacity).
    One added to a station that rendered and waits to enter (ready) is
    waited for like the others: the station enters with it, from 0.
  - `show(ids)` - the stations whose content should show.
  - `update(nowMs)` - advance the fades and let ready stations enter.
  - `has()` / `shown()` - whether any station holds a part; the count and
    skipped ids standing for the stations shown now.
  - `showsAny()` - whether a station shown now holds a part: false while
    every part waits at a station not shown (the visitor's "walk to a
    station" line).
  - `dispose()` - everything out and freed; later calls do nothing.
- `ContentPart { render(parent, alive) }`
  and `RenderedPart { count, skipped, dispose }`.
- `contentStatus(content | null)` - the status line's view of the tour's
  items: `{ kind: "none" }` until a station holds one, then
  `{ kind: "placed", count, skipped }` for the stations shown now (0 with no
  station shown).
- A station's group is named `station-content:<id>` (what the e2e suite
  reads).

## Invariants & assumptions

- **Anchored stations defer.** Under `anchorParent` a station's group is
  the anchor's pose-free root, placed at the alignment's inverse, so its
  parts keep the GPS-world NUE coordinates they would have on `scene`.
  While the station is in view an alignment change waits until it is out
  of view; a code lock or a tracking frame switch places it at once. A part
  mounted or removed while it stands calls `boundsChanged()`, so the view
  test sees the new subtree; leaving calls `remove`.

- **Nothing is decoded until a station is shown**; a shown station renders
  its parts into a detached group and enters the scene at opacity 0 once
  every part settled, then fades in.
- **One station group in the scene at a time**: a group enters only while
  no other station is still fading out - also for a station that settles
  inside `show` (its parts all failed before): its entry waits until
  `show` has marked every station it leaves. The next station DECODES during the
  fade-out (off the scene), so a switch holds two stations' textures at its
  peak and never more. "Show all" enters every station at once.
- **Leaving**: fade out, then out of the scene and every part disposed
  (textures, materials, geometries). Shown again during the fade-out: fades
  back in without decoding again. Shown again later: decodes again, its
  files read from the archive once more (the stations' prefetch holds story
  media only, until item photos join it).
- **A part that throws** is latched as failed (a `WeakSet` of parts): an
  enter/leave/enter tries it once, says `onFailed` once, and leaks
  nothing (its own cleanup, `content-placement.ts`). Only while its render
  is still wanted: a throw after its station was left (a stopped decode)
  latches nothing, and the part is built again on the next entry.
- **Late renders are dropped**: a render that lands after its station was
  left, its part replaced, or the table disposed is disposed at once
  (a per-entry token) and never enters the scene. `alive()` lets a long
  decode stop early.
- **One render at a time** (one chain), in the order asked: "show all" on
  a long tour never decodes every photo at once. Everything placed belongs
  to a station, so nothing decodes outside the shown stations.
- A fade that changes direction starts from the moment it changed, however
  long since the last frame (no jump).
- The station ids come from the tour.

## Measured: a generated 100-station tour (`station-content.scale.test.ts`)

- One station present (two pins, two photos): 7 objects and 2 textures in
  the scene.
- A switch: one group in the scene throughout; 4 textures at the peak.
- Show all: 700 objects and 200 textures.

## Example

```ts
const content = createStationContent({ scene, now: Date.now, registerFrame });
content.setPart("gate", "items", {
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
  late part's opacity, replace/remove disposal, one render at a time, the
  counts for the stations shown, `contentStatus`, `onMounted` once, a throwing render; a throwing
  part tried once over enter/leave/enter, a throwing mount callback, no
  material write once a fade settled, `showsAny`; an anchor parent that is
  null or absent puts the group on the scene, an unbound one or a throwing
  seam falls back to the scene with a warning.
- `station-content.property.test.ts` - over generated sequences of show /
  show all / setPart / frames / settles: at most one station group
  (presence only); every result disposed at most
  once, and exactly once after `dispose`; every live material back at its
  own opacity and transparent flag once its fade ends; once every render
  landed and every fade ended, each station shown last that still has a
  part stands in the scene (a table that held every station back would
  pass the other checks). "Every render landed" means the microtask queue
  drained (`setImmediate`): renders run one at a time, so a long sequence
  can queue dozens of stale renders ahead of the last live one, and a
  fixed microtask budget left that station still fading in (a found
  counterexample, pinned as its own case).
- `station-anchor.integration.test.ts` - a station as a deferred anchor
  under a real world group and binding: it enters under the group, follows
  an immature alignment, holds a mature change in view and lands once out
  of view (dwell honoured), lands on an epoch bump or a camera jump, re-reads
  its bounds after a late part, leaves on fade-out, is not held by its edge
  hint, draws its tag against the committed place in the commit's own frame, and,
  through the real QR controller, snaps on a code lock, casts nothing once
  the code's budget is spent, and releases nothing when the viewer refuses
  the votes.
- `station-content.scale.test.ts` - the 100-station object count.
- `station-content.sweep.test.ts` - the fade length's sweep.
- End to end: `playwright-tests/stations.spec.js` (the walk from the gate
  to the well, and `?allstations=1`).
