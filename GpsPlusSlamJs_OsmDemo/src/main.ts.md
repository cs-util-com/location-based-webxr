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
- **The scene anchor is advanced ONCE per position change, at the top of the
  position subscriber, before anything reads it.** Three consumers of the frame
  hang off that subscriber — the camera pivot, the terrain load and the refresh —
  and the refresh runs last, so while it owned the decision the other two used
  the OUTGOING anchor whenever it moved: after a Cologne→Tokyo pick the camera
  pivoted ~9 000 km from the scene it was looking at. `createAnchorHolder` makes
  it one value everything reads; see `scene-anchor.ts.md`.
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

## Examples

```bash
pnpm run dev   # http://localhost:5186
```

## Tests

No unit tests — it is DOM wiring. It is covered end to end by
`playwright-tests/`, which drives the real shell: the rule-table
tier it reports, the category picker it builds, the status line it assembles,
and the failure message it shows when a tile cannot be fetched.
