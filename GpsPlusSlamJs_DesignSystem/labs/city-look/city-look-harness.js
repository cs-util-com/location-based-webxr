/**
 * The city look lab's one page: a real OSM scene, three fixed cameras, today's
 * look next to a variant's behind a draggable divider, and the numbers a
 * variant is judged by. A variant page is one call of `startCityLook`.
 *
 * @see city-look-harness.js.md
 */
import { cellToBoundary, polygonToCells } from "h3-js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SimplexNoise } from "three/addons/math/SimplexNoise.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";

import { applyGlobeGrade, DEFAULT_GLOBE_GRADE } from "/globe/globe-grade.js";
import { buildCity, cityGround } from "/osm-lib/mesh/city.js";
import { enuFrameAt } from "/osm-lib/mesh/enu.js";
import { featureKey } from "/osm-lib/model/osm-feature.js";
import { parseOverpassJson } from "/osm-lib/model/overpass-parser.js";
import {
  buildingObjects,
  cityObjects,
  geometryFrom,
} from "/osm-lib/three/index.js";
import { fixedScale, heatColour } from "/osm/heat-colours.js";
import { GROUND_COLOUR } from "/osm/surface-colours.js";

import {
  AO_PARAMS,
  createAmbientOcclusion,
} from "../../3d/ambient-occlusion.js";
import {
  SCENES,
  VIEWS,
  cameraPose,
  cityLookSearch,
  clampSplit,
  parseCityLookParams,
  seededRandom,
  standInFraction,
  streetCamera,
} from "./city-look-model.js";

/** Literal, so the deploy's crawl finds and copies them. */
const FIXTURE_URLS = {
  lucerne: new URL("./fixtures/lucerne-meggen.json", import.meta.url),
  heidelberg: new URL("./fixtures/heidelberg-altstadt.json", import.meta.url),
};

const ATTRIBUTION_HTML =
  'Map data &copy; <a href="https://www.openstreetmap.org/copyright">' +
  "OpenStreetMap contributors</a>, ODbL";

/** The one sun: where it stands, as a unit vector towards it. */
const SUN_DIRECTION = new THREE.Vector3(-0.55, 0.72, 0.42).normalize();
const SUN_INTENSITY = 5.5;
const SKY_INTENSITY = 2.4;

const SKY_ZENITH = new THREE.Color(0.62, 0.8, 1.15);
const SKY_HORIZON = new THREE.Color(1.5, 1.6, 1.7);
const GROUND_BOUNCE = new THREE.Color(0.55, 0.53, 0.5);

/** The ground lies just below the roads, which are built at 0. */
const GROUND_Y = -0.15;
const GROUND_RADIUS_M = 3200;
const SKY_RADIUS_M = 5000;
const FOG_NEAR_M = 900;
const FOG_FAR_M = 3200;

/** The heat overlay: above the roads, inside the walls, as OsmDemo draws it. */
const HEAT_Y = 0.3;
const HEAT_RES = 12;
const HEAT_OPACITY = 0.85;
const HEAT_CELL_FILL = 0.94;
const HEAT_SCALE = fixedScale(1);

/**
 * The shared GTAO's fade moved out, so the bird's 400 m is still inside it;
 * at the module's 300-700 m the AO would be gone from that view.
 */
const LAB_AO_PARAMS = { ...AO_PARAMS, fadeStartM: 700, fadeEndM: 1400 };

const MAX_PIXEL_RATIO = 2;
const FRAME_MS_SMOOTHING = 0.1;
const STATS_EVERY_MS = 500;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

async function loadFixture(name) {
  const response = await fetch(FIXTURE_URLS[name]);
  if (!response.ok) throw new Error(`fixture ${name}: ${response.status}`);
  return response.json();
}

/** A horizon-to-zenith dome: a mesh, so it passes through one tone mapping. */
function skyDome() {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS_M, 32, 12);
  const position = geometry.getAttribute("position");
  const colours = new Float32Array(position.count * 3);
  const colour = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const up = Math.max(0, position.getY(i) / SKY_RADIUS_M);
    colour.copy(SKY_HORIZON).lerp(SKY_ZENITH, Math.sqrt(up));
    colour.toArray(colours, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  const dome = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  dome.renderOrder = -1;
  return dome;
}

function groundDisc() {
  const geometry = new THREE.CircleGeometry(GROUND_RADIUS_M, 48);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, GROUND_Y, 0);
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: GROUND_COLOUR,
      roughness: 0.95,
    }),
  );
}

