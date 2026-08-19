/**
 * "Terrain just landed — is the mesh currently on screen now out of date?"
 *
 * WHY THIS EXISTS (F1d, twelfth testing session). The terrain load and the
 * refresh run CONCURRENTLY, joined by `terrain-gate.ts` so the mesh is built on
 * the terrain of its own position. When the join times out, the mesh is built
 * on flat ground instead — and nothing ever rebuilt it, because the only thing
 * that triggers a rebuild is the NEXT `update`, and a terrain arrival does not
 * cause one. The owner saw buildings sitting at zero long after the relief had
 * loaded, and only a page reload fixed it.
 *
 * The damage was narrower than first reported and the distinction matters:
 * `terrainStamp` IS bumped when the field lands, and it is part of the mesh
 * planner's key, so the next refresh from ANY other cause — a category change,
 * a layer toggle, a geo-event, the next map click — rebuilds correctly. What
 * was missing is only the trigger from the arrival itself. On the ring the user
 * is actually looking at, nothing prompts that next refresh.
 *
 * WHY IT IS ITS OWN MODULE AND NOT A BRANCH IN `demo-worker.ts`. Same reason
 * `terrain-gate.ts` gives, and the same shape of question: this is a DECISION,
 * and a decision is what can be wrong. `demo-worker.ts` needs
 * `navigator.storage` and `OffscreenCanvas` to construct, so nothing written
 * inline there can be exercised by a unit test at all.
 *
 * WHY THE DECISION IS MADE IN THE WORKER RATHER THAN ON THE PAGE, which is
 * where the first draft of the plan put it. Two of the three inputs are worker
 * module state: `terrainStamp` and the record of what the standing mesh was
 * built from. Nothing in the terrain reply carried either, and inventing a page
 * copy of them would be a second source of truth for "what is the mesh standing
 * on" — the exact divergence `terrain-gate.ts` exists to prevent. The worker
 * decides; the page only acts.
 *
 * @see terrain-arrival.ts.md
 */

/** A position, structurally. This module never looks at anything else. */
export interface ArrivalPosition {
  readonly lat: number;
  readonly lng: number;
}

/** What the standing mesh was built from, recorded when it was built. */
export interface MeshBuildRecord {
  /**
   * The position the mesh was built for.
   *
   * **NO DATUM, deliberately — unlike `GateCentre`.** The gate's question is
   * "is this the same FIELD", for which the datum is part of the identity. This
   * module's question is "is the mesh standing on the newest field for this
   * PLACE", and AR entry changes the datum without moving the user: the desktop
   * mesh really is out of date the moment the AR field lands, so a datum-aware
   * comparison would answer "no rebuild needed" on precisely the transition
   * that needs one most. Including it here would import the gate's identity
   * into a question that is not the gate's.
   */
  readonly centre: ArrivalPosition;
  /** The value of the worker's terrain stamp at the moment it was built. */
  readonly terrainStamp: number;
}

export interface TerrainArrival {
  /** Where the terrain that just landed was sampled. */
  readonly centre: ArrivalPosition;
  /** The worker's terrain stamp AFTER this arrival bumped it. */
  readonly terrainStamp: number;
  /**
   * `update` handlers currently running in the worker.
   *
   * **THE GUARD THAT KEEPS THIS FROM MAKING THE APP SLOWER**, and it is not a
   * micro-optimisation. On the page, `refresh` is `latestOnly`: calling it
   * while one is running ABORTS the run in flight and starts over. An ordinary
   * cold click posts the terrain load and the refresh together, and the
   * refresh's Overpass fetch takes 15–90 s — far longer than the terrain. So a
   * rebuild signalled on every arrival would cancel and re-issue that fetch on
   * every single click, turning a fix for a rare stall into a permanent
   * regression. It was caught in review, before it shipped.
   *
   * An update in flight is also, by construction, one that will build its mesh
   * against the field this arrival just installed — it is either still waiting
   * at the gate this arrival releases, or past it. So there is nothing to
   * signal: the rebuild is already happening.
   */
  readonly updatesInFlight: number;
}

/**
 * Whether the standing mesh must be rebuilt because this terrain arrived late.
 *
 * THE BIAS IS TOWARDS NOT SIGNALLING, which is the opposite of `mesh-planner`'s
 * bias and deliberately so. A missed signal leaves the pre-existing behaviour —
 * the mesh rebuilds on the next interaction, which is what happened before this
 * module existed. A spurious signal aborts an in-flight Overpass fetch. The two
 * costs are not comparable, so every condition below is a reason to stay quiet.
 */
export function meshOutdatedByTerrain(
  lastMesh: MeshBuildRecord | undefined,
  arrival: TerrainArrival,
): boolean {
  // Nothing has been drawn yet, so nothing is stale. This is every first load:
  // the update that follows will build against the field that just landed.
  if (lastMesh === undefined) return false;
  // Something is already going to rebuild. See `updatesInFlight`.
  if (arrival.updatesInFlight > 0) return false;
  // A load for somewhere else says nothing about the ground under this mesh.
  // EXACT equality, as in `terrain-gate.ts`: both numbers come from the same
  // stored position, so they are the same doubles, and a tolerance would be a
  // way to accept a neighbouring position's arrival as this one's.
  if (
    lastMesh.centre.lat !== arrival.centre.lat ||
    lastMesh.centre.lng !== arrival.centre.lng
  ) {
    return false;
  }
  // The mesh already stands on this field. The ordinary case: the join held,
  // the update waited, and the mesh was built after the stamp moved.
  return lastMesh.terrainStamp !== arrival.terrainStamp;
}
