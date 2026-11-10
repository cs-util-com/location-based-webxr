/**
 * "Has anything the geometry depends on changed since the mesh the page DRAWS?"
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
 * - **the terrain**, because every builder samples heights from it;
 * - **the build choices**: the colour scheme (colour schemes plan
 *   2026-11-10-0841, D1), because the city's colours are baked into its
 *   buffers, and every later switch that changes what is built. They are a
 *   named map so a new switch joins the key without a change here.
 *
 * WHY THE PAGE'S DRAWN KEY, NOT THE LAST BUILD. A reply can be dropped: the
 * page aborts a superseded call, and the worker drops the reply of an aborted
 * request. A planner that remembered what it BUILT then answered the next pass
 * with the same inputs with slabs only, so the page kept an older mesh (or
 * none) and a switch waiting for the new one never finished. The page sends
 * the key of the mesh it has drawn (`TransferableMesh.buildKey`), and only that
 * mesh counts.
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
  /**
   * What the user chose to build, by name (the colour scheme, later switches).
   * A change of any value is a rebuild; the order of the names is not.
   */
  readonly choices: Readonly<Record<string, string | boolean>>;
}

/**
 * How far the user may move before the drawn content is considered stale, in
 * degrees.
 *
 * ~0.001° ≈ 110 m of latitude, and less of longitude at this latitude — an
 * order of magnitude inside the ~2 400 m clip extent, so the window is refreshed
 * long before the user can approach its edge, while an ordinary step costs
 * nothing.
 *
 * **A coarsened position, NOT a dropped one.** Dropping it would make steps free
 * and freeze the clipped content forever: geometry is clipped to a box around
 * the position (`demo-worker.ts`, `clipBoxAround(centre, TERRAIN_EXTENT_M)`), so
 * a key without position leaves the plates at wherever the scene started and
 * the user eventually walks off the edge of the drawn world.
 */
const POSITION_BUCKET_DEG = 0.001;

/** The position coarsened to its bucket, so a step is not a new identity. */
function bucket(value: number): number {
  return Math.round(value / POSITION_BUCKET_DEG);
}

/**
 * The build's identity: `latBucket|lngBucket|tiles|stamp|name=value...`,
 * coarse in space and exact in the rest, the choices sorted by name. The
 * worker stamps it on every full mesh and the page sends it back.
 */
export function meshBuildKey(inputs: MeshInputs): string {
  const choices = Object.keys(inputs.choices)
    .sort()
    .map((name) => `${name}=${String(inputs.choices[name])}`);
  return [
    bucket(inputs.position.lat),
    bucket(inputs.position.lng),
    inputs.loadedTileCount,
    inputs.terrainStamp,
    ...choices,
  ].join("|");
}

/**
 * Whether this pass must rebuild the geometry: whenever the page does not
 * already draw a mesh with this pass's key. `drawnKey` is the key of the mesh
 * on the page, `undefined` when it draws none.
 *
 * THE BIAS IS TOWARDS REBUILDING. Every input is compared exactly, so anything
 * this cannot prove is unchanged is treated as changed — a needless rebuild
 * costs milliseconds, while a skipped one leaves the city drawn for the wrong
 * position, which is the half-swapped scene this demo has repeatedly engineered
 * away.
 */
export function needsFullBuild(
  inputs: MeshInputs,
  drawnKey: string | undefined,
): boolean {
  return meshBuildKey(inputs) !== drawnKey;
}
