# globe-detail-region.js - the relief's detail colour in the globe lab

- Purpose: globe round-5 F1, `globe-albedo` plus its detail on the
  library's terrain tiles. The relief's tiles wear the globe's imagery
  (the albedo); this module adds the terrain lab's detail. For the dive's
  target it builds the terrain lab's region: 256 km at z8, posts every
  500 m, through the lab's own `placeFor`, `fieldSpec`, `regionTiles`
  and worker. It turns the region into a grid of factors
  (`detailRatioGrid`) and hands the grid to the relief's tiles
  (`terrain.setDetail`, `globe-detail.ts`).
- Public API:
  - `createDetailRegion({ terrain, urlTemplate })` -> `{ load, state }`:
    - `load(target, { detail })` builds the region around `target` and
      sets the grid. `detail` 0 switches the detail off. A later `load`
      supersedes one still running.
    - `state()` returns one of:
      - `idle`;
      - `loading`;
      - `ready`, with `posts`, `changedShare` (the share of factors that
        are not 1) and `centre`;
      - `failed`, with `message` (no tile loaded, a worker error, or a
        target that is not a finite position).
- Invariants & assumptions:
  - The page loads this module with a dynamic import, and only for the
    relief. Its worker reads the Osm library, which the globe's boot
    graph must not (`build-lookdev.test.mjs`).
  - The tiles come from the relief's own `urlTemplate`, so the smokes'
    synthetic heights serve the region too and nothing leaves the
    machine.
  - The worker runs without the sky view (the detail does not read it)
    and is terminated after one build.
- Tests: the globe lab's relief smoke (`globe-relief.smoke.spec.mjs`):
  the region reaches `ready` under the hold, and the frame differs from
  the same view with `detail=0`.
