// Guided model import ("two guided steps"): the panel a tour creator meets
// after dropping a .glb on the editor's asset shelf. Step 1 takes the
// bigger lever (pictures or shape, by bytes), step 2 the other, step 3
// (optional) how soon detail drops with distance. Any step can be opened,
// swapped or kept as it is; Original / Yours is one tap away and never
// moves the camera.
//
// mountModelImport(host, options) -> controller; see README.md.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { stepsFor, levelIndices } from "../model-lod-1/lod-simplify.js";
import {
  CHAIN_SHARES,
  SHELF,
  TEXTURE_STEPS,
  WEBP,
  byteShares,
  formatBytes,
  formatLength,
  geometryBytes,
  imageSide,
  levelAt,
  overheadBytes,
  pictureEntries,
  pixelBudget,
  readGlb,
  recommendFirst,
  switchDistance,
  textureFormat,
} from "./size-model.js";
import { flowReducer, initialFlow } from "./import-flow.js";

const STYLE_URL = new URL("./model-import.css", import.meta.url).href;
const WORKER_URL = new URL("./import-worker.js", import.meta.url);
const FOV = 40;
/** The walk-away slider reaches this many times the distance at which the
 *  coarsest level takes over at the standard falloff, so every switch is
 *  on it while the model stays visible. */
const WALK_REACH = 2.5;
const STEP_TITLES = {
  pictures: "Pictures",
  shape: "Shape",
  distance: "Far away",
  review: "Your version",
};

const TEMPLATE = `
<div class="mi">
  <div class="mi-stage" data-ref="stage">
    <canvas class="mi-canvas" data-ref="canvas" aria-label="3D view of the model. Drag to turn it, scroll or pinch to zoom."></canvas>
    <div class="mi-size" data-ref="sizeCard">
      <div class="mi-size-label">Your file</div>
      <div class="mi-size-now" data-ref="sizeNow">-</div>
      <div class="mi-size-share" data-ref="sizeShare"></div>
      <div class="mi-bar" aria-hidden="true"><span class="mi-bar-pictures" data-ref="barPictures"></span><span class="mi-bar-shape" data-ref="barShape"></span></div>
      <div class="mi-size-split"><span class="mi-key mi-key-pictures"></span><span data-ref="splitPictures"></span><span class="mi-key mi-key-shape"></span><span data-ref="splitShape"></span></div>
    </div>
    <button class="mi-look" type="button" data-ref="look" aria-pressed="false">Show the triangles</button>
    <div class="mi-compare" role="group" aria-label="Which version is shown" data-ref="compare">
      <button type="button" data-ref="showOriginal" aria-pressed="false">Original</button>
      <button type="button" data-ref="showMine" aria-pressed="true">Yours</button>
    </div>
    <div class="mi-inset" data-ref="inset" hidden><span>Up close: what is drawn there</span></div>
    <div class="mi-busy" data-ref="busy" role="status" hidden>
      <div class="mi-busy-title" data-ref="busyTitle"></div>
      <div class="mi-progress"><span data-ref="busyBar"></span></div>
    </div>
    <div class="mi-hook" data-ref="hook" aria-hidden="true"></div>
  </div>
  <section class="mi-panel" aria-label="Make the model lighter">
    <header class="mi-head">
      <p class="mi-kicker" data-ref="modelName"></p>
      <h2>Make it light for phones</h2>
    </header>
    <ol class="mi-steps" data-ref="stepper"></ol>
    <p class="mi-advice" data-ref="advice" hidden></p>

    <div class="mi-step" data-step="pictures" hidden>
      <h3>Pictures</h3>
      <p class="mi-lead" data-ref="picturesLead"></p>
      <div class="mi-sizes" role="radiogroup" aria-label="Picture size" data-ref="sizes"></div>
      <label class="mi-switch"><input type="checkbox" data-ref="webp" /><span>WebP pictures <small data-ref="webpSave"></small></span></label>
      <p class="mi-tip">Zoom in where it matters, then tap <b>Original</b> to compare. The camera stays where it is.</p>
      <p class="mi-working" data-ref="picturesWorking"></p>
      <div class="mi-actions"><button type="button" data-act="keep">Keep them as they are</button><button type="button" class="mi-primary" data-act="next" data-ref="nextPictures"></button></div>
    </div>

    <div class="mi-step" data-step="shape" hidden>
      <h3>Shape</h3>
      <p class="mi-lead" data-ref="shapeLead"></p>
      <div class="mi-slider-head"><label for="mi-quality">Triangles kept</label><output data-ref="qualityOut">100 %</output></div>
      <input class="mi-range" id="mi-quality" type="range" min="1" max="100" value="100" data-ref="quality" disabled />
      <div class="mi-ends"><span data-ref="qualityMin">Fewest</span><span>All</span></div>
      <p class="mi-fact" data-ref="shapeFact"></p>
      <p class="mi-caution" data-ref="shapeCaution" hidden></p>
      <button type="button" class="mi-link" data-ref="keepAll" hidden>Back to all triangles</button>
      <label class="mi-switch"><input type="checkbox" data-ref="positions8" /><span>Store the points more compactly <small data-ref="pos8Save"></small></span></label>
      <p class="mi-working" data-ref="shapeWorking"></p>
      <div class="mi-actions"><button type="button" data-act="keep">Keep the shape as it is</button><button type="button" class="mi-primary" data-act="next" data-ref="nextShape"></button></div>
    </div>

    <div class="mi-step" data-step="distance" hidden>
      <h3>Far away <span class="mi-optional">optional</span></h3>
      <p class="mi-lead">Visitors often see a model from a distance, where fewer triangles look the same. Choose how soon its detail may drop. This costs nothing in file size; it saves phones work when many models are in view.</p>
      <div class="mi-slider-head"><label for="mi-distance">Walk away from it</label><output data-ref="distanceOut"></output></div>
      <input class="mi-range" id="mi-distance" type="range" min="0" max="1000" value="0" data-ref="distance" />
      <div class="mi-slider-head"><label for="mi-falloff">Detail drops</label><output data-ref="falloffOut"></output></div>
      <input class="mi-range" id="mi-falloff" type="range" min="1" max="100" value="50" data-ref="falloff" />
      <div class="mi-ends"><span>Later, sharper</span><span>Sooner, lighter</span></div>
      <div class="mi-strip" data-ref="strip" aria-hidden="true"></div>
      <p class="mi-fact" data-ref="distanceFact"></p>
      <div class="mi-actions"><button type="button" data-act="keep">Use the standard</button><button type="button" class="mi-primary" data-act="next">Done</button></div>
    </div>

    <div class="mi-step" data-step="review" hidden>
      <h3>Your version</h3>
      <p class="mi-review-size" data-ref="reviewSize"></p>
      <ul class="mi-summary" data-ref="summary"></ul>
      <div class="mi-actions"><button type="button" data-act="back">Back</button><button type="button" class="mi-primary" data-act="accept">Use this version</button></div>
      <p class="mi-accepted" data-ref="accepted" role="status" hidden></p>
    </div>
    <p class="mi-error" data-ref="error" role="alert" hidden></p>
  </section>
</div>`;

