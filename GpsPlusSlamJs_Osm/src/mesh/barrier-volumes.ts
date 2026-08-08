/**
 * Barriers → drawn volumes. The half of DEC-R11-2 that had never shipped.
 *
 * `barriers.ts` has known how tall a wall is and `barrier-shape.ts` what ground
 * it covers since #259, and `nav/obstacles.ts` has been blocking agents with
 * both ever since — with nothing on screen. **DEC-R7b-14 and DEC-R11-2 are
 * explicit that this is not acceptable**: an NPC pathing around geometry the
 * viewer cannot see demonstrates nothing, and the Tower currently renders
 * without its curtain wall at all.
 *
 * **The centreline comes from `barrierCentrelines`, not from a local copy.**
 * The index and the drawing must agree exactly — a wall drawn where nothing is
 * indexed lets an agent walk through something visible, and a wall indexed where
 * nothing is drawn produces a detour around thin air. Both would be diagnosed in
 * the wrong file.
 *
 * **One extrusion per SEGMENT, not per way**, which follows from
 * `barrierFootprints` emitting one quad per segment — and it buys the terrain
 * sampling for free: each quad stands on the ground under its own midpoint, so a
 * wall running up a hill follows it. One sample per feature is the artefact
 * `buildings.ts` records (W5, R3-1) as having torn Cologne Cathedral's spires
 * off the model, and a curtain wall is far longer than a cathedral is wide.
 *
 * @see barrier-volumes.ts.md
 */

import type {
  LatLng,
  OsmFeature,
  OsmFeatureKey,
} from "../model/osm-feature.js";
import { featureKey } from "../model/osm-feature.js";
import { barrierFootprints } from "./barrier-shape.js";
import { gateOpenings } from "./barrier-gates.js";
import {
  barrierCentrelines,
  isSolidBarrier,
  resolveBarrier,
} from "./barriers.js";
import type { EnuFrame } from "./enu.js";
import { extrudeBuilding, mergeMeshes } from "./extrude.js";
import type { MeshData } from "./mesh-data.js";

/** One drawn barrier, with the provenance to trace it back to OSM. */
export interface BarrierVolume {
  readonly feature: OsmFeatureKey;
  /**
   * The height the volume was extruded to, metres above the ground under it.
   *
   * **The same number `nav/obstacles.ts` indexes**, and carried so a consumer
   * can check that rather than trust it. A drawn wall and an indexed wall that
   * disagreed would show an agent detouring around nothing.
   */
  readonly heightM: number;
  readonly mesh: MeshData;
}

export interface BuildBarriersOptions {
  readonly frame: EnuFrame;
  /** Ground elevation per position, metres. Defaults to 0 everywhere. */
  readonly groundHeightM?: (position: LatLng) => number;
}

/** Midpoint of two lat/lng positions, good enough at segment scale. */
function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

/**
 * One line's worth of extruded segments.
 *
 * ONE SEGMENT AT A TIME, so the quad and the ground sample under it are the
 * same segment — that is what makes a wall follow a hillside instead of being
 * buried at one end. `barrierFootprints` drops degenerate segments, so a
 * repeated node yields no quad and no sample is wasted on it.
 */
function extrudeLine(
  line: readonly LatLng[],
  frame: EnuFrame,
  { heightM, thicknessM }: { heightM: number; thicknessM: number },
  groundAt: (position: LatLng) => number,
): MeshData[] {
  const meshes: MeshData[] = [];

  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const quads = barrierFootprints(
      [frame.toEnu(a), frame.toEnu(b)],
      thicknessM,
    );
    if (quads.length === 0) continue;

    const ground = groundAt(midpoint(a, b));
    for (const quad of quads) {
      meshes.push(
        extrudeBuilding([quad], {
          minHeightM: 0,
          eaveHeightM: heightM,
          totalHeightM: heightM,
          // FLAT, ALWAYS. `roofShape` on a wall is not a tagging question — a
          // 0.5 m-wide quad has no roof form worth generating, and a gable on
          // it would be a ridge nobody mapped.
          roofShape: "flat",
          // A NON-FINITE SAMPLE FALLS BACK TO ZERO rather than propagating.
          // `NaN` vertices reach three.js, which draws nothing and reports no
          // error — a wall that silently does not exist.
          groundHeightM: Number.isFinite(ground) ? ground : 0,
        }),
      );
    }
  }

  return meshes;
}

/**
 * Extrudes every solid barrier in `features` into a volume.
 *
 * Features that are not solid barriers are ignored, and a barrier whose geometry
 * cannot form a line is skipped rather than throwing — a one-node way and an
 * empty way are both ordinary Overpass output. Same contract as
 * `buildBuildings`.
 */
export function buildBarriers(
  features: Iterable<OsmFeature>,
  options: BuildBarriersOptions,
): BarrierVolume[] {
  const groundAt = options.groundHeightM ?? (() => 0);
  const volumes: BarrierVolume[] = [];
  // MATERIALISED, because `features` is an `Iterable` and the gate pass has to
  // read all of it before the barrier pass can use the result.
  const all = [...features];
  // THE SAME GATES `nav/obstacles.ts` BUILDS, from the same feature set
  // (DEC-R12-1). Both derive it rather than share an instance, and both are
  // handed the same list by their caller — so what is drawn and what is indexed
  // open in the same places, which is the property stage 3 established.
  const gates = gateOpenings(all);

  for (const feature of all) {
    if (!isSolidBarrier(feature)) continue;

    const lines = barrierCentrelines(feature, gates);
    if (lines.length === 0) continue;

    const dimensions = resolveBarrier(feature.tags);
    const meshes = lines.flatMap((line) =>
      extrudeLine(line, options.frame, dimensions, groundAt),
    );

    // A barrier whose every segment was degenerate produces no volume rather
    // than an empty one — an empty mesh in the scene is still a draw call and a
    // disposal obligation, which is the rule `chunkMeshes` already follows.
    if (meshes.length === 0) continue;

    volumes.push({
      feature: featureKey(feature),
      heightM: dimensions.heightM,
      // ONE MESH PER FEATURE, not per segment: the demo colours and chunks by
      // feature, and a hundred one-quad meshes would be a hundred entries
      // carrying the same key.
      mesh: mergeMeshes(meshes),
    });
  }

  return volumes;
}
