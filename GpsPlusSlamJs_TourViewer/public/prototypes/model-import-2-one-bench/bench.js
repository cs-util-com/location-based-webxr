// The model bench: one workbench on which a tour creator makes a dropped
// 3D model light enough for visitors' phones. Everything is live and on
// one screen: the large view, the shape control (1 to 100 %, redrawn
// while dragging), the picture sizes, WebP and 8-bit, the distance a
// visitor stands at with how fast detail drops, and the size bar. The
// original-versus-yours switch is the largest control and never moves
// the camera. Heavy work runs in two Workers, so the page never stalls:
// the shape is ordered once (simplify-worker.js), the pictures are
// re-encoded as the editor writes them (texture-worker.js).
//
// API: see README.md ("The module API").
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { stepsFor, levelIndices } from "../model-lod-1/lod-simplify.js";
import {
  TEXTURE_STEPS,
  KEEP_ABOVE,
  readGlb,
  imageJobs,
  originalShares,
  chainCounts,
  geometryBytes,
  formatBytes,
  formatShare,
  formatCount,
  formatMetres,
  formatLength,
  pxPerMetre,
  switchDistance,
  budgetOf,
  errorAt,
} from "./bench-sizes.js";
import { INITIAL_BENCH, benchReducer } from "./bench-state.js";

const TEXTURE_SLOTS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"];
const POSITION8_ERROR = 0.01;

const FLAT = new THREE.MeshStandardMaterial({
  color: 0xcfcac0,
  flatShading: true,
  roughness: 1,
  metalness: 0,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
const WIRE = new THREE.MeshBasicMaterial({ color: 0x24303a, wireframe: true });
const LOUPE_BACKGROUND = new THREE.Color(0xf7f4ee);

/** A mesh's own textured material, also while the triangle view shows. */
const texturedOf = (mesh) => mesh.userData.textured ?? mesh.material;

const html = String.raw;

function template() {
  return html`
    <div class="mb">
      <header class="mb-head">
        <button type="button" class="mb-back" data-ref="back">Back</button>
        <div class="mb-title">
          <strong data-ref="name">3D model</strong>
          <span data-ref="facts"></span>
        </div>
        <button type="button" class="mb-accept" data-ref="accept">Use this version</button>
      </header>
      <div class="mb-stage" data-ref="stage">
        <canvas data-ref="canvas" aria-label="The model: drag to turn, pinch or scroll to zoom, double-tap a spot to look closer"></canvas>
        <p class="mb-badge" data-ref="badge" aria-live="polite"></p>
        <div class="mb-busy" data-ref="busy" hidden>
          <span data-ref="busyText"></span>
          <span class="mb-meter"><span data-ref="busyBar"></span></span>
        </div>
        <p class="mb-loupe" data-ref="loupe" hidden></p>
        <p class="mb-hint">Drag to turn, pinch or scroll to zoom, double-tap a spot to look closer</p>
        <div class="mb-ab" role="group" aria-label="Which version the view shows">
          <button type="button" data-ref="abOriginal" aria-pressed="false">
            <span>Original</span><small data-ref="abOriginalSize"></small>
          </button>
          <button type="button" data-ref="abMine" aria-pressed="true">
            <span>Yours</span><small data-ref="abMineSize"></small>
          </button>
        </div>
        <div class="mb-opening" data-ref="opening">
          <p data-ref="openingText">Opening the model...</p>
        </div>
      </div>
      <section class="mb-tray" aria-label="Make it lighter">
        <div class="mb-card mb-size">
          <h2>File size</h2>
          <p class="mb-total"><span data-ref="total">-</span><span data-ref="totalShare"></span></p>
          <div class="mb-bars" aria-hidden="true">
            <div class="mb-bar-row"><span>Original</span><div class="mb-bar" data-ref="barOriginal"><i class="tex"></i><i class="geo"></i></div></div>
            <div class="mb-bar-row"><span>Yours</span><div class="mb-bar" data-ref="barMine"><i class="tex"></i><i class="geo"></i></div></div>
          </div>
          <p class="mb-legend">
            <span><i class="tex"></i>Pictures <b data-ref="texBytes"></b></span>
            <span><i class="geo"></i>Shape <b data-ref="geoBytes"></b></span>
          </p>
          <p class="mb-note" data-ref="keepNote" hidden></p>
        </div>
        <div class="mb-card mb-shape">
          <h2><label for="mb-share">Shape detail</label><output data-ref="shareOut"></output></h2>
          <input id="mb-share" type="range" min="1" max="100" step="1" value="100" data-ref="share" disabled />
          <p class="mb-read" data-ref="shapeRead">Preparing live shape detail...</p>
          <label class="mb-check"><input type="checkbox" data-ref="wireframe" /> Show the triangles</label>
          <label class="mb-check"><input type="checkbox" data-ref="positions8" /> 8-bit corner points <small data-ref="pos8Save"></small></label>
        </div>
        <div class="mb-card mb-pics">
          <h2>Picture size <output data-ref="picOut"></output></h2>
          <div class="mb-steps" role="radiogroup" aria-label="Largest picture side" data-ref="steps"></div>
          <label class="mb-check"><input type="checkbox" data-ref="webp" /> WebP pictures <small data-ref="webpSave"></small></label>
        </div>
        <div class="mb-card mb-far">
          <h2><label for="mb-distance">Seen from afar</label><output data-ref="distanceOut"></output></h2>
          <input id="mb-distance" type="range" min="0" max="1000" step="1" value="0" data-ref="distance" />
          <div class="mb-ruler" data-ref="ruler" aria-hidden="true"></div>
          <p class="mb-read" data-ref="farRead">Measuring how the shape holds up from afar...</p>
          <label class="mb-sub" for="mb-drop">How fast detail drops</label>
          <input id="mb-drop" type="range" min="0" max="100" step="1" value="33" data-ref="drop" />
          <p class="mb-ends"><span>Keep detail longer</span><span>Drop it sooner</span></p>
        </div>
        <p class="mb-measure" data-ref="measure"></p>
      </section>
    </div>
  `;
}

/** `root`'s elements by their data-ref. */
function refsOf(root) {
  const refs = {};
  for (const el of root.querySelectorAll("[data-ref]")) {
    refs[el.dataset.ref] = el;
  }
  return refs;
}

/** A model's attributes copied out of three.js (interleaved or not). */
function flatAttribute(attribute) {
  const out = new Float32Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++) {
    for (let c = 0; c < attribute.itemSize; c++) {
      out[i * attribute.itemSize + c] = attribute.getComponent(i, c);
    }
  }
  return out;
}

const ATTRIBUTE_NAMES = { position: "position", normal: "normal", uv: "uv", tangent: "tangent" };

/** 8-bit positions: one scale for all axes around the box centre. */
function quantized8(P) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], P[i + c]);
      hi[c] = Math.max(hi[c], P[i + c]);
    }
  }
  const centre = lo.map((v, c) => (v + hi[c]) / 2);
  const scale = Math.max(...hi.map((v, c) => (v - lo[c]) / 2)) || 1;
  const out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i++) {
    const c = i % 3;
    out[i] = (Math.round(((P[i] - centre[c]) / scale) * 127) / 127) * scale + centre[c];
  }
  return out;
}

