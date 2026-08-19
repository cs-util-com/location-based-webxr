# `worker/terrain-arrival.ts`

## Purpose

One decision: **when a terrain field lands, is the mesh already on screen now
out of date because of it?** If yes, the worker says so on the terrain reply and
the page refreshes.

## Public API

- `meshOutdatedByTerrain(lastMesh, arrival): boolean`
  - `lastMesh: MeshBuildRecord | undefined` — `{ centre, terrainStamp }`, what
    the standing mesh was built from. `undefined` before the first build.
  - `arrival: TerrainArrival` — `{ centre, terrainStamp, updatesInFlight }`,
    where the field just landed, the stamp **after** the bump, and how many
    `update` handlers are running.
- `MeshBuildRecord`, `TerrainArrival`, `ArrivalPosition` — the input shapes.

Pure, synchronous, no I/O. Everything it needs is passed in, which is the whole
reason it is not a branch inside `demo-worker.ts`.

## The defect it exists for (F1d, twelfth testing session)

The terrain load and the refresh run concurrently, joined by
[`terrain-gate.ts`](./terrain-gate.ts.md) so a mesh is built on the terrain of
its own position. When that join times out — 15 s — the mesh is built on flat
ground instead, and **nothing rebuilt it when the relief finally arrived**. The
owner watched buildings sit at zero long after the terrain had loaded and fixed
it by reloading the page.

**The damage was narrower than first reported, and the distinction is worth
keeping.** `terrainStamp` _is_ bumped on arrival, and it is part of
[`mesh-planner.ts`](./mesh-planner.ts.md)'s key, so the next refresh from any
other cause — a category change, a layer toggle, a geo-event, the next map
click — rebuilds correctly. What was missing is only the trigger from the
arrival itself. On the ring the user is looking at, nothing prompts it.

## Invariants & assumptions

- **The bias is towards staying quiet**, which is the opposite of
  `mesh-planner.ts`'s bias and deliberately so. The two errors are not
  symmetric:
  - A missed signal restores the pre-existing behaviour: the mesh rebuilds on
    the next interaction. Mildly bad, and exactly what shipped before.
  - A spurious signal calls a `latestOnly` `refresh`, which **aborts the run in
    flight** and re-issues its Overpass fetch — 15–90 s. On an ordinary cold
    click the terrain load and the refresh are posted together, so a signal on
    every arrival would do this on **every click**. That is a permanent
    regression traded for a rare stall, and it is what the first draft of the
    plan would have shipped; the cold review caught it.
- **`updatesInFlight > 0` means "somebody else is already rebuilding".** An
  update in flight is, by construction, one that will build against the field
  this arrival just installed: it is either still waiting at the gate this
  arrival releases, or already past it.
- **The record carries NO datum, unlike `GateCentre`.** The gate asks "is this
  the same field", for which the datum is part of the identity. This module asks
  "is the mesh standing on the newest field for this place". AR entry re-samples
  an unchanged position against a different datum (~99 m apart at Cologne), and
  the desktop mesh really is out of date the moment that field lands — so a
  datum-aware comparison would answer "no rebuild" on precisely the transition
  that most needs one.
- **Positions compare with exact equality**, as in `terrain-gate.ts`: both
  numbers come from the same stored position, so they are the same doubles, and
  a tolerance would be a way to accept a neighbouring load as this one's.
- **Stamps compare with inequality, not `<`.** The stamp is monotonic today, so
  a backwards move cannot happen — but the property that matters is "the mesh
  was built against a _different_ field than the one now held", and an ordering
  would go quietly wrong if the counter were ever reset (a worker restart, a
  future per-datum stamp).
- **The record is written on every pass, including regions-only ones.** It
  answers "which field is the geometry on screen sampled against", and a
  regions-only pass leaves that geometry where the last full build put it.
  Writing it only on a full build would strand a stale stamp here and produce
  a rebuild signal that is not needed.

## How it is wired

- `demo-worker.ts` records `lastMeshBuild = { centre: position, terrainStamp }`
  right after `meshUpdateFor`, and maintains `updatesInFlight` at the **dispatch
  layer** (`if (kind === "update")` around the existing `.finally`) so an
  aborted or throwing handler still releases the count.
- The `terrain` handler calls this function after bumping the stamp and puts the
  answer on the reply as `TerrainResult.meshOutdated`.
- `main.ts`'s terrain `apply` does `if (meshOutdated === true && !refresh.busy)
void refresh();`. **The `busy` check is not redundant with the worker's
  `updatesInFlight` guard** — the worker's window closes when the reply is
  posted, the page's when the reply has been applied, and a terrain reply
  delivered in that gap would abort a live refresh.

**Why the flag rides the reply instead of a push.** The worker protocol is
strictly request/reply keyed on `id`, and `isWorkerReply` rejects anything
without an `id`/`ok` pair — there is no unsolicited worker→page channel. Adding
one is real protocol surface for a boolean that already has a message travelling
in the right direction.

## Examples

```ts
// In the worker's `terrain` handler, after `terrainStamp += 1`:
const meshOutdated = meshOutdatedByTerrain(lastMeshBuild, {
  centre,
  terrainStamp,
  updatesInFlight,
});
```

## Tests

`terrain-arrival.test.ts`. Seven cases, and the suppression ones carry more
weight than the signalling one:

- the reported bug — terrain lands after the mesh was built for that place
- **the most important case:** quiet while an update is in flight, because that
  update will rebuild anyway. Mutating this guard away fails exactly this test
  and nothing else, which is what makes it worth keeping.
- quiet before anything is drawn, quiet for another position, quiet when the
  mesh already stands on this field
- the AR-entry case, which is why the record has no datum
- a stamp that moved backwards, which pins inequality rather than ordering

No sidecar-level test is needed for the `demo-worker.ts` wiring: that file needs
`navigator.storage` and `OffscreenCanvas` to construct and has no unit test,
which is the reason this decision was extracted in the first place — the same
argument `terrain-gate.ts` makes.
