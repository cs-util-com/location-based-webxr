/**
 * Merged affordance regions as low 3D slabs (W14, DEC-R2-11).
 *
 * WHAT A REGION IS HERE. A flood fill over affordance cells, already computed by
 * `regions/region-builder.ts`, arriving as an outline: an array of polygons, each
 * an array of rings, outer first and holes after. A building inside a park is a
 * hole, and two cells that score but do not touch are two polygons of one region
 * — both are the ordinary shape of the data rather than edge cases.
 *
 * WHY A SLAB AND NOT A FLAT OVERLAY (DEC-R2-11). A zero-thickness surface
 * disappears edge-on, which is the angle this demo is usually viewed at. A short
 * wall makes the region read as a body without competing with the buildings.
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
}

export interface BuildRegionSlabsOptions {
  readonly frame: EnuFrame;
  readonly groundHeightM?: (position: LatLng) => number;
  /**
   * Height of the boundary wall, metres.
   *
   * 0.5 m by default (the plan's proposal, `[confirm]`): tall enough to read at
   * a shallow angle, short enough not to occlude buildings on a slope.
   */
  readonly wallHeightM?: number;
}

export interface RegionSlab {
  readonly medianScore: number;
  readonly mesh: MeshData;
}

const DEFAULT_WALL_HEIGHT_M = 0.5;

/** One slab per region, in input order. Never throws. */
export function buildRegionSlabs(
  regions: Iterable<SlabRegion>,
  options: BuildRegionSlabsOptions,
): RegionSlab[] {
  const slabs: RegionSlab[] = [];
  for (const region of regions) {
    slabs.push({
      medianScore: region.medianScore,
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
  const wallHeightM = options.wallHeightM ?? DEFAULT_WALL_HEIGHT_M;
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
    addPolygon(builder, rings, groundAt, wallHeightM);
  }

  return builder.build();
}

/** One polygon's top surface and the wall around every one of its rings. */
function addPolygon(
  builder: MeshBuilder,
  rings: readonly (readonly EnuPoint[])[],
  groundAt: (point: EnuPoint) => number,
  wallHeightM: number,
): void {
  const outer = rings[0];
  // A ring with fewer than three points cannot be triangulated, and pushing on
  // regardless produces NaN — which deletes the entire draw call in three.js
  // with no error at all.
  if (outer === undefined || outer.length < 3) return;

  const triangulated = triangulate(rings);
  if (triangulated.indices.length === 0) return;

  addTopSurface(builder, triangulated, groundAt, wallHeightM);

  // BOUNDARY WALL, around every ring including the holes — a hole's edge is just
  // as much a boundary of the region as its outside.
  for (const ring of rings) {
    if (ring.length < 3) continue;
    addWall(builder, ring, groundAt, wallHeightM);
  }
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
  wallHeightM: number,
): void {
  const top = triangulated.vertices.map((point) =>
    builder.vertex(point.x, groundAt(point) + wallHeightM, point.y, 0, 1, 0),
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

/** A vertical quad strip around one ring. */
function addWall(
  builder: MeshBuilder,
  ring: readonly EnuPoint[],
  groundAt: (point: EnuPoint) => number,
  wallHeightM: number,
): void {
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    // A closing point repeats the first, so the last segment is zero-length.
    // Its normal would be 0/0.
    if (length < 1e-9) continue;
    const nx = dy / length;
    const ny = -dx / length;

    const aGround = groundAt(a);
    const bGround = groundAt(b);
    const a0 = builder.vertex(a.x, aGround, a.y, nx, 0, ny);
    const a1 = builder.vertex(a.x, aGround + wallHeightM, a.y, nx, 0, ny);
    const b0 = builder.vertex(b.x, bGround, b.y, nx, 0, ny);
    const b1 = builder.vertex(b.x, bGround + wallHeightM, b.y, nx, 0, ny);
    builder.triangle(a0, b0, a1);
    builder.triangle(a1, b0, b1);
  }
}
