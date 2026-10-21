/**
 * The city a renderer draws: buildings (with their parts and the barriers
 * drawn among them), coloured per feature and chunked for culling, the
 * trees, and on request the roads and paths.
 *
 * WHY IT IS HERE. OsmDemo's worker assembled this inline from this package's
 * builders. When the globe lab became the package's second consumer (globe
 * city plan 2026-10-05-0040 §14 L3), the assembly was the part both needed,
 * so it moved here: the tag inheritance of `building:part`, the colours, the
 * stable shell phase and the chunking now live once. The roads followed
 * (round-4 plan 2026-10-11-0122 DEC-R4-7: the owner asked for the globe's
 * city to draw what OsmDemo draws). Plates, region slabs, POI markers and
 * the cell grid stay with OsmDemo, which draws them around this.
 *
 * @see city.ts.md
 */

import {
  featureKey,
  type LatLng,
  type OsmFeature,
} from "../model/osm-feature.js";
import { buildBarriers, type BarrierVolume } from "./barrier-volumes.js";
import { buildBuildings, type BuildingVolume } from "./buildings.js";
import {
  chunkMeshes,
  meshCentroidEnu,
  type MeshChunk,
} from "./chunk-meshes.js";
import type { EnuFrame, EnuPoint } from "./enu.js";
import { buildingColour, roadColour } from "./feature-colours.js";
import { buildRoads } from "./roads.js";
import { shellRandFor } from "./shell-rand.js";
import { buildTrees, type TreePlacement } from "./trees.js";

/** Where the city is built: its frame and the ground under it. */
export interface CityGround {
  readonly frame: EnuFrame;
  /** Ground elevation at a position, metres. Absent: flat at 0. */
  readonly groundHeightM?: (position: LatLng) => number;
}

/**
 * How much of the city is kept. `withinM`: only volumes, barriers and trees
 * whose own position (a mesh's centroid, a tree's placement) lies within
 * this many metres of the frame's origin in both directions, because a
 * height field covers a window and clamps its edge heights outward beyond it
 * (globe city plan 2026-10-05-0040 §12.4 R12). Absent: everything is kept.
 */
export interface CityOptions {
  readonly withinM?: number;
  /**
   * Also build the roads and paths (`buildRoads`: ribbons draped per vertex
   * on the ground, tunnels and highway areas left out), chunked and
   * coloured by class and surface (`roadColour`). Default false: a
   * consumer that draws none builds none.
   */
  readonly roads?: boolean;
}

/** What `buildCity` returns. */
export interface City {
  /** Every building volume (parts in place of their outlines). */
  readonly volumes: readonly BuildingVolume[];
  /** The barriers, drawn with the buildings. */
  readonly barriers: readonly BarrierVolume[];
  /**
   * Volumes and barriers merged per chunk, with a colour per vertex and the
   * shell attributes (`featureRand`, `height01`).
   */
  readonly buildings: readonly MeshChunk[];
  /** One placement per `natural=tree` node. */
  readonly trees: readonly TreePlacement[];
  /**
   * The road and path ribbons merged per chunk, a colour per vertex; empty
   * unless `roads` was asked for.
   */
  readonly roads: readonly MeshChunk[];
  /** Road and path ways built (0 unless asked for). */
  readonly roadCount: number;
}

/**
 * The ground for a frame: the field's height at a position's ENU metres, or
 * flat when there is no field. ONE derivation, so every layer a consumer
 * builds stands on the same surface (two copies of it once put two layers on
 * two surfaces in OsmDemo).
 */
export function cityGround(
  frame: EnuFrame,
  field: { heightAt(point: EnuPoint): number } | undefined,
): CityGround {
  if (field === undefined) return { frame };
  return {
    frame,
    groundHeightM: (position: LatLng) => field.heightAt(frame.toEnu(position)),
  };
}

/**
 * Builds the city in `features` on `ground`, within `options.withinM` when
 * given. Features that are not buildings, barriers or trees are ignored; a
 * feature whose geometry cannot be built is skipped (the builders'
 * contract). RangeError for a `withinM` that is not a positive number.
 */
export function buildCity(
  features: Iterable<OsmFeature>,
  ground: CityGround,
  options: CityOptions = {},
): City {
  const { withinM } = options;
  if (withinM !== undefined && !(withinM > 0)) {
    throw new RangeError(`withinM must be a positive number, got ${withinM}`);
  }
  const inside = (p: EnuPoint): boolean =>
    withinM === undefined ||
    (Math.abs(p.x) <= withinM && Math.abs(p.y) <= withinM);
  const all = [...features];
  const volumes = buildBuildings(all, ground).filter((v) =>
    inside(meshCentroidEnu(v.mesh)),
  );
  const barriers = buildBarriers(all, ground).filter((b) =>
    inside(meshCentroidEnu(b.mesh)),
  );
  const trees = buildTrees(all, ground).filter((t) => inside(t.position));
  // TAGS BY KEY: the builders return a feature key, not the tags.
  const tagsByKey = new Map(
    all.map((feature) => [featureKey(feature), feature.tags]),
  );
  // A `building:part` takes its PARENT's tags for its colour: the parts of
  // one building are one building, and colouring them independently would
  // stripe a cathedral by whichever part carried which tag. A barrier has no
  // parent and is simply itself.
  const drawn = [
    ...volumes.map((volume) => ({
      mesh: volume.mesh,
      tags:
        tagsByKey.get(volume.parentFeature ?? volume.feature) ??
        tagsByKey.get(volume.feature) ??
        {},
    })),
    ...barriers.map((barrier) => ({
      mesh: barrier.mesh,
      tags: tagsByKey.get(barrier.feature) ?? {},
    })),
  ];
  const buildings = chunkMeshes(
    drawn,
    (item) => item.mesh,
    (item) => meshCentroidEnu(item.mesh),
    undefined,
    (item) => buildingColour(item.tags),
    // The shell shader's phase, from the feature's own geometry, so it is
    // stable across rebuilds (an index would re-shuffle on every refresh).
    (item) => shellRandFor(item.mesh),
  );
  const { roads, roadCount } = options.roads
    ? cityRoads(all, ground, inside, tagsByKey)
    : { roads: [], roadCount: 0 };
  return { volumes, barriers, buildings, trees, roads, roadCount };
}

/**
 * The roads of a city, within its window, merged per chunk with a colour
 * per vertex (class and surface, `roadColour`). OsmDemo's worker did this
 * inline until the globe needed the same (round-4 plan 2026-10-11-0122).
 */
function cityRoads(
  all: readonly OsmFeature[],
  ground: CityGround,
  inside: (p: EnuPoint) => boolean,
  tagsByKey: ReadonlyMap<string, OsmFeature["tags"]>,
): { roads: MeshChunk[]; roadCount: number } {
  const ribbons = buildRoads(all, ground).filter((road) =>
    inside(meshCentroidEnu(road.mesh)),
  );
  return {
    roads: chunkMeshes(
      ribbons,
      (road) => road.mesh,
      (road) => meshCentroidEnu(road.mesh),
      undefined,
      (road) => roadColour(tagsByKey.get(road.feature) ?? {}),
    ),
    roadCount: ribbons.length,
  };
}
