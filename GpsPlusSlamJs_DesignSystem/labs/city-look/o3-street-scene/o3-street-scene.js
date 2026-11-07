/**
 * O3 "street scene" on V2's buildings: its own roads (the vertex disc dropped
 * at near-straight points only, sidewalks lighter than paths, muted kerb
 * edges), zebra stripes where mapped, and street lamps, benches, bins and
 * bollards from mapped nodes, instanced, drawn only near the eye.
 *
 * @see o3-street-scene.js.md
 */
import { roadWidthM } from "/osm-lib/mesh/roads.js";
import { roadColour } from "/osm-lib/mesh/feature-colours.js";
import { poiModelFor } from "/osm-lib/mesh/poi-models.js";
import {
  composed,
  postWithHead,
  prism,
  box,
} from "/osm-lib/mesh/poi-primitives.js";
import { featureKey } from "/osm-lib/model/osm-feature.js";
import { toGeometry } from "/osm-lib/model/osm-geometry.js";
import { ringToEnu } from "/osm-lib/mesh/enu.js";

import { v2Variant } from "../v2-closed-roofscape/v2-closed-roofscape.js";
import {
  FURNITURE_PARAMS,
  furnitureOf,
  isZebraTags,
  nearWithin,
  zebraStripes,
} from "./street-objects.js";
import {
  ROAD_PARAMS,
  buildRibbons,
  isStreetWay,
  pushTriangle,
  rankOf,
  rgbOf,
  streetColour,
} from "./street-roads.js";

/** The page's own settings, from the link: `?joins=&gap=&edges=&marks=&cut=`. */
const SETTINGS = {
  joins: { values: [0, 5, 10, 15, 30], fallback: ROAD_PARAMS.straightDeg },
  /** The widest notch a dropped disc may open, centimetres; 0 is no limit. */
  gap: { values: [0, 5, 10, 25], fallback: 10 },
  edges: { values: [0, 1], fallback: 1 },
  marks: { values: [0, 1], fallback: 1 },
  cut: { values: [40, 80, 150, 0], fallback: FURNITURE_PARAMS.cutM },
};

/** The thresholds the page measures on every load, whatever it draws. */
const SWEEP_DEG = [0, 2, 5, 10, 15, 20, 30];
const SWEEP_GAP_CM = [0, 5, 10, 25];

/** Mapped pedestrian areas (squares) a person stands on, drawn flat. */
const AREA_Y = 0.004;

const MARK_Y = 0.1;
const MARK_RGB = 0xd6d3ca;
const EDGE_DARKEN = 0.24;
const LAMP_RGB = 0x5a6167;
const BOLLARD_RGB = 0x676d73;
/** Re-pick the near items once the eye has moved this far. */
const REPACK_M = 4;

function readSettings() {
  const params = new URLSearchParams(location.search);
  const out = {};
  for (const [name, { values, fallback }] of Object.entries(SETTINGS)) {
    const value = Number(params.get(name));
    out[name] = params.has(name) && values.includes(value) ? value : fallback;
  }
  return out;
}

const settings = readSettings();

/** Ways as the pure builders read them: `{ key, tags, points }` in ENU. */
function streetWays(features, frame) {
  return features.filter(isStreetWay).map((f) => ({
    key: featureKey(f),
    tags: f.tags,
    points: f.geometry.map((p) => frame.toEnu(p)),
  }));
}

function triangleTotal(chunks) {
  return chunks.reduce((sum, c) => sum + c.mesh.indices.length / 3, 0);
}

/** The road material: today's, plus the kerb edge read from `aStreet`. */
function roadMaterial(THREE, edges) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.9,
    side: THREE.FrontSide,
  });
  if (!edges) return material;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec3 aStreet;\nvarying vec3 vStreet;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvStreet = aStreet;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vStreet;")
      .replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "float edgeDist = vStreet.y - abs(vStreet.x);",
          "float kerb = vStreet.z > 0.0 ? 1.0 - smoothstep(0.0, vStreet.z, edgeDist) : 0.0;",
          `diffuseColor.rgb *= 1.0 - ${EDGE_DARKEN.toFixed(3)} * kerb;`,
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => "o3-road-edges";
  return material;
}

