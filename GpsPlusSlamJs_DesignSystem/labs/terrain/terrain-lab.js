/**
 * The terrain lab (terrain plan 2026-09-27-0605, T1): a map-style 3D relief
 * of the Blue Ridge from coarse Terrarium tiles, in style A "Pastel atlas",
 * with an exaggeration slider (1-10, default 2) and an "auto" switch (off
 * by default), orbit and zoom, three camera presets and a scripted fly-in.
 * Every parameter sits on the control plate and in the hash, as in the
 * globe lab, so a link reproduces a view.
 *
 * The page fetches the tiles (so the smoke's routing sees every request,
 * plan §9 finding 4) and a worker decodes and precomputes them
 * (`terrain-worker.js`). The logic lives in the dependency-free modules
 * beside this file, which `node --test` covers; this file is the wiring.
 *
 * @see terrain-lab.js.md
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  TERRARIUM_URL_TEMPLATE,
  toWorldPixel,
} from "/osm-lib/elevation/terrarium.js";
import { enuFrameAt } from "/osm-lib/mesh/enu.js";
import { regionTiles } from "./terrain-mosaic.js";
import { packTerrain } from "./terrain-precompute.js";
import {
  AUTO_RULE,
  SLOPE_BOOST,
  autoFactor,
  effectiveExaggeration,
  slopeBoost,
  smoothAltitude,
  viewWidthM,
} from "./terrain-exaggeration.js";
import { PASTEL_ATLAS, hexToRgb, rampLut } from "./terrain-style.js";
import {
  CAMERA_PRESETS,
  flyInPose,
  orbitPosition,
  poseFromPosition,
  poseHashValues,
  poseSettled,
} from "./terrain-camera.js";
import {
  FIELD,
  PARAMS,
  TERRAIN_PLACES,
  fieldSpec,
  readTerrainParams,
} from "./terrain-params.js";
import {
  TERRAIN_CREDITS,
  TERRAIN_CREDIT_LINKS,
  TERRAIN_CREDIT_SHORT,
} from "./terrain-credits.js";
import {
  createTerrainGeometry,
  createTerrainMaterial,
  createTerrainTextures,
} from "./terrain-material.js";

const canvas = document.getElementById("terrain-canvas");
const errorBox = document.getElementById("terrain-error");
const loadingLabel = document.getElementById("terrain-loading");
const readout = document.getElementById("terrain-readout");
const costLine = document.getElementById("terrain-cost");
const creditsBox = document.getElementById("terrain-credits");

const DEG = Math.PI / 180;
/** The page behind the relief; the silhouette smoke keys on it. */
const BACKGROUND = "#e4e8ec";
/** The mesh's vertex pitch: every second post (plan §9 finding 20: one density). */
const MESH_STEP_M = 2 * FIELD.spacingM;
/** A tile request that never answers must not stall the lab forever. */
const TILE_TIMEOUT_MS = 30_000;
/** The preset the page opens on: the tilted view of the screenshots. */
const DEFAULT_PRESET = "oblique";

/** The hash with several keys set at once (null removes one). */
function hashWithAll(values) {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const [key, value] of Object.entries(values)) {
    if (value === null) params.delete(key);
    else params.set(key, String(value));
  }
  return params.toString();
}

/** A value for an output label: at most two decimals. */
const shown = (value) => String(Math.round(value * 100) / 100);

/**
 * The loading line (the async-feedback rule): shown while tiles load and
 * while the relief is computed, hidden once the terrain is drawn. `history`
 * records every distinct text, so a test reads the sequence instead of
 * racing it.
 */
function loadingView() {
  const history = [];
  return {
    history,
    show(text) {
      loadingLabel.textContent = text;
      loadingLabel.hidden = text === "";
      if (text !== "" && history.at(-1) !== text) history.push(text);
    },
  };
}

/** The credits line: the short text, and every source in a <details>. */
function renderCredits() {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = TERRAIN_CREDIT_SHORT;
  const list = document.createElement("ul");
  for (const text of TERRAIN_CREDITS) {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  }
  for (const { text, href } of TERRAIN_CREDIT_LINKS) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = text;
    item.append(link);
    list.append(item);
  }
  details.append(summary, list);
  creditsBox.replaceChildren(details);
}

