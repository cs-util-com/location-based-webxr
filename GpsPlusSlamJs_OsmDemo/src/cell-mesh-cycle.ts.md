# `cell-mesh-cycle.ts` — the grid build, coalesced

## Purpose

Runs `buildCellMesh` in the worker instead of on the main thread, and makes sure
only the newest build ever reaches the screen.

## Public API

- `CellMeshRequest` — `{ cells, centre, frameOrigin?, threshold, scale, showBelowThreshold }`,
  all plain cloneable data. `centre` is where the user is; `frameOrigin` is where
  the scene`s ENU frame is anchored, and defaults to `centre`. The grid is the
fourth thing built through the worker`s `meshOptions` and the one missed when
  the frame was fixed, so the overlay stayed pinned to the user while the
  buildings under it did not — the two sliding apart by the walked distance. `cells` is `{ cell, score }`, with the category
  already resolved on the caller's side.
- `CellMeshCycleOptions` — `{ worker, apply }`. `worker` is narrowed
  structurally to the one call, so a test can drive it with a stub.
- `createCellMeshCycle(options): LatestOnly<CellMeshRequest>`.

## Invariants & assumptions

- **Only the newest build paints.** Five things rebuild the grid — a new
  snapshot, a category change, the below-threshold switch, a layer toggle, and
  the heat scale moving — and three are a checkbox. An RPC has no ordering
  guarantee, so an older reply can arrive last; `latestOnly` drops the
  intermediate request and the post-await `signal.aborted` check drops a reply
  that was already on its way. Painting it would show a grid built from state
  the store has moved past — self-consistent, and therefore invisible.
- **Latest-wins, not a lock.** Refusing a rebuild while one is in flight would
  make the checkbox feel broken; the same trade `refresh-cycle.ts` and
  `terrain-cycle.ts` already made.
- **The category is resolved by the caller.** `cells` carries one score per
  cell, not the whole score record: sending every category's score for every
  cell would be most of the payload for data the grid cannot use.
- **The cells come from the caller, not from the worker's own scoring state.**
  The demo draws the snapshot it holds; a grid built from whatever the worker
  scored last would be a second source of truth for what is on screen.
- **A failure clears nothing.** A grid that could not be rebuilt is not evidence
  the previous one was wrong, and blanking on a superseded call is the bug
  DEC-R3-12 removed.
- **Switching the `cells` layer off does NOT go through here** — `main.ts`
  renders `EMPTY_CELL_MESH` synchronously, because an empty grid needs no
  arithmetic and a round trip would leave the old grid up while the checkbox
  looked ignored.

## Examples

```ts
const buildGrid = createCellMeshCycle({
  worker,
  apply: (mesh) => buildingView.renderCells(mesh),
});
void buildGrid({ cells, centre, threshold, scale, showBelowThreshold });
```

## Tests

`cell-mesh-cycle.test.ts` — a finished build is applied; the intermediate
request never reaches the worker while the newest always does; a reply that
arrives after being superseded is **not** painted; and the abort signal is
passed through so the worker can stop early. The geometry itself is
`cell-mesh.test.ts`'s subject and did not move.
