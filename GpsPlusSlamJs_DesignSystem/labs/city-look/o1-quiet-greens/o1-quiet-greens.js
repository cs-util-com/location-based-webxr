/**
 * O1 quiet greens: V2's buildings with today's trees replaced by muted,
 * tag-read, instanced trees, cosmetic trees inside mapped woods, orchards and
 * tree rows, and hedges, walls and fences in their own quiet colours.
 *
 * @see o1-quiet-greens.js.md
 */
import { buildBarriers } from "/osm-lib/mesh/barrier-volumes.js";
import { isSolidBarrier } from "/osm-lib/mesh/barriers.js";
import { isBuilding } from "/osm-lib/mesh/building-heights.js";
import { ringToEnu } from "/osm-lib/mesh/enu.js";
import { featureKey } from "/osm-lib/model/osm-feature.js";
import { toGeometry } from "/osm-lib/model/osm-geometry.js";

import { startCityLook } from "../city-look-harness.js";
import { v2Variant } from "../v2-closed-roofscape/v2-closed-roofscape.js";
import {
  PARAMS,
  alongLine,
  barrierStyle,
  capByRank,
  formOf,
  lodOf,
  makeExclusion,
  orchardInArea,
  scatterInArea,
  treeClass,
  treeColour,
  treeSize,
  trunkLayout,
} from "./quiet-greens-rules.js";

/** The page's own link parameters, with their defaults. */
const OWN = {
  trees: "crown",
  woods: "off",
  treeh: "8",
  untagged: "neutral",
  lod: String(PARAMS.lodNearM),
  wooddensity: String(PARAMS.woodDensityPerM2),
  woodcap: String(PARAMS.woodCap),
  tint: "1",
};
const STASH_KEY = "o1-quiet-greens-params";
const STASH_TTL_MS = 15000;

/**
 * The harness rewrites the link with its own four parameters only, and a scene
 * change reloads the page through it. Ours are carried over both: a
 * `replaceState` that keeps them, and a short-lived stash for the reload.
 */
function ownParams() {
  const search = new URLSearchParams(location.search);
  if (!Object.keys(OWN).some((key) => search.has(key))) {
    try {
      const stash = JSON.parse(sessionStorage.getItem(STASH_KEY) ?? "null");
      if (stash && Date.now() - stash.t < STASH_TTL_MS) {
        for (const [key, value] of Object.entries(stash.params)) {
          search.set(key, value);
        }
        history.replaceState(null, "", `?${search}`);
      }
    } catch {
      // No storage: the scene change loses the toggles, nothing else.
    }
  }
  const replace = history.replaceState.bind(history);
  history.replaceState = (state, unused, url) => {
    const next = new URL(url ?? location.href, location.href);
    for (const key of Object.keys(OWN)) {
      if (search.has(key) && !next.searchParams.has(key)) {
        next.searchParams.set(key, search.get(key));
      }
    }
    replace(state, unused, `${next.pathname}${next.search}${next.hash}`);
  };
  const own = {};
  for (const [key, fallback] of Object.entries(OWN)) {
    own[key] = search.get(key) ?? fallback;
  }
  const stash = () => {
    const params = {};
    for (const key of Object.keys(OWN)) {
      if (search.has(key)) params[key] = search.get(key);
    }
    try {
      sessionStorage.setItem(
        STASH_KEY,
        JSON.stringify({ params, t: Date.now() }),
      );
    } catch {
      // As above.
    }
  };
  return { own, search, stash };
}

const { own, stash } = ownParams();
const number = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const OPTS = {
  trunks: own.trees === "trunk",
  woods: own.woods === "on",
  defaultHeightM: PARAMS.treeHeightsM.includes(Number(own.treeh))
    ? Number(own.treeh)
    : PARAMS.treeHeightsM[0],
  untagged: own.untagged === "broad" ? "broad" : "neutral",
  lodNearM: number(own.lod, PARAMS.lodNearM, 5, 2000),
  woodDensity: number(own.wooddensity, PARAMS.woodDensityPerM2, 0, 0.1),
  woodCap: number(own.woodcap, PARAMS.woodCap, 0, 50000),
  tint: number(own.tint, 1, 0, 2),
};

// ---------------------------------------------------------------- geometry