/** Zebra stripes as triangles in the road arrays' layout. */
function markArrays(stripes) {
  const out = { positions: [], colours: [], street: [] };
  const rgb = rgbOf(MARK_RGB);
  for (const s of stripes) {
    const dx = s.uy;
    const dy = -s.ux;
    const corner = (u, v) => [
      s.cx + s.ux * u * (s.lengthM / 2) + dx * v * (s.widthM / 2),
      s.cy + s.uy * u * (s.lengthM / 2) + dy * v * (s.widthM / 2),
      MARK_Y,
      0,
      100,
      0,
    ];
    pushTriangle(out, rgb, corner(-1, -1), corner(1, -1), corner(1, 1));
    pushTriangle(out, rgb, corner(-1, -1), corner(1, 1), corner(-1, 1));
  }
  return out;
}

/**
 * Mapped pedestrian areas (`highway=pedestrian` and the like with
 * `area=yes`), which `roads.ts` leaves to the plate builder and the lab never
 * draws: Heidelberg's street camera stands on one. Flat, under every ribbon,
 * in the way's class colour (the class wins). Returns how many were drawn.
 */
function appendPedestrianAreas(out, features, frame, THREE) {
  let drawn = 0;
  for (const feature of features) {
    const tags = feature.tags ?? {};
    if (feature.type === "node" || !tags.highway || tags.area !== "yes")
      continue;
    const result = toGeometry(feature);
    if (!result.ok) continue;
    const { geometry } = result;
    const polygons =
      geometry.kind === "polygon"
        ? [geometry.rings]
        : geometry.kind === "multipolygon"
          ? geometry.polygons
          : [];
    const rgb = rgbOf(streetColour(tags, roadColour(tags)));
    for (const rings of polygons) {
      const enu = rings.map((ring) => ringToEnu(ring, frame));
      if (enu.length === 0 || enu[0].length < 3) continue;
      const v2 = (ring) => ring.map((p) => new THREE.Vector2(p.x, p.y));
      const [outer, ...holes] = enu;
      const all = enu.flat();
      const faces = THREE.ShapeUtils.triangulateShape(v2(outer), holes.map(v2));
      const at = (i) => [all[i].x, all[i].y, AREA_Y, 0, 100, 0];
      for (const [a, b, c] of faces)
        pushTriangle(out, rgb, at(a), at(b), at(c));
      drawn += 1;
    }
  }
  return drawn;
}

function concat(a, b) {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function roadMesh(THREE, built, marks, edges) {
  const geometry = new THREE.BufferGeometry();
  const join = (key) => concat(built[key], Float32Array.from(marks[key]));
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(join("positions"), 3),
  );
  geometry.setAttribute("color", new THREE.BufferAttribute(join("colours"), 3));
  geometry.setAttribute(
    "aStreet",
    new THREE.BufferAttribute(join("street"), 3),
  );
  const count = geometry.getAttribute("position").count;
  const normals = new Float32Array(count * 3);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  const mesh = new THREE.Mesh(geometry, roadMaterial(THREE, edges));
  mesh.userData.cityLayer = "roads";
  return mesh;
}

