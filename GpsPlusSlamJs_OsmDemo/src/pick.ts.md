# `src/pick.ts`

## Purpose

Decides what a click in the 3D view selected (W12). The raycast stays in
`BuildingView`; the judgement lives here so it can be tested without a
`WebGLRenderer`.

## Public API

- `PickCandidate` — `{ distance, faceIndex?, instanceId?, point?, userData }`.
  Deliberately not `THREE.Intersection`: these fields are the whole of what the
  decision reads, and a test must be able to construct one without a renderer.
- `ScenePoint` — `{ x, y, z }` in the scene's own frame (`x` east, `y` up, `z`
  **south**). Declared here because this is where it was first needed;
  `route-path.ts` imports the type rather than declaring a second one.
- `Pick` — `{ kind: "cell", cell }`, `{ kind: "poi", marker }`,
  `{ kind: "region", region }` or `{ kind: "ground", point }`.
- `resolvePick(hits, cellForTriangle) → Pick | undefined` — the nearest hit that
  resolves to something selectable, or the coarsest claim behind it. Never
  throws.

## The precedence chain (DEC-R7b-3a, DEC-R11-17)

Finest first. Distance is the tie-break **between peers only**:

- **cell / POI** — peers, decided by distance.
- **region** — remembered, returned only if nothing sharper turned up.
- **ground** — remembered, returned only if no region did either.
- **a solid object (building or barrier) STOPS the scan** — see below.

## Invariants & assumptions

- **Buildings are still not selectable — but they are now RAYCAST** (DEC-R11-17).
  They joined the set as **blockers**: `resolvePick` stops at the first one and
  never returns it, so a click on a facade resolves to nothing rather than to the
  ground behind it. That is the original invariant's intent stated positively
  instead of by omission, and it has a second reason now — a building interior is
  unreachable since stage 3, so routing there costs the full expansion cap to
  answer "no route".
  - Because the scan is nearest-first, the blocker only reaches things BEHIND it:
    a POI pin against a facade and a region slab in front of a building both
    still resolve.
  - The cost is real and stated: the largest geometry in the scene is now in the
    picking set. W20's chunking bounds it — three tests bounding boxes before
    triangles.
- **The ground is the coarsest claim, never a peer.** It is under everything, so
  a nearest-hit rule would have let it swallow every existing click the moment it
  joined the set — the same reason region slabs are not peers, and the same
  grazing-angle failure.
- **A ground pick carries SCENE coordinates, not `LatLng`.** This module must
  stay constructible without an ENU frame; the frame lives on the page next to
  the scene anchor and is re-taken on a teleport, so a second copy here would go
  stale exactly when the user moves. `main.ts` converts.
  - A ground hit with no `point` is skipped rather than defaulted — a destination
    at the origin would be a confidently wrong place, which this module refuses
    everywhere else too.
- **An unidentifiable hit is SKIPPED, not fatal** — the click keeps looking
  behind it. That still holds, and is now defence in depth rather than the
  mechanism: solid objects identify themselves.
- **An unidentifiable hit is SKIPPED, not fatal** — the click keeps looking
  behind it. Selecting nothing because an unselectable object was in front reads
  as a dead control, a defect this demo already shipped once via a
  non-interactive Leaflet tooltip.
- **Nearest wins, and distance is the only tie-break.** A marker stands on the
  grid, so clicking a marker hits both. Preferring one _kind_ by rule would make
  the grid unclickable wherever a marker overlaps it, or markers unclickable
  altogether.
- **Hits are sorted here rather than trusting the caller.** three's
  `intersectObjects` does return them in distance order, but relying on that
  makes this module's contract depend on a detail of its caller's caller.
- **A grid hit whose triangle maps to no cell is ignored.** `cellForTriangle` is
  built in the same pass as the geometry, so a miss means the two have drifted —
  and a drifted lookup opens the panel on a confidently wrong cell, worse than
  opening nothing. The H3 ragged-boundary fix landed for this exact class.
- **POI markers are INSTANCED (W7), so their identity is an index too.** One
  `InstancedMesh` carries every marker and the hit's `instanceId` selects one out
  of `userData.poiInstances`. Structurally identical to the grid's
  `faceIndex → cellForTriangle`, including the failure: a lookup miss means the
  table and the matrices have drifted, and answering from a drifted table opens
  the details panel on a confidently wrong place. The table is built in the same
  loop as the instance matrices, in `mesh-layers.ts`, so it cannot.
  - A hit with no `instanceId` is skipped rather than defaulting to instance 0 —
    every hit on a non-instanced object (the cell grid shares the raycast set)
    has none, and "the first marker" would be a confident wrong answer.
- **`faceIndex` is `number | null | undefined`.** `null` is three's own type when
  the hit object is unindexed; the explicit `| undefined` alongside the `?` is
  needed because `exactOptionalPropertyTypes` is on.
- **The POI pick carries the MARKER, not an id to look up.** A lookup would be
  resolved against whatever working set is current when the panel opens, which is
  not necessarily the one the user clicked.

## Examples

```ts
const picked = resolvePick(
  raycaster.intersectObjects(targets, false).map((hit) => ({
    distance: hit.distance,
    faceIndex: hit.faceIndex,
    userData: hit.object.userData,
  })),
  cellForTriangle,
);
```

## Tests

`pick.test.ts`: cell under a grid hit; marker under a POI hit; nearest wins in
both directions; unsorted input; empty input; an unidentifiable hit is skipped
and the search continues; a triangle that maps to no cell; a `null` `faceIndex`;
the instanced-marker lookup; the region precedence.

The ground block (DEC-R11-17) pins the chain from both ends: a sharper claim wins
at any distance; a building in FRONT refuses the destination; a building BEHIND
does not; a marker or a region in front of a building still resolves; and a
ground hit without a point is skipped.

`playwright-tests/` › "a building stays unpickable, which W12 must not have
undone" is the end-to-end half of the invariant, and `scene-3d.spec.js` ›
"orders the agent…" is the end-to-end half of the ground case.
