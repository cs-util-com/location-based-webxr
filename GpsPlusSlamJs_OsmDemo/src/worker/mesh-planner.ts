/**
 * "Has anything the geometry depends on changed since the last full build?"
 *
 * WHY THIS EXISTS (W6, finding R3-3). Progressive scoring runs three passes per
 * click, and the first version rebuilt the ENTIRE city on every one of them —
 * buildings, trees, POI markers, roads, plates — although only the region slabs
 * differ between rings. That was most of the per-click cost the round-3 notes
 * reported as "the calculation just takes longer", and it was recorded as a
 * known cost in `refresh-cycle.ts` for a round before being fixed.
 *
 * WHAT THE GEOMETRY ACTUALLY DEPENDS ON, which is the whole content of this
 * module:
 *
 * - **the position**, because the mesh is built in an ENU frame anchored there,
 *   so every vertex in the scene moves when the user does;
 * - **the feature set**, which grows only by loading another fetch tile;
 * - **the terrain**, because every builder samples heights from it.
 *
 * A widening ring changes none of them. Neither does a category change — which
 * is a second, unlooked-for win: switching category used to rebuild the city too.
 *
 * WHY A COUNTER FOR THE TILES AND A STAMP FOR THE TERRAIN. Both are "has this
 * been replaced?" questions rather than "what is it?" questions, and comparing
 * the things themselves would mean deep-comparing megabytes of features and a
 * 55 000-post field on every pass — more expensive than the rebuild being
 * avoided. Tiles are only ever ADDED, so a count is faithful; the terrain is
 * replaced wholesale, so a monotonic stamp is.
 *
 * @see mesh-planner.ts.md
 */

/** Everything the built geometry is a function of. */
export interface MeshInputs {
  readonly position: { readonly lat: number; readonly lng: number };
  /** Fetch tiles merged into the index. Only ever grows. */
  readonly loadedTileCount: number;
  /** Bumped whenever the held heightfield is replaced. */
  readonly terrainStamp: number;
}

export interface MeshPlanner {
  /**
   * Whether this pass must rebuild the geometry.
   *
   * **Records the inputs as the new baseline when it answers `true`**, so two
   * consecutive calls with the same inputs answer `true` then `false`. That
   * makes the caller's shape unavoidable — ask once per pass, build what you are
   * told — rather than leaving a separate "commit" step that can be forgotten.
   */
  needsFullBuild(inputs: MeshInputs): boolean;
}

/** `lat,lng,tiles,stamp` — an exact identity, not a fuzzy one. */
function keyOf(inputs: MeshInputs): string {
  return [
    inputs.position.lat,
    inputs.position.lng,
    inputs.loadedTileCount,
    inputs.terrainStamp,
  ].join("|");
}

/**
 * Builds a planner.
 *
 * THE BIAS IS TOWARDS REBUILDING. Every input is compared exactly, so anything
 * this cannot prove is unchanged is treated as changed — a needless rebuild
 * costs milliseconds, while a skipped one leaves the city drawn for the wrong
 * position, which is the half-swapped scene this demo has repeatedly engineered
 * away.
 */
export function createMeshPlanner(): MeshPlanner {
  let lastBuilt: string | undefined;
  return {
    needsFullBuild(inputs: MeshInputs): boolean {
      const key = keyOf(inputs);
      if (key === lastBuilt) return false;
      lastBuilt = key;
      return true;
    },
  };
}
