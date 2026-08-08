# `src/main.ts`

## Purpose

App shell — builds the store, the pipeline and the views, and wires them
together.

## Public API

None. Entry point only, loaded by `index.html`.

## Invariants & assumptions

- **Deliberately thin.** Everything that can be wrong in an interesting way is
  in `demo-pipeline.ts` (data), `refresh-cycle.ts` (the async cycle and its two
  failure kinds), `osm-store.ts` (shared state) and `heat-colours.ts`, all pure
  and tested. When the demo misbehaves, the question should be answerable
  without reading this file.
- **Every async action is a `*-cycle.ts` module, and none of them is inline
  here.** `refresh-cycle.ts`, `terrain-cycle.ts`, `explain-cycle.ts`,
  `geo-event-cycle.ts` and `agent-cycle.ts`. This file cannot be unit-tested, so
  an action left as a closure in it is an action with no test — which is what the
  geo-event was until W0, and it had a busy state, a label, a failure path and a
  missing republish, none of them covered. A **new async action belongs in a new
  cycle module**, not here.
- **Two picks order the agent, and only one of them is purely an order**
  (DEC-R11-17, then DEC-R13-6).
  - **Open ground** is a PLACE rather than a thing, so it has no panel to open
    and orders the agent instead. It takes no meaning away from a click that
    already had one — every finer claim still wins, and a click on a building
    resolves to nothing at all.
  - **A cell now does BOTH** (stage 3, DEC-R13-6): it opens the details panel
    AND sends the agent to the cell centre. Before that, a cell hit stopped at
    the store, so wherever the grid was drawn the agent could not be ordered —
    masked only by the grid being off by default and covering ~250 m, and a real
    blocker the moment coverage grows.
    - **Accepted cost, stated:** every inspection click also moves the agent and
      re-plans the route. The escape hatch, if a session finds that annoying, is
      the modifier split DEC-R13-6 rejected — it was rejected for hiding
      inspection behind a gesture touch does not have.
    - POI markers and regions still only dispatch to the store.
  - **Both orders go through ONE `latestOnly` channel**, which is why
    `orderAgent` takes a `LatLng` rather than a `ScenePoint`: a cell click and a
    ground click are the same intent and must supersede each other, and the cell
    branch already knows a position rather than having to invent scene
    coordinates for the function to convert straight back.
  - `orderAgentTo` is a **forward reference** assigned after the worker client
    and the anchor exist, like `reportFatal`. The pick handler is declared with
    the view, which is built before both.
  - The scene→ENU→lat/lng conversion happens HERE, not in `pick.ts`: the frame
    lives next to the anchor and is re-taken on a teleport, so a second copy in a
    pure module would go stale exactly when the user moves.
- **A RE-ANCHOR clears the route; an ordinary publish does not.** Every point on
  the drawn polyline is expressed in the scene's ENU frame, and round 5B's whole
  guarantee is that an ordinary step leaves that frame alone. So the route
  survives a walk across the map and is taken down exactly when its coordinates
  stop meaning anything — which is also when the agent, standing where the user
  _was_, is in the wrong city.
- **A control's element may be looked up far from where its behaviour is
  wired.** `geoEventButton` is fetched with the other controls but wired below
  `refresh`, which it needs. The docstring at the lookup says where to look.
- **The scene anchor is advanced ONCE per position change, at the top of the
  position subscriber, before anything reads it.** Three consumers of the frame
  hang off that subscriber — the camera pivot, the terrain load and the refresh —
  and the refresh runs last, so while it owned the decision the other two used
  the OUTGOING anchor whenever it moved: after a Cologne→Tokyo pick the camera
  pivoted ~9 000 km from the scene it was looking at. `createAnchorHolder` makes
  it one value everything reads; see `scene-anchor.ts.md`.
- **`#scene` carries `data-routing` while a route is being planned**, which
  `index.html` turns into `cursor: progress`. The element that was "pressed" is
  the canvas — there is no button to relabel — and the wait is real: "no route"
  is the SLOWEST reply, because the search must exhaust its frontier to know,
  which is what every mis-click across a wall does.
- **`#scene` carries `data-frame-origin` and `data-ground-centre` for the e2e.**
  "The scene does not jump" has no other machine-readable definition here: a
  canvas diff cannot supply one, because the user moved so the picture MUST
  change, and an identical-pixels assertion would also pass for a scene that had
  stopped drawing. The frame origin must be unchanged across a step; the ground
  centre must follow the user, which is the counterweight that stops "nothing
  moved" passing for "nothing is sampled where you are". `data-*` rather than a
  `window` global, matching `data-state` on the locate button and
  `data-collapsed` on the header.
