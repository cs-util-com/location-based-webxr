# `terrain-field.ts`

## Purpose

The session's terrain cache: one growing lattice of height posts on the DEM's own
pixel grid, fetched once each and reused as the user moves.

## Public API

- `createTerrainField({ provider, zoom?, maxPosts? }): TerrainField`
  - `ensureAround(centre, radiusM, signal?)` — fetches only the **missing**
    posts, in one batch. Never rejects.
    - **Pass `signal` for any load a newer one can supersede**, which is every
      load a position change drives. It is forwarded to
      `provider.elevationAt(positions, signal)`. Omitting it does not merely fail
      to cancel: `InFlightRequests` registers an unsignalled caller as `pinned`,
      declaring the request uncancellable **and pinning it for every other
      joiner**. Before #270 the demo's terrain path omitted it, so abort was
      honoured for correctness (the worker re-checks `signal.aborted` afterwards)
      and not for cost — one view is ~321 000 posts across several Terrarium
      tiles, and every abandoned view was fetched to completion.
    - **An abort is swallowed into "degrade to what is held"**, on the same path
      as a DEM outage. Cancellation is not an error the 3D pane should have to
      handle, and the caller re-checks the signal regardless.
  - `sampleGrid({ frame, extentM, spacingM, centreEnu?, absoluteDatum? })` →
    `HeightfieldData` — a bounded, fixed-shape grid rendered from the lattice,
    for crossing the worker boundary.
    - **`absoluteDatum: { undulationMetres }` is AR mode's datum** (milestone 1).
      Present, the returned `datum` is `−N` and heights read as **ellipsoidal**;
      absent, it is the height at the window centre and heights read as relief.
      Desktop uses the default and must keep using it.
    - The distinction that matters is not the units, it is that **the absolute
      datum does not depend on the window**. The window follows the user, so a
      window-centre datum moves mid-session and shifts the whole scene's Y
      baseline — which AR cannot tolerate and desktop never notices, because the
      camera is framed relative to the same moving surface.
    - Takes a number rather than a `GeoidModel` because a model is a function
      and functions do not survive a structured clone; the page samples `N` once
      at the frame origin, which is uniform to ~5 cm across a city.
  - `postCount` — held posts, so the eviction bound is testable.

## Invariants & assumptions

- **A post is fetched once.** This is the entire reason the module exists. The
  previous design (DEC-15/W8) sampled a square centred on the user and re-sampled
  **all of it** per position change — ~55 000 posts discarded and recomputed per
  step, which is fine for clicking a map and wrong for walking.
- **One lattice, so a seam is unrepresentable.** DEC-R2-21 asked for tiles and named
  tile seams as the risk it introduced. A sparse post map keyed by integer pixel has
  the same three properties (cached, incremental, evictable) and no boundary between
  two grids for a discontinuity to live on. That is why there is no seam test — the
  condition cannot occur.
- **The lattice is Web Mercator pixels at the Terrarium zoom.** Two independent
  reasons: it is the DEM's own sampling grid, so every post is a source pixel centre
  and nothing is resampled; and it is absolute, unlike an ENU grid, which shifts
  with the user so no post would ever be reusable.
- **Gaps are filled with the mean of what arrived, never zero.** Zero is sea level,
  and a sea-level hole is shaped exactly like the outage that caused it — it reads
  as terrain and buries the buildings standing in it.
- **`hasData: false` is distinct from "flat".** Tracked by `anyData`, because a
  field that loaded and a field that failed both render as a flat plane. The status
  line's relief number is the only thing that separates them, which DEC-R2-1 made
  load-bearing by accepting that flat ground should look flat.
- **Outside the covered area, `heightAtPosition` returns the NEAREST held post**,
  not `undefined`. A `NaN`/undefined vertex silently drops a triangle rather than
  reporting anything, and "this is the last thing we know" is the honest answer.
  - This is _not_ the striping bug of finding R2-9. That was a fixed 600 m field
    under 2.8 km of buildings, so the fallback covered most of the scene. The field
    is now sized to the rendered extent, so the fallback is an edge case rather than
    the common path.
- **Eviction is by DISTANCE from the current centre, not insertion order.** A user
  who walks out and back should not lose the posts under their feet for being old —
  the same reasoning the OSM chunk LRU records.
- **`reliefM` and `nearReliefM` both use a fold, never a spread into `Math.max`.** A
  spread passes one argument per element and throws above ~100 000; this grid exceeds
  that at the 2.8 km extent.

## Examples

```ts
// The demo composes Mapterhorn-primary + AWS-fallback behind one caching
// fetch via `createDemProvider` (see dem-provider.ts.md); any single
// `ElevationProvider` works the same way here.
const field = createTerrainField({ provider: demProvider });
await field.ensureAround(centre, extentM * Math.SQRT2); // grow (incremental)
const grid = field.sampleGrid({ frame, extentM, spacingM }); // render (bounded)
```

## Tests

`terrain-field.test.ts` — 9 examples. The two that carry the change are
_"RE-ASKS FOR NOTHING when the area is already covered"_ and _"asks ONLY for the new
posts when the user walks"_ (a ~150 m step must cost less than half the original
load). The rest pin the pixel-centre snapping, one-batch fetching, de-duplication,
the DEM-outage and patchy-coverage paths, and the eviction bound.

Two more cover the signal (#270): that the caller's **own** signal reaches
`elevationAt` — identity, not merely "a signal", since `InFlightRequests` cannot
otherwise tell this caller's abandonment from anyone else's — and that a provider
rejecting with `AbortError` resolves to nothing held rather than throwing.

## Provenance: invented posts and upgraded posts (2026-08-19)

The lattice is still write-once for MEASURED posts — standing still costs
nothing, which is the whole point of the cache — but it now tracks two things it
did not before.

- **`meanFilledCount`** — posts holding the mean of whatever answered in their
  batch rather than a measured height.
  - When some positions come back `undefined`, the rest are filled with that
    mean. Before this change they were written with the same `posts.set` as a
    real height and then skipped by the write-once guard forever, so a tile that
    failed while its neighbours succeeded left thousands of posts holding a
    plausible, confident, permanent wrong height — with nothing in the data or
    in any readout distinguishing them.
  - `ensureAround` now treats a mean-filled post as MISSING, so a later pass
    re-requests it. A post that becomes measured leaves the set; if it is
    invented again it stays.
  - The all-`undefined` case is unchanged and was always safe: nothing is
    written and the next load retries.
- **`replacePosts(positions, heights)`** — the DEM race's upgrade path, and the
  only way heights the lattice already holds can change.
  - **All of the current window or none of it.** The rule is about the WINDOW,
    not the batch: `ensureAround` only ever asks for the posts it is missing, so
    on a second load near the first the batch is just the new rim. Replacing per
    batch would leave the interior on one DEM and the rim on another — a visible
    step in the ground, produced by the rule written to prevent one. A batch
    applies only when every post in the current window would then come from the
    upgraded source: in this batch, or upgraded earlier.
  - Returns whether anything was written. `false` means refused — no usable
    heights, or the window would have been mixed. The caller must not treat a
    refusal as a change; see `worker/terrain-upgrade-sink.ts.md`.
- **`heldPositions()`** — every held post as a position, for building an
  upgrade batch.

Tested by `terrain-field.upgrade.test.ts`, whose assertions are deliberately
about heights observed through `sampleGrid` rather than about calls: "the
replace method was invoked" is satisfied by one that writes nothing.
