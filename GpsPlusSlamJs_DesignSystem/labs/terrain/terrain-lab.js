/**
 * The terrain lab (terrain plan 2026-09-27-0605, T1-T3): a map-style 3D
 * relief from coarse Terrarium tiles, in five styles (A "Pastel atlas", B
 * "Natural colour", C "Globe blend", D "Swiss classic", E "Clay"), at four
 * places (the Blue Ridge, the Alps, northern Germany and the viewer's GPS
 * position), with an exaggeration slider (1-10, default 3) and an "auto"
 * switch (off by default), orbit and zoom, three camera presets and a
 * scripted fly-in.
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
  NATURAL,
  SHADER_STYLE,
  SWISS,
  naturalBaseColour,
} from "./terrain-styles.js";
import {
  FAR_FIELD,
  farFieldAt,
  farFieldGrid,
  farWeights,
  imageryTiles,
  regionBox,
  sampleImagery,
  sampleImageryLand,
} from "./terrain-far-field.js";
import {
  CLASS_SWEEP,
  GLOBE_CLASSES,
  classSweep,
} from "./terrain-globe-classes.js";
import { globeSource } from "/globe/globe-sources.js";
import {
  readGlobeClockSetting,
  sameGlobeClockSetting,
  startGlobeClock,
} from "/globe/globe-clock.js";
import { solarPosition } from "/fw/geo/solar-position.js";
import { MAP_KEY_LIGHT, sunDownNote, sunEnuFromGlobe } from "./terrain-sun.js";
import {
  GLOBE_ALBEDO,
  bandRamp,
  bandRampLut,
  bandSweep,
  boxMeanAt,
  footprintLuminanceGrid,
  footprintM,
  linearLuminance,
  summedArea,
} from "./terrain-globe-colour.js";
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
  GPS_PLACE,
  IMAGERY_STYLES,
  PARAMS,
  fieldSpec,
  pixelRatioFor,
  placeFor,
  readTerrainParams,
} from "./terrain-params.js";
import { labelFor, locateAdvice, locateOnce } from "/fw/utils/locate-state.js";
import {
  TERRAIN_CREDITS,
  TERRAIN_CREDIT_LINKS,
  TERRAIN_CREDIT_SHORT,
} from "./terrain-credits.js";
import {
  applyStyle,
  createFarTexture,
  createLutTexture,
  EMPTY_TEXTURE,
  createScalarTexture,
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
const linesLabel = document.getElementById("terrain-lines");
const pinButton = document.getElementById("terrain-pin");
const pinStatus = document.getElementById("terrain-pin-status");

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

/**
 * The lowest and highest land (m, absolute) over the posts that are data,
 * with sea level as the floor: style D spreads its contrast over it.
 */
function landRange(height, valid, datum) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < height.length; i++) {
    if (!valid[i]) continue;
    const h = height[i] + datum;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return Number.isFinite(lo) ? [Math.max(0, lo), Math.max(0, hi)] : [0, 4000];
}

/** How long the pin waits for a fix, as the globe's pin and OsmDemo do. */
const LOCATE_TIMEOUT_MS = 15_000;
/** What the pin's line says while `place=gps` waits for a press. */
const GPS_PROMPT =
  "Press the location pin (bottom right) to load the terrain around you.";

/**
 * The location pin (DEC-TR-3's GPS place): a PRESS asks for the position
 * (the framework's `locateOnce`), never the page's load; a second press
 * while it waits cancels (a browser can leave the request pending while its
 * permission prompt is open), and an answer for a cancelled request is
 * dropped. A failure names its fix (`labelFor`, `locateAdvice`) and
 * returns the pin to idle with the locate atom's warning look; a fix calls
 * `onFix`. The button carries the state in its `aria-label`, `title`,
 * `aria-busy` and `data-state` (the design system's locate atom).
 *
 * A fix is not yet the terrain: the line says the region is loading until
 * the page calls `regionSettled` with how the build ended (the async-
 * feedback rule's durable end state; review 2026-09-29 B5).
 */
