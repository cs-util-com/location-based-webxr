/**
 * Merged affordance regions as low 3D slabs (W14, DEC-R2-11).
 *
 * WHAT A REGION IS HERE. A flood fill over affordance cells, already computed by
 * `regions/region-builder.ts`, arriving as an outline: an array of polygons, each
 * an array of rings, outer first and holes after. A building inside a park is a
 * hole, and two cells that score but do not touch are two polygons of one region
 * — both are the ordinary shape of the data rather than edge cases.
 *
 * WHY IT IS A FLAT SHEET AGAIN (DEC-R7b-7a, round 8). It was a slab: DEC-R2-11
 * gave every region a 0.5 m boundary wall because a zero-thickness surface
 * disappears edge-on, which is the angle this demo is usually viewed at. The
 * owner asked for the extrusion to go — a region is an overlay on the ground,
 * not a body standing on it — so the walls are gone and the top sits on the
 * layer ladder's own `areas` rung.
 *
 * **DEC-R2-11's objection was never answered, only accepted.** The plan paired
 * this with lifting the sheet 2-3 m clear of the ground, which is what would
 * have made a flat surface visible edge-on; that lift was then cancelled because
 * it broke three `layer-order.ts` invariants. So a region CAN still vanish at a
 * grazing angle, and if it does the escalation is opacity, then a separate
 * outline — not the walls, which is where this started.
 *
 * WHY THE COLOUR IS NOT COMPUTED HERE, and this is the load-bearing decision.
 * The 2D map and the 3D view must never be able to disagree about what a score
 * looks like — that is the whole reason the store exists. The demo owns one
 * `heatScale`/`heatColour` pair and both views read it, so this module carries
 * `medianScore` through untouched and colours nothing. A colour computed in the
 * package would be a second source of truth for the same question.
 *
 * @see region-slabs.ts.md
 */

import type { LatLng } from "../model/osm-feature.js";
import type { EnuFrame, EnuPoint } from "./enu.js";
import { MeshBuilder, type MeshData } from "./mesh-data.js";
import { triangulate } from "./triangulate.js";

/**
 * The part of a region this builder needs.
 *
 * STRUCTURAL rather than the full `Region`, so a caller can hand one over
 * without this module depending on the region builder, and so a test can
 * construct one in three lines.
 */
export interface SlabRegion {
  /** Polygons, each a list of rings: outer first, holes after. */
  readonly outline: readonly (readonly (readonly LatLng[])[])[];
  /** Carried through so the CALLER can colour by it. See the header. */
  readonly medianScore: number;
  /**
   * Carried through so a CLICK on the slab can be resolved back to the region.
   *
   * Opaque here, exactly like the score: this module knows nothing about how
   * ids are formed and must not, or it would become a second place that decides
   * region identity.
   */
  readonly id: string;
}

export interface BuildRegionSlabsOptions {
  readonly frame: EnuFrame;
  readonly groundHeightM?: (position: LatLng) => number;
}

export interface RegionSlab {
  readonly medianScore: number;
  readonly id: string;
  readonly mesh: MeshData;
}

/** One slab per region, in input order. Never throws. */
export function buildRegionSlabs(
  regions: Iterable<SlabRegion>,
  options: BuildRegionSlabsOptions,
): RegionSlab[] {
  const slabs: RegionSlab[] = [];
  for (const region of regions) {
    slabs.push({
      medianScore: region.medianScore,
      id: region.id,
      mesh: slabMesh(region, options),
    });
  }
  return slabs;
}

function slabMesh(
  region: SlabRegion,
  options: BuildRegionSlabsOptions,
): MeshData {
  const builder = new MeshBuilder();
  const sample = options.groundHeightM;

  /** Ground under an ENU point, defaulting to 0 rather than to NaN. */
  const groundAt = (point: EnuPoint): number => {
    const height = sample?.(options.frame.toLatLng(point)) ?? 0;
    return Number.isFinite(height) ? height : 0;
  };

  for (const polygon of region.outline) {
    const rings = polygon.map((ring) =>
      ring.map((position) => options.frame.toEnu(position)),
    );
    addPolygon(builder, rings, groundAt);
  }

  return builder.build();
}

/** One polygon's top surface and the wall around every one of its rings. */
function addPolygon(
  builder: MeshBuilder,
  rings: readonly (readonly EnuPoint[])[],
  groundAt: (point: EnuPoint) => number,
): void {
  const outer = rings[0];
  // A ring with fewer than three points cannot be triangulated, and pushing on
  // regardless produces NaN — which deletes the entire draw call in three.js
  // with no error at all.
  if (outer === undefined || outer.length < 3) return;

  const triangulated = triangulate(rings);
  if (triangulated.indices.length === 0) return;

  addTopSurface(builder, triangulated, groundAt);
}

/**
 * The draped top of one polygon.
 *
 * Drapes PER VERTEX, like the plates and the roads: a region can be hundreds of
 * metres across, and one sample would cut into the hill at one end and float at
 * the other.
 */
function addTopSurface(
  builder: MeshBuilder,
  triangulated: ReturnType<typeof triangulate>,
  groundAt: (point: EnuPoint) => number,
): void {
  // ON the ground, not above it. The wall height used to double as this lift, so
  // deleting the walls also drops the surface by 0.5 m — deliberate, and the
  // reason `region-slabs.test.ts` asserts the resulting height rather than
  // trusting that "drop the walls" was a pure deletion. Separation from the
  // other ground layers is the demo's `layer-order.ts` ladder, which puts
  // `areas` at 0.12 m; doing it here as well would double-count it.
  const top = triangulated.vertices.map((point) =>
    builder.vertex(point.x, groundAt(point), point.y, 0, 1, 0),
  );
  const { indices } = triangulated;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = top[indices[i] ?? 0];
    const b = top[indices[i + 1] ?? 0];
    const c = top[indices[i + 2] ?? 0];
    if (a === undefined || b === undefined || c === undefined) continue;
    // Reversed relative to the triangulator's output for the same reason W13's
    // ribbons are: `flatShading` recomputes the face normal from the winding and
    // ignores the per-vertex normals, so an inverted top is lit from beneath and
    // culled while every counter still reports it. Pinned by "winds every TOP
    // triangle so its face normal points up".
    builder.triangle(a, c, b);
  }
}