function disposeMaterialTextures(material) {
  for (const slot of TEXTURE_SLOTS) {
    material[slot]?.dispose();
  }
}

/**
 * Builds the bench inside `root`.
 * @param {HTMLElement} root
 * @param {{ onAccept?: (settings: object) => void, onBack?: () => void,
 *   workerBase?: URL }} [options]
 */
export function createModelBench(root, options = {}) {
  root.innerHTML = template();
  const $ = refsOf(root);
  const base = options.workerBase ?? new URL(".", import.meta.url);
  const simplifier = new Worker(new URL("simplify-worker.js", base), { type: "module" });
  const textures = new Worker(new URL("texture-worker.js", base));

  let state = INITIAL_BENCH;
  const renderer = new THREE.WebGLRenderer({ canvas: $.canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setScissorTest(false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9e4da);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8170, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  const loupeCamera = camera.clone();
  const controls = new OrbitControls(camera, $.canvas);
  controls.addEventListener("change", () => {
    if (state.distance === 0) {
      model.closeDistance = camera.position.distanceTo(controls.target);
    }
    dirty = true;
  });

  /** The loaded model and its resources (not state). */
  let model = null;
  let loadId = 0;
  let dirty = true;
  let pictureTicket = 0;
  const updateTimes = [];
  let lastUpdateMs = 0;

  function dispatch(action) {
    const before = state;
    state = benchReducer(state, action);
    if (state !== before) {
      apply(before);
    }
  }

  // ---------- loading ----------

  async function load(source, name = "3D model") {
    const id = ++loadId;
    clearModel();
    $.name.textContent = name;
    $.facts.textContent = "";
    $.opening.hidden = false;
    $.openingText.textContent = "Opening the model...";
    try {
      const buffer = await toArrayBuffer(source);
      if (id !== loadId) {
        return;
      }
      const bytes = new Uint8Array(buffer);
      const glb = readGlb(bytes);
      const gltf = await new GLTFLoader().parseAsync(buffer.slice(0), "");
      if (id !== loadId) {
        disposeObject(gltf.scene);
        return;
      }
      setUpModel(id, gltf, glb, bytes.length);
    } catch (error) {
      if (id === loadId) {
        $.openingText.textContent = `This model could not be opened: ${error.message}`;
      }
    }
  }

  async function toArrayBuffer(source) {
    if (source instanceof ArrayBuffer) {
      return source;
    }
    if (source instanceof Blob) {
      return source.arrayBuffer();
    }
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`it did not download (${response.status})`);
    }
    return response.arrayBuffer();
  }

  function setUpModel(id, gltf, glb, totalBytes) {
    const original = gltf.scene;
    const mine = original.clone(true);
    const parts = [];
    const srcMeshes = [];
    original.traverse((o) => o.isMesh && srcMeshes.push(o));
    const mineMeshes = [];
    mine.traverse((o) => o.isMesh && mineMeshes.push(o));
    srcMeshes.forEach((src, i) => {
      const own = mineMeshes[i];
      own.material = Array.isArray(src.material) ? src.material.map((m) => m.clone()) : src.material.clone();
      parts.push({
        id: `${id}:${i}`,
        src,
        own,
        prog: null,
        total: (src.geometry.index?.count ?? src.geometry.attributes.position.count) / 3,
        curve: [],
        measured: false,
        skipped: Boolean(src.isSkinnedMesh) || Object.keys(src.geometry.morphAttributes ?? {}).length > 0,
      });
    });
    const imageOfTexture = new Map();
    const json = glb.json;
    for (const part of parts) {
      for (const slot of TEXTURE_SLOTS) {
        const tex = part.src.material[slot];
        const assoc = tex ? gltf.parser.associations.get(tex) : null;
        const ti = assoc?.textures;
        const source = json.textures?.[ti]?.source;
        if (tex && Number.isInteger(source)) {
          imageOfTexture.set(tex, source);
        }
      }
    }
    const box = new THREE.Box3().setFromObject(original);
    const size = box.getSize(new THREE.Vector3()).length();
    const jobs = imageJobs(json, glb.bin);
    let largestSide = 0;
    original.traverse((o) => {
      for (const slot of o.isMesh ? TEXTURE_SLOTS : []) {
        const img = o.material[slot]?.image;
        if (img) {
          largestSide = Math.max(largestSide, img.width, img.height);
        }
      }
    });
    model = {
      id,
      original,
      mine,
      parts,
      box,
      size,
      json,
      jsonBytes: glb.jsonLength,
      shares: originalShares(json, totalBytes),
      triangles: parts.reduce((s, p) => s + p.total, 0),
      imageOfTexture,
      largestSide,
      textureBytes: new Map(),
      textureProgress: new Map(),
      textureFailed: new Map(),
      shownPictures: null,
      shownKey: null,
      previews: [],
      closeDistance: 1,
      wires: [],
    };
    scene.add(original, mine);
    frame();
    $.facts.textContent = `${formatCount(model.triangles)} triangles, pictures up to ${largestSide} px, ${formatBytes(totalBytes)}`;
    $.opening.hidden = true;
    state = benchReducer(state, { type: "loaded", minShare: 1 });
    textures.postMessage({
      type: "images",
      images: jobs.map((j) => ({
        index: j.index,
        blob: new Blob([j.bytes], { type: j.mime }),
        mime: j.mime,
        use: j.use,
        rewritable: j.rewritable,
      })),
    });
    queueTextures();
    for (const part of parts) {
      if (!part.skipped) {
        sendBuild(part);
      }
    }
    apply(null);
  }

  function sendBuild(part) {
    const g = part.src.geometry;
    const attributes = [];
    for (const [three, name] of Object.entries(ATTRIBUTE_NAMES)) {
      const a = g.attributes[three];
      if (a) {
        attributes.push({ name, size: a.itemSize, data: flatAttribute(a) });
      }
    }
    const index = g.index
      ? Uint32Array.from(g.index.array.subarray(0, g.index.count))
      : Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);
    simplifier.postMessage({ type: "build", id: part.id, attributes, index }, [
      ...attributes.map((a) => a.data.buffer),
      index.buffer,
    ]);
  }

  function frame() {
    const { box, size } = model;
    const centre = box.getCenter(new THREE.Vector3());
    const away = new THREE.Vector3(1, 0.7, 1.2).normalize();
    const radius = size / 2;
    camera.position.copy(centre).addScaledVector(away, radius * 2.6);
    controls.target.copy(centre);
    camera.near = size / 400;
    camera.far = Math.max(size * 2000, 500);
    controls.minDistance = size * 0.03;
    controls.maxDistance = Math.max(size * 1500, 200);
    camera.updateProjectionMatrix();
    controls.update();
    model.closeDistance = camera.position.distanceTo(controls.target);
  }

  function clearModel() {
    if (!model) {
      return;
    }
    scene.remove(model.original, model.mine);
    releasePreviews();
    for (const part of model.parts) {
      if (part.own.geometry !== part.src.geometry) {
        part.own.geometry.dispose();
      }
      texturedOf(part.own).dispose();
    }
    for (const w of model.wires) {
      w.removeFromParent();
    }
    disposeObject(model.original);
    model = null;
  }

  function disposeObject(object) {
    object.traverse((node) => {
      node.geometry?.dispose();
      if (node.material && node.material !== FLAT && node.material !== WIRE) {
        disposeMaterialTextures(node.userData.textured ?? node.material);
        (node.userData.textured ?? node.material).dispose();
      }
    });
  }

  // ---------- the shape (Worker answers) ----------

  simplifier.addEventListener("message", (event) => {
    const m = event.data;
    const part = model?.parts.find((p) => p.id === m.id);
    if (!part) {
      return;
    }
    if (m.type === "built") {
      onBuilt(part, m);
    } else if (m.type === "error") {
      part.curve.push({ share: m.share, error: m.error });
      apply(state);
    } else if (m.type === "measured") {
      part.measured = true;
      apply(state);
    } else if (m.type === "failed") {
      part.skipped = true;
      $.shapeRead.textContent = `The shape cannot be thinned live here: ${m.reason}`;
    }
  });

  function onBuilt(part, m) {
    const geo = new THREE.BufferGeometry();
    for (const a of m.attributes) {
      geo.setAttribute(a.name, new THREE.BufferAttribute(a.data, a.size));
    }
    const capacity = Math.ceil(m.full.length * 1.4) + 3;
    const index = new THREE.BufferAttribute(new Uint32Array(capacity), 1);
    index.array.set(m.full);
    geo.setIndex(index);
    geo.setDrawRange(0, m.full.length);
    part.positions = geo.attributes.position;
    part.positions8 = null;
    part.own.geometry = geo;
    part.prog = m.prog;
    part.full = m.full;
    part.vertexCount = m.attributes[0].data.length / 3;
    part.marks = new Uint32Array(part.vertexCount);
    part.markId = 0;
    part.buildMs = m.buildMs;
    part.hasNormals = Boolean(geo.attributes.normal);
    part.hasUvs = Boolean(geo.attributes.uv);
    part.hasTangents = Boolean(geo.attributes.tangent);
    part.wire = null;
    const minShare = Math.max(
      ...model.parts.filter((p) => p.prog).map((p) => (100 * p.prog.minTriangles) / p.total),
    );
    state = benchReducer(state, { type: "minShare", value: minShare });
    $.share.disabled = false;
    apply(null);
  }

  // ---------- the pictures (Worker answers) ----------

  const textureKey = (stepId, webp) => `${stepId}|${webp ? "webp" : "jpeg"}`;

  /** Every step queued, the one shown first, then its neighbours, then
   *  the other format. */
  function queueTextures() {
    if (!model) {
      return;
    }
    const at = TEXTURE_STEPS.findIndex((s) => s.id === state.textureStep);
    const order = TEXTURE_STEPS.map((s, i) => ({ s, d: Math.abs(i - at) })).sort((a, b) => a.d - b.d);
    const jobs = [];
    for (const webp of [state.webp, !state.webp]) {
      for (const { s } of order) {
        const key = textureKey(s.id, webp);
        if (!model.textureBytes.has(key)) {
          jobs.push({ key, side: s.side, webp });
        }
      }
    }
    textures.postMessage({ type: "jobs", jobs });
  }

  textures.addEventListener("message", (event) => {
    const m = event.data;
    if (!model) {
      return;
    }
    if (m.type === "progress") {
      model.textureProgress.set(m.key, m.done / m.of);
      showProgress();
    } else if (m.type === "made") {
      model.textureBytes.set(m.key, m.sizes);
      model.textureProgress.delete(m.key);
      apply(state);
    } else if (m.type === "failed") {
      model.textureFailed.set(m.key, m.reason);
      apply(state);
    } else if (m.type === "pictures") {
      onPictures(m);
    }
  });

  function askPictures() {
    const key = textureKey(state.textureStep, state.webp);
    if (!model || model.shownKey === key || !model.textureBytes.has(key)) {
      return;
    }
    if (model.askedKey === key) {
      return;
    }
    model.askedKey = key;
    textures.postMessage({ type: "pictures", key, ticket: ++pictureTicket });
  }

  function onPictures(m) {
    if (m.ticket !== pictureTicket || m.key !== textureKey(state.textureStep, state.webp)) {
      for (const b of m.bitmaps) {
        b.bitmap.close();
      }
      return;
    }
    releasePreviews();
    const byImage = new Map(m.bitmaps.map((b) => [b.index, b.bitmap]));
    for (const part of model.parts) {
      for (const slot of TEXTURE_SLOTS) {
        const tex = part.src.material[slot];
        const image = tex ? model.imageOfTexture.get(tex) : undefined;
        const bitmap = image === undefined ? undefined : byImage.get(image);
        if (!bitmap) {
          continue;
        }
        const preview = tex.clone();
        preview.image = bitmap;
        preview.needsUpdate = true;
        texturedOf(part.own)[slot] = preview;
        model.previews.push(preview);
      }
      texturedOf(part.own).needsUpdate = true;
    }
    model.previewBitmaps = m.bitmaps.map((b) => b.bitmap);
    model.shownKey = m.key;
    apply(state);
  }

  function releasePreviews() {
    if (!model) {
      return;
    }
    for (const p of model.previews) {
      p.dispose();
    }
    for (const b of model.previewBitmaps ?? []) {
      b.close();
    }
    model.previews = [];
    model.previewBitmaps = [];
    model.shownKey = null;
    model.askedKey = null;
  }

  // ---------- applying the state ----------

  /** Shape: the author's level written into each part's index list, and
   *  the chain after it when the visitor stands away. */
  function applyShape() {
    const t0 = performance.now();
    let kept = 0;
    let vertices = 0;
    const chain = [];
    for (const part of model.parts) {
      if (!part.prog) {
        kept += part.total;
        continue;
      }
      const target = Math.round((part.total * state.share) / 100);
      const ix = levelIndices(part.prog, stepsFor(part.prog, target));
      const levels = [ix];
      part.chainCounts = chainCounts(ix.length / 3, part.prog.minTriangles);
      if (state.distance > 0) {
        for (const c of part.chainCounts) {
          levels.push(levelIndices(part.prog, stepsFor(part.prog, c)));
        }
      }
      writeLevels(part, levels);
      kept += ix.length / 3;
      vertices += usedVertices(part, ix);
      part.chainCounts.forEach((c, i) => (chain[i] = (chain[i] ?? 0) + c));
      part.level = ix.length / 3;
      applyPositions(part);
    }
    const ms = performance.now() - t0;
    lastUpdateMs = ms;
    updateTimes.push(ms);
    if (updateTimes.length > 60) {
      updateTimes.shift();
    }
    model.kept = kept;
    model.vertices = vertices;
    model.chain = chain;
  }

  function writeLevels(part, levels) {
    const attr = part.own.geometry.index;
    let at = 0;
    part.ranges = [];
    for (const ix of levels) {
      attr.array.set(ix, at);
      part.ranges.push({ start: at, count: ix.length });
      at += ix.length;
    }
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, at);
    attr.needsUpdate = true;
  }

  function usedVertices(part, ix) {
    part.markId++;
    let n = 0;
    for (let i = 0; i < ix.length; i++) {
      if (part.marks[ix[i]] !== part.markId) {
        part.marks[ix[i]] = part.markId;
        n++;
      }
    }
    return n;
  }

  function applyPositions(part) {
    const geo = part.own.geometry;
    if (state.positions8) {
      part.positions8 ??= new THREE.BufferAttribute(quantized8(part.positions.array), 3);
      if (geo.attributes.position !== part.positions8) {
        geo.setAttribute("position", part.positions8);
      }
    } else if (geo.attributes.position !== part.positions) {
      geo.setAttribute("position", part.positions);
    }
  }

  /** The visitor's distance in metres for the slider (0: up close). */
  function visitorDistance() {
    if (state.distance === 0) {
      return model.closeDistance;
    }
    const near = model.closeDistance;
    const far = Math.max(near * 4, model.size * 400, 60);
    return near * Math.pow(far / near, state.distance / 1000);
  }

  /** The level each part draws at the visitor's distance, and the switch
   *  distances of the chain. */
  function pickLevels() {
    const budget = budgetOf(state.drop);
    const d = visitorDistance();
    const ppm = pxPerMetre(d);
    let drawn = 0;
    const switches = [];
    for (const part of model.parts) {
      if (!part.prog || !part.ranges) {
        continue;
      }
      const errors = [part.level, ...part.chainCounts].map((c) => errorAt(part.curve, c / part.total));
      let pick = 0;
      if (state.distance > 0) {
        errors.forEach((e, i) => {
          if (i < part.ranges.length && e * ppm <= budget) {
            pick = i;
          }
        });
      }
      const r = part.ranges[pick] ?? part.ranges[0];
      part.own.geometry.setDrawRange(r.start, r.count);
      drawn += r.count / 3;
      errors.slice(1).forEach((e, i) => {
        switches[i] = Math.max(switches[i] ?? 0, switchDistance(e, budget));
      });
      part.errors = errors;
      part.pick = pick;
    }
    model.drawn = drawn;
    model.switches = switches;
    model.visitorAt = d;
  }

  function placeCameraForDistance(before) {
    if (before && before.distance === state.distance) {
      return;
    }
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-12) {
      dir.set(1, 0.7, 1.2);
    }
    dir.setLength(visitorDistance());
    camera.position.copy(controls.target).add(dir);
    camera.updateProjectionMatrix();
    controls.update();
  }

  function apply(before) {
    if (!model) {
      return;
    }
    const shapeChanged =
      !before ||
      before.share !== state.share ||
      before.positions8 !== state.positions8 ||
      (before.distance === 0) !== (state.distance === 0);
    if (shapeChanged) {
      applyShape();
    }
    if (before && before.distance !== state.distance) {
      placeCameraForDistance(before);
    }
    pickLevels();
    if (!before || before.textureStep !== state.textureStep || before.webp !== state.webp) {
      queueTextures();
    }
    askPictures();
    applyLook();
    renderPanel();
    dirty = true;
  }

  function applyLook() {
    const showMine = state.showing === "mine";
    model.original.visible = !showMine;
    model.mine.visible = showMine;
    for (const part of model.parts) {
      for (const [mesh, which] of [
        [part.src, "src"],
        [part.own, "own"],
      ]) {
        mesh.userData.textured ??= mesh.material;
        if (mesh.material !== FLAT && mesh.material !== mesh.userData.textured) {
          mesh.userData.textured = mesh.material;
        }
        mesh.material = state.wireframe ? FLAT : mesh.userData.textured;
        const key = `${which}Wire`;
        if (state.wireframe && !part[key]) {
          part[key] = new THREE.Mesh(mesh.geometry, WIRE);
          mesh.add(part[key]);
          model.wires.push(part[key]);
        }
        if (part[key]) {
          part[key].geometry = mesh.geometry;
          part[key].visible = state.wireframe;
        }
      }
    }
  }

  // ---------- the panel ----------

  function textureTotal(key) {
    const sizes = model.textureBytes.get(key);
    return sizes ? sizes.reduce((s, x) => s + x.bytes, 0) : null;
  }

  function mineGeometryBytes(positionBits = state.positions8 ? 8 : 16) {
    const p0 = model.parts.find((p) => p.prog) ?? {};
    return geometryBytes({
      vertices: model.vertices || model.parts.reduce((s, p) => s + (p.vertexCount ?? 0), 0),
      triangles: model.kept,
      chain: model.chain ?? [],
      hasNormals: p0.hasNormals ?? true,
      hasUvs: p0.hasUvs ?? true,
      hasTangents: p0.hasTangents ?? false,
      positionBits,
      jsonBytes: model.jsonBytes + 400,
    });
  }

  function renderPanel() {
    const original = model.shares;
    const key = textureKey(state.textureStep, state.webp);
    const tex = textureTotal(key);
    const geo = mineGeometryBytes();
    const total = tex === null ? null : tex + geo;
    renderSize(original, tex, geo, total);
    renderAb(original, total);
    renderShape(geo);
    renderSteps(geo);
    renderFar();
    renderMeasure();
    showProgress();
  }

  function renderSize(original, tex, geo, total) {
    $.total.textContent = total === null ? "..." : formatBytes(total);
    $.totalShare.textContent =
      total === null ? "working out the pictures" : `${formatShare(total, original.total)} of ${formatBytes(original.total)}`;
    const scale = original.total;
    const setBar = (bar, t, g) => {
      bar.children[0].style.width = `${(100 * (t ?? 0)) / scale}%`;
      bar.children[1].style.width = `${(100 * g) / scale}%`;
    };
    setBar($.barOriginal, original.textures, original.geometry);
    setBar($.barMine, tex, geo);
    $.texBytes.textContent = `${formatBytes(original.textures)} to ${tex === null ? "..." : formatBytes(tex)}`;
    $.geoBytes.textContent = `${formatBytes(original.geometry)} to ${formatBytes(geo)}`;
    const keeps = total !== null && total > KEEP_ABOVE * original.total;
    $.keepNote.hidden = !keeps;
    $.keepNote.textContent = keeps
      ? `Above ${Math.round(KEEP_ABOVE * 100)} % of the original, the editor keeps the original file: lower a control to save anything.`
      : "";
  }

  function renderAb(original, total) {
    const mine = state.showing === "mine";
    $.abMine.setAttribute("aria-pressed", String(mine));
    $.abOriginal.setAttribute("aria-pressed", String(!mine));
    $.abOriginalSize.textContent = formatBytes(original.total);
    $.abMineSize.textContent = total === null ? "..." : formatBytes(total);
    $.badge.textContent = mine ? "You are looking at your version" : "You are looking at the original";
    $.badge.classList.toggle("is-original", !mine);
  }

  function renderShape(geo) {
    $.share.min = String(state.minShare);
    $.share.value = String(state.share);
    $.shareOut.textContent = `${state.share} %`;
    const ready = model.parts.some((p) => p.prog);
    if (!ready) {
      $.shapeRead.textContent = "Preparing live shape detail...";
    } else {
      const part = model.parts.find((p) => p.prog);
      const moved = part.curve.length > 0 ? errorAt(part.curve, part.level / part.total) : null;
      const movedText =
        state.share === 100 ? "the shape as it is" : moved === null ? "measuring how far it moves" : `moves at most ${formatLength(moved)}`;
      $.shapeRead.textContent = `${formatCount(model.kept)} of ${formatCount(model.triangles)} triangles, ${movedText}`;
    }
    $.wireframe.checked = state.wireframe;
    $.positions8.checked = state.positions8;
    $.webp.checked = state.webp;
    const other = mineGeometryBytes(state.positions8 ? 16 : 8);
    const diff = Math.abs(other - geo);
    $.pos8Save.textContent = state.positions8 ? `saves ${formatBytes(diff)}` : `would save ${formatBytes(diff)}`;
  }

  function renderSteps(geo) {
    if ($.steps.children.length === 0) {
      for (const s of TEXTURE_STEPS) {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.dataset.step = s.id;
        b.innerHTML = `<span>${s.label}</span><small></small><i></i>`;
        b.addEventListener("click", () => dispatch({ type: "textureStep", id: s.id }));
        $.steps.append(b);
      }
    }
    for (const b of $.steps.children) {
      const s = TEXTURE_STEPS.find((x) => x.id === b.dataset.step);
      const key = textureKey(s.id, state.webp);
      const tex = textureTotal(key);
      const on = s.id === state.textureStep;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
      const same = s.side < 16384 && s.side >= model.largestSide;
      b.querySelector("small").textContent =
        tex === null ? (model.textureFailed.has(key) ? "failed" : "...") : formatBytes(tex + geo);
      b.title = same ? "Your pictures are this size or smaller already: only re-encoded" : "";
      const p = model.textureProgress.get(key);
      b.querySelector("i").style.width = p === undefined ? "0" : `${Math.round(p * 100)}%`;
    }
    const step = TEXTURE_STEPS.find((x) => x.id === state.textureStep);
    $.picOut.textContent = step.id === "original" ? "as they are" : `${step.label} px`;
    const jpeg = textureTotal(textureKey(state.textureStep, false));
    const webp = textureTotal(textureKey(state.textureStep, true));
    $.webpSave.textContent =
      jpeg === null || webp === null
        ? ""
        : webp < jpeg
          ? `${state.webp ? "saves" : "would save"} ${formatBytes(jpeg - webp)} here`
          : "saves nothing here";
  }

  function renderFar() {
    $.distance.value = String(state.distance);
    $.drop.value = String(state.drop);
    const part = model.parts.find((p) => p.prog);
    const far = state.distance === 0;
    $.distanceOut.textContent = far ? "up close" : `a visitor ${formatMetres(model.visitorAt)} away`;
    if (!part || part.curve.length === 0) {
      $.farRead.textContent = part ? "Measuring how the shape holds up from afar..." : "Preparing live shape detail...";
      $.ruler.replaceChildren();
      $.loupe.hidden = true;
      return;
    }
    renderRuler(part);
    const counts = [part.level, ...part.chainCounts];
    const s = model.switches;
    const pieces = [`All ${formatCount(counts[0])} triangles to ${formatMetres(s[0] ?? Infinity)}`];
    for (let i = 1; i < counts.length; i++) {
      pieces.push(`${formatCount(counts[i])} ${i + 1 < counts.length ? `to ${formatMetres(s[i])}` : "beyond"}`);
    }
    const drawnNow = far ? "" : `. Drawn at ${formatMetres(model.visitorAt)}: ${formatCount(model.drawn)}`;
    $.farRead.textContent = `${pieces.join(", then ")}${drawnNow}`;
    $.loupe.hidden = far;
    $.loupe.textContent = far ? "" : `Up close, what a visitor at ${formatMetres(model.visitorAt)} gets`;
  }

  function renderRuler(part) {
    const near = model.closeDistance;
    const far = Math.max(near * 4, model.size * 400, 60);
    const pos = (d) => Math.min(100, Math.max(0, (100 * Math.log(Math.max(d, near) / near)) / Math.log(far / near)));
    const counts = [part.level, ...part.chainCounts];
    const s = model.switches;
    const segs = [];
    let from = 0;
    counts.forEach((c, i) => {
      const to = i < s.length ? pos(s[i]) : 100;
      segs.push(`<span class="seg lv${i}" style="left:${from}%;width:${Math.max(0, to - from)}%"></span>`);
      from = to;
    });
    const at = state.distance === 0 ? 0 : pos(model.visitorAt);
    $.ruler.innerHTML = `${segs.join("")}<b style="left:${at}%"></b>`;
  }

  function renderMeasure() {
    const sorted = [...updateTimes].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    $.measure.textContent = `Live update ${lastUpdateMs.toFixed(1)} ms (median ${median.toFixed(1)} ms) - ${root.querySelectorAll("*").length} elements`;
  }

  function showProgress() {
    if (!model) {
      return;
    }
    const key = textureKey(state.textureStep, state.webp);
    const waiting = !model.textureBytes.has(key) || model.shownKey !== key;
    const p = model.textureProgress.get(key) ?? 0;
    const step = TEXTURE_STEPS.find((s) => s.id === state.textureStep);
    $.busy.hidden = !waiting || model.textureFailed.has(key);
    $.busyText.textContent = `Making the ${step.id === "original" ? "original-size" : `${step.label} px`} ${state.webp ? "WebP " : ""}pictures`;
    $.busyBar.style.width = `${Math.round(p * 100)}%`;
  }

  // ---------- drawing ----------

  function draw() {
    const canvas = renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) {
      return;
    }
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setViewport(0, 0, w, h);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);
    if (model && state.distance > 0) {
      drawLoupe(w, h);
    }
  }

  /** The loupe: the level drawn at the visitor's distance, seen from the
   *  author's own close-up distance, top right of the view. */
  function drawLoupe(w, h) {
    const side = Math.round(Math.min(Math.max(w * 0.3, 120), 260, h * 0.45));
    const x = w - side - 12;
    const y = h - side - 12 - 44;
    const dir = camera.position.clone().sub(controls.target).setLength(model.closeDistance * 1.25);
    loupeCamera.position.copy(controls.target).add(dir);
    loupeCamera.lookAt(controls.target);
    loupeCamera.aspect = 1;
    loupeCamera.near = model.size / 400;
    loupeCamera.far = model.size * 50;
    loupeCamera.updateProjectionMatrix();
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, side, side);
    renderer.setScissor(x, y, side, side);
    const background = scene.background;
    scene.background = LOUPE_BACKGROUND;
    renderer.render(scene, loupeCamera);
    scene.background = background;
    renderer.setScissorTest(false);
    $.loupe.style.right = "12px";
    $.loupe.style.top = `${12 + 44 - 2}px`;
    $.loupe.style.width = `${side}px`;
  }

  let frameHandle = 0;
  const loop = () => {
    frameHandle = requestAnimationFrame(loop);
    if (dirty) {
      dirty = false;
      draw();
    }
  };
  loop();
  const resize = new ResizeObserver(() => {
    dirty = true;
  });
  resize.observe($.canvas);

  // ---------- input ----------

  $.share.addEventListener("input", () => dispatch({ type: "share", value: Number($.share.value) }));
  $.distance.addEventListener("input", () => dispatch({ type: "distance", value: Number($.distance.value) }));
  $.drop.addEventListener("input", () => dispatch({ type: "drop", value: Number($.drop.value) }));
  for (const name of ["wireframe", "positions8", "webp"]) {
    $[name].addEventListener("change", () => dispatch({ type: "toggle", name, on: $[name].checked }));
  }
  $.abMine.addEventListener("click", () => dispatch({ type: "show", which: "mine" }));
  $.abOriginal.addEventListener("click", () => dispatch({ type: "show", which: "original" }));
  $.steps.addEventListener("keydown", (event) => {
    const at = TEXTURE_STEPS.findIndex((s) => s.id === state.textureStep);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const next = TEXTURE_STEPS[at + (step ?? 0)];
    if (step && next) {
      event.preventDefault();
      dispatch({ type: "textureStep", id: next.id });
      $.steps.querySelector(`[data-step="${next.id}"]`)?.focus();
    }
  });
  const onKey = (event) => {
    const t = event.target;
    const typing = t instanceof HTMLInputElement && t.type !== "checkbox" && t.type !== "range";
    if (typing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.key === "o" || event.key === "O" || (event.key === " " && !(t instanceof HTMLButtonElement) && !(t instanceof HTMLInputElement))) {
      event.preventDefault();
      dispatch({ type: "flip" });
    }
  };
  window.addEventListener("keydown", onKey);
  $.back.addEventListener("click", () => options.onBack?.());
  $.accept.addEventListener("click", () => options.onAccept?.(settings()));

  // Double-tap or double-click: look closer at that spot.
  const raycaster = new THREE.Raycaster();
  let lastTap = { t: 0, x: 0, y: 0 };
  $.canvas.addEventListener("pointerup", (event) => {
    const now = performance.now();
    const near = Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 24;
    if (now - lastTap.t < 320 && near) {
      focusAt(event.clientX, event.clientY);
      lastTap = { t: 0, x: 0, y: 0 };
    } else {
      lastTap = { t: now, x: event.clientX, y: event.clientY };
    }
  });

  function focusAt(clientX, clientY) {
    if (!model) {
      return;
    }
    const rect = $.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const shown = state.showing === "mine" ? model.mine : model.original;
    const hit = raycaster.intersectObject(shown, true).find((h) => h.object.material !== WIRE);
    if (!hit) {
      return;
    }
    const dir = camera.position.clone().sub(controls.target);
    controls.target.copy(hit.point);
    dir.setLength(Math.max(controls.minDistance, dir.length() * 0.5));
    camera.position.copy(hit.point).add(dir);
    controls.update();
  }

  // ---------- the API ----------

  /** The settings the shelf's optimizer takes for this version. */
  function settings() {
    const step = TEXTURE_STEPS.find((s) => s.id === state.textureStep);
    return {
      detailShare: state.share / 100,
      textureMaxSidePx: step.side,
      ...(state.webp ? { textureType: "image/webp" } : {}),
      ...(state.positions8 ? { positionBits: 8, maxPositionError: POSITION8_ERROR } : {}),
      distanceBudgetPx: Number(budgetOf(state.drop).toFixed(2)),
    };
  }

  function metrics() {
    const sorted = [...updateTimes].sort((a, b) => a - b);
    return {
      elements: root.querySelectorAll("*").length,
      lastUpdateMs,
      medianUpdateMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      worstUpdateMs: sorted.length ? sorted[sorted.length - 1] : null,
      updates: updateTimes.length,
      buildMs: model?.parts.map((p) => p.buildMs ?? null) ?? [],
      ready: Boolean(model?.parts.every((p) => p.prog || p.skipped)),
      measured: Boolean(model?.parts.every((p) => p.measured || p.skipped)),
      picturesMade: model ? model.textureBytes.size : 0,
      shownPictures: model?.shownKey ?? null,
      triangles: model?.kept ?? null,
      drawn: model?.drawn ?? null,
      bytes: model ? { original: model.shares.total, pictures: textureTotal(textureKey(state.textureStep, state.webp)), shape: mineGeometryBytes() } : null,
      camera: { position: camera.position.toArray(), target: controls.target.toArray() },
    };
  }

  function dispose() {
    cancelAnimationFrame(frameHandle);
    resize.disconnect();
    window.removeEventListener("keydown", onKey);
    clearModel();
    simplifier.terminate();
    textures.terminate();
    controls.dispose();
    renderer.dispose();
    root.replaceChildren();
  }

  return {
    load,
    dispatch,
    getState: () => state,
    settings,
    metrics,
    dispose,
  };
}
