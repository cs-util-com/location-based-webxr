/**
 * The AR shadows pixel page (W4 AR shadows plan 2026-09-26-0549, M2): the
 * framework's real OcclusionMesh receiver and `createArShadows` rig over a
 * synthetic room, with probes placed by the analytic oracle.
 *
 * @see ar-shadows-lab.js.md
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { WEBXR_TO_NUE } from "/fw/ar/webxr-nue-basis.js";
import { AR_SHADOWS, createArShadows } from "/fw/visualization/ar-shadows.js";
import { OcclusionMesh } from "/fw/visualization/occlusion-mesh.js";
import { createShadowPlane } from "/fw/visualization/shadow-receiver.js";
import { enableSunShadows } from "/fw/visualization/sun-shadow.js";
import { classifyProbe, shadowTexelM } from "/fw/test-utils/shadow-oracle.js";
import { guardSlidersIn } from "/fw/utils/slider-scroll-guard.js";

// A swipe that starts on a sun slider must not edit it (owner report
// 2026-09-30; the framework's page-wide slider guard).
guardSlidersIn(document);

const DEG = Math.PI / 180;
/** The room: 8 × 8 m, meshed at 10 cm like a fine occupancy grid. */
const FIELD_HALF_M = 4;
const FIELD_STEP_M = 0.1;
/**
 * The height profile depends on x only, and is linear between vertices, so
 * every quad is planar and the triangulated mesh IS this function: the CPU
 * exact ray solve below hits exactly what the GPU draws.
 * - a 1.2 m tent ridge at x = -2.9 (half width 0.3 m);
 * - a 20 cm kerb from x = 2.2 on.
 */
const RIDGE = { x: -2.9, halfWidthM: 0.3, heightM: 1.2 };
const KERB = { fromX: 2.2, heightM: 0.2 };
/** Probes only on flat floor this far from any slope (no edge verdicts). */
const FLAT_CLEARANCE_M = 0.25;
/** Nearer than the room by less than this: no caster/floor verdict. */
const DEPTH_TIE_M = 0.05;
/** Probes stay this far inside the shadow square (the rig's ±R). */
const SQUARE_CLEARANCE_M = 0.3;

function heightAtVertexX(x) {
  const ridge = Math.max(
    0,
    RIDGE.heightM * (1 - Math.abs(x - RIDGE.x) / RIDGE.halfWidthM),
  );
  const kerb = x >= KERB.fromX - 1e-9 ? KERB.heightM : 0;
  return Math.max(ridge, kerb);
}

/** The exact surface: linear between the mesh's vertex columns. */
function heightAt(x) {
  const i = Math.floor((x + FIELD_HALF_M) / FIELD_STEP_M);
  const x0 = -FIELD_HALF_M + i * FIELD_STEP_M;
  const f = (x - x0) / FIELD_STEP_M;
  return heightAtVertexX(x0) * (1 - f) + heightAtVertexX(x0 + FIELD_STEP_M) * f;
}

/** Flat floor, clear of the ridge's and the kerb's slopes. */
function flatRegion(x) {
  const ridgeFoot = RIDGE.halfWidthM + FLAT_CLEARANCE_M;
  if (Math.abs(x - RIDGE.x) < ridgeFoot) return null;
  if (x < KERB.fromX - FIELD_STEP_M - FLAT_CLEARANCE_M) return "ground";
  if (x > KERB.fromX + FLAT_CLEARANCE_M) return "kerb";
  return null;
}

function buildFieldMesh() {
  const n = Math.round((2 * FIELD_HALF_M) / FIELD_STEP_M) + 1;
  const positions = new Float32Array(n * n * 3);
  for (let i = 0; i < n; i++) {
    const x = -FIELD_HALF_M + i * FIELD_STEP_M;
    const y = heightAtVertexX(x);
    for (let j = 0; j < n; j++) {
      const o = (i * n + j) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = -FIELD_HALF_M + j * FIELD_STEP_M;
    }
  }
  // Counter-clockwise seen from above (+y normals): a=(i,j), b=(i,j+1),
  // c=(i+1,j), d=(i+1,j+1) → (a, b, c) and (b, d, c).
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices.set([a, b, c, b, d, c], k);
      k += 6;
    }
  }
  // The occluder takes RAW WebXR positions and applies WEBXR_TO_NUE itself
  // (its parent is the NUE world), so the room is built in world coordinates
  // and handed over through the inverse. A rotation: winding is unchanged.
  new THREE.BufferAttribute(positions, 3).applyMatrix4(
    WEBXR_TO_NUE.clone().invert(),
  );
  return { positions, indices };
}