function bindPin(onFix) {
  let phase = "idle";
  let failure = null;
  let located = false;
  let message = "";
  let request = 0;
  /** The line to show once the fix's region is drawn; null when none waits. */
  let drawnMessage = null;
  const render = () => {
    const locating = phase === "locating";
    const label = locating
      ? "Finding you... - tap to cancel"
      : "Load the terrain around my location";
    pinButton.setAttribute("aria-label", label);
    pinButton.title = label;
    pinButton.setAttribute("aria-busy", String(locating));
    pinButton.dataset.state = locating
      ? "locating"
      : (failure ?? (located ? "located" : "idle"));
    pinStatus.textContent = locating ? label : message;
  };
  pinButton.addEventListener("click", async () => {
    const mine = ++request;
    failure = null;
    drawnMessage = null;
    if (phase === "locating") {
      phase = "idle";
      message = "Stopped looking for your location.";
      render();
      return;
    }
    phase = "locating";
    message = "";
    render();
    const outcome = await locateOnce(navigator.geolocation, {
      timeoutMs: LOCATE_TIMEOUT_MS,
    });
    if (mine !== request || phase !== "locating") return;
    phase = "idle";
    if (outcome.kind === "failed") {
      failure = outcome.state;
      message = `${labelFor(outcome.state)}: ${locateAdvice(outcome.state)}`;
      render();
      return;
    }
    located = true;
    const accuracy = outcome.fix.accuracyM;
    const within =
      accuracy === undefined ? "" : ` (located to ${Math.round(accuracy)} m)`;
    message = `Found you${within}: loading the terrain around you...`;
    drawnMessage = `The terrain around you${within}.`;
    render();
    onFix({ lat: outcome.fix.lat, lng: outcome.fix.lng });
  });
  render();
  return {
    phase: () => phase,
    /** A line for the idle pin (the GPS place waiting for a press). */
    say(text) {
      if (phase !== "idle") return;
      message = text;
      render();
    },
    /**
     * How the build for the last fix ended: `drawn`, `failed` (no data, or
     * the worker failed; the error line says why) or `replaced` (another
     * place was chosen first). Does nothing when no fix's region waits.
     */
    regionSettled(outcome) {
      if (drawnMessage === null) return;
      message =
        outcome === "drawn"
          ? drawnMessage
          : outcome === "failed"
            ? "Found you, but the terrain around you could not be drawn."
            : "";
      drawnMessage = null;
      render();
    },
  };
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

/**
 * The credits line: the short text, and every source in a <details>. With
 * the far field on, the globe's imagery credit joins it (the globe's own
 * registry, `globe-sources.ts`, so the text is the globe's).
 */
function renderCredits(withImagery) {
  const imagery = globeSource("blue-marble").credit;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent =
    TERRAIN_CREDIT_SHORT + (withImagery ? ` Imagery: ${imagery.short}.` : "");
  const list = document.createElement("ul");
  for (const text of TERRAIN_CREDITS) {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  }
  const links = withImagery
    ? [...TERRAIN_CREDIT_LINKS, { text: imagery.full, href: imagery.href }]
    : TERRAIN_CREDIT_LINKS;
  for (const { text, href } of links) {
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
      // A style's own controls show only with it (`data-styles`).
      for (const el of document.querySelectorAll("[data-styles]")) {
        el.hidden = !el.dataset.styles.split(" ").includes(params.style);
      }
    },
  };
}

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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
  // The device's ratio (capped at 2) unless `dpr` pins one: the comparison
  // page reads its contrast from pixels (review 2026-10-01-1650 M1).
  renderer.setPixelRatio(pixelRatioFor(params.dpr, window.devicePixelRatio));
  /**
   * The scene's clock, the globe lab's own (`time=`, `timeScale=`), which
   * the sun reads with `light` 1 (globe round-5 plan §3.3).
   */
  const startClock = (setting) =>
    startGlobeClock(setting, {
      epochMs: Date.now(),
      monoMs: performance.now(),
    });
  let clockSetting = readGlobeClockSetting(
    new URLSearchParams(location.hash.slice(1)),
  );
  let clock = startClock(clockSetting);
  /** The light the relief is drawn with this frame, for the hooks. */
  const sunState = { enu: [...MAP_KEY_LIGHT], timeMs: null };
  /** The position a press of the pin found; never in the hash. */
  let gpsFix = null;
  /**
   * The region drawn: its place, field, frame and tiles, all null while
   * `place=gps` waits for a press of the pin. `loadRegion` sets them.
   */
  let place = null;
  let spec = null;
  let frame = null;
  let tiles = [];
  const loading = loadingView();
  let creditsWithImagery = params.imageryOn;
  renderCredits(creditsWithImagery);
  /** The region's lowest and highest land, for style D's contrast. */
  let hRange = [0, 4000];

  const run = {
    tilesLoaded: 0,
    tilesFailed: 0,
    bytes: 0,
    relief: null,
    svfMs: null,
    buildId: 0,
    fetched: null,
    fields: null,
    /** Bumped by every region, so an answer for an old one is dropped. */
    regionId: 0,
  };
  const errors = new Set();
  /**
   * The far field (style C): the globe's imagery, loaded the first time a
   * style needs it, as a grid over the region (`terrain-far-field.js`).
   */
  const far = {
    state: "idle",
    tiles: null,
    grid: null,
    texture: null,
    error: null,
    regionId: 0,
  };
  /** The sun-down note while the globe's sun lights the relief at night. */
  let sunNote = null;
  const showErrors = () => {
    errorBox.textContent = [
      ...params.notes,
      ...(sunNote ? [sunNote] : []),
      ...errors,
      ...(far.error && params.imageryOn ? [far.error] : []),
    ].join(" ");
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

  /** The canvas size the renderer was last fitted to ("" refits). */
  let fittedSize = "";
  let mesh = null;
  let material = null;
  let textures = null;
  let lastUserWrite = 0;

  const panel = bindPanel(
    () => params,
    () => onHash(),
  );
  /**
   * Reads the hash and applies it; another place loads its region, a
   * sky-view change recomputes the one drawn.
   */
  const onHash = () => {
    const next = readTerrainParams(location.hash.slice(1));
    const nextClock = readGlobeClockSetting(
      new URLSearchParams(location.hash.slice(1)),
    );
    if (!sameGlobeClockSetting(nextClock, clockSetting)) {
      clockSetting = nextClock;
      clock = startClock(clockSetting);
    }
    const moved = next.place !== params.place;
    const recompute = next.svf !== params.svf;
    if (next.dpr !== params.dpr) {
      renderer.setPixelRatio(pixelRatioFor(next.dpr, window.devicePixelRatio));
      fittedSize = "";
    }
    params = next;
    applyCamera();
    applyLive();
    panel.sync();
    showErrors();
    appliedHash = location.hash.slice(1);
    if (moved) loadRegion();
    else if (recompute && run.fetched) build(run.fetched);
  };
  const applyLive = () => {
    if (params.imageryOn && far.state === "idle") loadFarField();
    if (params.imageryOn !== creditsWithImagery) {
      creditsWithImagery = params.imageryOn;
      renderCredits(creditsWithImagery);
    }
    if (!material || !place) return;
    applyStyle(material, params, {
      shaderStyle: SHADER_STYLE[params.style],
      latDeg: place.centre.lat,
      hRange,
    });
    updateGlobeColour();
    const u = material.uniforms;
    const lat = place.centre.lat;
    linesLabel.textContent =
      `Tree line ${Math.round(u.uTreeM.value)} m, snow line ${Math.round(u.uSnowM.value)} m ` +
      `(fitted for ${Math.abs(lat).toFixed(1)}° ${lat < 0 ? "S" : "N"}, off by up to ~500 m)`;
  };
  /** Fetches, decodes and grids the imagery; a failure turns it off, said. */
  const loadFarField = async () => {
    if (!place) return;
    far.state = "loading";
    const mine = run.regionId;
    far.regionId = mine;
    const imageryLoading = "Loading Earth imagery...";
    if (loadingLabel.hidden) loading.show(imageryLoading);
    const source = globeSource("blue-marble");
    const pixelDeg = 180 / 2 ** FAR_FIELD.level / FAR_FIELD.tileSize;
    const box = regionBox((p) => frame.toLatLng(p), spec.halfExtentM, pixelDeg);
    try {
      far.tiles = await Promise.all(
        imageryTiles(box, FAR_FIELD.level).map(async (k) => {
          const url = source.path
            .replace("{z}", String(k.z))
            .replace("{x}", String(k.x))
            .replace("{y}", String(k.y));
          const response = await fetch(url, {
            signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          // As the elevation decoder does: no colour management, so the
          // bytes are the file's own.
          const bitmap = await createImageBitmap(await response.blob(), {
            colorSpaceConversion: "none",
            premultiplyAlpha: "none",
          });
          const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = surface.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          const { data } = context.getImageData(
            0,
            0,
            bitmap.width,
            bitmap.height,
          );
          return { ...k, width: bitmap.width, height: bitmap.height, data };
        }),
      );
      if (mine !== run.regionId) return;
      far.grid = farFieldGrid({
        side: FAR_FIELD.side,
        halfM: spec.halfExtentM,
        toLatLng: (p) => frame.toLatLng(p),
        sample: (lat, lng) => sampleImagery(far.tiles, lat, lng),
      });
      far.texture = createFarTexture(far.grid, FAR_FIELD.side);
      if (material) material.uniforms.uFar.value = far.texture;
      far.state = "ready";
      updateGlobeColour();
    } catch (e) {
      if (mine !== run.regionId) return;
      far.state = "failed";
      far.error = `The Earth imagery could not load (${e?.message ?? e}): the far field is off.`;
      showErrors();
    }
    if (loadingLabel.textContent === imageryLoading) loading.show("");
  };
  /**
   * The imagery styles' textures (globe round-5 §3.3,
   * `terrain-globe-colour.js`): the imagery as a 1 km albedo grid once it
   * has loaded, and for `globe-albedo`'s detail style B's ramp luminance
   * averaged over each imagery pixel's footprint, rebuilt when the relief
   * or style B's lines change. Built only while an imagery style is drawn.
   */
  const globeColour = {
    albedo: null,
    grid: null,
    albedoRegion: 0,
    coarse: null,
    coarseKey: null,
    coarseMs: null,
    /** globe-bands: the imagery pixels with their footprint heights. */
    samples: null,
    samplesKey: null,
    samplesMs: null,
    ramp: null,
    rampKey: null,
    lut: null,
    /** globe-bands: the share of land posts above the top band, and both heights. */
    clamp: null,
    /**
     * globe-classes: the imagery's land colour and its water share as 1 km
     * grids over the region (`sampleImageryLand`), and their textures.
     */
    classRegion: 0,
    classLand: null,
    classWater: null,
    classLandTexture: null,
    classWaterTexture: null,
  };
  /**
   * globe-bands' samples: every imagery pixel whose footprint lies in the
   * drawn region, with the mean height (absolute) over that footprint and
   * its global pixel indices `gx`, `gy` (the sweep's cross-validation
   * folds them in blocks, `foldOf`).
   */
  const bandSamples = () => {
    const f = run.fields;
    const heights = new Float64Array(f.height.length);
    for (let i = 0; i < heights.length; i++) {
      heights[i] = f.height[i] + run.relief.datum;
    }
    const sat = summedArea(heights, spec.side);
    const grid = {
      side: spec.side,
      spacingM: spec.spacingM,
      extentM: spec.extentM,
    };
    const lat0 = place.centre.lat;
    const [wx, wy] = footprintM(FAR_FIELD.level, lat0);
    const limit = spec.halfExtentM;
    const out = [];
    for (const t of far.tiles) {
      const size = t.width;
      const degPerPx = 180 / 2 ** t.z / size;
      for (let py = 0; py < size; py++) {
        const lat = 90 - (t.y * size + py + 0.5) * degPerPx;
        for (let px = 0; px < size; px++) {
          const lng = -180 + (t.x * size + px + 0.5) * degPerPx;
          const { x, y } = frame.toEnu({ lat, lng });
          if (Math.abs(x) + wx / 2 > limit || Math.abs(y) + wy / 2 > limit) {
            continue;
          }
          const h = boxMeanAt(sat, grid, x, y, wx, wy);
          if (h === null) continue;
          const i = 4 * (py * size + px);
          out.push({
            heightM: h,
            rgb: [t.data[i] / 255, t.data[i + 1] / 255, t.data[i + 2] / 255],
            gx: t.x * size + px,
            gy: t.y * size + py,
          });
        }
      }
    }
    return out;
  };
  /**
   * How globe-bands' top band clamps (review 2026-10-01-1650 m2): the ramp
   * is fitted on footprint-mean heights but read at the posts' own, and it
   * holds its last band's colour above that band's mean height, so every
   * post higher than it takes the top band's colour.
   */
  const topBandClamp = (ramp) => {
    const top = ramp.bands.at(-1);
    if (!top || !run.fields) return null;
    const f = run.fields;
    let land = 0;
    let above = 0;
    let highest = -Infinity;
    for (let i = 0; i < f.height.length; i++) {
      const h = f.height[i] + run.relief.datum;
      if (!f.valid[i] || h <= 0) continue;
      land += 1;
      if (h > top.heightM) above += 1;
      if (h > highest) highest = h;
    }
    return {
      topBandM: top.heightM,
      highestPostM: highest,
      share: land > 0 ? above / land : 0,
    };
  };
  /**
   * globe-classes' grids for the drawn region: the land colour (alpha 0
   * where the imagery cannot answer; the water's colour where a texel is
   * all water) and the water share (red), both on the albedo grid's texels.
   */
  const buildClassGrids = () => {
    const side = GLOBE_ALBEDO.side;
    const step = (2 * spec.halfExtentM) / side;
    const land = new Uint8Array(side * side * 4);
    const water = new Uint8Array(side * side * 4);
    const byte = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    for (let r = 0; r < side; r++) {
      for (let c = 0; c < side; c++) {
        const { lat, lng } = frame.toLatLng({
          x: -spec.halfExtentM + (c + 0.5) * step,
          y: -spec.halfExtentM + (r + 0.5) * step,
        });
        const s = sampleImageryLand(far.tiles, lat, lng);
        if (s === null) continue;
        const i = 4 * (r * side + c);
        land.set([...(s.rgb ?? GLOBE_CLASSES.water).map(byte), 255], i);
        water.set([byte(s.water), byte(s.water), byte(s.water), 255], i);
      }
    }
    globeColour.classLandTexture?.dispose();
    globeColour.classWaterTexture?.dispose();
    globeColour.classLand = land;
    globeColour.classWater = water;
    globeColour.classLandTexture = createFarTexture(land, side);
    globeColour.classWaterTexture = createFarTexture(water, side);
    globeColour.classRegion = run.regionId;
  };
  const updateGlobeColour = () => {
    if (
      !material ||
      !spec ||
      far.state !== "ready" ||
      !IMAGERY_STYLES.has(params.style)
    ) {
      return;
    }
    const u = material.uniforms;
    if (globeColour.albedoRegion !== run.regionId) {
      globeColour.albedo?.dispose();
      const grid = farFieldGrid({
        side: GLOBE_ALBEDO.side,
        halfM: spec.halfExtentM,
        toLatLng: (p) => frame.toLatLng(p),
        sample: (lat, lng) => sampleImagery(far.tiles, lat, lng),
      });
      globeColour.albedo = createFarTexture(grid, GLOBE_ALBEDO.side);
      globeColour.grid = grid;
      globeColour.albedoRegion = run.regionId;
    }
    u.uAlbedo.value = globeColour.albedo;
    if (params.style === "globe-classes") {
      if (globeColour.classRegion !== run.regionId) buildClassGrids();
      u.uClassLand.value = globeColour.classLandTexture;
      u.uClassWater.value = globeColour.classWaterTexture;
      return;
    }
    if (!run.fields || !run.relief) return;
    const key = JSON.stringify([
      run.regionId,
      run.buildId,
      params.tree,
      params.snow,
      params.aspect,
      params.rock,
    ]);
    if (key !== globeColour.coarseKey) {
      const started = performance.now();
      const f = run.fields;
      const lat = place.centre.lat;
      const o = {
        treeOffsetM: params.tree,
        snowOffsetM: params.snow,
        aspectSnowM: params.aspect,
        rockSlopeDeg: params.rock,
      };
      const fineLum = new Float64Array(f.height.length);
      for (let i = 0; i < fineLum.length; i++) {
        fineLum[i] = linearLuminance(
          naturalBaseColour(
            {
              heightM: f.height[i] + run.relief.datum,
              gx: f.gx[i],
              gy: f.gy[i],
              smallM: f.reliefSmall[i],
              spreadM: f.reliefStd[i],
              latDeg: lat,
            },
            o,
            NATURAL,
            1,
          ),
        );
      }
      const coarse = footprintLuminanceGrid({
        fineLum,
        grid: {
          side: spec.side,
          spacingM: spec.spacingM,
          extentM: spec.extentM,
        },
        halfM: spec.halfExtentM,
        side: GLOBE_ALBEDO.side,
        footprint: footprintM(FAR_FIELD.level, lat),
      });
      globeColour.coarse?.dispose();
      globeColour.coarse = createScalarTexture(coarse, GLOBE_ALBEDO.side, (v) =>
        THREE.DataUtils.toHalfFloat(v),
      );
      globeColour.coarseKey = key;
      globeColour.coarseMs = performance.now() - started;
    }
    u.uCoarseLum.value = globeColour.coarse;
    if (params.style !== "globe-bands") return;
    const sKey = JSON.stringify([run.regionId, run.buildId]);
    if (sKey !== globeColour.samplesKey) {
      const started = performance.now();
      globeColour.samples = bandSamples();
      globeColour.samplesKey = sKey;
      globeColour.samplesMs = performance.now() - started;
      globeColour.rampKey = null;
    }
    const rKey = JSON.stringify([sKey, params.band]);
    if (rKey !== globeColour.rampKey) {
      globeColour.ramp = bandRamp(globeColour.samples, {
        widthM: params.band,
      });
      globeColour.lut?.dispose();
      globeColour.lut = createLutTexture(bandRampLut(globeColour.ramp));
      globeColour.rampKey = rKey;
      globeColour.clamp = topBandClamp(globeColour.ramp);
    }
    u.uLutBands.value = globeColour.lut;
    u.uBandsOn.value = globeColour.ramp.bands.length > 0 ? 1 : 0;
    const sea = globeColour.ramp.sea;
    u.uBandSeaOn.value = sea === null ? 0 : 1;
    if (sea !== null) u.uBandSea.value.set(...sea);
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
    pin.regionSettled("failed");
    window.__terrainLab.ready = true;
  };
  // `||`: an ErrorEvent can carry an EMPTY message (a failed module load).
  worker.onerror = (event) =>
    fail(`The relief worker failed: ${event.message || "unknown error"}`);
  worker.onmessageerror = () =>
    fail("The relief worker sent an unreadable message.");

  const lut = rampLut(PASTEL_ATLAS.land);
  const lutSwiss = rampLut(SWISS.land);
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
      for (const t of Object.values(textures ?? {})) t.dispose();
      textures = createTerrainTextures({
        ...packed,
        side: m.side,
        lut,
        lutSwiss,
      });
      run.fields = m.fields;
      hRange = landRange(m.fields.height, m.fields.valid, m.datum);
      if (!mesh) {
        material = createTerrainMaterial(textures, m);
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
        material.uniforms.uLutSwiss.value = textures.lutSwiss;
        material.uniforms.uDatum.value = m.datum;
      }
      const u = material.uniforms;
      u.uHalfM.value = spec.halfExtentM;
      u.uFarDeltaM.value = (2 * spec.halfExtentM) / FAR_FIELD.side;
      u.uFarDeltaUv.value =
        (u.uFarDeltaM.value * (m.side - 1)) / (m.side * 2 * m.extentM);
      if (far.texture) u.uFar.value = far.texture;
      mesh.visible = true;
      run.aux = packed.rgba8;
      // The relief is new: its footprint luminance is rebuilt.
      globeColour.coarseKey = null;
      applyLive();
      loading.show(params.svf > 0 && m.hasData ? "Computing sky view..." : "");
      if (place?.id === GPS_PLACE) {
        pin.regionSettled(m.hasData ? "drawn" : "failed");
      }
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

  /**
   * Loads the region of the hash's place: its tiles fetched here (a
   * superseded region's answers are dropped), then built by the worker. The
   * mesh is hidden until the new relief arrives, so the old place is never
   * drawn under the new name. The GPS place without a fix loads nothing and
   * says what to press.
   */
  const loadRegion = () => {
    run.regionId += 1;
    run.buildId += 1;
    const mine = run.regionId;
    Object.assign(run, {
      tilesLoaded: 0,
      tilesFailed: 0,
      bytes: 0,
      relief: null,
      svfMs: null,
      fetched: null,
      fields: null,
    });
    far.texture?.dispose();
    Object.assign(far, {
      state: "idle",
      tiles: null,
      grid: null,
      texture: null,
      error: null,
    });
    // The imagery styles show style B until the new region's imagery is in.
    globeColour.coarseKey = null;
    globeColour.samplesKey = null;
    globeColour.samples = null;
    globeColour.ramp = null;
    globeColour.rampKey = null;
    globeColour.clamp = null;
    globeColour.grid = null;
    if (material) {
      material.uniforms.uAlbedo.value = EMPTY_TEXTURE;
      material.uniforms.uCoarseLum.value = EMPTY_TEXTURE;
      // globe-bands draws style B until this region's ramp exists, never
      // the previous region's (review 2026-10-01-1650 m6).
      material.uniforms.uBandsOn.value = 0;
      // globe-classes likewise, until this region's grids exist.
      material.uniforms.uClassLand.value = EMPTY_TEXTURE;
      material.uniforms.uClassWater.value = EMPTY_TEXTURE;
    }
    errors.clear();
    hRange = [0, 4000];
    if (mesh) mesh.visible = false;
    place = placeFor(params.place, gpsFix);
    if (place?.id !== GPS_PLACE) pin.regionSettled("replaced");
    if (!place) {
      spec = null;
      frame = null;
      tiles = [];
      loading.show("");
      pin.say(GPS_PROMPT);
      showErrors();
      window.__terrainLab.ready = true;
      return;
    }
    spec = fieldSpec(place);
    frame = enuFrameAt(place.centre);
    tiles = regionTiles(spec, {
      toLatLng: (p) => frame.toLatLng(p),
      toWorldPixel,
    });
    const count = tiles.length;
    showErrors();
    applyLive();
    loading.show(`Loading elevation tiles: 0 of ${count}`);
    fetchTiles(tiles, (done) => {
      if (mine === run.regionId) {
        loading.show(`Loading elevation tiles: ${done} of ${count}`);
      }
    }).then((fetched) => {
      if (mine !== run.regionId) return;
      run.fetched = fetched;
      run.tilesLoaded = fetched.filter((t) => t.bytes !== null).length;
      run.tilesFailed = fetched.length - run.tilesLoaded;
      run.bytes = fetched.reduce(
        (sum, t) => sum + (t.bytes?.byteLength ?? 0),
        0,
      );
      build(fetched);
    });
  };
  const pin = bindPin((fix) => {
    gpsFix = fix;
    if (params.place === GPS_PLACE) loadRegion();
    else panel.write({ place: GPS_PLACE });
  });

  applyCamera();
  // Starts the far field's imagery at once when the hash asks for it.
  applyLive();
  panel.sync();
  showErrors();

  let lastFrame = performance.now();
  let smoothedAltitude = null;
  const live = {
    effectiveE: params.exag,
    factor: 1,
    widthM: 0,
    boost: 1,
    far: { near: 1, relief: 0 },
  };
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
    live.far = farWeights(smoothedAltitude, {
      on: params.farOn && far.state === "ready",
      highKm: params.farHigh,
      lowKm: params.farLow,
    });
    // The key light: the globe's sun (the globe lab's own call, turned into
    // this place's frame) with `light` 1, the map styles' light otherwise.
    if (params.light === 1 && place) {
      sunState.timeMs = clock.timeAt(now);
      sunState.enu = sunEnuFromGlobe(
        solarPosition(sunState.timeMs, 0, 0),
        place.centre.lat,
        place.centre.lng,
      );
    } else {
      sunState.timeMs = null;
      sunState.enu = [...MAP_KEY_LIGHT];
    }
    const note =
      params.light === 1 && place
        ? sunDownNote(sunState.enu[2], sunState.timeMs)
        : null;
    if (note !== sunNote) {
      sunNote = note;
      showErrors();
    }
    if (material) {
      material.uniforms.uSun.value.set(...sunState.enu);
      material.uniforms.uSunIntensity.value = params.sunIntensity;
      material.uniforms.uLightMode.value = params.light;
      material.uniforms.uExag.value = live.effectiveE;
      material.uniforms.uGain.value = params.shade * live.boost;
      material.uniforms.uNearW.value = live.far.near;
      material.uniforms.uFarReliefW.value = live.far.relief;
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
        shaderStyle: material?.uniforms.uStyle.value ?? null,
        farOn: params.farOn,
        farState: far.state,
        farWeights: { ...live.far },
        imageryOn: params.imageryOn,
        detail: params.detail,
        globeColour: {
          albedo: globeColour.albedo !== null,
          coarse: globeColour.coarse !== null,
          coarseMs: globeColour.coarseMs,
          samples: globeColour.samples?.length ?? 0,
          samplesMs: globeColour.samplesMs,
          bands:
            params.style === "globe-bands" && globeColour.ramp
              ? globeColour.ramp.bands.map((b) => ({
                  heightM: Math.round(b.heightM),
                  count: b.count,
                  rgb: b.rgb.map((v) => Math.round(v * 255)),
                }))
              : null,
          bandsOn: material ? material.uniforms.uBandsOn.value === 1 : false,
          classes:
            globeColour.classRegion === run.regionId &&
            globeColour.classLand !== null,
          clamp: globeColour.clamp ? { ...globeColour.clamp } : null,
        },
        band: params.band,
        classWidth: params.classWidth,
        light: params.light,
        sunIntensity: params.sunIntensity,
        // The drawing buffer the pixels are read from, and the camera's
        // vertical field of view: the comparison's pixel scale.
        pixelRatio: renderer.getPixelRatio(),
        buffer: {
          width: renderer.getContext().drawingBufferWidth,
          height: renderer.getContext().drawingBufferHeight,
        },
        fovDeg: camera.fov,
        sun: {
          enu: sunState.enu.slice(),
          elevationDeg: (Math.asin(sunState.enu[2]) * 180) / Math.PI,
          timeMs: sunState.timeMs,
        },
        hRange: hRange.slice(),
        lines: material
          ? {
              treeM: material.uniforms.uTreeM.value,
              snowM: material.uniforms.uSnowM.value,
            }
          : null,
        credits: creditsBox.textContent,
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
        centre: place ? { ...place.centre } : null,
        awaitingFix: place === null,
        pin: pin.phase(),
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
    /** `project` for many points after ONE frame (a frame is slow on a CPU). */
    projectAll(points) {
      frameOnce();
      const v = new THREE.Vector3();
      return points.map(([x, y, z]) => {
        v.set(x, y, z).project(camera);
        return [(v.x + 1) / 2, (1 - v.y) / 2];
      });
    },
    /** A position's ENU metres in the lab's frame (x east, y north). */
    toEnu: (lat, lng) => frame?.toEnu({ lat, lng }) ?? null,
    /** ENU metres to a position. */
    toLatLng: (x, y) => frame?.toLatLng({ x, y }) ?? null,
    /**
     * The field the shader reads, bilinear at ENU metres: the absolute
     * height, the gradient (m/m east, north) and the small relief; null
     * before the relief or outside the field.
     */
    fieldAt(x, y) {
      if (!run.fields || !spec) return null;
      const side = spec.side;
      const gx = (x + spec.extentM) / spec.spacingM;
      const gy = (y + spec.extentM) / spec.spacingM;
      if (!(gx >= 0 && gy >= 0 && gx <= side - 1 && gy <= side - 1)) {
        return null;
      }
      const c0 = Math.min(side - 2, Math.floor(gx));
      const r0 = Math.min(side - 2, Math.floor(gy));
      const fx = gx - c0;
      const fy = gy - r0;
      const at = (grid) => {
        const i = r0 * side + c0;
        return (
          (grid[i] * (1 - fx) + grid[i + 1] * fx) * (1 - fy) +
          (grid[i + side] * (1 - fx) + grid[i + side + 1] * fx) * fy
        );
      };
      const f = run.fields;
      return {
        heightM: at(f.height) + run.relief.datum,
        gx: at(f.gx),
        gy: at(f.gy),
        smallM: at(f.reliefSmall),
        spreadM: at(f.reliefStd),
      };
    },
    /** The far field's grid at ENU metres (sRGB 0-1), or null. */
    farAt: (x, y) =>
      far.grid && spec
        ? farFieldAt(far.grid, FAR_FIELD.side, spec.halfExtentM, x, y)
        : null,
    /**
     * globe-bands' band-width sweep over the region's samples
     * (`bandSweep`, its folds in `blockPx` blocks): null before the
     * samples exist.
     */
    bandSweep: (widths, blockPx = 1) =>
      globeColour.samples
        ? bandSweep(globeColour.samples, widths, { blockPx })
        : null,
    /**
     * globe-classes' grids at ENU metres: the land colour (sRGB 0-1) and
     * the water share, bilinear as the shader reads them; null before the
     * grids or where the imagery cannot answer.
     */
    classAt: (x, y) => {
      if (globeColour.classRegion !== run.regionId || !globeColour.classLand)
        return null;
      const side = GLOBE_ALBEDO.side;
      const land = farFieldAt(
        globeColour.classLand,
        side,
        spec.halfExtentM,
        x,
        y,
      );
      const water = farFieldAt(
        globeColour.classWater,
        side,
        spec.halfExtentM,
        x,
        y,
      );
      return land && water ? { land, water: water[0] } : null;
    },
    /**
     * globe-classes' class-threshold sweep over the drawn region
     * (`classSweep`, settings `CLASS_SWEEP` unless given): null before the
     * grids and the relief exist.
     */
    classSweep: (settings = CLASS_SWEEP) => {
      if (!run.fields || !run.relief || !globeColour.classLand) return null;
      const f = run.fields;
      const side = GLOBE_ALBEDO.side;
      return classSweep(
        {
          posts: {
            side: spec.side,
            spacingM: spec.spacingM,
            extentM: spec.extentM,
            height: f.height,
            gx: f.gx,
            gy: f.gy,
            small: f.reliefSmall,
            valid: f.valid,
          },
          datum: run.relief.datum,
          latDeg: place.centre.lat,
          halfM: spec.halfExtentM,
          footprint: footprintM(FAR_FIELD.level, place.centre.lat),
          coarseSide: 64,
          imageryAt: (x, y) => {
            const land = farFieldAt(
              globeColour.classLand,
              side,
              spec.halfExtentM,
              x,
              y,
            );
            const water = farFieldAt(
              globeColour.classWater,
              side,
              spec.halfExtentM,
              x,
              y,
            );
            return land && water ? { land, water: water[0] } : null;
          },
        },
        settings,
      );
    },
    /** The imagery styles' albedo grid at ENU metres (sRGB 0-1), or null. */
    albedoAt: (x, y) =>
      globeColour.grid && spec
        ? farFieldAt(
            globeColour.grid,
            GLOBE_ALBEDO.side,
            spec.halfExtentM,
            x,
            y,
          )
        : null,
    /** The decoded imagery itself at a position (sRGB 0-1), or null. */
    imageryAt: (lat, lng) =>
      far.tiles ? sampleImagery(far.tiles, lat, lng) : null,
    /**
     * The whole drawing buffer after one frame, RGBA bytes, row 0 at the
     * BOTTOM (as WebGL reads it): the comparison page's captures.
     */
    capture: () => readBuffer(),
    /**
     * The milliseconds of each of `frames` frames, each forced to finish by
     * a one-pixel read, after one warm-up frame (the comparison's frame
     * cost; relative only on a CPU rasteriser, so the page reports ratios
     * within one load, with their spread).
     */
    frameCost(frames = 10) {
      const gl = renderer.getContext();
      const one = new Uint8Array(4);
      frameOnce();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
      const out = [];
      for (let i = 0; i < frames; i++) {
        const started = performance.now();
        frameOnce();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
        out.push(performance.now() - started);
      }
      return out;
    },
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
  // After the hooks exist: the GPS place without a fix is ready at once.
  loadRegion();
}

try {
  start();
} catch (e) {
  window.__terrainLab = { ready: false, error: String(e?.stack ?? e) };
  errorBox.textContent = String(e);
  throw e;
}
