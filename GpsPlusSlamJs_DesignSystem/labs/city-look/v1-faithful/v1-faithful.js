/**
 * V1 faithful: pitched roofs only where a footprint really fits a rectangle,
 * colour read from tags and class, narrow class heights for untagged houses,
 * GTAO. Everything a tag states is left as the library built it.
 *
 * @see v1-faithful.js.md
 */
import { startCityLook } from "../city-look-harness.js";
import { chunkKeyFor, meshCentroidEnu } from "/osm-lib/mesh/chunk-meshes.js";
import { buildingColour } from "/osm-lib/mesh/feature-colours.js";
import { toGeometry } from "/osm-lib/model/osm-geometry.js";

import {
  fitRectangle,
  guessedEaveM,
  houseMesh,
  leftAlone,
  linearRgb,
  mergeParts,
  paintByNormal,
  parseV1Params,
  ringArea,
  roofColour,
  roofPlan,
  scaleHeights,
  wallColour,
} from "./v1-faithful-model.js";

const SWEEP_TOLERANCES = [0.02, 0.05, 0.1];
const SOFFIT_SHARE = 0.72;

const look = parseV1Params(location.search);

function ringCount(feature) {
  const geometry = toGeometry(feature);
  if (!geometry.ok) return 1;
  if (geometry.geometry.kind === "polygon")
    return geometry.geometry.rings.length;
  if (geometry.geometry.kind === "multipolygon") {
    return geometry.geometry.polygons[0]?.length ?? 1;
  }
  return 1;
}

/** One volume as a part to merge: inferred, rescaled, or only repainted. */
function volumePart(volume, ctx, stats) {
  const feature = ctx.featureByKey.get(volume.feature);
  const tags = feature?.tags ?? {};
  const parent = volume.parentFeature
    ? (ctx.featureByKey.get(volume.parentFeature)?.tags ?? {})
    : {};
  const key = volume.feature;
  const facts = {
    ring: volume.footprint,
    isPart: volume.parentFeature !== undefined,
    hasHoles: feature ? ringCount(feature) > 1 : true,
  };
  stats.note(tags, facts);

  const plan = roofPlan(tags, facts, look);
  const wall = linearRgb(wallColour(tags, parent, key, look));
  const pitched = plan !== null || volume.heights.roofShape !== "flat";
  const roof = linearRgb(roofColour(tags, parent, key, pitched, look));
  const eaveM = guessedEaveM(tags, ringArea(volume.footprint), key, look);

  if (plan) {
    stats.roofed[plan.shape] += 1;
    return houseMesh(volume.footprint, {
      ...plan,
      eaveM,
      baseM: 0,
      colours: { wall, roof, soffit: wall.map((v) => v * SOFFIT_SHARE) },
    });
  }
  const scale = eaveM !== null && volume.heights.heightIsGuessed;
  return {
    positions: scale
      ? scaleHeights(volume.mesh.positions, eaveM / volume.heights.eaveHeightM)
      : volume.mesh.positions,
    normals: volume.mesh.normals,
    colours: paintByNormal(volume.mesh.normals, wall, roof),
    indices: volume.mesh.indices,
  };
}

/** Counts what the rectangle tolerance changes, for the report's sweep. */
function sweepStats() {
  const fits = Object.fromEntries(SWEEP_TOLERANCES.map((t) => [t, 0]));
  const stats = {
    candidates: 0,
    fits,
    roofed: { gabled: 0, hipped: 0 },
    note(tags, facts) {
      if (leftAlone(tags) || facts.isPart || facts.hasHoles) return;
      stats.candidates += 1;
      for (const tolerance of SWEEP_TOLERANCES) {
        if (fitRectangle(facts.ring, tolerance).fits) fits[tolerance] += 1;
      }
    },
  };
  return stats;
}

function buildingsFor(features, ctx) {
  const { THREE, city, geometryFrom } = ctx;
  const stats = sweepStats();
  const chunks = new Map();
  const add = (mesh, part) => {
    const key = chunkKeyFor(meshCentroidEnu(mesh));
    chunks.set(key, [...(chunks.get(key) ?? []), part]);
  };
  for (const volume of city.volumes) {
    if (volume.mesh.triangleCount > 0) {
      add(volume.mesh, volumePart(volume, ctx, stats));
    }
  }
  for (const barrier of city.barriers) {
    if (barrier.mesh.triangleCount === 0) continue;
    const tags = ctx.featureByKey.get(barrier.feature)?.tags ?? {};
    const colour = linearRgb(buildingColour(tags));
    add(barrier.mesh, {
      ...barrier.mesh,
      colours: paintByNormal(barrier.mesh.normals, colour, colour),
    });
  }
  window.__cityLookV1 = {
    scene: ctx.fixture.name,
    params: look,
    candidates: stats.candidates,
    fits: stats.fits,
    roofed: stats.roofed,
  };
  return [...chunks.values()].map((parts) => {
    const { colours, ...mesh } = mergeParts(parts);
    return new THREE.Mesh(
      geometryFrom(mesh, colours),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.FrontSide,
        flatShading: true,
        roughness: 0.85,
        metalness: 0,
      }),
    );
  });
}

startCityLook({
  id: "v1",
  label: "V1 faithful",
  postprocess: look.ao ? "gtao" : undefined,
  buildingsFor,
});