/**
 * The bbox's H3 cells as translucent hexagons in OsmDemo's real ramp colours,
 * on deterministic stand-in scores. One mesh, one draw call.
 */
function heatOverlay(bbox, frame) {
  const { south, west, north, east } = bbox;
  const cells = polygonToCells(
    [
      [south, west],
      [south, east],
      [north, east],
      [north, west],
    ],
    HEAT_RES,
  ).sort();
  const positions = [];
  const colours = [];
  const colour = new THREE.Color();
  for (const cell of cells) {
    const corners = cellToBoundary(cell).map(([lat, lng]) =>
      frame.toEnu({ lat, lng }),
    );
    const centre = {
      x: corners.reduce((sum, c) => sum + c.x, 0) / corners.length,
      y: corners.reduce((sum, c) => sum + c.y, 0) / corners.length,
    };
    const f = standInFraction(cell, centre);
    const { r, g, b } = heatColour(10 ** (4 * f), HEAT_SCALE);
    colour.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    const shrunk = (c) => [
      centre.x + (c.x - centre.x) * HEAT_CELL_FILL,
      HEAT_Y,
      -(centre.y + (c.y - centre.y) * HEAT_CELL_FILL),
    ];
    corners.forEach((corner, i) => {
      const next = corners[(i + 1) % corners.length];
      positions.push(centre.x, HEAT_Y, -centre.y);
      positions.push(...shrunk(corner), ...shrunk(next));
      for (let v = 0; v < 3; v++) colours.push(colour.r, colour.g, colour.b);
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: HEAT_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
}

/** Today's objects sorted into the layers a variant may override. */
function todayLayers(city) {
  const layers = { buildings: [], trees: [], roads: [] };
  for (const object of cityObjects(city)) {
    if (object.isInstancedMesh) layers.trees.push(object);
    else if (object.userData.cityLayer === "roads") layers.roads.push(object);
    else layers.buildings.push(object);
  }
  return layers;
}

/** A clone sharing the geometry, carrying the variant's material for `kind`. */
function variantClone(object, kind, variant, ctx) {
  const clone = object.clone();
  const own = object.material.clone();
  clone.material = variant.materialFor?.(kind, own, ctx) ?? own;
  return clone;
}

/** The variant's side of the scene; today's objects when it is today. */
async function variantGroup(variant, today, ground, ctx) {
  const group = new THREE.Group();
  if (variant.id === "v0") {
    group.add(ground, ...today.roads, ...today.trees, ...today.buildings);
    return group;
  }
  group.add(variantClone(ground, "ground", variant, ctx));
  for (const road of today.roads) {
    group.add(variantClone(road, "roads", variant, ctx));
  }
  for (const tree of today.trees) {
    group.add(variantClone(tree, "trees", variant, ctx));
  }
  const buildings = variant.buildingsFor
    ? await variant.buildingsFor(ctx.features, ctx)
    : buildingObjects(ctx.city.buildings);
  const list = Array.isArray(buildings) ? buildings : [buildings];
  if (list.length > 0) group.add(...list);
  return group;
}

function makeComposer(renderer, scene, camera) {
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
    }),
  );
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
  return composer;
}

/** A row of toggle buttons; `aria-pressed` carries the state. */
function segmented(label, options, current, onPick) {
  const row = el("div", "cl-row");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", label);
  row.append(el("span", "cl-row-label", label));
  const buttons = options.map(({ value, text }) => {
    const button = el("button", "cl-button", text);
    button.type = "button";
    button.dataset.value = String(value);
    button.addEventListener("click", () => onPick(value));
    return button;
  });
  const mark = (value) => {
    for (const button of buttons) {
      const pressed = button.dataset.value === String(value);
      button.setAttribute("aria-pressed", String(pressed));
    }
  };
  mark(current);
  row.append(...buttons);
  return { row, mark };
}