/**
 * The casters: spheres of the thrown-ball scale and cubes, one of them over
 * the kerb. `oracle` is the shape the oracle sees; `mesh` what three draws.
 */
const CASTER_SPECS = [
  { kind: "sphere", centre: [0.3, 0.9, -1.2], radius: 0.25 },
  { kind: "sphere", centre: [1.2, 0.6, 0.8], radius: 0.25 },
  { kind: "sphere", centre: [-0.4, 1.4, 1.6], radius: 0.25 },
  { kind: "sphere", centre: [0.8, 0.5, -0.2], radius: 0.08 },
  {
    kind: "box",
    centre: [1.0, 1.0, -2.2],
    halfExtents: [0.2, 0.2, 0.2],
    axis: [0, 1, 0],
    angleDeg: 30,
  },
  {
    kind: "box",
    centre: [-1.3, 0.7, -0.4],
    halfExtents: [0.25, 0.15, 0.2],
    axis: [1, 1, 0],
    angleDeg: 40,
  },
  {
    kind: "box",
    centre: [2.6, 0.7, -1.0],
    halfExtents: [0.2, 0.2, 0.2],
    axis: [0, 1, 0],
    angleDeg: 15,
  },
];
/** Drawn, never casts (castShadow false): its footprint must stay clear. */
const NON_CASTER = { kind: "sphere", centre: [-1.0, 0.8, 2.6], radius: 0.3 };
/** Behind the ridge from the camera: the depth-only room must hide it. */
const HIDDEN = {
  kind: "box",
  centre: [-3.7, 0.3, 0.5],
  halfExtents: [0.3, 0.3, 0.3],
  axis: [0, 1, 0],
  angleDeg: 0,
};

const CAMERA_POSITION = [5.5, 6.2, 5.0];
const MARGIN_DEFAULTS = [2, 3, 4, 6, 8];
/** Probe spacing in device pixels (a grid, so the counts are stable). */
const PROBE_STRIDE_PX = 6;

function makeCasterMesh(spec, color) {
  const geometry =
    spec.kind === "sphere"
      ? new THREE.SphereGeometry(spec.radius, 48, 24)
      : new THREE.BoxGeometry(
          2 * spec.halfExtents[0],
          2 * spec.halfExtents[1],
          2 * spec.halfExtents[2],
        );
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
  );
  mesh.position.set(...spec.centre);
  if (spec.kind === "box") {
    mesh.quaternion.setFromAxisAngle(
      new THREE.Vector3(...spec.axis).normalize(),
      spec.angleDeg * DEG,
    );
  }
  return mesh;
}

/** The oracle's view of a drawn caster (its current pose). */
function oracleCaster(spec, mesh) {
  const centre = [mesh.position.x, mesh.position.y, mesh.position.z];
  if (spec.kind === "sphere") {
    return { kind: "sphere", centre, radius: spec.radius };
  }
  const q = mesh.quaternion;
  return {
    kind: "box",
    centre,
    halfExtents: spec.halfExtents,
    rotation: [q.x, q.y, q.z, q.w],
  };
}

function sunDirection(elevationDeg, azimuthDeg) {
  const e = elevationDeg * DEG;
  const a = azimuthDeg * DEG;
  return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
}

const ROOM_TOP_M = Math.max(RIDGE.heightM, KERB.heightM);

