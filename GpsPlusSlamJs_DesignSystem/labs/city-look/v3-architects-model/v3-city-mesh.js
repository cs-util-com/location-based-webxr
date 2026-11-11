/**
 * V3's buildings: the library's volumes built from V3's tags, an inferred roof
 * sheet where the rules allow one, merged per chunk with the metres and tones
 * the model shader reads. All of it happens once, at load.
 *
 * @see v3-city-mesh.js.md
 */
import { chunkKeyFor, meshCentroidEnu } from "/osm-lib/mesh/chunk-meshes.js";
import { mergeMeshes } from "/osm-lib/mesh/extrude.js";
import { featureKey } from "/osm-lib/model/osm-feature.js";
import { geometryFrom } from "/osm-lib/three/index.js";

import {
  footprintArea,
  lookFor,
  roofPlanFor,
  storeyFor,
  tagsForMesh,
} from "./v3-model-rules.js";
import { roofShell } from "./v3-roof-shell.js";
import { wallSpans } from "./v3-wall-span.js";

const OVERHANG_M = 0.45;
const SHEET_M = 0.22;
/** Barriers carry no tags worth reading: a card wall with no lines. */
const BARRIER_LOOK = lookFor({});

/** A way's outer ring in ENU metres; null for anything without one. */
function enuRing(feature, frame) {
  if (!Array.isArray(feature.geometry) || feature.geometry.length < 3) {
    return null;
  }
  return feature.geometry.map((point) => frame.toEnu(point));
}

/** V3's feature list and the roofs it decided on, keyed by `featureKey`. */
function planCity(features, { frame, seededRandom }, tolerance) {
  const plans = new Map();
  const adjusted = features.map((feature) => {
    const ring = enuRing(feature, frame);
    if (ring === null || feature.tags?.building === undefined) return feature;
    const key = featureKey(feature);
    const random = seededRandom(key);
    const plan = roofPlanFor(feature, ring, { random, tolerance });
    if (plan !== null) plans.set(key, plan);
    const tags = tagsForMesh(feature.tags, footprintArea(ring));
    return tags === feature.tags ? feature : { ...feature, tags };
  });
  return { adjusted, plans };
}

function lowestY(mesh) {
  let low = Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    low = Math.min(low, mesh.positions[i]);
  }
  return low;
}

/** One volume, and its roof sheet if it has one, as pieces of a chunk. */
function piecesOfVolume(volume, featureByKey, plans) {
  const tags = featureByKey.get(volume.feature)?.tags ?? {};
  const parent = volume.parentFeature
    ? featureByKey.get(volume.parentFeature)?.tags
    : undefined;
  const look = lookFor(tags, parent);
  const { minHeightM, eaveHeightM } = volume.heights;
  const { storeyM } = storeyFor(tags, { minHeightM, eaveHeightM });
  const baseY = lowestY(volume.mesh);
  const eaveY = baseY + (eaveHeightM - minHeightM);
  const piece = { look, baseY, eaveY, storeyM };
  const pieces = [{ ...piece, mesh: volume.mesh }];
  const plan = volume.parentFeature ? undefined : plans.get(volume.feature);
  if (plan) {
    const mesh = roofShell({
      ...plan,
      eaveY,
      overhangM: OVERHANG_M,
      thicknessM: SHEET_M,
    });
    pieces.push({ ...piece, mesh, roofFlags: mesh.roofFlags });
  }
  return pieces;
}

function chunksOf(volumes, barriers, featureByKey, plans) {
  const chunks = new Map();
  const place = (mesh, pieces) => {
    const key = chunkKeyFor(meshCentroidEnu(mesh));
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(...pieces);
  };
  for (const volume of volumes) {
    place(volume.mesh, piecesOfVolume(volume, featureByKey, plans));
  }
  for (const { mesh } of barriers) {
    const baseY = lowestY(mesh);
    place(mesh, [
      { mesh, look: BARRIER_LOOK, baseY, eaveY: baseY, storeyM: 0 },
    ]);
  }
  return chunks;
}

/** The per-vertex arrays of a chunk, in `mergeMeshes` order. */
function attributesOf(pieces, vertexCount) {
  const color = new Float32Array(vertexCount * 3);
  const roofTint = new Float32Array(vertexCount * 3);
  const finish = new Float32Array(vertexCount * 2);
  const storey = new Float32Array(vertexCount * 3);
  const shell = new Float32Array(vertexCount);
  const span = new Float32Array(vertexCount * 2);
  let v = 0;
  for (const { mesh, look, baseY, eaveY, storeyM, roofFlags } of pieces) {
    const count = mesh.positions.length / 3;
    if (!roofFlags) span.set(wallSpans(mesh), v * 2);
    for (let i = 0; i < count; i++, v++) {
      color.set(look.wall, v * 3);
      roofTint.set(look.roof, v * 3);
      finish.set([look.wallFinish, look.roofFinish], v * 2);
      storey.set([baseY, storeyM, eaveY], v * 3);
      shell[v] = roofFlags ? roofFlags[i] : 0;
    }
  }
  return { color, roofTint, finish, storey, shell, span };
}

function chunkObject(pieces, material, THREE) {
  const merged = mergeMeshes(pieces.map((piece) => piece.mesh));
  const data = attributesOf(pieces, merged.positions.length / 3);
  const geometry = geometryFrom(merged, data.color);
  const attribute = (array, size) => new THREE.BufferAttribute(array, size);
  geometry.setAttribute("aRoofTint", attribute(data.roofTint, 3));
  geometry.setAttribute("aFinish", attribute(data.finish, 2));
  geometry.setAttribute("aStorey", attribute(data.storey, 3));
  geometry.setAttribute("aRoofShell", attribute(data.shell, 1));
  geometry.setAttribute("aWallSpan", attribute(data.span, 2));
  const object = new THREE.Mesh(geometry, material);
  object.userData.solid = true;
  return object;
}

/**
 * The model city as `THREE.Mesh`es, one per chunk, sharing `material`. `ctx` is
 * the harness's variant context; `tolerance` the footprint fit's (see
 * `ROOF_TOLERANCE`).
 */
export function buildModelCity(features, ctx, { material, tolerance }) {
  const { adjusted, plans } = planCity(features, ctx, tolerance);
  const city = ctx.buildCity(adjusted, ctx.ground, {
    window: ctx.fixture.bbox,
    cosmeticTrees: false,
    // The variant shapes its own roofs; the library's would stack on them.
    inventedRoofs: false,
  });
  const chunks = chunksOf(city.volumes, city.barriers, ctx.featureByKey, plans);
  return [...chunks.values()].map((pieces) =>
    chunkObject(pieces, material, ctx.THREE),
  );
}