/** The page's chrome; every control writes the state and the link. */
function buildChrome(variant, state, fixture, actions) {
  const stage = el("main", "cl-stage");
  const canvas = el("canvas", "cl-canvas");
  const panel = el("section", "cl-panel");
  panel.setAttribute("aria-label", "View controls");

  const title = el("h1", "cl-title", variant.label);
  const back = el("a", "cl-back", "All variants");
  back.href = "../index.html";

  const sceneRow = segmented(
    "Scene",
    SCENES.map((value) => ({ value, text: value })),
    state.scene,
    actions.scene,
  );
  const viewRow = segmented(
    "View",
    VIEWS.map((value) => ({ value, text: value })),
    state.view,
    actions.view,
  );
  const heatRow = segmented(
    "Heat (stand-in scores)",
    [
      { value: false, text: "off" },
      { value: true, text: "on" },
    ],
    state.heat,
    actions.heat,
  );
  const stats = el("p", "cl-stats", "building the scene");
  const attribution = el("p", "cl-attribution");
  attribution.innerHTML = `${ATTRIBUTION_HTML}. ${fixture.label}`;
  const rows = [sceneRow.row, viewRow.row, heatRow.row];

  const chrome = {
    stage,
    canvas,
    stats,
    markView: viewRow.mark,
    markHeat: heatRow.mark,
    divider: null,
    markSplit: null,
  };
  if (variant.id !== "v0") {
    const splitRow = segmented(
      "Compare with today",
      [
        { value: true, text: "split" },
        { value: false, text: "full" },
      ],
      state.split !== null,
      actions.compare,
    );
    rows.push(splitRow.row);
    chrome.markSplit = splitRow.mark;
    chrome.divider = buildDivider(actions.split);
    stage.append(chrome.divider.node);
  }
  panel.append(title, back, ...rows, stats, attribution);
  if (variant.id !== "v0") {
    stage.append(
      el("span", "cl-side cl-side-left", "Today"),
      el("span", "cl-side cl-side-right", variant.label),
    );
  }
  stage.prepend(canvas);
  document.body.classList.add("cl-page");
  document.body.append(stage, panel);
  return chrome;
}