/** The ray-parameter interval over the room's 8 × 8 m footprint, or null. */
function footprintInterval(o, d, tMin, tMax) {
  let lo = tMin;
  let hi = tMax;
  for (const k of [0, 2]) {
    if (d[k] === 0) {
      if (Math.abs(o[k]) > FIELD_HALF_M) return null;
      continue;
    }
    const a = (-FIELD_HALF_M - o[k]) / d[k];
    const b = (FIELD_HALF_M - o[k]) / d[k];
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * The ray parameters in [lo, hi] where the ray crosses a vertex column, plus
 * both ends, sorted. Between two of them the height above the surface is
 * LINEAR in t (the profile is linear between columns), so roots and minima
 * are exact at these points. A fixed-step march is not: it can step over the
 * ridge's sharp apex, which is what the first version of this page did.
 */
function columnCrossings(o, d, lo, hi) {
  const ts = [lo, hi];
  if (d[0] !== 0) {
    const xa = o[0] + d[0] * lo;
    const xb = o[0] + d[0] * hi;
    const k0 = Math.ceil((Math.min(xa, xb) + FIELD_HALF_M) / FIELD_STEP_M);
    const k1 = Math.floor((Math.max(xa, xb) + FIELD_HALF_M) / FIELD_STEP_M);
    for (let k = k0; k <= k1; k++) {
      const t = (-FIELD_HALF_M + k * FIELD_STEP_M - o[0]) / d[0];
      if (t > lo && t < hi) ts.push(t);
    }
  }
  return ts.sort((a, b) => a - b);
}

/** The ray's height above the room's surface at parameter t. */
function heightAbove(o, d, t) {
  return o[1] + d[1] * t - heightAt(o[0] + d[0] * t);
}

/** The first ray parameter where the ray meets the room (exact), or Infinity. */
function rayToRoom(origin, dir) {
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  if (!(d[1] < 0)) return Infinity;
  const span = footprintInterval(
    o,
    d,
    Math.max(0, (o[1] - ROOM_TOP_M) / -d[1]),
    o[1] / -d[1],
  );
  if (!span) return Infinity;
  const ts = columnCrossings(o, d, span[0], span[1]);
  let f0 = heightAbove(o, d, ts[0]);
  // Entering the footprint BELOW the surface means through a side the room
  // does not have: the mesh is an open height field (no walls) and is never
  // hit from below, so this ray sees no room at all.
  if (f0 < 0) return Infinity;
  if (f0 === 0) return ts[0];
  for (let i = 1; i < ts.length; i++) {
    const f1 = heightAbove(o, d, ts[i]);
    if (f1 <= 0) return ts[i - 1] + (f0 / (f0 - f1)) * (ts[i] - ts[i - 1]);
    f0 = f1;
  }
  return Infinity;
}

/** Whether the room itself blocks the sun at q (its own geometric shadow). */
function roomShadowsPoint(q, sunDir) {
  if (!(sunDir[1] > 0)) return false;
  const span = footprintInterval(
    q,
    sunDir,
    1e-4,
    (ROOM_TOP_M - q[1]) / sunDir[1],
  );
  if (!span) return false;
  return columnCrossings(q, sunDir, span[0], span[1]).some(
    (t) => heightAbove(q, sunDir, t) < -1e-9,
  );
}

function start() {
  const canvas = document.getElementById("lab-canvas");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  enableSunShadows(renderer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
  camera.position.set(...CAMERA_POSITION);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(-0.4, 0, 0);
  controls.update();

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const light = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(light, light.target);

  const room = new THREE.Group();
  scene.add(room);
  const field = buildFieldMesh();
  let occluder = null;
  const fallbackPlane = createShadowPlane(
    AR_SHADOWS.halfWidthM,
    AR_SHADOWS.opacity,
  );
  fallbackPlane.visible = false;

  const palette = [
    0xe07a5f, 0x81b29a, 0xf2cc8f, 0x3d85c6, 0x9b5de5, 0xf15bb5, 0x00bbf9,
  ];
  const casters = CASTER_SPECS.map((spec, i) => {
    const mesh = makeCasterMesh(spec, palette[i % palette.length]);
    mesh.castShadow = true;
    scene.add(mesh);
    return { spec, mesh };
  });
  const nonCaster = makeCasterMesh(NON_CASTER, 0xffffff);
  nonCaster.castShadow = false;
  const hidden = makeCasterMesh(HIDDEN, 0xff0000);
  hidden.castShadow = true;
  scene.add(nonCaster, hidden);
  // The hidden box casts too, so the oracle must know it.
  const oracleSpecs = [...casters, { spec: HIDDEN, mesh: hidden }];

  const state = {
    elevationDeg: 35,
    azimuthDeg: 205,
    mapSize: AR_SHADOWS.mapSize,
    halfWidthM: AR_SHADOWS.halfWidthM,
    mesh: true,
    fallback: true,
    mutation: null,
    /** Draw the room with the occluder's matcap debug skin (looking only). */
    showRoom: false,
  };
  let shadows = null;
  let syncPanel = null;
  let sunDir = sunDirection(state.elevationDeg, state.azimuthDeg);

  const rebuild = () => {
    shadows?.dispose();
    if (occluder) {
      occluder.dispose();
      occluder = null;
    }
    if (state.mesh) {
      occluder = new OcclusionMesh(room);
      occluder.applyMeshData(field.positions, field.indices);
      if (state.showRoom) occluder.setDebugStyle("matcap");
    }
    if (state.fallback) scene.add(fallbackPlane);
    else fallbackPlane.removeFromParent();
    sunDir = sunDirection(state.elevationDeg, state.azimuthDeg);
    light.target.position.set(0, 0, 0);
    light.position.set(sunDir[0] * 10, sunDir[1] * 10, sunDir[2] * 10);
    shadows = createArShadows({
      renderer,
      light,
      getOccluder: () => occluder,
      fallbackPlane: state.fallback ? fallbackPlane : null,
      halfWidthM: state.halfWidthM,
      mapSize: state.mapSize,
      dynamicCasters: true,
    });
    // The mutations: the one flag that would make a non-caster cast.
    if (occluder)
      occluder.getMesh().castShadow = state.mutation === "mesh-casts";
    nonCaster.castShadow = state.mutation === "non-caster-casts";
    light.shadow.needsUpdate = true;
  };

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (
      canvas.width !== Math.floor(w * renderer.getPixelRatio()) ||
      canvas.height !== Math.floor(h * renderer.getPixelRatio())
    ) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  };

  const renderFrame = () => {
    resize();
    shadows.update({ centre: [0, 0, 0], casterCount: casters.length + 1 });
    renderer.render(scene, camera);
  };

  /** Probe every stride-th pixel: what the ray meets and what the oracle says. */
  const sample = ({ margins = MARGIN_DEFAULTS } = {}) => {
    renderFrame();
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const texelM = shadowTexelM(state.halfWidthM, state.mapSize);
    const oracle = oracleSpecs.map((c) => oracleCaster(c.spec, c.mesh));
    const nonCasterOracle = [oracleCaster(NON_CASTER, nonCaster)];
    const maxMargin = Math.max(...margins);
    const drawn = [...casters.map((c) => c.mesh), nonCaster, hidden];
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    camera.updateMatrixWorld();
    const probes = [];
    for (let py = PROBE_STRIDE_PX / 2; py < h; py += PROBE_STRIDE_PX) {
      for (let px = PROBE_STRIDE_PX / 2; px < w; px += PROBE_STRIDE_PX) {
        const x = Math.floor(px);
        const y = Math.floor(py);
        ndc.set(((x + 0.5) / w) * 2 - 1, ((y + 0.5) / h) * 2 - 1);
        raycaster.setFromCamera(ndc, camera);
        const { origin, direction } = raycaster.ray;
        const hits = raycaster.intersectObjects(drawn, false);
        const casterT = hits.length ? hits[0].distance : Infinity;
        // The room is probed whether or not its mesh is drawn (A7 judges
        // the floor with no mesh).
        const roomT = rayToRoom(origin, direction);
        const o = (y * w + x) * 4;
        const alpha = pixels[o + 3];
        const rgbMax = Math.max(pixels[o], pixels[o + 1], pixels[o + 2]);
        if (casterT < roomT - DEPTH_TIE_M) {
          probes.push({
            x,
            y,
            target: "caster",
            alpha,
            rgbMax,
            casterT,
            roomT,
          });
          continue;
        }
        // A caster and the room at nearly the same depth on this ray (the
        // hidden box peeking over the crest): the depth buffer decides, so
        // the pixel gets no verdict.
        if (casterT < roomT) continue;
        if (roomT === Infinity) continue;
        const behindTerrain = casterT < Infinity;
        const q = [
          origin.x + direction.x * roomT,
          origin.y + direction.y * roomT,
          origin.z + direction.z * roomT,
        ];
        const region = flatRegion(q[0]);
        const inSquare =
          Math.hypot(q[0], q[2]) < state.halfWidthM - SQUARE_CLEARANCE_M &&
          Math.abs(q[0]) < FIELD_HALF_M - FLAT_CLEARANCE_M &&
          Math.abs(q[2]) < FIELD_HALF_M - FLAT_CLEARANCE_M;
        const probe = {
          x,
          y,
          target: "floor",
          q,
          alpha,
          rgbMax,
          flat: region !== null && inSquare,
          kerb: region === "kerb",
          behindTerrain,
          cls: margins.map((m) =>
            classifyProbe(sunDir, q, oracle, { texelM, marginTexels: m }),
          ),
          terrainShadow: false,
          nonCasterShadow: false,
        };
        if (probe.flat && probe.cls[margins.indexOf(maxMargin)] === "outside") {
          probe.terrainShadow =
            roomShadowsPoint(q, sunDir) &&
            // Deep inside the room's shadow: the same at 10 cm either side.
            [-0.1, 0.1].every((d) =>
              roomShadowsPoint([q[0] + d, q[1], q[2]], sunDir),
            );
          probe.nonCasterShadow =
            classifyProbe(sunDir, q, nonCasterOracle, {
              texelM,
              marginTexels: maxMargin,
            }) === "inside";
        }
        probes.push(probe);
      }
    }
    return { opacity: AR_SHADOWS.opacity, texelM, width: w, height: h, probes };
  };

  const api = {
    ready: false,
    error: null,
    configure(patch = {}) {
      Object.assign(state, {
        mesh: true,
        fallback: true,
        mutation: null,
        showRoom: false,
        ...patch,
      });
      rebuild();
      syncPanel?.();
    },
    moveCaster(index, centre) {
      casters[index].mesh.position.set(...centre);
    },
    sample,
    /** Where the rig actually put the light, against the oracle's sun. */
    lightPose: () => {
      const d = light.position.clone().sub(light.target.position).normalize();
      return {
        sunDir,
        rendered: [d.x, d.y, d.z],
        position: light.position.toArray(),
        target: light.target.position.toArray(),
      };
    },
    state: () => ({ ...state }),
  };
  window.__arShadowsLab = api;

  syncPanel = bindPanel(state, (patch) =>
    api.configure({ ...state, ...patch }),
  );
  rebuild();
  syncPanel();
  renderer.setAnimationLoop(renderFrame);
  api.ready = true;
}

/**
 * The on-page controls, for looking at it by eye on a phone. Returns
 * `sync()`, which shows the current state (the test API configures the page
 * directly, and the panel must not keep showing the previous sun).
 */
function bindPanel(state, apply) {
  const elevation = document.getElementById("sun-elevation");
  const azimuth = document.getElementById("sun-azimuth");
  const readout = document.getElementById("sun-readout");
  const mutation = document.getElementById("mutation");
  const boxes = [
    ["room-mesh", "mesh"],
    ["fallback", "fallback"],
    ["show-room", "showRoom"],
  ].map(([id, key]) => [document.getElementById(id), key]);
  const sync = () => {
    elevation.value = String(state.elevationDeg);
    azimuth.value = String(state.azimuthDeg);
    readout.textContent = `${state.elevationDeg}° up, ${state.azimuthDeg}°`;
    for (const [box, key] of boxes) box.checked = state[key];
    mutation.value = state.mutation ?? "";
  };
  elevation.addEventListener("input", () =>
    apply({ elevationDeg: Number(elevation.value) }),
  );
  azimuth.addEventListener("input", () =>
    apply({ azimuthDeg: Number(azimuth.value) }),
  );
  for (const [box, key] of boxes) {
    box.addEventListener("change", () => apply({ [key]: box.checked }));
  }
  mutation.addEventListener("change", () =>
    apply({ mutation: mutation.value || null }),
  );
  return sync;
}

try {
  start();
} catch (e) {
  window.__arShadowsLab = { ready: false, error: String(e?.stack ?? e) };
  document.getElementById("lab-error").textContent = String(e);
  throw e;
}