/** One model per furniture kind: geometry, colour, the height it is built at. */
function furnitureModels(THREE, geometryFrom) {
  const own = (build, colour, heightM) => {
    const data = composed(build);
    return {
      geometry: geometryFrom(data),
      colour,
      heightM,
      vertexColours: false,
    };
  };
  const library = (kind) => {
    const model = poiModelFor(kind);
    if (!model) throw new Error(`no library model for ${kind}`);
    return {
      geometry: geometryFrom(model.mesh, model.mesh.colours),
      colour: model.colour,
      heightM: null,
      vertexColours: model.mesh.colours !== undefined,
    };
  };
  const L = FURNITURE_PARAMS;
  return {
    lamp: own(
      (b) => postWithHead(b, L.lampHeightM, 0.07, 0.36, 0.16),
      LAMP_RGB,
      L.lampHeightM,
    ),
    "lamp-wall": own(
      (b) => box(b, 0.32, 0.16, 0.32, L.wallLampHeightM - 0.16),
      LAMP_RGB,
      L.wallLampHeightM,
    ),
    "lamp-suspended": own(
      (b) => box(b, 0.4, 0.16, 0.4, L.suspendedLampHeightM - 0.16),
      LAMP_RGB,
      L.suspendedLampHeightM,
    ),
    bollard: own(
      (b) => prism(b, 0.1, 0.085, L.bollardHeightM, 6),
      BOLLARD_RGB,
      L.bollardHeightM,
    ),
    bench: library("amenity=bench"),
    bin: library("amenity=waste_basket"),
  };
}

/**
 * One instanced mesh per kind. Before each render the near items within the
 * cut are packed to the front and `count` is set, once the eye has moved
 * `REPACK_M`: work over a few hundred matrices, never over geometry.
 */
function furnitureMeshes(THREE, items, models, cutM) {
  const meshes = [];
  const byKind = new Map();
  for (const item of items) {
    if (!byKind.has(item.kind)) byKind.set(item.kind, []);
    byKind.get(item.kind).push(item);
  }
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [kind, list] of byKind) {
    const model = models[kind];
    const material = new THREE.MeshStandardMaterial({
      color: model.vertexColours ? 0xffffff : model.colour,
      vertexColors: model.vertexColours,
      roughness: 0.75,
      metalness: 0,
      flatShading: true,
    });
    if (model.vertexColours) material.color.set(model.colour);
    const mesh = new THREE.InstancedMesh(model.geometry, material, list.length);
    mesh.frustumCulled = false;
    const all = list.map((item) => {
      const scaleY =
        model.heightM && item.heightM ? item.heightM / model.heightM : 1;
      quaternion.setFromAxisAngle(up, item.yawRad);
      return matrix
        .clone()
        .compose(
          new THREE.Vector3(item.x, 0, -item.y),
          quaternion,
          new THREE.Vector3(1, scaleY, 1),
        );
    });
    let packedAt = null;
    mesh.onBeforeRender = (renderer, scene, camera) => {
      const eye = { x: camera.position.x, y: -camera.position.z };
      if (
        packedAt &&
        Math.hypot(eye.x - packedAt.x, eye.y - packedAt.y) < REPACK_M
      ) {
        return;
      }
      packedAt = eye;
      const keep =
        cutM > 0 ? nearWithin(list, eye, cutM) : list.map((_, i) => i);
      keep.forEach((index, slot) => mesh.setMatrixAt(slot, all[index]));
      mesh.count = keep.length;
      mesh.instanceMatrix.needsUpdate = true;
    };
    mesh.userData = {
      streetLayer: kind,
      // Mapped positions; what is guessed per item is listed, never hidden.
      guessed: list.map((item) => ({ key: item.key, fields: item.guessed })),
    };
    meshes.push(mesh);
  }
  return meshes;
}

/** The page's own controls, under the harness's, as the same buttons. */
function addControls() {
  const panel = document.querySelector(".cl-panel");
  const stats = panel?.querySelector(".cl-stats");
  if (!panel || !stats) return;
  const row = (label, name, options) => {
    const node = document.createElement("div");
    node.className = "cl-row";
    node.setAttribute("role", "group");
    node.setAttribute("aria-label", label);
    const caption = document.createElement("span");
    caption.className = "cl-row-label";
    caption.textContent = label;
    node.append(caption);
    for (const [value, text] of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cl-button";
      button.textContent = text;
      button.setAttribute("aria-pressed", String(settings[name] === value));
      button.addEventListener("click", () => {
        const params = new URLSearchParams(location.search);
        for (const [key, current] of Object.entries(settings)) {
          params.set(key, String(key === name ? value : current));
        }
        location.search = `?${params}`;
      });
      node.append(button);
    }
    panel.insertBefore(node, stats);
  };
  row("Road joins: no disc under", "joins", [
    [0, "today"],
    [5, "5°"],
    [10, "10°"],
    [15, "15°"],
    [30, "30°"],
  ]);
  row("Notch limit", "gap", [
    [0, "none"],
    [5, "5 cm"],
    [10, "10 cm"],
    [25, "25 cm"],
  ]);
  row("Kerb edges", "edges", [
    [0, "off"],
    [1, "on"],
  ]);
  row("Zebra crossings", "marks", [
    [0, "off"],
    [1, "on"],
  ]);
  row("Furniture within", "cut", [
    [40, "40 m"],
    [80, "80 m"],
    [150, "150 m"],
    [0, "all"],
  ]);
}

