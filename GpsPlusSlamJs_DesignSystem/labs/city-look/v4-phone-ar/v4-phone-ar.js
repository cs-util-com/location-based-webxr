/**
 * V4: the look for where no screen-space pass can run, the phone and the AR
 * view. No postprocess; a storey grid in real metres, a muted window rhythm and
 * a labelled wall-foot darkening, all in one material, on the library's own
 * geometry.
 *
 * @see v4-phone-ar.js.md
 */
import { chunkKeyFor, meshCentroidEnu } from "/osm-lib/mesh/chunk-meshes.js";
import { mergeMeshes } from "/osm-lib/mesh/extrude.js";

import { startCityLook } from "../city-look-harness.js";
import { facadeMaterial } from "./v4-material.js";
import {
  bayWidthM,
  facadeFor,
  parseLook,
  perimeterOf,
  roofRgb,
  storeyHeightM,
  wallRgb,
} from "./v4-facade.js";

const LABEL = "V4 phone and AR";
const NOTE =
  "No screen-space pass. The wall-foot darkening is the look being tested: " +
  "it sits on the wall, never on the ground.";

const look = parseLook(location.search);

/** The range the look was judged over; `medium` is the choice. */
const FOOT_STEPS = [
  { value: "off", text: "off", footStrength: 0, footHeightM: 2.4 },
  { value: "soft", text: "1.6 m", footStrength: 0.3, footHeightM: 1.6 },
  { value: "medium", text: "2.4 m", footStrength: 0.45, footHeightM: 2.4 },
  { value: "strong", text: "4 m", footStrength: 0.6, footHeightM: 4 },
];

function minY(mesh) {
  let lowest = Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    lowest = Math.min(lowest, mesh.positions[i]);
  }
  return lowest;
}

/** One entry per drawn volume, parts over their parents' tags. */
function drawnVolumes({ city, featureByKey }) {
  const tagsOf = (key) => featureByKey.get(key)?.tags ?? {};
  const drawn = city.volumes.map((volume) => {
    const own = tagsOf(volume.feature);
    const parent = volume.parentFeature ? tagsOf(volume.parentFeature) : {};
    const tags = { ...parent, ...own };
    const baseY = minY(volume.mesh) - volume.heights.minHeightM;
    return {
      mesh: volume.mesh,
      spec: {
        baseY,
        storeyM: storeyHeightM(
          tags,
          own,
          volume.heights.eaveHeightM,
          perimeterOf(volume.mesh),
        ),
        bayM: bayWidthM(volume.feature),
        wall: wallRgb(tags, volume.parentFeature ?? volume.feature),
        roof: roofRgb(tags, volume.parentFeature ?? volume.feature),
      },
    };
  });
  const barriers = city.barriers.map((barrier) => {
    const tags = tagsOf(barrier.feature);
    return {
      mesh: barrier.mesh,
      spec: {
        baseY: minY(barrier.mesh),
        storeyM: 0,
        bayM: 0,
        wall: wallRgb(tags, barrier.feature),
        roof: wallRgb(tags, barrier.feature),
      },
    };
  });
  return [...drawn, ...barriers];
}

/** The library's chunk grid, so a draw call here is a draw call in V0. */
function chunked(items) {
  const chunks = new Map();
  for (const item of items) {
    if (item.mesh.indices.length === 0) continue;
    const key = chunkKeyFor(meshCentroidEnu(item.mesh));
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(item);
  }
  return [...chunks.values()];
}

function chunkGeometry(THREE, geometryFrom, items) {
  const mesh = mergeMeshes(items.map((item) => item.mesh));
  const count = mesh.positions.length / 3;
  const facade = new Float32Array(count * 4);
  const colours = new Float32Array(count * 3);
  let at = 0;
  for (const item of items) {
    const buffers = facadeFor(item.mesh, item.spec);
    facade.set(buffers.facade, at * 4);
    colours.set(buffers.colours, at * 3);
    at += item.mesh.positions.length / 3;
  }
  const geometry = geometryFrom(mesh, colours);
  geometry.setAttribute("aFacade", new THREE.BufferAttribute(facade, 4));
  return geometry;
}

function controlRow(label, options, current, onPick) {
  const row = document.createElement("div");
  row.className = "cl-row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", label);
  const name = document.createElement("span");
  name.className = "cl-row-label";
  name.textContent = label;
  row.append(name);
  const buttons = options.map(({ value, text }) => {
    const button = document.createElement("button");
    button.className = "cl-button";
    button.type = "button";
    button.textContent = text;
    button.setAttribute("aria-pressed", String(value === current));
    button.addEventListener("click", () => {
      for (const other of buttons) other.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-pressed", "true");
      onPick(value);
    });
    return button;
  });
  row.append(...buttons);
  return row;
}

const onOff = [
  { value: false, text: "off" },
  { value: true, text: "on" },
];

/** The note under the title, and one control per element of the look. */
function addControls(uniforms) {
  const title = document.querySelector(".cl-title");
  const note = document.createElement("p");
  note.className = "cl-attribution";
  note.textContent = NOTE;
  title.after(note);

  const currentFoot = FOOT_STEPS.find(
    (step) =>
      step.footStrength === look.footStrength &&
      step.footHeightM === look.footHeightM,
  )?.value;
  const stats = document.querySelector(".cl-stats");
  stats.before(
    controlRow("Wall foot darkening", FOOT_STEPS, currentFoot, (value) => {
      const step = FOOT_STEPS.find((candidate) => candidate.value === value);
      uniforms.uFoot.value.set(step.footStrength, step.footHeightM);
    }),
    controlRow("Storey lines", onOff, true, (on) => {
      uniforms.uLine.value = on ? look.lineStrength : 0;
      uniforms.uEave.value = on ? look.eaveStrength : 0;
    }),
    controlRow("Window rhythm", onOff, true, (on) => {
      uniforms.uWindow.value = on ? look.windowStrength : 0;
    }),
  );
}

startCityLook({
  id: "v4",
  label: LABEL,
  postprocess: "none",
  buildingsFor(features, ctx) {
    const { THREE, geometryFrom } = ctx;
    const { material, uniforms } = facadeMaterial(THREE, look);
    addControls(uniforms);
    return chunked(drawnVolumes(ctx)).map(
      (items) =>
        new THREE.Mesh(chunkGeometry(THREE, geometryFrom, items), material),
    );
  },
});