- **The views are subscribers, not callees.** Since the round-1 store migration
  (2026-07-29, DEC-4) nothing here decides who draws first: `main.ts` dispatches
  intent, and each view redraws when the state it reads changes. It still owns
  the view OBJECTS — the views themselves never import the store, so they stay
  testable without one.
- **Each view draws inside its own guard.** `renderSafely` wraps every draw, so a
  three.js failure reports itself as a 3D-view failure rather than blanking a
  correct map, and cannot stop the next subscriber from running. See
  `refresh-cycle.ts.md` for why the two failure kinds are not interchangeable.
- **Mesh counters live here, not in the store.** `volumes` / `triangles` /
  `guessed building heights` are properties of the DRAW, not of the scored data;
  the store holds what was scored. The label says **building** deliberately —
  read as bare "guessed heights" it was taken for terrain relief (finding M13).
  Since W11 the status line carries actual terrain relief as a separate number,
  which makes the distinction more important rather than less.
- **The rule-table TIER is displayed.** A demo silently running on the
  checked-in snapshot looks identical to one running on the live sheet, and they
  are different claims about what is being judged.
- **OPFS where available, memory otherwise.** A cached res-7 tile is tens of MB
  and refetching on every reload would abuse donated infrastructure — but the
  demo must still start in a browser without OPFS rather than refusing to.
- **Errors are shown, never swallowed.** A silent failure here looks exactly
  like "there is no data at this location", which is the one message that would
  send someone debugging the wrong layer.
- **Clicking the map moves the user**, which is how a walk is simulated without
  a phone; crossing a res-11 boundary is what exercises the chunk cache.
- **`?lat=&lng=` overrides the start position.** Useful on its own — pointing the
  demo at a place you know is the whole point of it — and it is what lets the
  e2e suite stand exactly on top of the checked-in fixture. Both parameters are
  required together, because half an override would mix a URL latitude with a
  default longitude and land somewhere nobody asked for.
- **A PICKER choice is a declared place change; everything else is travel**
  (DEC-R12-6/8). The picker dispatches `placeChanged`, which clears the snapshot
  and the geo-event, so the scene stops asserting a city the user has left rather
  than drawing it for the 20–30 s the next Overpass fetch takes. A map click, a
  GPS fix and a simulated walk keep dispatching `positionChanged`, which keeps
  both — blanking a scene that is about to be mostly identical is the cost the
  mesh planner exists to avoid. The `placeChangeDeclared` flag stays demo-local
  and now only carries the ANCHORING half of the same intent.
- **The URL has exactly TWO writers, one per fact, and each preserves the
  other's keys** (DEC-R12-5, then DEC-R13-7; `url-state.ts`).
  - **Where the user IS** — written in one place, the `view.position`
    subscriber, because that is where the picker, the map click and the locate
    button converge. Writing at each call site would let a site jump be
    overwritten by the coordinates of the same jump. The picker's id rides along
    in `declaredSiteId`, read and cleared beside `placeChangeDeclared`, so a
    named place writes `?site=` and travel writes `?lat=&lng=`.
  - **Where the CAMERA is looking** — `writeCameraView`, fed by
    `BuildingView.onCameraMove` and sampled through `throttle.ts`. A viewpoint
    and a position are different facts, so one writer cannot describe both.
  - **WHY TWO WRITERS ARE SAFE HERE, when one was the rule before.** Both go
    through `history.replaceState`, so whichever runs last decides the whole
    query — they do not conflict only because each `*Query` function preserves
    the keys it does not own, and because `browserPlaceUrl.search` is a LIVE
    getter, so the second writer reads what the first just wrote. Break either
    of those and a shared link starts losing `?site=` intermittently.
  - **Nothing is written at boot for a bare `/`** — it stays bare until the user
    actually moves. A URL that already carries a camera target is the exception:
    restoring it calls `controls.update()`, which fires `change`, which
    schedules one camera write. That write is a no-op against an unchanged
    query, which is why `cameraQuery` updates its keys in place rather than
    deleting and re-appending them.

## Examples

```bash
pnpm run dev   # http://localhost:5186
```

## Tests

No unit tests — it is DOM wiring. It is covered end to end by
`playwright-tests/`, which drives the real shell: the rule-table
tier it reports, the category picker it builds, the status line it assembles,
and the failure message it shows when a tile cannot be fetched.