function ensureStyles(doc) {
  if (doc.querySelector("link[data-model-import]")) {
    return;
  }
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.modelImport = "";
  doc.head.appendChild(link);
}

function collectRefs(root) {
  const refs = {};
  for (const el of root.querySelectorAll("[data-ref]")) {
    refs[el.dataset.ref] = el;
  }
  return refs;
}

/** A helper thread with promise calls and progress callbacks. */
function workerClient() {
  const worker = new Worker(WORKER_URL, { type: "module" });
  const pending = new Map();
  let next = 1;
  const failAll = (message) => {
    for (const p of pending.values()) {
      p.reject(new Error(message));
    }
    pending.clear();
  };
  worker.onmessage = (event) => {
    const m = event.data;
    const p = pending.get(m.id);
    if (!p) {
      return;
    }
    if (m.type === "progress") {
      p.onProgress?.(m.f, m.label);
      return;
    }
    pending.delete(m.id);
    if (m.type === "error") {
      p.reject(new Error(m.message));
    } else {
      p.resolve(m);
    }
  };
  worker.onerror = (event) =>
    failAll(event.message || "the helper thread stopped");
  return {
    call(message, transfer = [], onProgress = null) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress });
        worker.postMessage({ ...message, id }, transfer);
      });
    },
    stop() {
      worker.terminate();
      failAll("stopped");
    },
  };
}

/** One attribute copied out per component (a model's attributes may be
 *  interleaved). */
function flatten(attribute) {
  const out = new Float32Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++) {
    for (let c = 0; c < attribute.itemSize; c++) {
      out[i * attribute.itemSize + c] = attribute.getComponent(i, c);
    }
  }
  return out;
}

function firstMesh(root) {
  let found = null;
  root.traverse((o) => {
    if (o.isMesh && found === null) {
      found = o;
    }
  });
  return found;
}

/** Texture slots a glTF material fills in three.js. */
const SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
];

