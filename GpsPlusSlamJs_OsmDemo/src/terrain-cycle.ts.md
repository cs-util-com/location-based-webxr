# `terrain-cycle.ts`

**Purpose.** Load the heightfield under a position, coalesced so the terrain and the buildings can never be for two different places.

## Public API

- `createTerrainCycle({ worker, extentM, spacingM, apply })` → `LatestOnly<TerrainLoad>`
  - Called with `{ centre, frameOrigin }` — where the user is, and where the
    scene's ENU frame is anchored. **TWO values, not one:** they were a single
    `centre` while the frame followed the user, and once the scene got a fixed
    anchor the heightfield kept being sampled in the user's frame while the
    buildings standing on it moved to the scene's — so the ground slid under the
    city by the step distance on every step. `terrain-window.ts` owns what the
    worker then does with the pair.
  - Reports the loaded field through `apply` exactly once per load that is not
    superseded.
  - Coalesced through `latestOnly`: at most one load in flight, only the newest waiting position survives, never rejects.
- `interface TerrainState` — `field` (`Heightfield | undefined`; `undefined` means the ground stays flat), `note` (one status-line phrase, never empty), `demSourceId` (which DEM composition sampled the field — the worker provider's `sourceId`, applied atomically with the field for the same reason the note is), `demStats` (which member of that composition actually served, as position counts — the worker's snapshot, optional, applied atomically for the same reason again) and `centreEnu` (where the window was sampled, in the scene’s frame).
  - **`centreEnu` is reported even when `field` is `undefined`**, and that is the point of it being a separate value. The ground plane follows this centre and the plane is FINITE — it reaches `TERRAIN_EXTENT_M` and stops — so one left behind during a DEM outage stops covering the user as soon as they walk past that, and the 5 km re-anchor threshold puts that well inside a single anchor. Raised in review on #269, where the code returned early instead: that fixed the appearance (moving a flat plane is invisible) and missed the coverage.
- `interface TerrainCycleOptions` — `worker` (the narrowed RPC surface), `extentM`, `spacingM`, `apply`. The SAMPLING moved into the worker; this module is now the coalescing wrapper around an RPC call, and `apply` receives `HeightfieldData` (not `Heightfield` — `heightAt` is a method and structured clone drops methods silently).

## Invariants & assumptions

- **This exists because it was the demo's ONE un-coalesced async action.** `refresh` went through `latestOnly` from the start; the terrain load did not, and both are driven by the same click. `TerrariumProvider` caches decoded tiles, so a second click can resolve from cache while the first is still fetching — the older load then lands last and wins. The result is the new position's buildings standing on the old position's relief, with a status line confidently reporting the old position's `reliefM`. Nothing about that symptom points at concurrency, which is exactly why it needs a structural guarantee rather than care.
  - Latest-wins rather than a lock, for the reason `latest-only.ts` gives: refusing a click while a fetch is open would make the map feel broken. The intermediate load is what gets dropped, never the user's final intent.
  - The guarantee is asserted as "only one load is ever open", not as "the stale write is discarded". With one load open at a time the out-of-order interleaving is unrepresentable, which is a stronger property than filtering it after the fact — and it also stops the middle of a click burst from costing DEM requests for ground nobody will see.
- **`apply` reports everything at once, on purpose.** The caller updates four things together — the field the 3D view stands on, its own copy for the next `drawScene`, the status-line note, and the attribution — and they must move as a unit or the screen says one thing while it draws another.
- **`field: undefined` is never a zero heightfield.** `hasData: false` means the ground stays FLAT, not at sea level: a hole shaped exactly like the DEM outage reads as terrain rather than as a failure, and buries the buildings standing in it. `heightfield.ts` makes the same point at more length.
- **The note always says something.** `terrain ±N m` (plus `(missing/total samples missing)` when posts were filled) or `terrain unavailable — ground is flat`. The relief is the one number distinguishing "loaded, and this place is flat" from "did not load" — two facts that render identically.
- **Never rejects.** `buildHeightfield` already swallows a provider failure into a flat field, and `latestOnly` swallows anything else. A DEM outage costs the relief, not the 3D view.

## Examples

```ts
const loadTerrain = createTerrainCycle({
  worker,
  extentM: TERRAIN_EXTENT_M,
  spacingM: 12,
  apply: ({ field, note, centreEnu, demSourceId }) => {
    terrain = field === undefined ? undefined : heightfieldFrom(field);
    terrainNote = note;
    // `centreEnu` is passed separately because it is reported even for a FAILED
    // load: the plane still has to move to where the window was asked for, or a
    // walk during a DEM outage leaves the user off the edge of a flat plane.
    buildingView.setTerrain(terrain, centreEnu);
  },
});

subscribe(
  (view) => view.position,
  (position) => {
    // BOTH AT ONCE, never chained. They are independent work on the same worker
    // and the worker joins them on the far side (`worker/terrain-gate.ts`), so
    // `.finally(() => refresh())` would be pure added latency.
    void loadTerrain({ centre: position, frameOrigin: anchors.origin });
    void refresh();
  },
);
```

## Tests

`terrain-cycle.test.ts`, against a provider whose every call the test holds open — the newest position wins even when an older load would have resolved later (only one load is ever in flight); the middle of a three-click burst is dropped; a DEM outage reports flat with an explicit note rather than sea level; the relief and missing-sample counts reach the note; and a rejecting provider still resolves with a flat field.

Plus the frame-forwarding pair, added after review on #269: `centre` and `frameOrigin` reach the worker as DISTINCT values (Cologne against Bonn, ~26 km apart, so a drop or a swap is unmissable), and the window centre still reaches `apply` when the DEM produced nothing. The rest of the file deliberately holds the two equal — it is about ordering — which is precisely why that hole existed: with one value, dropping or swapping the pair changed nothing any assertion could see.

That a FAILED load then moves the ground plane is the e2e’s (“keeps the ground under the user even when the terrain fails to load”, driven by `stubNetwork`’s `failTerrain`), since neither the worker nor `BuildingView` can be constructed in a unit test.

Related: `latest-only.ts.md` (the coalescing contract), `refresh-cycle.ts.md` (the other half of the same click), `heightfield.ts.md` (what a field is and why it is relative).

## Collecting the DEM race's better answer (2026-08-19)

`createTerrainCycle` now owns a **second `latestOnly` cycle** that issues the
`terrainUpgrade` RPC.

**Why the page has to ask at all.** The preferred DEM settles after the
`terrain` reply was built, and the worker protocol is strictly request/reply
keyed on `id` — `isWorkerReply` rejects anything without an `id`/`ok` pair,
so there is no unsolicited worker-to-page channel to announce the upgrade on.
Adding a push envelope would be real protocol surface for one boolean. Instead
the reply carries `upgradePending`, and the page asks.

**If that trigger is ever lost, nothing else fails.** The map still shows
terrain, the provider tests still pass, the worker still applies the better
heights internally — and the user permanently sees the coarse ones. It has its
own tests for that reason.

**Why a separate cycle.** The upgrade call waits for the preferred source, which
was measured at up to 21.7 s per tile. Run inside the load cycle it would hold
that cycle `busy` for the whole wait, delaying the next position's terrain and
making every readout keyed on `busy` claim the view is still loading long after
it finished. `latestOnly` also gives the right cancellation for free: walking
away supersedes an upgrade for a window nobody is looking at.

The upgrade reply is the SAME shape as `terrain`'s, so `apply` — including the
`meshOutdated` rebuild — is reused rather than duplicated.