/**
 * A closed hull of revolution around +y from 0 to 1: `rings` of `[y, r]`
 * between a bottom and a top pole, `sides` around. 2 x sides x rings
 * triangles, known before it is built; a vertex colour darkens the bottom.
 */
function hull(THREE, sides, rings, { bottomY = 0, topY = 1 } = {}) {
  const positions = [];
  const colours = [];
  const shadeAt = (y) => 0.86 + 0.18 * y;
  const push = (x, y, z) => {
    positions.push(x, y, z);
    const s = shadeAt(y);
    colours.push(s, s, s);
  };
  const ringPoints = rings.map(([y, r], k) =>
    Array.from({ length: sides }, (_, i) => {
      const a = ((i + (k % 2) * 0.5) / sides) * Math.PI * 2;
      return [Math.cos(a) * r, y, Math.sin(a) * r];
    }),
  );
  const bottom = [0, bottomY, 0];
  const top = [0, topY, 0];
  const tri = (a, b, c) => {
    push(...a);
    push(...b);
    push(...c);
  };
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    tri(bottom, ringPoints[0][i], ringPoints[0][j]);
    const last = ringPoints[ringPoints.length - 1];
    tri(top, last[j], last[i]);
  }
  for (let k = 0; k + 1 < ringPoints.length; k++) {
    const lo = ringPoints[k];
    const hi = ringPoints[k + 1];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      // Odd rings are turned half a step, so each band is a strip of
      // alternating triangles: 2 x sides per band.
      if (k % 2 === 0) {
        tri(lo[i], hi[i], lo[j]);
        tri(lo[j], hi[i], hi[j]);
      } else {
        tri(lo[i], hi[j], lo[j]);
        tri(lo[i], hi[i], hi[j]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** An open prism from y 0 to 1, radius 1: 2 x sides triangles. */
function prism(THREE, sides) {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, sides, 1, true);
  geometry.translate(0, 0.5, 0);
  const count = geometry.attributes.position.count;
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(new Array(count * 3).fill(1), 3),
  );
  return geometry;
}

/**
 * Crown profiles, unit height and unit radius. `full` spans the whole tree
 * (crown-only mode: no trunk, the crown tapers to the ground), `crown` sits on
 * a trunk. Near and far are the two LOD levels.
 */
const PROFILES = {
  broad: {
    near: [
      [0.22, 0.82],
      [0.52, 1.0],
      [0.82, 0.8],
    ],
    far: [
      [0.3, 0.9],
      [0.72, 0.86],
    ],
  },
  neutral: {
    near: [
      [0.24, 0.7],
      [0.56, 0.8],
      [0.85, 0.52],
    ],
    far: [
      [0.3, 0.76],
      [0.72, 0.66],
    ],
  },
  needle: {
    near: [
      [0.1, 1.0],
      [0.48, 0.6],
    ],
    far: [[0.12, 1.0]],
  },
};
const SIDES = { near: 7, far: 5 };
const TRUNK_SIDES = { near: 5, far: 3 };

function treeGeometries(THREE) {
  const out = {};
  for (const [form, levels] of Object.entries(PROFILES)) {
    out[form] = {
      near: hull(THREE, SIDES.near, levels.near),
      far: hull(THREE, SIDES.far, levels.far),
    };
  }
  out.trunk = {
    near: prism(THREE, TRUNK_SIDES.near),
    far: prism(THREE, TRUNK_SIDES.far),
  };
  return out;
}

const trianglesOf = (geometry) =>
  (geometry.index ? geometry.index.count : geometry.attributes.position.count) /
  3;

// ------------------------------------------------------------------- data

function ringsOfFeature(feature, frame) {
  const result = toGeometry(feature);
  if (!result.ok) return [];
  const { geometry } = result;
  const polygons =
    geometry.kind === "polygon"
      ? [geometry.rings]
      : geometry.kind === "multipolygon"
        ? geometry.polygons
        : [];
  return polygons
    .map((rings) =>
      rings.map((ring) => ringToEnu(ring, frame)).filter((r) => r.length >= 3),
    )
    .filter((rings) => rings.length > 0);
}

function lineOfFeature(feature, frame) {
  const result = toGeometry(feature);
  if (!result.ok) return [];
  const { geometry } = result;
  if (geometry.kind === "linestring") {
    return [geometry.positions.map((p) => frame.toEnu(p))];
  }
  if (geometry.kind === "multilinestring") {
    return geometry.lines.map((line) => line.map((p) => frame.toEnu(p)));
  }
  return [];
}

/** Half widths of the road margin a cosmetic tree keeps, metres. */
const ROAD_HALF_WIDTH_M = {
  motorway: 8,
  trunk: 7,
  primary: 6,
  secondary: 5.5,
  tertiary: 5,
  residential: 4,
  unclassified: 4,
  living_street: 3.5,
  service: 3,
  track: 2,
  footway: 1.5,
  path: 1.5,
  cycleway: 1.5,
  bridleway: 1.5,
  steps: 1.5,
};

function exclusionFor(features, frame) {
  const rings = [];
  const segments = [];
  for (const feature of features) {
    if (isBuilding(feature)) {
      for (const polygon of ringsOfFeature(feature, frame)) {
        rings.push(polygon[0]);
      }
      continue;
    }
    const highway = feature.tags?.highway;
    if (!highway || feature.type !== "way") continue;
    const halfWidthM = ROAD_HALF_WIDTH_M[highway] ?? 3;
    for (const line of lineOfFeature(feature, frame)) {
      for (let i = 0; i + 1 < line.length; i++) {
        segments.push({ a: line[i], b: line[i + 1], halfWidthM });
      }
    }
  }
  return makeExclusion({ rings, segments });
}

function clipOf(bbox, frame) {
  const sw = frame.toEnu({ lat: bbox.south, lng: bbox.west });
  const ne = frame.toEnu({ lat: bbox.north, lng: bbox.east });
  return { minX: sw.x, minY: sw.y, maxX: ne.x, maxY: ne.y };
}

const isWood = (tags) => tags.landuse === "forest" || tags.natural === "wood";
const isOrchard = (tags) => tags.landuse === "orchard";

/**
 * Every tree the page draws: `{ x, y, form, heightM, crownM, trunkRadiusM,
 * colour, rotation, cosmetic, key, source }`, plus counts per kind.
 */
function plantTrees(features, ctx) {
  const { frame } = ctx;
  const counts = {
    mapped: 0,
    mappedByForm: { broad: 0, neutral: 0, needle: 0 },
    mappedHeightTagged: 0,
    mappedTypeFrom: {},
    rows: 0,
    rowTrees: 0,
    woods: 0,
    orchards: 0,
    woodTrees: 0,
    orchardTrees: 0,
    woodBeforeCap: 0,
  };
  const trees = [];
  const add = (point, cls, size, extra) => {
    const form = formOf(cls.leafType, { untagged: OPTS.untagged });
    trees.push({
      x: point.x,
      y: point.y,
      form,
      ...size,
      colour: treeColour(cls, point.key, { tint: OPTS.tint }),
      rotation: ctx.seededRandom(`${point.key}|r`) * Math.PI * 2,
      key: point.key,
      ...extra,
    });
    return form;
  };
  const mapped = [];
  for (const feature of features) {
    if (feature.type !== "node" || feature.tags?.natural !== "tree") continue;
    const key = featureKey(feature);
    const point = { ...frame.toEnu(feature.position), key };
    const cls = treeClass(feature.tags);
    const size = treeSize(feature.tags, key, {
      defaultHeightM: OPTS.defaultHeightM,
    });
    const form = add(point, cls, size, { cosmetic: false, source: "tree" });
    counts.mapped++;
    counts.mappedByForm[form]++;
    if (size.heightTagged) counts.mappedHeightTagged++;
    counts.mappedTypeFrom[cls.source] =
      (counts.mappedTypeFrom[cls.source] ?? 0) + 1;
    mapped.push(point);
  }

  const clip = clipOf(ctx.fixture.bbox, frame);
  for (const feature of features) {
    if (feature.tags?.natural !== "tree_row") continue;
    counts.rows++;
    const key = featureKey(feature);
    const cls = treeClass(feature.tags);
    for (const line of lineOfFeature(feature, frame)) {
      for (const point of alongLine(line, key, { avoid: mapped, clip })) {
        add(
          point,
          cls,
          treeSize({}, point.key, { defaultHeightM: OPTS.defaultHeightM }),
          { cosmetic: true, source: "tree_row" },
        );
        counts.rowTrees++;
      }
    }
  }

  if (!OPTS.woods) return { trees, counts };
  const exclude = exclusionFor(features, frame);
  const taken = new Set();
  const woodPoints = [];
  const orchardPoints = [];
  for (const feature of features) {
    const tags = feature.tags ?? {};
    const wood = isWood(tags);
    const orchard = isOrchard(tags);
    if (!wood && !orchard) continue;
    const key = featureKey(feature);
    const cls = treeClass(tags);
    for (const rings of ringsOfFeature(feature, frame)) {
      const points = wood
        ? scatterInArea(rings, key, {
            densityPerM2: OPTS.woodDensity,
            clip,
            exclude,
            taken,
          })
        : orchardInArea(rings, key, { clip, exclude });
      for (const point of points) {
        (wood ? woodPoints : orchardPoints).push({ point, cls });
      }
    }
    if (wood) counts.woods++;
    else counts.orchards++;
  }
  counts.woodBeforeCap = woodPoints.length + orchardPoints.length;
  const kept = new Set(
    capByRank(
      [...woodPoints, ...orchardPoints].map(({ point }) => point),
      OPTS.woodCap,
    ).map((p) => p.key),
  );
  for (const { point, cls } of woodPoints) {
    if (!kept.has(point.key)) continue;
    const resolved =
      cls.leafType === "mixed"
        ? {
            leafType:
              ctx.seededRandom(`${point.key}|mix`) < 0.5
                ? "needleleaved"
                : "broadleaved",
            leafCycle: "unknown",
          }
        : cls;
    add(
      point,
      resolved,
      treeSize({}, point.key, {
        defaultHeightM: OPTS.defaultHeightM * PARAMS.forestHeightFactor,
      }),
      { cosmetic: true, source: "wood" },
    );
    counts.woodTrees++;
  }
  for (const { point, cls } of orchardPoints) {
    if (!kept.has(point.key)) continue;
    add(
      point,
      cls.leafType === "unknown" ? { ...cls, leafType: "broadleaved" } : cls,
      treeSize({}, point.key, { defaultHeightM: PARAMS.orchardHeightM }),
      { cosmetic: true, source: "orchard" },
    );
    counts.orchardTrees++;
  }
  return { trees, counts };
}

// --------------------------------------------------------------- drawing

/**
 * One InstancedMesh per source (mapped or invented), form and level, plus the
 * trunks. Instances are re-sorted into near and far only when the camera has
 * moved, never per frame and never over geometry.
 */
function treeObjects(trees, ctx) {
  const { THREE } = ctx;
  const geometries = treeGeometries(THREE);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
  });
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x5e564d,
    roughness: 0.95,
    metalness: 0,
  });
  const levels = OPTS.trunks ? ["near", "far"] : ["far"];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const colour = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);

  for (const tree of trees) {
    const layout = OPTS.trunks
      ? trunkLayout(tree.form, tree.heightM)
      : { crownBaseM: 0, crownHeightM: tree.heightM };
    quaternion.setFromAxisAngle(up, tree.rotation);
    position.set(tree.x, layout.crownBaseM, -tree.y);
    scale.set(tree.crownM / 2, layout.crownHeightM, tree.crownM / 2);
    tree.crownMatrix = matrix.compose(position, quaternion, scale).toArray();
    if (OPTS.trunks) {
      const r = tree.trunkRadiusM;
      position.set(tree.x, 0, -tree.y);
      scale.set(r, layout.crownBaseM + layout.crownHeightM * 0.25, r);
      tree.trunkMatrix = matrix.compose(position, quaternion, scale).toArray();
    }
    colour.setHex(tree.colour);
    tree.rgb = [colour.r, colour.g, colour.b];
  }

  const meshes = [];
  const groups = new Map();
  for (const tree of trees) {
    const id = `${tree.cosmetic ? "cosmetic" : "mapped"}-${tree.form}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(tree);
  }
  const make = (geometry, mat, capacity, name, cosmetic) => {
    const mesh = new THREE.InstancedMesh(geometry, mat, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = name;
    mesh.userData.cityLayer = "trees";
    // Invented trees: kept out of navigation and scoring by this flag.
    if (cosmetic) mesh.userData.cosmetic = true;
    if (mat === material) mesh.setColorAt(0, white);
    meshes.push(mesh);
    return mesh;
  };
  const sets = [];
  for (const [id, list] of groups) {
    const cosmetic = id.startsWith("cosmetic");
    const form = list[0].form;
    const crowns = {};
    const trunks = {};
    for (const level of levels) {
      crowns[level] = make(
        geometries[form][level],
        material,
        list.length,
        `o1-${id}-crown-${level}`,
        cosmetic,
      );
      if (OPTS.trunks) {
        trunks[level] = make(
          geometries.trunk[level],
          trunkMaterial,
          list.length,
          `o1-${id}-trunk-${level}`,
          cosmetic,
        );
      }
    }
    sets.push({ list, crowns, trunks });
  }

  const write = (mesh, matrixArray, rgb) => {
    const i = mesh.count++;
    mesh.instanceMatrix.array.set(matrixArray, i * 16);
    if (rgb) mesh.instanceColor.array.set(rgb, i * 3);
  };
  const rebucket = (eye) => {
    let near = 0;
    for (const mesh of meshes) mesh.count = 0;
    for (const { list, crowns, trunks } of sets) {
      for (const tree of list) {
        const level = OPTS.trunks
          ? lodOf(
              Math.hypot(
                tree.x - eye.x,
                eye.y - tree.heightM / 2,
                -tree.y - eye.z,
              ),
              OPTS.lodNearM,
            )
          : "far";
        if (level === "near") near++;
        write(crowns[level], tree.crownMatrix, tree.rgb);
        if (OPTS.trunks) write(trunks[level], tree.trunkMatrix, null);
      }
    }
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    return near;
  };
  rebucket({ x: 0, y: 150, z: 0 });

  const perTree = {};
  for (const form of Object.keys(PROFILES)) {
    perTree[form] = {};
    for (const level of ["near", "far"]) {
      perTree[form][level] =
        trianglesOf(geometries[form][level]) +
        (OPTS.trunks ? trianglesOf(geometries.trunk[level]) : 0);
    }
  }
  return { meshes, rebucket, perTree };
}

/** Rebuckets when the camera has moved more than this, metres. */
const REBUCKET_MOVE_M = 2;

/** Rebuckets on camera moves; the harness publishes its camera at the end. */
function watchCamera(rebucket) {
  let last = null;
  const loop = () => {
    requestAnimationFrame(loop);
    const camera = window.__cityLook?.three?.camera;
    if (!camera) return;
    const p = camera.position;
    if (last && p.distanceTo(last) < REBUCKET_MOVE_M) return;
    last = p.clone();
    window.__quietGreens.nearTrees = rebucket(p);
    window.__quietGreens.rebuckets++;
  };
  requestAnimationFrame(loop);
}

/** Parses a `colour` tag, or null when three does not know it. */
function parseColour(THREE, css) {
  if (!css) return null;
  const colour = new THREE.Color(-1, -1, -1);
  try {
    colour.setStyle(String(css).trim());
  } catch {
    return null;
  }
  return colour.r < 0 ? null : colour;
}

/** Share of a tagged `colour` kept; the rest is the kind's muted colour. */
const TAGGED_COLOUR_SHARE = 0.5;

/**
 * Hedges, walls and fences, each with its own colour and size. The volumes
 * come from the library's own `buildBarriers`, on copies whose untagged
 * height and width are filled with this page's values; nothing else changes.
 */
function barrierObjects(features, ctx) {
  const { THREE } = ctx;
  const styles = new Map();
  const copies = features.map((feature) => {
    if (!isSolidBarrier(feature) || isBuilding(feature)) return feature;
    const style = barrierStyle(feature.tags);
    styles.set(featureKey(feature), style);
    return {
      ...feature,
      tags: {
        ...feature.tags,
        height: String(style.heightM),
        width: String(style.thicknessM),
      },
    };
  });
  const volumes = buildBarriers(copies, ctx.ground);
  const counts = {};
  const positions = [];
  const normals = [];
  const colours = [];
  const indices = [];
  const colour = new THREE.Color();
  for (const volume of volumes) {
    const style = styles.get(volume.feature);
    if (!style) continue;
    counts[style.kind] = (counts[style.kind] ?? 0) + 1;
    colour.setHex(style.colour);
    const tagged = parseColour(THREE, style.taggedColour);
    if (tagged) colour.lerp(tagged, TAGGED_COLOUR_SHARE);
    const base = positions.length / 3;
    const { mesh } = volume;
    for (let i = 0; i < mesh.positions.length; i++) {
      positions.push(mesh.positions[i]);
      normals.push(mesh.normals[i]);
    }
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      colours.push(colour.r, colour.g, colour.b);
    }
    for (const index of mesh.indices) indices.push(base + index);
  }
  if (indices.length === 0) return { objects: [], counts, triangles: 0 };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
    }),
  );
  mesh.name = "o1-barriers";
  // Real geometry from OSM; only the untagged sizes and the colours are ours.
  mesh.userData.cityLayer = "barriers";
  return { objects: [mesh], counts, triangles: indices.length / 3 };
}

// ------------------------------------------------------------------ panel

function panelRow(label, key, options) {
  const row = document.createElement("div");
  row.className = "cl-row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", label);
  const name = document.createElement("span");
  name.className = "cl-row-label";
  name.textContent = label;
  row.append(name);
  for (const { value, text } of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cl-button";
    button.textContent = text;
    button.setAttribute("aria-pressed", String(own[key] === value));
    button.addEventListener("click", () => {
      if (own[key] === value) return;
      const next = new URLSearchParams(location.search);
      next.set(key, value);
      location.search = `?${next}`;
    });
    row.append(button);
  }
  return row;
}

function addPanel(statsText) {
  const panel = document.querySelector(".cl-panel");
  const stats = panel?.querySelector(".cl-stats");
  if (!panel || !stats) return;
  const rows = [
    panelRow("Trees", "trees", [
      { value: "crown", text: "crown" },
      { value: "trunk", text: "trunk and crown" },
    ]),
    panelRow("Cosmetic woods", "woods", [
      { value: "off", text: "off" },
      { value: "on", text: "on" },
    ]),
    panelRow(
      "Default tree height",
      "treeh",
      PARAMS.treeHeightsM.map((h) => ({ value: String(h), text: `${h} m` })),
    ),
    panelRow("Untagged trees", "untagged", [
      { value: "neutral", text: "neutral" },
      { value: "broad", text: "broadleaved" },
    ]),
  ];
  const line = document.createElement("p");
  line.className = "cl-stats";
  line.textContent = statsText;
  stats.before(...rows);
  stats.after(line);
  // A scene change reloads through the harness, which drops our parameters.
  panel
    .querySelector('[aria-label="Scene"]')
    ?.addEventListener("click", stash, true);
}

// ---------------------------------------------------------------- variant

function buildingsFor(features, ctx) {
  // V2 draws barriers in the building colour; they are drawn here instead.
  const kept = features.filter(
    (feature) => isBuilding(feature) || !isSolidBarrier(feature),
  );
  return v2Variant.buildingsFor(kept, ctx);
}

function objectsFor(features, ctx) {
  const { trees, counts } = plantTrees(features, ctx);
  const drawn = treeObjects(trees, ctx);
  const barriers = barrierObjects(features, ctx);
  const cosmetic = trees.filter((t) => t.cosmetic).length;
  window.__quietGreens = {
    options: OPTS,
    counts,
    barriers: barriers.counts,
    barrierTriangles: barriers.triangles,
    trees: trees.length,
    cosmetic,
    perTree: drawn.perTree,
    treeMeshes: drawn.meshes.length,
    nearTrees: 0,
    rebuckets: 0,
  };
  watchCamera(drawn.rebucket);
  const forms = counts.mappedByForm;
  const per = drawn.perTree.broad;
  addPanel(
    `Trees: ${counts.mapped} mapped (${forms.broad} broad, ${forms.needle} ` +
      `needle, ${forms.neutral} neutral), ${cosmetic} invented; ` +
      `${per.near}/${per.far} triangles a broadleaf near/far; ` +
      `${Object.values(barriers.counts).reduce((a, b) => a + b, 0)} barriers.`,
  );
  return [...drawn.meshes, ...barriers.objects];
}

startCityLook({
  ...v2Variant,
  id: "o1",
  label: "O1 quiet greens",
  buildingsFor,
  objectsFor,
  omitToday: ["trees"],
});