/** The divider: drag or arrow keys, with labels for its two sides. */
function buildDivider(onMove) {
  const node = el("div", "cl-divider");
  node.tabIndex = 0;
  node.setAttribute("role", "slider");
  node.setAttribute("aria-label", "Divider between today and the variant");
  node.setAttribute("aria-valuemin", "5");
  node.setAttribute("aria-valuemax", "95");
  node.append(el("span", "cl-divider-line"), el("span", "cl-divider-grip"));
  node.addEventListener("pointerdown", (event) => {
    node.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  node.addEventListener("pointermove", (event) => {
    if (!node.hasPointerCapture(event.pointerId)) return;
    const box = node.parentElement.getBoundingClientRect();
    onMove((event.clientX - box.left) / box.width);
  });
  const STEP = { ArrowLeft: -0.02, ArrowRight: 0.02 };
  node.addEventListener("keydown", (event) => {
    const step = STEP[event.key];
    if (step === undefined) return;
    event.preventDefault();
    onMove(Number(node.dataset.split) + step);
  });
  return {
    node,
    place(split) {
      node.hidden = split === null;
      if (split === null) return;
      node.style.left = `${split * 100}%`;
      node.dataset.split = String(split);
      node.setAttribute("aria-valuenow", String(Math.round(split * 100)));
    },
  };
}

/** Everything after the fixture: the scene, the sides and the frame loop. */
async function run(variant, api) {
  const isToday = variant.id === "v0";
  const state = parseCityLookParams(location.search, {
    defaultSplit: isToday ? null : 0.5,
  });
  if (isToday) state.split = null;
  api.scene = state.scene;
  api.camera = state.view;
  api.split = state.split;

  const fixture = await loadFixture(state.scene);
  const { features } = parseOverpassJson(fixture.payload);
  const frame = enuFrameAt(fixture.centre);
  const ground = cityGround(frame, undefined);
  const city = buildCity(features, ground, { roads: true });
  const street = streetCamera(features, frame);

  const writeLink = () => history.replaceState(null, "", cityLookSearch(state));
  const actions = {
    scene(name) {
      if (name === state.scene) return;
      location.search = cityLookSearch({ ...state, scene: name });
    },
    view(name) {
      state.view = name;
      api.camera = name;
      applyView();
      chrome.markView(name);
      writeLink();
    },
    heat(on) {
      state.heat = on;
      heat.visible = on;
      chrome.markHeat(on);
      writeLink();
    },
    compare(on) {
      setSplit(on ? (lastSplit ?? 0.5) : null);
      writeLink();
    },
    split(share) {
      setSplit(clampSplit(share));
      writeLink();
    },
  };
  const chrome = buildChrome(variant, state, fixture, actions);

  const renderer = new THREE.WebGLRenderer({
    canvas: chrome.canvas,
    antialias: false,
  });
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = false;
  applyGlobeGrade(renderer, DEFAULT_GLOBE_GRADE);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY_HORIZON.getHex(), FOG_NEAR_M, FOG_FAR_M);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 6000);

  const sun = new THREE.DirectionalLight(0xfff4e6, SUN_INTENSITY);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(1000);
  const sky = new THREE.HemisphereLight(
    SKY_ZENITH,
    GROUND_BOUNCE,
    SKY_INTENSITY,
  );
  const heat = heatOverlay(fixture.bbox, frame);
  heat.visible = state.heat;
  scene.add(sun, sky, skyDome(), heat);

  const ctx = {
    THREE,
    fixture: {
      name: state.scene,
      label: fixture.label,
      centre: fixture.centre,
      bbox: fixture.bbox,
    },
    features,
    featureByKey: new Map(features.map((f) => [featureKey(f), f])),
    frame,
    ground,
    city,
    sun: SUN_DIRECTION.clone(),
    seededRandom,
    buildCity,
    buildingObjects,
    geometryFrom,
  };
  const today = todayLayers(city);
  const disc = groundDisc();

  const sideB = await variantGroup(variant, today, disc, ctx);
  scene.add(sideB);
  let sideA = null;
  if (!isToday) {
    sideA = new THREE.Group();
    sideA.add(disc, ...today.roads, ...today.trees, ...today.buildings);
    scene.add(sideA);
  }

  const composerB = makeComposer(renderer, scene, camera);
  const composerA = sideA ? makeComposer(renderer, scene, camera) : null;
  if (variant.postprocess === "gtao") {
    createAmbientOcclusion({
      GTAOPass,
      SimplexNoise,
      scene,
      camera,
      params: { ...LAB_AO_PARAMS, ...variant.aoParams },
    }).sync(composerB, true);
  }

  const controls = new OrbitControls(camera, chrome.canvas);
  function applyView() {
    const pose = cameraPose(state.view, street);
    const isStreet = state.view === "street";
    controls.minDistance = isStreet ? 0.1 : 30;
    controls.maxDistance = isStreet ? 30 : 1500;
    controls.maxPolarAngle = Math.PI * (isStreet ? 0.62 : 0.49);
    camera.position.fromArray(pose.position);
    controls.target.fromArray(pose.target);
    controls.update();
  }
  applyView();

  let lastSplit = state.split;
  function setSplit(split) {
    state.split = split;
    api.split = split;
    if (split !== null) lastSplit = split;
    chrome.divider?.place(split);
    chrome.markSplit?.(split !== null);
  }
  setSplit(state.split);

  function resize() {
    const { width, height } = chrome.stage.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    const ratio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    for (const composer of [composerA, composerB]) {
      composer?.setPixelRatio(ratio);
      composer?.setSize(width, height);
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(chrome.stage);
  resize();

  function draw(side, composer) {
    if (sideA) sideA.visible = side === sideA;
    sideB.visible = side === sideB;
    composer.render();
  }

  function drawFrame() {
    if (sideA && state.split !== null) {
      const { width, height } = chrome.stage.getBoundingClientRect();
      const left = Math.round(width * state.split);
      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, left, height);
      draw(sideA, composerA);
      renderer.setScissor(left, 0, width - left, height);
      renderer.info.reset();
      draw(sideB, composerB);
      renderer.setScissorTest(false);
    } else {
      renderer.info.reset();
      draw(sideB, composerB);
    }
    api.triangles = renderer.info.render.triangles;
    api.draws = renderer.info.render.calls;
  }

  let previous = performance.now();
  let lastStats = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    drawFrame();
    const delta = now - previous;
    previous = now;
    api.frameMs =
      api.frameMs === null
        ? delta
        : api.frameMs + (delta - api.frameMs) * FRAME_MS_SMOOTHING;
    if (now - lastStats > STATS_EVERY_MS) {
      lastStats = now;
      chrome.stats.textContent =
        `${api.triangles.toLocaleString("en-US")} triangles, ` +
        `${api.draws} draw calls, ${api.frameMs.toFixed(1)} ms a frame`;
    }
    api.ready = true;
  }

  api.three = { scene, camera, renderer };
  requestAnimationFrame(tick);
}

/**
 * Starts a page. `variant`: `{ id, label, buildingsFor?, materialFor?,
 * postprocess?, aoParams? }`, documented in the sidecar. Publishes
 * `window.__cityLook` at once; a failure shows on the page and in its `error`.
 */
export async function startCityLook(variant) {
  const api = {
    ready: false,
    error: null,
    scene: null,
    camera: null,
    split: null,
    triangles: 0,
    draws: 0,
    frameMs: null,
    three: null,
  };
  window.__cityLook = api;
  try {
    await run(variant, api);
  } catch (error) {
    api.error = String(error?.stack ?? error);
    console.error(error);
    document.body.append(el("p", "cl-error", `The page failed: ${error}`));
  }
  return api;
}
