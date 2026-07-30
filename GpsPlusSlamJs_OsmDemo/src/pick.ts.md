# `src/pick.ts`

## Purpose

Decides what a click in the 3D view selected (W12). The raycast stays in
`BuildingView`; the judgement lives here so it can be tested without a
`WebGLRenderer`.

## Public API

- `PickCandidate` — `{ distance, faceIndex?, userData }`. Deliberately not
  `THREE.Intersection`: the three fields below are the whole of what the decision
  reads, and a test must be able to construct one without a renderer.
- `Pick` — `{ kind: "cell", cell }` or `{ kind: "poi", marker }`.
- `resolvePick(hits, cellForTriangle) → Pick | undefined` — the nearest hit that
  resolves to something selectable. Never throws.

## Invariants & assumptions

- **Buildings are not selectable, and W12 must not have undone that.** They are
  excluded from the raycast set in `BuildingView.pick`, which is a stronger
  guarantee than filtering afterwards and much cheaper than raycasting the whole
  city. `resolvePick` additionally ignores anything it cannot identify, so a
  building could neither be returned nor swallow a click even if one arrived.
- **An unidentifiable hit is SKIPPED, not fatal** — the click keeps looking
  behind it. Selecting nothing because an unselectable object was in front reads
  as a dead control, a defect this demo already shipped once via a
  non-interactive Leaflet tooltip.
- **Nearest wins, and distance is the only tie-break.** A marker stands on the
  grid, so clicking a marker hits both. Preferring one *kind* by rule would make
  the grid unclickable wherever a marker overlaps it, or markers unclickable
  altogether.
- **Hits are sorted here rather than trusting the caller.** three's
  `intersectObjects` does return them in distance order, but relying on that
  makes this module's contract depend on a detail of its caller's caller.
- **A grid hit whose triangle maps to no cell is ignored.** `cellForTriangle` is
  built in the same pass as the geometry, so a miss means the two have drifted —
  and a drifted lookup opens the panel on a confidently wrong cell, worse than
  opening nothing. The H3 ragged-boundary fix landed for this exact class.
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

`pick.test.ts` — 8 tests: cell under a grid hit; marker under a POI hit; nearest
wins in both directions; unsorted input; empty input; an unidentifiable hit is
skipped and the search continues; a triangle that maps to no cell; a `null`
`faceIndex`.

`osm-demo.spec.js` › "a building stays unpickable, which W12 must not have
undone" is the end-to-end half of the invariant.
