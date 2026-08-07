/**
 * What a click in the 3D view selects (W12).
 *
 * WHY THIS IS ITS OWN MODULE. Picking used to be four lines inside
 * `BuildingView` answering one question — which cell is under the pointer. W12
 * makes it answer "which *thing*", and the moment there are two kinds of answer
 * there is a precedence question, a nearest-hit question and a
 * what-happens-over-a-building question, none of which can be tested through a
 * class that needs a `WebGLRenderer`.
 *
 * So the raycast stays in the view and the DECISION lives here — the same split
 * this repo already uses for worker and shader logic: keep the judgement in a
 * pure module that the device layer thinly wraps.
 *
 * THE INVARIANT W12 MUST NOT UNDO: buildings are not selectable. `building-view`
 * excluded them deliberately, because hitting a building should not silently
 * select the cell behind it as though the building had been chosen. They stay
 * out of the raycast set, and `resolvePick` additionally ignores anything it
 * cannot identify, so a building can neither be returned nor swallow the click.
 *
 * @see pick.ts.md
 */

import type { TransferableMesh } from "./worker/protocol.js";

/** A POI marker, as it crosses the worker boundary. */
type PoiMarker = TransferableMesh["poi"][number];

/**
 * One raycast hit, reduced to what the decision needs.
 *
 * Deliberately NOT `THREE.Intersection`: this module must be constructible in a
 * test without a renderer, and the three fields below are the whole of what the
 * decision reads.
 */
export interface PickCandidate {
  readonly distance: number;
  /**
   * `number | null` in three's own types — null when the object is unindexed.
   *
   * `| undefined` is spelled out as well as the `?`, because
   * `exactOptionalPropertyTypes` is on: without it, a caller mapping from a real
   * `Intersection` cannot pass the field through, since three declares it as
   * possibly-`undefined` rather than as optional.
   */
  readonly faceIndex?: number | null | undefined;
  /**
   * Which instance of an `InstancedMesh` was hit (W7).
   *
   * `number | undefined` in three's own types — absent for every hit on a
   * non-instanced object, which includes the cell grid sharing this raycast set.
   * Spelled out as `| undefined` as well as `?` for the same
   * `exactOptionalPropertyTypes` reason as `faceIndex`.
   */
  readonly instanceId?: number | null | undefined;
  readonly userData: Record<string, unknown>;
}

/** What the user selected. */
export type Pick =
  | { readonly kind: "cell"; readonly cell: string }
  | { readonly kind: "poi"; readonly marker: PoiMarker }
  | { readonly kind: "region"; readonly region: string };

/**
 * The nearest hit that resolves to something selectable, or `undefined`.
 *
 * SORTED HERE rather than trusting the caller. three's `intersectObjects` does
 * return hits in distance order, but relying on that would make this module's
 * contract depend on a detail of its caller's caller.
 *
 * Distance is the only tie-break BETWEEN PEERS, and that is deliberate. A marker
 * stands on the grid, so a click on a marker hits both — preferring one KIND by
 * rule would make the grid unclickable wherever a marker overlaps it, or markers
 * unclickable altogether.
 *
 * A REGION IS NOT A PEER, and it is the one exception (DEC-R7b-3a). A region is
 * a flood fill OVER cells, so its slab covers every cell inside it by
 * construction — the overlap is total rather than incidental, which is exactly
 * the case the distance rule handles badly. The finer claim wins: a region is
 * resolved only when nothing sharper was hit.
 *
 * Relying on the 4 cm the layer ladder puts between them would work from
 * overhead and fail at a grazing angle, where the slab in front of a cell is
 * nearer. That is a bug that appears only at certain camera angles, which is the
 * class this round already spent a session diagnosing.
 *
 * An unidentifiable hit is SKIPPED, not fatal: the click keeps looking behind
 * it. Selecting nothing because an unselectable object was in front reads as a
 * dead control, which is the defect this demo already had once with a
 * non-interactive tooltip.
 */
export function resolvePick(
  hits: readonly PickCandidate[],
  cellForTriangle: readonly string[],
): Pick | undefined {
  let region: Pick | undefined;
  for (const hit of [...hits].sort((a, b) => a.distance - b.distance)) {
    // Remembered, not returned: the nearest region is the answer only if no cell
    // or marker turns up behind it. See the header.
    const regionId = hit.userData["regionId"];
    if (typeof regionId === "string" && regionId !== "") {
      region ??= { kind: "region", region: regionId };
      continue;
    }
    // POI MARKERS ARE INSTANCED (W7), so the identity is no longer on the
    // object — one `InstancedMesh` carries every marker and the hit's
    // `instanceId` selects one. Structurally identical to the cell grid's
    // `faceIndex -> cellForTriangle`, and it fails the same way: a lookup miss
    // means the table and the geometry have drifted, and answering from a
    // drifted table opens the details panel on a confidently wrong place.
    const markers = hit.userData["poiInstances"];
    if (Array.isArray(markers)) {
      const instance = hit.instanceId;
      if (instance === undefined || instance === null) continue;
      const marker = (markers as PoiMarker[])[instance];
      if (marker === undefined) continue;
      return { kind: "poi", marker };
    }
    if (hit.userData["cellGrid"] !== true) continue;
    // `faceIndex` IS the triangle index for an indexed BufferGeometry, which is
    // what `cellForTriangle` is keyed on — built in the same pass as the
    // geometry so the two cannot drift.
    const face = hit.faceIndex;
    if (face === undefined || face === null) continue;
    const cell = cellForTriangle[face];
    // A miss means the lookup and the geometry HAVE drifted, and a drifted
    // lookup opens the details panel on a confidently wrong cell — worse than
    // opening nothing. The H3 ragged-boundary fix landed for this exact class.
    if (cell === undefined) continue;
    return { kind: "cell", cell };
  }
  return region;
}
