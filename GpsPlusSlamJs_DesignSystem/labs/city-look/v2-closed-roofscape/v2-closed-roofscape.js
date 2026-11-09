/**
 * V2: every low house without a roof tag gets a roof that fits its real
 * footprint, a seeded height and a muted seeded palette; tagged buildings stay
 * exactly as today. One extra mesh on top of today's buildings.
 *
 * @see v2-closed-roofscape.js.md
 */
import { isBuilding, isBuildingPart } from "/osm-lib/mesh/building-heights.js";
import { ringToEnu } from "/osm-lib/mesh/enu.js";
import { isBelowSurface } from "/osm-lib/model/below-surface.js";
import { featureKey } from "/osm-lib/model/osm-feature.js";
import { toGeometry } from "/osm-lib/model/osm-geometry.js";

import { appendHouse } from "./house-shell.js";
import { PARAMS, planCity } from "./roofscape-rules.js";

const SIMPLIFY_KEY = "tolerance";

/** A ring without its repeated closing point and its near-duplicate corners. */
function cleanRing(ring) {
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.05) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 0.05) {
    out.pop();
  }
  return out;
}

/** The rings of a building's first polygon, in local metres, or null. */
function ringsOf(feature, frame) {
  const result = toGeometry(feature);
  if (!result.ok) return null;
  const { geometry } = result;
  const rings =
    geometry.kind === "polygon"
      ? geometry.rings
      : geometry.kind === "multipolygon"
        ? geometry.polygons[0]
        : null;
  if (!rings || rings.length === 0) return null;
  return rings
    .map((ring) => cleanRing(ringToEnu(ring, frame)))
    .filter((ring) => ring.length >= 3);
}

function plannerEntries(features, frame) {
  const entries = [];
  for (const feature of features) {
    if (!isBuilding(feature) && !isBuildingPart(feature)) continue;
    const rings = ringsOf(feature, frame);
    if (!rings || rings.length === 0) continue;
    entries.push({
      key: featureKey(feature),
      tags: feature.tags,
      rings,
      belowSurface: isBelowSurface(feature),
    });
  }
  return entries;
}

function makeTools(THREE) {
  const triangulate = (contour, holes) =>
    THREE.ShapeUtils.triangulateShape(
      contour.map((p) => new THREE.Vector2(p.x, p.y)),
      holes.map((ring) => ring.map((p) => new THREE.Vector2(p.x, p.y))),
    );
  const cache = new Map();
  const rgb = (css) => {
    let value = cache.get(css);
    if (!value) {
      const colour = new THREE.Color(css);
      value = [colour.r, colour.g, colour.b];
      cache.set(css, value);
    }
    return value;
  };
  return { triangulate, rgb };
}

function roofscapeMesh(plans, tools, THREE) {
  const sink = { positions: [], colours: [] };
  for (const plan of plans) appendHouse(plan, sink, tools);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(sink.positions, 3),
  );
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(sink.colours, 3),
  );
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.82,
    metalness: 0,
  });
  return new THREE.Mesh(geometry, material);
}

/** Every triangle of `objects` as text: world position and colour. */
function triangleKeys(objects) {
  const keys = [];
  for (const object of objects) {
    object.updateMatrixWorld(true);
    const { index, attributes } = object.geometry;
    const count = index ? index.count : attributes.position.count;
    const corner = (i) => {
      const at = index ? index.getX(i) : i;
      const x = attributes.position.getX(at) + object.position.x;
      const y = attributes.position.getY(at) + object.position.y;
      const z = attributes.position.getZ(at) + object.position.z;
      const red = attributes.color ? attributes.color.getX(at) : 1;
      return [x, y, z, red].map((n) => n.toFixed(3)).join(",");
    };
    for (let i = 0; i < count; i += 3) {
      keys.push([corner(i), corner(i + 1), corner(i + 2)].sort().join("|"));
    }
  }
  return keys;
}

/** How many kept triangles differ from today's: the promise, measured. */
function changedTriangles(kept, today) {
  const known = new Set(triangleKeys(today));
  return triangleKeys(kept).filter((key) => !known.has(key)).length;
}

function buildingsFor(features, ctx) {
  const tools = makeTools(ctx.THREE);
  const search = new URLSearchParams(location.search);
  const limit = Number(search.get("limit")) || PARAMS.heightLimitM;
  const tolerance =
    Number(search.get(SIMPLIFY_KEY)) || PARAMS.simplifyToleranceM;
  const started = performance.now();
  const { plans, counts } = planCity(plannerEntries(features, ctx.frame), {
    triangulate: tools.triangulate,
    heightLimitM: limit,
    simplifyToleranceM: tolerance,
    refusals: search.get("prior") !== "off",
  });
  const planMs = performance.now() - started;
  window.__roofscape = { counts, planMs };

  const replaced = new Set(plans.map((plan) => plan.key));
  const kept = features.filter((feature) => !replaced.has(featureKey(feature)));
  const { buildings } = ctx.buildCity(kept, ctx.ground, {
    roads: false,
    window: ctx.fixture.bbox,
    cosmeticTrees: false,
  });
  const objects = ctx.buildingObjects(buildings);
  const list = Array.isArray(objects) ? objects : [objects];
  if (search.has("audit")) {
    window.__roofscape.keptChanged = changedTriangles(
      list,
      [ctx.buildingObjects(ctx.city.buildings)].flat(),
    );
    window.__roofscape.keptTriangles = triangleKeys(list).length;
  }
  return [...list, roofscapeMesh(plans, tools, ctx.THREE)];
}

/**
 * V2 as a variant, so a later round can build on its buildings and add its
 * own objects; `v2-page.js` starts the V2 page with it.
 */
export const v2Variant = Object.freeze({
  id: "v2",
  label: "V2 closed roofscape",
  postprocess: "gtao",
  buildingsFor,
});