const FLAT = new THREE.MeshStandardMaterial({
  color: 0xc9c6bf,
  flatShading: true,
  roughness: 1,
  metalness: 0,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
const WIRE = new THREE.MeshBasicMaterial({
  color: 0x23302b,
  wireframe: true,
  transparent: true,
  opacity: 0.55,
});

function disposeMaterial(material) {
  for (const value of Object.values(material)) {
    if (value?.isTexture) {
      value.dispose();
    }
  }
  material.dispose();
}

const median = (values) => {
  if (values.length === 0) {
    return 0;
  }
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Mounts the guided import into `host` (an element that has a size).
 * @param {HTMLElement} host
 * @param {{ onAccept?: (result: object) => void, onBack?: () => void }} [options]
 */
export function mountModelImport(host, options = {}) {
  if (!(host instanceof HTMLElement)) {
    throw new TypeError("mountModelImport needs an element to draw into");
  }
  ensureStyles(host.ownerDocument);
  host.innerHTML = TEMPLATE;
  const ui = collectRefs(host);
  const root = host.firstElementChild;

  // ---- the scene (imperative resources, not state) ----
  const renderer = new THREE.WebGLRenderer({
    canvas: ui.canvas,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe6e4de);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8172, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(3, 5, 2.5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000);
  const insetCamera = camera.clone();
  const controls = new OrbitControls(camera, ui.canvas);
  controls.enableDamping = true;

  let flow = initialFlow("pictures");
  let model = null;
  let loadId = 0;
  let workers = null;
  let destroyed = false;
  const timings = { quality: [], distance: [] };
  let lastUpdate = { kind: "", ms: 0 };

  // ---- size arithmetic for the current model ----
  function picturesBytes(m, choices) {
    let sum = 0;
    for (const p of m.pictures) {
      const r = m.cache.get(pictureKey(p, choices.texture, choices.webp));
      if (!r || r.failed) {
        return null;
      }
      sum += r.size;
    }
    return sum;
  }

  /** Triangles in the saved levels and vertices used, at `quality`. */
  function levelCounts(m, quality) {
    if (!m.prog) {
      const t = Math.round((m.sourceTriangles * quality) / 100);
      return {
        triangles: Math.round(t * (1 + 1 / 4 + 1 / 16)),
        vertices: Math.round((m.sourceVertices * quality) / 100),
      };
    }
    const top = Math.round((m.total * quality) / 100);
    let triangles = 0;
    let prev = Infinity;
    for (const share of CHAIN_SHARES) {
      const alive = m.prog.stepAlive[stepsFor(m.prog, Math.round(top * share))];
      if (alive < prev) {
        triangles += alive;
        prev = alive;
      }
    }
    const vertices =
      quality === flow.choices.quality && m.level
        ? m.level.vertices
        : m.vertexCount;
    return { triangles, vertices };
  }

  function shapeBytes(m, choices, quality = choices.quality) {
    const counts = levelCounts(m, quality);
    return geometryBytes({
      ...m.attrs,
      ...counts,
      positionBits: choices.positions8 ? 8 : 16,
    });
  }

  function estimate(m, choices) {
    const pictures = picturesBytes(m, choices);
    const shape = shapeBytes(m, choices);
    const overhead = overheadBytes(m.shares);
    return {
      pictures,
      shape,
      total: pictures === null ? null : overhead + pictures + shape,
    };
  }

  // ---- pictures: measured in the helper, previewed for real ----
  function pictureKey(p, stepId, webp) {
    const fmt = textureFormat(p.use, p.mime, webp);
    return `${p.index}|${stepId}|${fmt.type}`;
  }

  function visibleSteps(m) {
    return TEXTURE_STEPS.filter(
      (s) => s.id === "original" || s.side < m.maxSide,
    );
  }

  function queueChoice(m, stepId, webp, front) {
    const jobs = m.pictures.map((p) => ({
      p,
      stepId,
      webp,
      key: pictureKey(p, stepId, webp),
    }));
    const fresh = jobs.filter(
      (j) => !m.cache.has(j.key) && !m.queue.some((q) => q.key === j.key),
    );
    if (front) {
      m.queue.unshift(...fresh);
    } else {
      m.queue.push(...fresh);
    }
    m.jobsTotal += fresh.length;
  }

  function queueAllPictures(m) {
    const order = ["original", "1024", "512", "2048", "256", "128"];
    const steps = visibleSteps(m).map((s) => s.id);
    for (const webp of [false, true]) {
      for (const id of order.filter((o) => steps.includes(o))) {
        queueChoice(m, id, webp, false);
      }
    }
  }

  async function runPictureJob(m, job) {
    const step = TEXTURE_STEPS.find((s) => s.id === job.stepId);
    const format = textureFormat(job.p.use, job.p.mime, job.webp);
    try {
      const r = await workers.pictures.call({
        type: "encode",
        key: job.key,
        bytes: job.p.bytes,
        mime: job.p.mime,
        side: step.side,
        format,
      });
      m.cache.set(job.key, r);
    } catch (error) {
      if (m !== model) {
        return;
      }
      m.cache.set(job.key, { failed: true, message: error.message });
      if (job.webp) {
        m.webpFailed = error.message;
      }
    }
  }

  async function pumpPictures(m) {
    if (m.encoding) {
      return;
    }
    m.encoding = true;
    while (m === model && m.queue.length > 0) {
      const job = m.queue.shift();
      if (m.cache.has(job.key)) {
        continue;
      }
      await runPictureJob(m, job);
      m.jobsDone++;
      if (m === model) {
        pictureResultArrived(m);
      }
    }
    m.encoding = false;
  }

  function pictureResultArrived(m) {
    renderSizes(m);
    updateSize();
    const choices = flow.choices;
    const ready = m.pictures.every((p) =>
      m.cache.has(pictureKey(p, choices.texture, choices.webp)),
    );
    if (ready && m.appliedPictures !== `${choices.texture}|${choices.webp}`) {
      applyPictures();
    }
  }

  async function applyPictures() {
    const m = model;
    if (!m) {
      return;
    }
    const { texture, webp } = flow.choices;
    const results = m.pictures.map((p) =>
      m.cache.get(pictureKey(p, texture, webp)),
    );
    if (results.some((r) => !r)) {
      queueChoice(m, texture, webp, true);
      pumpPictures(m);
      renderSizes(m);
      return;
    }
    const token = ++m.pictureToken;
    const bitmaps = await Promise.all(
      results.map((r) =>
        r.failed || r.kept
          ? null
          : createImageBitmap(r.blob, { premultiplyAlpha: "none" }),
      ),
    );
    if (token !== m.pictureToken || m !== model) {
      bitmaps.forEach((b) => b?.close());
      return;
    }
    const old = [];
    m.pictures.forEach((p, i) =>
      old.push(...setMineImage(m, p.index, bitmaps[i])),
    );
    old.forEach((b) => b.close());
    m.appliedPictures = `${texture}|${webp}`;
    renderSizes(m);
  }

  /** Points every texture of image `index` in "yours" at `bitmap` (null:
   *  the original's own picture). Returns the bitmaps it replaced. */
  function setMineImage(m, index, bitmap) {
    const replaced = [];
    for (const entry of m.mineTextures) {
      if (entry.image !== index) {
        continue;
      }
      const prev = entry.texture.userData.bitmap;
      if (prev) {
        replaced.push(prev);
      }
      entry.texture.source = bitmap
        ? new THREE.Source(bitmap)
        : entry.original.source;
      entry.texture.userData.bitmap = bitmap;
      entry.texture.needsUpdate = true;
    }
    return replaced;
  }

  // ---- shape: the live level, the 8-bit points, the distance chain ----
  function writeIndex(geometry, array) {
    const attr = geometry.index;
    attr.array.set(array, 0);
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, array.length);
    attr.needsUpdate = true;
  }

  function countVertices(m, indices) {
    m.mark.fill(0);
    let n = 0;
    for (let i = 0; i < indices.length; i++) {
      if (m.mark[indices[i]] === 0) {
        m.mark[indices[i]] = 1;
        n++;
      }
    }
    return n;
  }

  function applyQuality() {
    const m = model;
    if (!m?.prog) {
      return;
    }
    const t0 = performance.now();
    const top = Math.round((m.total * flow.choices.quality) / 100);
    const steps = stepsFor(m.prog, top);
    const indices = levelIndices(m.prog, steps);
    writeIndex(m.mineGeometry, indices);
    m.mineGeometry.setDrawRange(0, indices.length);
    m.level = {
      top,
      steps,
      triangles: indices.length / 3,
      vertices: countVertices(m, indices),
    };
    if (m.chain?.top !== top) {
      m.chain = null;
      scheduleChain(m);
    }
    recordTiming("quality", performance.now() - t0);
    renderShapeText(m);
  }

  let chainTimer = 0;
  function scheduleChain(m, now = false) {
    clearTimeout(chainTimer);
    chainTimer = setTimeout(() => requestChain(m), now ? 0 : 220);
  }

  async function requestChain(m) {
    if (m !== model || !m.level || m.chainPending === m.level.top) {
      return;
    }
    const top = m.level.top;
    m.chainPending = top;
    try {
      const r = await workers.shape.call({ type: "chain", top });
      if (m !== model || m.level.top !== top) {
        return;
      }
      writeIndex(m.mineGeometry, r.indices);
      m.chain = { top, levels: r.levels };
      if (flow.current === "distance") {
        applyDistance();
      } else {
        m.mineGeometry.setDrawRange(0, r.levels[0].count);
      }
      renderShapeText(m);
    } catch (error) {
      showError(m, error);
    } finally {
      if (m.chainPending === top) {
        m.chainPending = null;
      }
    }
  }

  function applyPositions() {
    const m = model;
    if (!m?.prog) {
      return;
    }
    const attr = m.mineGeometry.attributes.position;
    if (!flow.choices.positions8) {
      attr.array.set(m.positions);
    } else {
      const c = m.box.getCenter(new THREE.Vector3()).toArray();
      const scale = m.maxExtent / 2 / 127;
      for (let i = 0; i < m.positions.length; i++) {
        const q = Math.max(
          -127,
          Math.min(127, Math.round((m.positions[i] - c[i % 3]) / scale)),
        );
        attr.array[i] = c[i % 3] + q * scale;
      }
    }
    attr.needsUpdate = true;
    renderShapeText(m);
  }

  // ---- the distance step ----
  function distanceRange(m) {
    const near = m.closePose
      ? m.closePose.position.distanceTo(m.closePose.target)
      : m.size * 1.5;
    const levels = m.chain?.levels;
    const last = levels ? switchDistance(levels.at(-1).error, pixelBudget(50), FOV) : 0;
    return { near, far: Math.max(near * 8, WALK_REACH * last) };
  }

  function distanceMetres(m) {
    const { near, far } = distanceRange(m);
    return near * Math.pow(far / near, Number(ui.distance.value) / 1000);
  }

  function placeCameraAt(m, d) {
    const pose = m.closePose;
    const dir = pose.position.clone().sub(pose.target).normalize();
    controls.target.copy(pose.target);
    camera.position.copy(pose.target).addScaledVector(dir, d);
    camera.near = Math.max(m.size / 200, d - m.size * 2, 0.001);
    camera.far = d + m.size * 50;
    camera.updateProjectionMatrix();
  }

  function applyDistance() {
    const m = model;
    if (!m?.closePose) {
      return;
    }
    const t0 = performance.now();
    const d = distanceMetres(m);
    placeCameraAt(m, d);
    ui.distanceOut.textContent = `${formatLength(d)} away`;
    const budget = pixelBudget(flow.choices.falloff);
    ui.falloffOut.textContent = falloffWords(flow.choices.falloff);
    if (!m.chain) {
      ui.distanceFact.textContent = m.prog
        ? "Measuring the coarser levels..."
        : "The shape is still being prepared.";
      ui.strip.replaceChildren();
      if (m.level) {
        scheduleChain(m, true);
      }
      return;
    }
    const pick = levelAt(m.chain.levels, d, budget, FOV);
    const level = m.chain.levels[pick];
    m.mineGeometry.setDrawRange(level.start, level.count);
    recordTiming("distance", performance.now() - t0);
    renderStrip(m, d, budget, pick);
  }

  function falloffWords(v) {
    if (v < 35) {
      return "later";
    }
    return v > 65 ? "sooner" : "standard";
  }

  const LEVEL_NAMES = ["all your triangles", "a quarter", "a sixteenth"];

  function renderStrip(m, d, budget, pick) {
    const { near, far } = distanceRange(m);
    const pos = (x) =>
      (100 * Math.log(Math.max(near, Math.min(far, x)) / near)) /
      Math.log(far / near);
    const levels = m.chain.levels;
    const starts = levels.map((l) => switchDistance(l.error, budget, FOV));
    const parts = levels.map((l, i) => {
      const from = i === 0 ? 0 : pos(starts[i]);
      const to = i + 1 < levels.length ? pos(starts[i + 1]) : 100;
      const seg = document.createElement("span");
      seg.className =
        `mi-strip-seg mi-strip-l${i}` + (i === pick ? " is-on" : "");
      seg.style.left = from + "%";
      seg.style.width = Math.max(0, to - from) + "%";
      return seg;
    });
    const marker = document.createElement("span");
    marker.className = "mi-strip-marker";
    marker.style.left = pos(d) + "%";
    ui.strip.replaceChildren(...parts, marker);
    const sentences = levels.map((l, i) => {
      const n = (l.count / 3).toLocaleString("en-US");
      const name = LEVEL_NAMES[i] ?? `level ${i + 1}`;
      if (i === 0) {
        return `${name} (${n})`;
      }
      return `${name} (${n}) from ${formatLength(starts[i])}`;
    });
    ui.distanceFact.innerHTML =
      `A visitor here sees <b>${LEVEL_NAMES[pick] ?? "level " + (pick + 1)}</b>. ` +
      `Close up: ${sentences.join(", then ")}.`;
  }

  // ---- size card and per-step texts ----
  function updateSize() {
    const m = model;
    if (!m) {
      return;
    }
    const e = estimate(m, flow.choices);
    const total = m.shares.total;
    if (e.total === null) {
      ui.sizeNow.textContent = m.lastTotal ? formatBytes(m.lastTotal) : "...";
      ui.sizeShare.textContent = "measuring the pictures...";
      ui.sizeCard.classList.add("is-measuring");
    } else {
      m.lastTotal = e.total;
      ui.sizeNow.textContent = formatBytes(e.total);
      ui.sizeShare.textContent = `${Math.round((100 * e.total) / total)} % of the original ${formatBytes(total)}`;
      ui.sizeCard.classList.remove("is-measuring");
    }
    const pictures = e.pictures ?? m.lastPictures ?? m.shares.pictures;
    m.lastPictures = pictures;
    ui.barPictures.style.width = `${(100 * pictures) / total}%`;
    ui.barShape.style.width = `${(100 * e.shape) / total}%`;
    ui.splitPictures.textContent = `Pictures ${formatBytes(pictures)}`;
    ui.splitShape.textContent = `Shape ${formatBytes(e.shape)}`;
    renderReview(m);
  }

  function renderSizes(m) {
    const { texture, webp } = flow.choices;
    const buttons = visibleSteps(m).map((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(s.id === texture));
      b.dataset.texture = s.id;
      const bytes = picturesBytes(m, { texture: s.id, webp });
      const tag =
        s.side === SHELF.defaultSide ? '<em class="mi-tag">suggested</em>' : "";
      b.innerHTML = `<b>${s.label}</b><small>${bytes === null ? "measuring" : formatBytes(bytes)}</small>${tag}`;
      return b;
    });
    ui.sizes.replaceChildren(...buttons);
    renderWebpSaving(m);
    const left = m.jobsTotal - m.jobsDone;
    ui.picturesWorking.textContent =
      left > 0
        ? `Measuring each size for real: ${m.jobsDone} of ${m.jobsTotal} pictures made.`
        : "";
  }

  function renderWebpSaving(m) {
    const { texture } = flow.choices;
    if (m.webpFailed) {
      ui.webp.disabled = true;
      ui.webpSave.textContent = "not available in this browser";
      return;
    }
    const jpeg = picturesBytes(m, { texture, webp: false });
    const webp = picturesBytes(m, { texture, webp: true });
    ui.webpSave.textContent =
      jpeg === null || webp === null
        ? "(measuring)"
        : `(${webp < jpeg ? "saves " + formatBytes(jpeg - webp) : "no saving"} at this size, for newer browsers)`;
  }

  function roleWords(m) {
    const roles = [...new Set(m.pictures.flatMap((p) => p.roles))];
    if (roles.length === 0) {
      return "";
    }
    return roles.length === 1
      ? roles[0]
      : `${roles.slice(0, -1).join(", ")} and ${roles[roles.length - 1]}`;
  }

  function renderPicturesLead(m) {
    const n = m.pictures.length;
    if (n === 0) {
      ui.picturesLead.textContent =
        "This model wears no pictures this step can make smaller.";
      return;
    }
    const share = Math.round((100 * m.shares.pictures) / m.shares.total);
    ui.picturesLead.textContent =
      `It wears ${n} picture${n > 1 ? "s" : ""} (${roleWords(m)}), ${share} % of the original file. ` +
      `Half the size on each side is about a quarter of the bytes.`;
  }

  function renderShapeText(m) {
    if (!m.prog) {
      return;
    }
    const choices = flow.choices;
    const e = estimate(m, choices);
    const total = e.total ?? m.lastTotal ?? m.shares.total;
    const all = shapeBytes(m, choices, 100);
    const fewest = shapeBytes(m, choices, Number(ui.quality.min));
    ui.qualityOut.textContent = `${choices.quality} %`;
    ui.shapeLead.textContent =
      `The shape is now ${Math.round((100 * e.shape) / total)} % of your file (${formatBytes(e.shape)}). ` +
      `Fewer triangles save less than smaller pictures, but phones draw them faster.`;
    const tris = m.level ? m.level.triangles.toLocaleString("en-US") : "-";
    const dev = m.chain ? deviationWords(m) : "measuring how much it moved...";
    ui.shapeFact.innerHTML = `<b>${tris}</b> of ${m.total.toLocaleString("en-US")} triangles. ${dev}`;
    const atMost = Math.round((100 * (all - fewest)) / total);
    ui.shapeCaution.hidden = false;
    ui.shapeCaution.textContent =
      `Small details such as eyes, fingers or lettering change first. If they do, keep all triangles: ` +
      `this whole step can save at most ${atMost} % of your file.`;
    ui.keepAll.hidden = choices.quality === 100;
    renderPos8(m, total);
  }

  function deviationWords(m) {
    const err = m.chain.levels[0].error;
    if (err === 0) {
      return "The shape is exactly the original.";
    }
    return `The surface moved by up to ${formatLength(err)} (${((100 * err) / m.size).toFixed(2)} % of its size).`;
  }

  function renderPos8(m, total) {
    const c16 = shapeBytes(m, { ...flow.choices, positions8: false });
    const c8 = shapeBytes(m, { ...flow.choices, positions8: true });
    const move = m.maxExtent / 254 / 2;
    ui.pos8Save.textContent = `(saves ${formatBytes(c16 - c8)}, ${Math.round((100 * (c16 - c8)) / total)} %; points move by up to ${formatLength(move)})`;
  }

  // ---- the panel: stepper, advice, steps, review ----
  function stepStatusWords(id) {
    const s = flow.status[id];
    if (s === "done") {
      return "done";
    }
    if (s === "kept") {
      return id === "distance" ? "standard" : "kept as it is";
    }
    return id === "distance" ? "optional" : "";
  }

  function renderStepper() {
    const items = flow.order.map((id, i) => {
      const li = document.createElement("li");
      li.className =
        `mi-chip is-${flow.status[id]}` +
        (flow.current === id ? " is-current" : "");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mi-chip-btn";
      b.dataset.go = id;
      if (flow.current === id) {
        b.setAttribute("aria-current", "step");
      }
      b.innerHTML = `<span class="mi-num">${flow.status[id] === "todo" ? i + 1 : "&#10003;"}</span><span class="mi-chip-text"><b>${STEP_TITLES[id]}</b><small>${stepStatusWords(id)}</small></span>`;
      li.appendChild(b);
      return li;
    });
    const swap = document.createElement("li");
    swap.className = "mi-swap";
    swap.innerHTML = `<button type="button" class="mi-swap-btn" data-act="swap" aria-label="Swap the first two steps" title="Swap the first two steps">&#8646;</button>`;
    items.splice(1, 0, swap);
    ui.stepper.replaceChildren(...items);
  }

  function renderAdvice(m) {
    const onLever = flow.current === "pictures" || flow.current === "shape";
    ui.advice.hidden = !m || !onLever;
    if (ui.advice.hidden) {
      return;
    }
    const rec = recommendFirst(m.shares);
    const pct = Math.round(rec.share * 100);
    const name = rec.first === "pictures" ? "Pictures" : "The shape";
    const other = rec.first === "pictures" ? "the shape" : "the pictures";
    if (flow.order[0] === rec.first) {
      ui.advice.innerHTML = `<b>${name} ${rec.first === "pictures" ? "are" : "is"} ${pct} % of this file: start here.</b> <button type="button" class="mi-link" data-act="swap">Start with ${other} instead</button>`;
    } else {
      ui.advice.innerHTML = `You start with ${other}. <b>${name} ${rec.first === "pictures" ? "are" : "is"} ${pct} % of this file</b>, so ${rec.first === "pictures" ? "they save" : "it saves"} the most. <button type="button" class="mi-link" data-act="swap">Swap back</button>`;
    }
  }

  function nextLabel(id) {
    const at = flow.order.indexOf(id);
    const later = flow.order
      .slice(at + 1)
      .find((s) => flow.status[s] === "todo");
    return later ? `Next: ${STEP_TITLES[later]}` : "See your version";
  }

  function renderReview(m) {
    if (flow.current !== "review") {
      return;
    }
    const e = estimate(m, flow.choices);
    const total = m.shares.total;
    ui.reviewSize.innerHTML =
      e.total === null
        ? "Measuring the pictures..."
        : `<b>${formatBytes(e.total)}</b>, ${Math.round((100 * e.total) / total)} % of the original ${formatBytes(total)}`;
    const c = flow.choices;
    const step = TEXTURE_STEPS.find((s) => s.id === c.texture);
    const rows = [
      [
        "pictures",
        "Pictures",
        `${c.texture === "original" ? "original size" : "at most " + step.label}${c.webp ? ", WebP" : ""}`,
      ],
      [
        "shape",
        "Shape",
        `${c.quality} % of the triangles${c.positions8 ? ", compact points" : ""}`,
      ],
      ["distance", "Far away", `detail drops ${falloffWords(c.falloff)}`],
    ];
    ui.summary.replaceChildren(
      ...rows.map(([id, name, value]) => {
        const li = document.createElement("li");
        li.innerHTML = `<span><b>${name}</b><small>${value}</small></span><button type="button" class="mi-link" data-go="${id}">Change</button>`;
        return li;
      }),
    );
  }

  function renderFlow(prev) {
    for (const el of root.querySelectorAll(".mi-step")) {
      el.hidden = el.dataset.step !== flow.current;
    }
    renderStepper();
    renderAdvice(model);
    ui.nextPictures.textContent = nextLabel("pictures");
    ui.nextShape.textContent = nextLabel("shape");
    ui.quality.value = String(flow.choices.quality);
    ui.webp.checked = flow.choices.webp;
    ui.positions8.checked = flow.choices.positions8;
    ui.falloff.value = String(flow.choices.falloff);
    ui.showOriginal.setAttribute("aria-pressed", String(flow.showOriginal));
    ui.showMine.setAttribute("aria-pressed", String(!flow.showOriginal));
    ui.look.setAttribute("aria-pressed", String(flow.shapeLook));
    ui.inset.hidden = flow.current !== "distance";
    if (!flow.accepted) {
      ui.accepted.hidden = true;
    }
    if (model) {
      renderSizes(model);
      renderShapeText(model);
      renderReview(model);
    }
    if (prev && prev.current !== flow.current) {
      stepChanged(prev.current, flow.current);
    }
  }

  function stepChanged(from, to) {
    const m = model;
    if (!m) {
      return;
    }
    if (to === "distance") {
      m.closePose = {
        position: camera.position.clone(),
        target: controls.target.clone(),
      };
      insetCamera.position.copy(m.closePose.position);
      insetCamera.lookAt(m.closePose.target);
      insetCamera.near = camera.near;
      insetCamera.far = camera.far;
      ui.distance.value = "350";
      applyDistance();
    } else if (from === "distance") {
      restoreClosePose(m);
    }
  }

  function restoreClosePose(m) {
    if (!m.closePose) {
      return;
    }
    camera.position.copy(m.closePose.position);
    controls.target.copy(m.closePose.target);
    camera.near = m.size / 100;
    camera.far = m.size * 100;
    camera.updateProjectionMatrix();
    m.closePose = null;
    if (m.level) {
      m.mineGeometry.setDrawRange(0, m.level.triangles * 3);
    }
  }

  function applyLook() {
    const m = model;
    if (!m) {
      return;
    }
    m.originalMesh.visible = flow.showOriginal;
    m.mineMesh.visible = !flow.showOriginal;
    m.originalMesh.material = flow.shapeLook ? FLAT : m.originalMaterial;
    m.mineMesh.material = flow.shapeLook ? FLAT : m.mineMaterial;
    for (const mesh of [m.originalMesh, m.mineMesh]) {
      mesh.userData.wire.visible = flow.shapeLook;
    }
  }

  function dispatch(action) {
    const prev = flow;
    flow = flowReducer(flow, action);
    if (flow === prev) {
      return;
    }
    runEffects(prev);
    renderFlow(prev);
    updateSize();
  }

  function runEffects(prev) {
    const a = prev.choices;
    const b = flow.choices;
    if (a.quality !== b.quality) {
      applyQuality();
    }
    if (a.positions8 !== b.positions8) {
      applyPositions();
    }
    if (a.texture !== b.texture || a.webp !== b.webp) {
      applyPictures();
    }
    if (a.falloff !== b.falloff && flow.current === "distance") {
      applyDistance();
    }
    if (
      prev.showOriginal !== flow.showOriginal ||
      prev.shapeLook !== flow.shapeLook
    ) {
      applyLook();
    }
  }

  function recordTiming(kind, ms) {
    const list = timings[kind];
    list.push(ms);
    if (list.length > 200) {
      list.shift();
    }
    lastUpdate = { kind, ms };
  }

  // ---- events ----
  function onClick(event) {
    const target = event.target.closest("button");
    if (!target || !root.contains(target)) {
      return;
    }
    if (target.dataset.go) {
      dispatch({ type: "go", step: target.dataset.go });
    } else if (target.dataset.texture) {
      dispatch({ type: "set", name: "texture", value: target.dataset.texture });
    } else if (target.dataset.act) {
      onAct(target.dataset.act);
    }
  }

  function onAct(act) {
    if (act === "accept") {
      accept();
      return;
    }
    if (act === "back") {
      dispatch({
        type: "go",
        step:
          flow.order.find(
            (s) => s !== "distance" && flow.status[s] !== "todo",
          ) ?? flow.order[0],
      });
      options.onBack?.();
      return;
    }
    dispatch({ type: act });
  }

  function accept() {
    const m = model;
    const e = m ? estimate(m, flow.choices) : null;
    if (!m || e.total === null) {
      return;
    }
    dispatch({ type: "accept" });
    const result = resultOf(m, e);
    ui.accepted.hidden = false;
    ui.accepted.textContent = `Ready: ${formatBytes(e.total)} instead of ${formatBytes(m.shares.total)}. The optimizer makes this file next.`;
    options.onAccept?.(result);
  }

  function resultOf(m, e) {
    const c = flow.choices;
    const step = TEXTURE_STEPS.find((s) => s.id === c.texture);
    return {
      model: {
        textureMaxSidePx: Number.isFinite(step.side) ? step.side : 16384,
        ...(c.webp ? { textureType: WEBP } : {}),
        ...(c.quality < 100 ? { detailShare: c.quality / 100 } : {}),
        ...(c.positions8
          ? { positionBits: 8, maxPositionError: SHELF.position8Error }
          : {}),
      },
      lodPixelBudget: pixelBudget(c.falloff),
      estimatedBytes: e.total,
      originalBytes: m.shares.total,
      steps: { order: [...flow.order], status: { ...flow.status } },
    };
  }

  const listeners = [];
  function listen(target, type, fn) {
    target.addEventListener(type, fn);
    listeners.push(() => target.removeEventListener(type, fn));
  }
  listen(root, "click", onClick);
  listen(ui.quality, "input", () =>
    dispatch({ type: "set", name: "quality", value: Number(ui.quality.value) }),
  );
  listen(ui.falloff, "input", () =>
    dispatch({ type: "set", name: "falloff", value: Number(ui.falloff.value) }),
  );
  listen(ui.distance, "input", () => applyDistance());
  listen(ui.webp, "change", () =>
    dispatch({ type: "set", name: "webp", value: ui.webp.checked }),
  );
  listen(ui.positions8, "change", () =>
    dispatch({ type: "set", name: "positions8", value: ui.positions8.checked }),
  );
  listen(ui.showOriginal, "click", () =>
    dispatch({ type: "toggle", name: "showOriginal", on: true }),
  );
  listen(ui.showMine, "click", () =>
    dispatch({ type: "toggle", name: "showOriginal", on: false }),
  );
  listen(ui.look, "click", () =>
    dispatch({ type: "toggle", name: "shapeLook", on: !flow.shapeLook }),
  );
  listen(ui.keepAll, "click", () =>
    dispatch({ type: "set", name: "quality", value: 100 }),
  );
  listen(host.ownerDocument, "keydown", (event) => {
    const typing = event.target.closest?.("input[type=text], textarea");
    if (
      (event.key === "o" || event.key === "O") &&
      !typing &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      dispatch({
        type: "toggle",
        name: "showOriginal",
        on: !flow.showOriginal,
      });
    }
  });

  // ---- frame loop ----
  let lastSize = "";
  function resize() {
    const w = ui.canvas.clientWidth;
    const h = ui.canvas.clientHeight;
    const key = `${w}x${h}`;
    if (key === lastSize || w === 0 || h === 0) {
      return;
    }
    lastSize = key;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function renderInset() {
    const canvasRect = ui.canvas.getBoundingClientRect();
    const r = ui.inset.getBoundingClientRect();
    const x = r.left - canvasRect.left;
    const y = canvasRect.bottom - r.bottom;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, r.width, r.height);
    renderer.setViewport(x, y, r.width, r.height);
    insetCamera.aspect = r.width / r.height;
    insetCamera.updateProjectionMatrix();
    renderer.render(scene, insetCamera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvasRect.width, canvasRect.height);
  }

  function frame() {
    resize();
    controls.update();
    renderer.render(scene, camera);
    if (flow.current === "distance" && model?.closePose && !ui.inset.hidden) {
      renderInset();
    }
    ui.hook.textContent = `${lastUpdate.kind ? `live update ${lastUpdate.ms.toFixed(1)} ms` : "live update -"} · ${host.ownerDocument.getElementsByTagName("*").length} elements`;
  }
  renderer.setAnimationLoop(frame);

  // ---- loading a model ----
  function showBusy(title, f) {
    ui.busy.hidden = false;
    ui.compare.hidden = true;
    ui.busyTitle.textContent = title;
    ui.busyBar.style.width = `${Math.round(100 * f)}%`;
    ui.shapeWorking.textContent = `${title}: ${Math.round(100 * f)} %`;
  }

  function hideBusy() {
    ui.busy.hidden = true;
    ui.compare.hidden = false;
    ui.shapeWorking.textContent = "";
  }

  function showError(m, error) {
    if (m !== model && m !== null) {
      return;
    }
    ui.error.hidden = false;
    ui.error.textContent = `Something went wrong: ${error.message}`;
  }

  function disposeModel(m) {
    if (!m) {
      return;
    }
    scene.remove(m.group);
    for (const g of new Set([
      m.originalMesh.geometry,
      m.mineMesh.geometry,
      m.sourceGeometry,
    ])) {
      g.dispose();
    }
    for (const entry of m.mineTextures) {
      entry.texture.userData.bitmap?.close();
      entry.texture.dispose();
    }
    m.mineMaterial.dispose();
    disposeMaterial(m.originalMaterial);
  }

  function frame0(m) {
    const radius = m.box.getSize(new THREE.Vector3()).length() / 2;
    const center = m.box.getCenter(new THREE.Vector3());
    const away = new THREE.Vector3(1, 0.7, 1.2).normalize();
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(away, radius * 2.6);
    camera.near = m.size / 100;
    camera.far = m.size * 100;
    camera.updateProjectionMatrix();
  }

  function mineTexturesFor(gltf, material, mineMaterial) {
    const entries = [];
    const byTexture = new Map();
    for (const slot of SLOTS) {
      const tex = material[slot];
      if (!tex) {
        continue;
      }
      if (!byTexture.has(tex)) {
        const assoc = gltf.parser.associations.get(tex);
        const json = gltf.parser.json;
        const image = json.textures?.[assoc?.textures]?.source ?? null;
        const clone = tex.clone();
        clone.source = tex.source;
        byTexture.set(tex, clone);
        entries.push({ image, texture: clone, original: tex });
      }
      mineMaterial[slot] = byTexture.get(tex);
    }
    return entries;
  }

  function addWire(mesh) {
    const wire = new THREE.Mesh(mesh.geometry, WIRE);
    wire.visible = false;
    mesh.add(wire);
    mesh.userData.wire = wire;
  }

  function setGeometry(mesh, geometry) {
    mesh.geometry = geometry;
    mesh.userData.wire.geometry = geometry;
  }

  async function parseModel(buffer) {
    const gltf = await new GLTFLoader().parseAsync(buffer.slice(0), "");
    const source = firstMesh(gltf.scene);
    if (!source) {
      throw new Error("the file has no shape to show");
    }
    gltf.scene.updateMatrixWorld(true);
    const geometry = source.geometry.clone();
    geometry.applyMatrix4(source.matrixWorld);
    const material = Array.isArray(source.material)
      ? source.material[0]
      : source.material;
    return { gltf, geometry, material };
  }

  function makeModel(label, glb, parsed) {
    const { gltf, geometry, material } = parsed;
    const pictures = pictureEntries(glb);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox.clone();
    const mineMaterial = material.clone();
    const mineTextures = mineTexturesFor(gltf, material, mineMaterial);
    const originalMesh = new THREE.Mesh(geometry, material);
    const mineMesh = new THREE.Mesh(geometry, mineMaterial);
    addWire(originalMesh);
    addWire(mineMesh);
    const group = new THREE.Group();
    group.add(originalMesh, mineMesh);
    const ext = box.getSize(new THREE.Vector3());
    const uv = geometry.attributes.uv;
    return {
      label,
      glb,
      shares: byteShares(glb),
      pictures,
      maxSide: Math.max(0, ...pictures.map((p) => imageSide(p.bytes, p.mime))),
      cache: new Map(),
      queue: [],
      jobsTotal: 0,
      jobsDone: 0,
      encoding: false,
      pictureToken: 0,
      appliedPictures: "original|false",
      group,
      originalMesh,
      mineMesh,
      sourceGeometry: geometry,
      originalMaterial: material,
      mineMaterial,
      mineTextures,
      box,
      size: ext.length(),
      maxExtent: Math.max(ext.x, ext.y, ext.z),
      sourceTriangles:
        (geometry.index
          ? geometry.index.count
          : geometry.attributes.position.count) / 3,
      sourceVertices: geometry.attributes.position.count,
      attrs: {
        normal: Boolean(geometry.attributes.normal),
        uv: Boolean(uv),
        uvInUnit: uv
          ? flatten(uv).every((v) => v >= -1e-6 && v <= 1 + 1e-6)
          : false,
        tangent: Boolean(geometry.attributes.tangent),
      },
      prog: null,
      level: null,
      chain: null,
      closePose: null,
    };
  }

  function sourceArrays(geometry) {
    const g = geometry;
    return {
      position: flatten(g.attributes.position),
      normal: g.attributes.normal ? flatten(g.attributes.normal) : null,
      uv: g.attributes.uv ? flatten(g.attributes.uv) : null,
      index: g.index
        ? Uint32Array.from(g.index.array.subarray(0, g.index.count))
        : Uint32Array.from(
            { length: g.attributes.position.count },
            (_, i) => i,
          ),
    };
  }

  function shapeBuilt(m, r) {
    const base = new THREE.BufferGeometry();
    base.setAttribute("position", new THREE.BufferAttribute(r.position, 3));
    if (r.normal) {
      base.setAttribute("normal", new THREE.BufferAttribute(r.normal, 3));
    }
    if (r.uv) {
      base.setAttribute("uv", new THREE.BufferAttribute(r.uv, 2));
    }
    const original = base.clone();
    original.setIndex(new THREE.BufferAttribute(r.lod0, 1));
    const mine = base.clone();
    mine.setIndex(
      new THREE.BufferAttribute(new Uint32Array(r.lod0.length * 2), 1),
    );
    base.dispose();
    setGeometry(m.originalMesh, original);
    setGeometry(m.mineMesh, mine);
    Object.assign(m, {
      prog: r.prog,
      positions: r.position,
      mineGeometry: mine,
      total: r.lod0.length / 3,
      vertexCount: r.position.length / 3,
      mark: new Uint8Array(r.position.length / 3),
      buildMs: r.ms,
    });
    ui.quality.min = String(
      Math.max(1, Math.ceil((100 * r.prog.minTriangles) / m.total)),
    );
    ui.qualityMin.textContent = `Fewest (${ui.quality.min} %)`;
    ui.quality.disabled = false;
    applyQuality();
    applyPositions();
    hideBusy();
  }

  async function buildShape(m) {
    const arrays = sourceArrays(m.sourceGeometry);
    const transfer = [arrays.position.buffer, arrays.index.buffer];
    for (const a of [arrays.normal, arrays.uv]) {
      if (a) {
        transfer.push(a.buffer);
      }
    }
    const r = await workers.shape.call(
      { type: "build", ...arrays },
      transfer,
      (f, label) => {
        if (m === model) {
          showBusy(`${label}`, f);
        }
      },
    );
    if (m === model) {
      shapeBuilt(m, r);
    }
  }

  /**
   * Loads a model (a .glb Blob), replacing the one shown.
   * @param {Blob} blob
   * @param {string} [label]
   */
  async function load(blob, label = "Your model") {
    if (destroyed) {
      throw new Error("this import view was closed");
    }
    const id = ++loadId;
    ui.error.hidden = true;
    showBusy("Opening the model", 0.01);
    workers?.shape.stop();
    workers?.pictures.stop();
    workers = { shape: workerClient(), pictures: workerClient() };
    try {
      const buffer = await blob.arrayBuffer();
      const glb = readGlb(buffer);
      const parsed = await parseModel(buffer);
      if (id !== loadId) {
        return;
      }
      disposeModel(model);
      const m = makeModel(label, glb, parsed);
      model = m;
      scene.add(m.group);
      frame0(m);
      flow = initialFlow(recommendFirst(m.shares).first);
      ui.modelName.textContent = label;
      ui.quality.disabled = true;
      timings.quality.length = 0;
      timings.distance.length = 0;
      lastUpdate = { kind: "", ms: 0 };
      applyLook();
      renderPicturesLead(m);
      renderFlow(null);
      updateSize();
      queueAllPictures(m);
      pumpPictures(m);
      await buildShape(m);
    } catch (error) {
      if (id === loadId) {
        hideBusy();
        showError(null, error);
      }
    }
  }

  function destroy() {
    destroyed = true;
    renderer.setAnimationLoop(null);
    listeners.forEach((off) => off());
    workers?.shape.stop();
    workers?.pictures.stop();
    disposeModel(model);
    model = null;
    controls.dispose();
    renderer.dispose();
    host.replaceChildren();
  }

  renderFlow(null);

  return {
    load,
    destroy,
    /** The flow state (order, current step, status, choices). */
    getState: () => flow,
    /** The settings and the estimate, as onAccept would get them. */
    getResult: () =>
      model ? resultOf(model, estimate(model, flow.choices)) : null,
    /** Opens a step: "pictures", "shape", "distance" or "review". */
    goTo: (step) => dispatch({ type: "go", step }),
    /** Sets one choice (quality, texture, webp, positions8, falloff). */
    set: (name, value) => dispatch({ type: "set", name, value }),
    /** Measuring hook: live update times (ms) and the element count. */
    stats: () => ({
      quality: {
        last: timings.quality.at(-1) ?? null,
        median: median(timings.quality),
        max: Math.max(0, ...timings.quality),
        samples: timings.quality.length,
      },
      distance: {
        last: timings.distance.at(-1) ?? null,
        median: median(timings.distance),
        max: Math.max(0, ...timings.distance),
        samples: timings.distance.length,
      },
      elements: host.ownerDocument.getElementsByTagName("*").length,
      buildMs: model?.buildMs ?? null,
      ready: Boolean(model?.prog),
      picturesMeasured: model
        ? model.jobsTotal > 0 && model.jobsDone >= model.jobsTotal
        : false,
    }),
  };
}