function objectsFor(features, ctx) {
  const { THREE, frame, geometryFrom, seededRandom } = ctx;
  const ways = streetWays(features, frame);
  const widthOf = (tags) => roadWidthM(tags);
  const colourOf = (tags) => roadColour(tags);

  // Car roads over paths in draw order too; heights already separate them.
  ways.sort((a, b) => rankOf(a.tags) - rankOf(b.tags));
  const maxGap = (cm) => (cm > 0 ? cm / 100 : Infinity);
  const sweep = SWEEP_GAP_CM.flatMap((gapCm) =>
    SWEEP_DEG.map((straightDeg) => {
      const { stats } = buildRibbons(ways, {
        widthOf,
        colourOf,
        straightDeg,
        maxGapM: maxGap(gapCm),
      });
      return {
        straightDeg,
        gapCm,
        triangles: stats.quadTriangles + stats.discTriangles,
        discsDropped: stats.discsDropped,
        maxGapM: Number(stats.maxGapM.toFixed(3)),
        gapAreaM2: Number(stats.gapAreaM2.toFixed(2)),
      };
    }),
  );
  const built = buildRibbons(ways, {
    widthOf,
    colourOf,
    straightDeg: settings.joins,
    maxGapM: maxGap(settings.gap),
  });

  const nodes = features
    .filter((f) => f.type === "node")
    .map((f) => {
      const { x, y } = frame.toEnu(f.position);
      return { key: featureKey(f), type: "node", tags: f.tags ?? {}, x, y };
    });
  const crossingWays = ways.filter(
    (w) => w.tags.footway === "crossing" || w.tags.crossing !== undefined,
  );
  const carRoads = ways
    .filter((w) => rankOf(w.tags) > 0)
    .map((w) => ({ ...w, widthM: widthOf(w.tags) }));
  const stripes = settings.marks
    ? zebraStripes(crossingWays, nodes, carRoads)
    : [];
  const marks = markArrays(stripes);
  const markTriangles = marks.positions.length / 9;
  const areaCount = appendPedestrianAreas(marks, features, frame, THREE);

  const items = furnitureOf(nodes, seededRandom);
  const models = furnitureModels(THREE, geometryFrom);
  const furniture = furnitureMeshes(THREE, items, models, settings.cut);

  const counts = {};
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  const trianglesPer = Object.fromEntries(
    Object.entries(models).map(([kind, m]) => [
      kind,
      (m.geometry.index
        ? m.geometry.index.count
        : m.geometry.getAttribute("position").count) / 3,
    ]),
  );
  window.__o3 = {
    settings,
    todayRoadTriangles: triangleTotal(ctx.city.roads),
    sweep,
    roadTriangles: built.positions.length / 9,
    markTriangles,
    areaTriangles: marks.positions.length / 9 - markTriangles,
    stripes: stripes.length,
    pedestrianAreas: areaCount,
    zebraWays: crossingWays.filter((w) => isZebraTags(w.tags)).length,
    furniture: counts,
    trianglesPer,
    guessedHeights: items.filter((i) => i.guessed.includes("height")).length,
  };

  addControls();
  return [roadMesh(THREE, built, marks, settings.edges === 1), ...furniture];
}

export const o3Variant = Object.freeze({
  ...v2Variant,
  id: "o3",
  label: "O3 street scene",
  omitToday: ["roads"],
  objectsFor,
});
