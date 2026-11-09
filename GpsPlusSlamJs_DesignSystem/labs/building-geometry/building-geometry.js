/**
 * The building geometry lab's page: one landmark from a fixed camera, the
 * picture captured before the geometry fixes next to the library's live
 * render from the same camera, so a fix is confirmed by eye.
 *
 * @see building-geometry.js.md
 */
import * as THREE from "three";

import { buildCity, cityGround } from "/osm-lib/mesh/city.js";
import { enuFrameAt } from "/osm-lib/mesh/enu.js";
import { featureKey } from "/osm-lib/model/osm-feature.js";
import { toGeometry } from "/osm-lib/model/osm-geometry.js";
import { parseOverpassJson } from "/osm-lib/model/overpass-parser.js";
import { buildingObjects } from "/osm-lib/three/index.js";

import {
  BUILDINGS,
  PALETTES,
  fixtureUrl,
  parseParams,
  searchFor,
  todayShotUrl,
} from "./building-geometry-model.js";

const ATTRIBUTION_HTML =
  'Map data &copy; <a href="https://www.openstreetmap.org/copyright">' +
  "OpenStreetMap contributors</a>, ODbL";

/** The drawing buffer: the "today" pictures' size, so both frame alike. */
const WIDTH = 800;
const HEIGHT = 600;

/** Every building inside this square around the origin is built. */
const WITHIN_M = 400;

const SKY = 0xcfe0ee;
const GROUND = 0x9a9a90;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** A row of buttons that navigate; `aria-current` marks the one shown. */
function linkRow(label, items, current) {
  const row = el("nav", "bg-row");
  row.setAttribute("aria-label", label);
  row.append(el("span", "bg-row-label", label));
  for (const { value, text, href } of items) {
    const link = el("a", "bg-button", text);
    link.href = href;
    if (value === current) link.setAttribute("aria-current", "true");
    row.append(link);
  }
  return row;
}

/** The first vertex of `feature`'s outline: the scene's origin. */
function originOf(feature) {
  const result = toGeometry(feature);
  if (result.ok) {
    const { geometry } = result;
    if (geometry.kind === "polygon") return geometry.rings[0][0];
    if (geometry.kind === "multipolygon") return geometry.polygons[0][0][0];
  }
  const member = feature.members?.find((m) => m.geometry?.length);
  if (member) return member.geometry[0];
  throw new Error(`no outline for ${featureKey(feature)}`);
}

async function loadFeatures(id) {
  const response = await fetch(fixtureUrl(id));
  if (!response.ok) throw new Error(`fixture ${id}: ${response.status}`);
  const fixture = await response.json();
  return {
    features: parseOverpassJson(fixture.payload).features,
    window: fixture.bbox,
  };
}

function buildChrome(state, capture) {
  const page = el("main", "bg-page");
  if (capture) page.classList.add("bg-capture");
  const title = el("h1", "bg-title", "Building geometry, before and after");
  const buildings = linkRow(
    "Building",
    BUILDINGS.map((b) => ({
      value: b.id,
      text: b.label,
      href: searchFor(b.id, Object.keys(b.views)[0], state.palette),
    })),
    state.building.id,
  );
  const views = linkRow(
    "Camera",
    Object.keys(state.building.views).map((view) => ({
      value: view,
      text: view,
      href: searchFor(state.building.id, view, state.palette),
    })),
    state.view,
  );
  // The owner's words for the toggle (M7 review MINOR 3): the seeded palette
  // against the class colours it replaced, same building, same camera.
  const colourNames = { seeded: "Palette", class: "Klassen" };
  const colours = linkRow(
    "Farben",
    PALETTES.map((palette) => ({
      value: palette,
      text: colourNames[palette],
      href: searchFor(state.building.id, state.view, palette),
    })),
    state.palette,
  );
  const bugs = el(
    "p",
    "bg-note",
    `Bugs this building shows (findings doc numbers): ${state.building.bugs}.`,
  );

  const source = el(
    "p",
    "bg-note",
    "Today: captured from this page on 2026-11-07, with the library of main " +
      "2dd1168d1, before the geometry fixes. Now: the library this page serves.",
  );

  const pair = el("div", "bg-pair");
  const todayFigure = el("figure", "bg-figure");
  const shot = todayShotUrl(state.building.id, state.view);
  if (shot && !capture) {
    const img = el("img", "bg-picture");
    img.src = shot.href;
    img.alt = `${state.building.label}, ${state.view}, before the fixes`;
    img.width = WIDTH;
    img.height = HEIGHT;
    todayFigure.append(img);
  } else {
    todayFigure.append(el("p", "bg-missing", "No picture of today."));
  }
  todayFigure.append(el("figcaption", null, "Today: before the fixes"));
  const nowFigure = el("figure", "bg-figure");
  const canvas = el("canvas", "bg-picture");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  nowFigure.append(canvas, el("figcaption", null, "Now: the live library"));
  pair.append(todayFigure, nowFigure);

  const stats = el("p", "bg-note bg-stats", "building the scene");
  const attribution = el("p", "bg-note bg-attribution");
  attribution.innerHTML = `${ATTRIBUTION_HTML}.`;
  page.append(
    title,
    buildings,
    views,
    colours,
    bugs,
    source,
    pair,
    stats,
    attribution,
  );
  document.body.append(page);
  return { canvas, stats };
}

function render(canvas, objects, pose) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(SKY);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x887766, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-300, 500, 200);
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3000, 48),
    new THREE.MeshLambertMaterial({ color: GROUND }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  scene.add(ground, ...objects);

  const camera = new THREE.PerspectiveCamera(pose.fov, WIDTH / HEIGHT, 1, 6000);
  camera.position.fromArray(pose.pos);
  camera.lookAt(...pose.at);
  renderer.render(scene, camera);
  return renderer;
}

async function run(api) {
  const state = parseParams(location.search);
  const capture = new URLSearchParams(location.search).has("capture");
  api.building = state.building.id;
  api.view = state.view;
  api.palette = state.palette;
  const chrome = buildChrome(state, capture);

  const { features, window } = await loadFeatures(state.building.id);
  const target = features.find((f) => featureKey(f) === state.building.target);
  if (!target) throw new Error(`target ${state.building.target} not found`);
  const frame = enuFrameAt(originOf(target));
  const city = buildCity(features, cityGround(frame, undefined), {
    window,
    withinM: WITHIN_M,
    palette: state.palette,
  });
  const objects = buildingObjects(city.buildings);
  api.triangles = objects.reduce(
    (sum, mesh) => sum + (mesh.geometry.index?.count ?? 0) / 3,
    0,
  );
  render(chrome.canvas, objects, state.building.views[state.view]);
  chrome.stats.textContent = `${api.triangles.toLocaleString("en-US")} building triangles within ${WITHIN_M} m.`;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  api.ready = true;
}

/** Publishes `window.__buildingGeometry` at once; a failure shows on the page. */
export async function startBuildingGeometry() {
  const api = {
    ready: false,
    error: null,
    building: null,
    view: null,
    palette: null,
    triangles: 0,
  };
  window.__buildingGeometry = api;
  try {
    await run(api);
  } catch (error) {
    api.error = String(error?.stack ?? error);
    console.error(error);
    document.body.append(el("p", "bg-error", `The page failed: ${error}`));
  }
  return api;
}

startBuildingGeometry();