/**
 * Fetches every tile on the page's thread (plan §9 finding 4), each bounded
 * by a timeout; a failure is a gap (`bytes: null`), never a thrown batch.
 */
async function fetchTiles(tiles, onProgress) {
  let done = 0;
  return Promise.all(
    tiles.map(async (t) => {
      const url = TERRARIUM_URL_TEMPLATE.replace("{z}", String(t.z))
        .replace("{x}", String(t.x))
        .replace("{y}", String(t.y));
      let bytes = null;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
        });
        if (response.ok) bytes = await response.arrayBuffer();
      } catch {
        bytes = null;
      }
      done += 1;
      onProgress(done);
      return { ...t, url, bytes };
    }),
  );
}

/**
 * The control plate: every [data-hash-key] field writes its key and applies
 * at once (replacing the history entry, so a drag does not flood the back
 * button); [data-preset] buttons choose a camera. `sync` sets the fields
 * from the params.
 */
function bindPanel(getParams, apply) {
  const fields = [...document.querySelectorAll("[data-hash-key]")];
  const show = (key, value) => {
    const out = document.querySelector(`output[data-for="${key}"]`);
    if (out) out.textContent = value;
  };
  const write = (values) => {
    history.replaceState(null, "", `#${hashWithAll(values)}`);
    apply();
  };
  for (const field of fields) {
    const range = PARAMS[field.dataset.hashKey];
    if (range && field.tagName !== "SELECT") {
      field.min = String(range.min);
      field.max = String(range.max);
    }
    const event = field.tagName === "SELECT" ? "change" : "input";
    field.addEventListener(event, () =>
      write({ [field.dataset.hashKey]: field.value }),
    );
  }
  for (const button of document.querySelectorAll("[data-preset]")) {
    button.addEventListener("click", () =>
      write({
        preset: button.dataset.preset,
        alt: null,
        tilt: null,
        head: null,
        // A new press of "Fly in" restarts it even when the hash is equal.
        fly: button.dataset.preset === "fly" ? Date.now() : null,
      }),
    );
  }
  return {
    write,
    sync() {
      const params = getParams();
      for (const field of fields) {
        const key = field.dataset.hashKey;
        field.value = String(params[key]);
        show(key, shown(params[key]));
      }
    },
  };
}

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(BACKGROUND);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 10, 1e7);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.maxPolarAngle = 89 * DEG;
  controls.minDistance = 2_000;
  controls.maxDistance = 3_000_000;

  let params = readTerrainParams(location.hash.slice(1));
  let appliedHash = location.hash.slice(1);
  const place = TERRAIN_PLACES[params.place];
  const spec = fieldSpec(place);
  const frame = enuFrameAt(place.centre);
  const tiles = regionTiles(spec, {
    toLatLng: (p) => frame.toLatLng(p),
    toWorldPixel,
  });
  const loading = loadingView();
  renderCredits();

  const run = {
    tilesLoaded: 0,
    tilesFailed: 0,
    bytes: 0,
    relief: null,
    svfMs: null,
    buildId: 0,
    fetched: null,
  };
  const errors = new Set();
  const showErrors = () => {
    errorBox.textContent = [...params.notes, ...errors].join(" ");
  };

  /**
   * Ends any damping motion at once: with damping off, one update applies
   * the remaining turn and clears it. Without this a pose applied during a
   * drag's damping would keep drifting after it was set.
   */
  const finishDamping = () => {
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
  };
  /** The camera from a pose; OrbitControls keeps orbiting from there. */
  const setPose = (pose) => {
    finishDamping();
    camera.position.fromArray(orbitPosition(pose));
    controls.target.set(0, 0, 0);
    camera.lookAt(controls.target);
    controls.update();
  };
  const flight = { phase: "idle", startedAt: 0, samples: [] };
  const cameraKey = (p) =>
    JSON.stringify([
      p.camera,
      p.preset,
      new URLSearchParams(location.hash.slice(1)).get("fly"),
    ]);
  let appliedCameraKey = null;
  const applyCamera = () => {
    const key = cameraKey(params);
    if (key === appliedCameraKey) return;
    appliedCameraKey = key;
    if (params.camera) {
      flight.phase = "idle";
      setPose(params.camera);
    } else if (params.preset === "fly") {
      flight.phase = "flying";
      flight.startedAt = performance.now();
      flight.samples = [];
      setPose(flyInPose(0));
    } else {
      flight.phase = "idle";
      setPose(CAMERA_PRESETS[params.preset ?? DEFAULT_PRESET]);
    }
  };

  let mesh = null;
  let material = null;
  let textures = null;
  let lastUserWrite = 0;

  const panel = bindPanel(
    () => params,
    () => onHash(),
  );
  /** Reads the hash and applies it; a sky-view change recomputes. */
  const onHash = () => {
    const next = readTerrainParams(location.hash.slice(1));
    const recompute = next.svf !== params.svf;
    params = next;
    applyCamera();
    applyLive();
    panel.sync();
    showErrors();
    appliedHash = location.hash.slice(1);
    if (recompute && run.fetched) build(run.fetched);
  };
  const applyLive = () => {
    if (!material) return;
    const u = material.uniforms;
    u.uGreenAmount.value = params.green;
    u.uShadow.value = params.shadow;
  };
  window.addEventListener("hashchange", onHash);
  // A drag or a wheel writes the pose into the hash, so the link still
  // reproduces the view (the preset no longer describes it). NOT at `end`:
  // the damping keeps turning the camera after the finger lifts. Once a frame
  // moves it by less than a perceptible step (`poseSettled`), the rest of
  // the damping is applied at once and the pose it lands on is written
  // (T0/T1 review finding 12).
  const settle = { active: false, last: null };
  controls.addEventListener("start", () => {
    settle.active = false;
  });
  controls.addEventListener("end", () => {
    settle.active = true;
    settle.last = null;
  });
  const currentPose = () =>
    poseFromPosition(camera.position.clone().sub(controls.target).toArray());
  /** Called each frame after the controls update. */
  const writePoseWhenSettled = () => {
    if (!settle.active) return;
    const pose = currentPose();
    if (settle.last !== null && poseSettled(settle.last, pose)) {
      settle.active = false;
      finishDamping();
      lastUserWrite = performance.now();
      panel.write({
        preset: null,
        fly: null,
        ...poseHashValues(currentPose()),
      });
      return;
    }
    settle.last = pose;
  };

  const worker = new Worker(new URL("./terrain-worker.js", import.meta.url), {
    type: "module",
  });
  const fail = (message) => {
    errors.add(message);
    showErrors();
    loading.show("");
    window.__terrainLab.ready = true;
  };
  // `||`: an ErrorEvent can carry an EMPTY message (a failed module load).
  worker.onerror = (event) =>
    fail(`The relief worker failed: ${event.message || "unknown error"}`);
  worker.onmessageerror = () =>
    fail("The relief worker sent an unreadable message.");

  const lut = rampLut(PASTEL_ATLAS.land);
  /**
   * Posts a build of the fetched tiles. The worker gets COPIES of the bytes,
   * transferred (not cloned a second time): the originals stay here for a
   * rebuild when the sky view setting changes.
   */
  const build = (fetched) => {
    run.buildId += 1;
    run.svfMs = null;
    loading.show("Computing relief...");
    const copies = fetched.map(({ z, x, y, bytes }) => ({
      z,
      x,
      y,
      bytes: bytes === null ? null : bytes.slice(0),
    }));
    const message = {
      type: "build",
      id: run.buildId,
      spec: {
        ...spec,
        reliefSigmaM: FIELD.reliefSigmaM,
        detailSigmaPosts: FIELD.detailSigmaPosts,
      },
      tiles: copies,
      svf: { directions: params.svf, steps: FIELD.svfSteps },
    };
    worker.postMessage(
      message,
      copies.flatMap((t) => (t.bytes === null ? [] : [t.bytes])),
    );
  };

  worker.onmessage = (event) => {
    const m = event.data;
    if (m.id !== run.buildId) return;
    if (m.type === "error") {
      fail(`The relief could not be computed: ${m.message}`);
      return;
    }
    if (m.type === "relief") {
      run.relief = m;
      const failed = run.tilesFailed + m.decodeFailures;
      errors.clear();
      if (!m.hasData) {
        errors.add("No elevation tile could load: there is no relief to draw.");
      } else if (failed > 0 || m.missing > 0) {
        // By post count: that is what the hatch shows (a failed tile can
        // cover the padding ring only, which is never drawn).
        errors.add(
          `${m.missing} of ${m.total} height posts have no data (${failed} of ${tiles.length} elevation tiles could not load): they are hatched.`,
        );
      }
      showErrors();
      const packed = packTerrain({ ...m.fields, svf: null }, m.side, (v) =>
        THREE.DataUtils.toHalfFloat(v),
      );
      textures?.data.dispose();
      textures?.aux.dispose();
      textures?.lut.dispose();
      textures = createTerrainTextures({ ...packed, side: m.side, lut });
      if (!mesh) {
        material = createTerrainMaterial(PASTEL_ATLAS, textures, m);
        mesh = new THREE.Mesh(
          createTerrainGeometry(spec.halfExtentM, MESH_STEP_M),
          material,
        );
        // The vertex shader lifts the grid: its flat bounds would cull it.
        mesh.frustumCulled = false;
        scene.add(mesh);
      } else {
        material.uniforms.uData.value = textures.data;
        material.uniforms.uAux.value = textures.aux;
        material.uniforms.uLut.value = textures.lut;
        material.uniforms.uDatum.value = m.datum;
      }
      run.aux = packed.rgba8;
      applyLive();
      loading.show(params.svf > 0 && m.hasData ? "Computing sky view..." : "");
      window.__terrainLab.ready = true;
      return;
    }
    if (m.type === "svf") {
      // Only the aux texture's blue channel changes.
      for (let i = 0; i < m.svf.length; i++) {
        run.aux[i * 4 + 2] = Math.min(
          255,
          Math.max(0, Math.round(m.svf[i] * 255)),
        );
      }
      textures.aux.needsUpdate = true;
      run.svfMs = m.ms;
      loading.show("");
    }
  };

  loading.show(`Loading elevation tiles: 0 of ${tiles.length}`);
  fetchTiles(tiles, (done) =>
    loading.show(`Loading elevation tiles: ${done} of ${tiles.length}`),
  ).then((fetched) => {
    run.fetched = fetched;
    run.tilesLoaded = fetched.filter((t) => t.bytes !== null).length;
    run.tilesFailed = fetched.length - run.tilesLoaded;
    run.bytes = fetched.reduce((sum, t) => sum + (t.bytes?.byteLength ?? 0), 0);
    build(fetched);
  });

  applyCamera();
  panel.sync();
  showErrors();

  let fittedSize = "";
  let lastFrame = performance.now();
  let smoothedAltitude = null;
  const live = { effectiveE: params.exag, factor: 1, widthM: 0, boost: 1 };
  let readoutText = "";
  const frameOnce = () => {
    const now = performance.now();
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (`${w}x${h}` !== fittedSize) {
      fittedSize = `${w}x${h}`;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (flight.phase === "flying") {
      const t = params.flyMs > 0 ? (now - flight.startedAt) / params.flyMs : 1;
      const pose = flyInPose(t);
      setPose(pose);
      flight.samples.push(Math.round(pose.altitudeM));
      if (t >= 1) flight.phase = "done";
      controls.enabled = false;
    } else {
      controls.enabled = true;
      controls.update();
      writePoseWhenSettled();
    }
    const altitudeM = Math.max(1, camera.position.y);
    smoothedAltitude =
      smoothedAltitude === null
        ? altitudeM
        : smoothAltitude(smoothedAltitude, altitudeM, dt, params.tau);
    const rule = { ...AUTO_RULE, exponent: params.autoExp };
    live.widthM = viewWidthM(smoothedAltitude);
    live.factor = autoFactor(live.widthM, rule);
    live.effectiveE = effectiveExaggeration({
      slider: params.exag,
      auto: params.auto === 1,
      altitudeM: smoothedAltitude,
      rule,
    });
    live.boost = slopeBoost(live.widthM, {
      ...SLOPE_BOOST,
      exponent: params.boostExp,
    });
    if (material) {
      material.uniforms.uExag.value = live.effectiveE;
      material.uniforms.uGain.value = params.shade * live.boost;
    }
    const distance = camera.position.distanceTo(controls.target);
    camera.near = Math.max(10, distance * 0.002);
    camera.far = distance * 4 + 600_000;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const text =
      `Exaggeration ${live.effectiveE.toFixed(1)}x` +
      (params.auto === 1
        ? ` (slider ${shown(params.exag)} x auto ${live.factor.toFixed(2)} at a ${Math.round(live.widthM / 1000)} km view)`
        : " (slider)");
    if (text !== readoutText) {
      readoutText = text;
      readout.textContent = text;
    }
    const r = run.relief;
    costLine.textContent = r
      ? `${run.tilesLoaded} of ${tiles.length} tiles, ${Math.round(run.bytes / 1024)} KiB; decode ${Math.round(r.decodedMs)} ms, relief ${Math.round(r.reliefMs)} ms` +
        (run.svfMs === null ? "" : `, sky view ${Math.round(run.svfMs)} ms`)
      : "";
  };
  renderer.setAnimationLoop(frameOnce);

  /** One read of the drawing buffer after a render, as RGBA bytes. */
  const readBuffer = () => {
    frameOnce();
    const gl = renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const px = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { width, height, px };
  };
  // The clear colour as the canvas holds it: sRGB bytes (three converts it
  // for the output), not THREE.Color's linear components.
  const bg = hexToRgb(BACKGROUND).map((v) => Math.round(v * 255));

  window.__terrainLab = {
    ready: false,
    error: null,
    background: bg,
    // One frame first, so E, W and the readout describe the current hash.
    state: () => {
      frameOnce();
      return {
        appliedHash,
        place: params.place,
        style: params.style,
        exag: params.exag,
        auto: params.auto,
        effectiveE: live.effectiveE,
        autoFactor: live.factor,
        viewWidthM: live.widthM,
        slopeBoost: live.boost,
        altitudeM: camera.position.y,
        pose: poseFromPosition(
          camera.position.clone().sub(controls.target).toArray(),
        ),
        flight: { phase: flight.phase, samples: flight.samples.slice() },
        tiles: tiles.map((t) => `${t.z}/${t.x}/${t.y}`),
        tilesLoaded: run.tilesLoaded,
        tilesFailed: run.tilesFailed,
        bytes: run.bytes,
        datum: run.relief?.datum ?? null,
        hasData: run.relief?.hasData ?? null,
        missing: run.relief?.missing ?? null,
        total: run.relief?.total ?? null,
        missingTiles: run.relief?.missingTiles ?? null,
        reliefM: run.relief?.reliefM ?? null,
        svfDone: run.svfMs !== null,
        loadingHistory: loading.history.slice(),
        loadingVisible: !loadingLabel.hidden,
        errorText: errorBox.textContent,
        readout: readout.textContent,
        // Plan §9 finding 13: no FloatType texture, ever.
        textureTypes: textures
          ? Object.fromEntries(
              Object.entries(textures).map(([k, t]) => [k, t.type]),
            )
          : null,
        floatType: THREE.FloatType,
        halfFloatType: THREE.HalfFloatType,
        lastUserWrite,
      };
    },
    /** Where a point [x, y, z] (three's frame, metres) is on the canvas, 0-1. */
    project([x, y, z]) {
      frameOnce();
      const p = new THREE.Vector3(x, y, z).project(camera);
      return [(p.x + 1) / 2, (1 - p.y) / 2];
    },
    /** A position's ENU metres in the lab's frame (x east, y north). */
    toEnu: (lat, lng) => frame.toEnu({ lat, lng }),
    /** RGBA bytes at normalised canvas points (0,0 top-left). */
    readPixels(points) {
      const { width, height, px } = readBuffer();
      return points.map(([u, v]) => {
        const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
        const y = Math.min(
          height - 1,
          Math.max(0, Math.floor((1 - v) * height)),
        );
        const i = 4 * (y * width + x);
        return [px[i], px[i + 1], px[i + 2], px[i + 3]];
      });
    },
    /**
     * For each column (normalised u), the first row from the top whose
     * pixel is not the background (within `tolerance` per channel), as a
     * normalised v; null for a column that is all background.
     */
    silhouette(columns, tolerance = 2) {
      const { width, height, px } = readBuffer();
      return columns.map((u) => {
        const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
        for (let row = 0; row < height; row++) {
          const i = 4 * ((height - 1 - row) * width + x);
          const differs = [0, 1, 2].some(
            (c) => Math.abs(px[i + c] - bg[c]) > tolerance,
          );
          if (differs) return (row + 0.5) / height;
        }
        return null;
      });
    },
  };
}

try {
  start();
} catch (e) {
  window.__terrainLab = { ready: false, error: String(e?.stack ?? e) };
  errorBox.textContent = String(e);
  throw e;
}
