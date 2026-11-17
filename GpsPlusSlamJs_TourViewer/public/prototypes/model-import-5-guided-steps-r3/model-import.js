// Guided model import ("two guided steps", round 3): the panel a tour
// creator meets after dropping a .glb on the editor's asset shelf. Step 1
// takes the bigger lever (pictures or shape, by bytes), step 2 the other,
// step 3 (optional) how soon detail drops with distance. Any step can be
// opened or swapped; Original / Yours is one tap away and never moves the
// camera. Each picture size is made only when chosen, a quality slider
// under the sizes fine-tunes the chosen size, and the shape step shows
// the frame rate and a load test of many copies.
//
// mountModelImport(host, options) -> controller; see README.md.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { stepsFor, levelIndices } from "../model-lod-1/lod-simplify.js";
import {
  COMPACT_RULE,
  LEVEL_RULE,
  PICTURE_QUALITY,
  SHELF,
  WEBP,
  byteShares,
  compactPositions,
  formatBytes,
  formatLength,
  geometryBytes,
  imageSide,
  levelAt,
  levelTargets,
  overheadBytes,
  pictureEntries,
  pixelBudget,
  qualityBytes,
  qualityValues,
  readGlb,
  recommendFirst,
  screenPixels,
  switchDistance,
  textureFormat,
  textureStep,
  textureSteps,
} from "./size-model.js";
import { LOAD_COUNTS, flowReducer, initialFlow } from "./import-flow.js";

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
      <div class="mi-quality" data-ref="qualityBlock">
        <div class="mi-slider-head"><label for="mi-picture-quality">Picture quality</label><output for="mi-picture-quality" data-ref="pictureQualityOut"></output></div>
        <input class="mi-range" id="mi-picture-quality" type="range" data-ref="pictureQuality" />
        <div class="mi-ends"><span>Smaller, rougher</span><span>Sharper, larger</span></div>
        <p class="mi-quality-note" data-ref="pictureQualityNote"></p>
      </div>
      <label class="mi-switch"><input type="checkbox" data-ref="webp" /><span>WebP pictures <small data-ref="webpSave"></small></span></label>
      <p class="mi-tip">Zoom in where it matters, then tap <b>Original</b> to compare. The camera stays where it is.</p>
      <p class="mi-working" data-ref="picturesWorking" role="status"></p>
      <div class="mi-actions"><button type="button" class="mi-primary" data-act="next" data-ref="nextPictures"></button></div>
    </div>

    <div class="mi-step" data-step="shape" hidden>
      <h3>Shape</h3>
      <p class="mi-lead">Fewer triangles save less than smaller pictures, but phones draw them faster. The load test below shows how much faster.</p>
      <div class="mi-slider-head"><label for="mi-quality">Triangles kept</label><output data-ref="qualityOut">100 %</output></div>
      <input class="mi-range" id="mi-quality" type="range" min="1" max="100" value="100" data-ref="quality" disabled />
      <div class="mi-ends"><span data-ref="qualityMin">Fewest</span><span>All</span></div>
      <p class="mi-fact" data-ref="shapeFact"></p>
      <div class="mi-load">
        <div class="mi-load-head"><span>Frame rate</span><output data-ref="fps">-</output></div>
        <div class="mi-load-row">
          <label class="mi-switch"><input type="checkbox" data-ref="loadTest" disabled /><span>Load test</span></label>
          <select data-ref="loadCount" aria-label="Copies the load test draws"></select>
        </div>
        <p class="mi-load-fact" data-ref="loadFact"></p>
      </div>
      <p class="mi-caution" data-ref="shapeCaution" hidden></p>
      <label class="mi-switch"><input type="checkbox" data-ref="positions8" /><span>Store the points more compactly <small data-ref="pos8Save"></small></span></label>
      <p class="mi-working" data-ref="shapeWorking"></p>
      <div class="mi-actions"><button type="button" class="mi-primary" data-act="next" data-ref="nextShape"></button></div>
    </div>

    <div class="mi-step" data-step="distance" hidden>
      <h3>Far away <span class="mi-optional">optional</span></h3>
      <p class="mi-lead">Visitors often see a model from a distance, where fewer triangles look the same. Choose how soon its detail may drop. This costs nothing in file size; it saves phones work when many models are in view.</p>
      <div class="mi-slider-head"><label for="mi-distance">Walk away from it</label><output data-ref="distanceOut"></output></div>
      <input class="mi-range" id="mi-distance" type="range" min="0" max="1000" value="0" data-ref="distance" />
      <div class="mi-slider-head"><label for="mi-falloff">Detail drops</label><output data-ref="falloffOut"></output></div>
      <input class="mi-range" id="mi-falloff" type="range" min="1" max="100" value="50" data-ref="falloff" />
      <div class="mi-ends"><span>Sooner, lighter</span><span>Later, sharper</span></div>
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
  const failAll = (message, cancelled = false) => {
    for (const p of pending.values()) {
      const error = new Error(message);
      // A job cut short because its model is being replaced is not a
      // failure the author needs to hear about.
      error.cancelled = cancelled;
      p.reject(error);
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
      failAll("stopped", true);
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
      const r = m.cache.get(
        pictureKey(p, choices.texture, choices.webp, choices.pictureQuality),
      );
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
      // Halving levels add up to at most twice the author's level.
      return {
        triangles: 2 * t,
        vertices: Math.round((m.sourceVertices * quality) / 100),
      };
    }
    const top = Math.round((m.total * quality) / 100);
    let triangles = 0;
    if (m.chain?.top === top) {
      // The measured levels, as they would be saved.
      for (const level of m.chain.levels) {
        triangles += level.count / 3;
      }
    } else {
      // Until they are measured: every halving candidate, at most
      // LEVEL_RULE.maxLevels of them (an upper bound).
      let prev = Infinity;
      let n = 0;
      for (const target of levelTargets(top, m.prog.minTriangles)) {
        const alive = m.prog.stepAlive[stepsFor(m.prog, target)];
        if (alive < prev && n < LEVEL_RULE.maxLevels) {
          triangles += alive;
          prev = alive;
          n++;
        }
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
  /** `quality` in percent. A PNG picture has no quality, so its key is
   *  the same at every slider position and it is made once per size. */
  function pictureKey(p, stepId, webp, quality) {
    const fmt = formatOf(p, webp, quality);
    return `${p.index}|${stepId}|${fmt.type}|${Math.round(fmt.quality * 100)}`;
  }

  function formatOf(p, webp, quality) {
    return textureFormat(p.use, p.mime, webp, quality / 100);
  }

  function visibleSteps(m) {
    return textureSteps(m.maxSide);
  }

  /** What one picture size would weigh, for its button: measured when it
   *  was made, else "making" while it is being made, else a guess scaled
   *  from the nearest measured size of the same picture. Sizes are made
   *  only when the author chooses them. */
  function picturesGuess(m, stepId, webp, quality) {
    const side = textureStep(stepId).side;
    let sum = 0;
    let exact = true;
    let making =
      m.picturesPending &&
      stepId === flow.choices.texture &&
      webp === flow.choices.webp;
    for (const p of m.pictures) {
      const key = pictureKey(p, stepId, webp, quality);
      const r = m.cache.get(key);
      if (r && !r.failed) {
        sum += r.size;
        continue;
      }
      exact = false;
      making ||= m.inflight === key || m.queue.some((q) => q.key === key);
      sum += guessPicture(m, p, side, webp, quality);
    }
    return { bytes: sum, exact, making };
  }

  /** Bytes grow with the side to this power: measured on the rock's and
   *  the bust's JPEG and WebP pictures, each halving keeps 0.29 to 0.49 of
   *  the bytes (mostly about a third), not the quarter the pixel count
   *  suggests. Only the buttons' "about" figures use it. */
  const BYTES_EXPONENT = 1.5;

  /** Scaled from the nearest measured version of the same picture in
   *  the same format: nearest in size and in quality (qualityBytes, the
   *  measured bytes against quality). */
  function guessPicture(m, p, side, webp, quality) {
    const own = p.side || 1;
    const sideOf = (s) => Math.min(s, own);
    const want = sideOf(side);
    const factor = (q) => qualityBytes(formatOf(p, webp, q).type, q);
    let best = null;
    for (const s of visibleSteps(m)) {
      for (const q of qualityValues()) {
        const r = m.cache.get(pictureKey(p, s.id, webp, q));
        if (!r || r.failed) {
          continue;
        }
        const at = sideOf(s.side);
        const gap =
          Math.abs(Math.log(at / want)) +
          Math.abs(Math.log(factor(q) / factor(quality)));
        if (best === null || gap < best.gap) {
          best = { size: r.size, at, q, gap };
        }
      }
    }
    // Nothing of this picture measured in this format yet: its own bytes,
    // taken as if they were written at the shelf's 85 %.
    const ref = best ?? { size: p.bytes.length, at: own, q: 85 };
    return (
      ref.size *
      (want / ref.at) ** BYTES_EXPONENT *
      (factor(quality) / factor(ref.q))
    );
  }

  function queueChoice(m, stepId, webp, quality, front) {
    const jobs = m.pictures.map((p) => ({
      p,
      stepId,
      webp,
      quality,
      key: pictureKey(p, stepId, webp, quality),
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

  async function runPictureJob(m, job) {
    const step = textureStep(job.stepId);
    const format = formatOf(job.p, job.webp, job.quality);
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
      if (m !== model || error.cancelled) {
        return;
      }
      m.cache.set(job.key, { failed: true, message: error.message });
      if (job.webp && !m.webpFailed) {
        // WebP starts on; a browser that cannot write it falls back.
        m.webpFailed = error.message;
        dispatch({ type: "set", name: "webp", value: false });
      } else if (!job.webp) {
        showError(m, error);
      }
    }
  }

  async function pumpPictures(m) {
    if (m.encoding) {
      return;
    }
    m.encoding = true;
    while (m === model && !m.leaving && m.queue.length > 0) {
      const job = m.queue.shift();
      if (m.cache.has(job.key)) {
        continue;
      }
      m.inflight = job.key;
      await runPictureJob(m, job);
      m.inflight = null;
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
      m.cache.has(
        pictureKey(p, choices.texture, choices.webp, choices.pictureQuality),
      ),
    );
    if (ready && m.appliedPictures !== appliedKey(choices)) {
      applyPictures();
    }
  }

  const appliedKey = (c) => `${c.texture}|${c.webp}|${c.pictureQuality}`;

  /** The quality slider waits this long after its last move before the
   *  pictures are made again: a drag passes many values, and each would
   *  otherwise queue a full set of encodes. */
  const QUALITY_SETTLE_MS = 250;
  let pictureTimer = 0;

  /** The quality moved: the chosen size shows "making..." at once, the
   *  encode starts once the slider rests. */
  function schedulePictures() {
    const m = model;
    if (!m) {
      return;
    }
    clearTimeout(pictureTimer);
    m.picturesPending = true;
    renderSizes(m);
    updateSize();
    pictureTimer = setTimeout(() => {
      if (m === model) {
        applyPictures();
      }
    }, QUALITY_SETTLE_MS);
  }

  async function applyPictures() {
    const m = model;
    if (!m) {
      return;
    }
    clearTimeout(pictureTimer);
    m.picturesPending = false;
    const { texture, webp, pictureQuality: quality } = flow.choices;
    // Encodes queued for a quality the author has left are not made.
    const before = m.queue.length;
    m.queue = m.queue.filter((j) => j.quality === quality);
    m.jobsTotal -= before - m.queue.length;
    if (!m.webpFailed) {
      // The same size in the other format, after the chosen one: what the
      // WebP switch saves at this size.
      queueChoice(m, texture, !webp, quality, false);
    }
    const results = m.pictures.map((p) =>
      m.cache.get(pictureKey(p, texture, webp, quality)),
    );
    if (results.some((r) => !r)) {
      queueChoice(m, texture, webp, quality, true);
      pumpPictures(m);
      renderSizes(m);
      return;
    }
    pumpPictures(m);
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
    const old = new Set();
    m.pictures.forEach((p, i) => {
      for (const b of setMineImage(m, p.index, bitmaps[i])) {
        old.add(b);
      }
    });
    old.forEach((b) => b.close());
    m.appliedPictures = appliedKey({ texture, webp, pictureQuality: quality });
    renderSizes(m);
  }

  /** Gives every texture of image `index` in "yours" a fresh texture drawn
   *  from `bitmap` (null: the original's own picture), and disposes the one
   *  it replaces. Returns the bitmaps no texture uses any more.
   *
   *  A texture is never given a new `source` after it was drawn: three.js
   *  keeps its GPU texture per source, so a swapped source makes it upload
   *  the new picture into the old source's GPU texture (the original's, as
   *  "yours" starts out sharing it), whose storage is fixed at the old size.
   *  A smaller picture then fills only a corner of it (pictures in the wrong
   *  place, every smaller size looking alike, the original changing too),
   *  and disposing the texture later fails on the lost entry ("reading
   *  'usedTimes'"). */
  function setMineImage(m, index, bitmap) {
    const replaced = [];
    for (const entry of m.mineTextures) {
      if (entry.image !== index) {
        continue;
      }
      const next = entry.original.clone();
      if (bitmap) {
        next.source = new THREE.Source(bitmap);
      }
      next.needsUpdate = true;
      for (const slot of entry.slots) {
        m.mineMaterial[slot] = next;
      }
      entry.texture.dispose();
      if (entry.bitmap) {
        replaced.push(entry.bitmap);
      }
      entry.texture = next;
      entry.bitmap = bitmap;
    }
    return replaced;
  }

  // ---- shape: the live level, the 8-bit points, the distance chain ----
  function writeIndex(geometry, array) {
    if (array.length > geometry.index.array.length) {
      // More levels than the buffer was made for: a larger one.
      geometry.setIndex(
        new THREE.BufferAttribute(new Uint32Array(array.length), 1),
      );
    }
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
    if (
      m !== model ||
      m.leaving ||
      !m.level ||
      m.chainPending === m.level.top
    ) {
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
      updateSize();
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
    attr.array.set(
      flow.choices.positions8 ? m.compactShape.positions : m.positions,
    );
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
      seg.className = "mi-strip-seg" + (i === pick ? " is-on" : "");
      // Darkest for all triangles, lighter with every coarser level.
      const ink = Math.round(100 - (70 * i) / Math.max(1, levels.length - 1));
      seg.style.background = `color-mix(in srgb, var(--mi-shape) ${ink}%, #ffffff)`;
      seg.style.color = ink > 60 ? "#ffffff" : "var(--mi-ink)";
      seg.style.left = from + "%";
      seg.style.width = Math.max(0, to - from) + "%";
      seg.textContent = to - from >= 6 ? String(i + 1) : "";
      seg.title = `Level ${i + 1}: ${(l.count / 3).toLocaleString("en-US")} triangles, off by up to ${formatLength(l.error)}${i === 0 ? "" : `, from ${formatLength(starts[i])}`}`;
      return seg;
    });
    const marker = document.createElement("span");
    marker.className = "mi-strip-marker";
    marker.style.left = pos(d) + "%";
    ui.strip.replaceChildren(...parts, marker);
    const level = levels[pick];
    const tris = (level.count / 3).toLocaleString("en-US");
    const all = (levels[0].count / 3).toLocaleString("en-US");
    const off =
      pick === 0
        ? ""
        : `, its surface off by up to ${formatLength(level.error)}`;
    const next =
      pick + 1 < levels.length
        ? ` The next takes over from ${formatLength(starts[pick + 1])}.`
        : " This is the coarsest.";
    ui.distanceFact.innerHTML =
      `${levels.length} levels. A visitor here sees <b>level ${pick + 1}</b>: ` +
      `${tris} of ${all} triangles${off}.${next}`;
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
    const { texture, webp, pictureQuality: quality } = flow.choices;
    const buttons = visibleSteps(m).map((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(s.id === texture));
      b.dataset.texture = s.id;
      const g = picturesGuess(m, s.id, webp, quality);
      let size = `about ${formatBytes(g.bytes)}`;
      if (g.exact) {
        size = formatBytes(g.bytes);
      } else if (g.making) {
        size = "making...";
      }
      let tag = "";
      if (s.id === "original" && m.maxSide > 0) {
        tag = `<em class="mi-tag">${m.maxSide} px</em>`;
      } else if (s.side === SHELF.defaultSide) {
        tag = '<em class="mi-tag">suggested</em>';
      }
      b.innerHTML = `<b>${s.label}</b><small>${size}</small>${tag}`;
      return b;
    });
    ui.sizes.replaceChildren(...buttons);
    renderWebpSaving(m);
    renderPictureQuality(m);
    const made = m.pictures.filter((p) =>
      m.cache.has(pictureKey(p, texture, webp, quality)),
    ).length;
    ui.picturesWorking.textContent =
      made < m.pictures.length && !m.picturesPending
        ? `Making the ${textureStep(texture).label.toLowerCase()} pictures at ${quality} %: ${made} of ${m.pictures.length} done...`
        : "";
  }

  /** The quality slider's line: its value and the pictures' measured
   *  bytes, or "making..." from the first move until the last encode of
   *  that quality is back. */
  function renderPictureQuality(m) {
    const c = flow.choices;
    const lossy = m.pictures.filter(
      (p) => formatOf(p, c.webp, c.pictureQuality).type !== "image/png",
    );
    const bytes = picturesBytes(m, c);
    const working = lossy.length > 0 && (bytes === null || m.picturesPending);
    ui.qualityBlock.classList.toggle("is-working", working);
    ui.qualityBlock.setAttribute("aria-busy", String(working));
    ui.pictureQuality.disabled = lossy.length === 0;
    if (lossy.length === 0) {
      ui.pictureQualityOut.textContent = "-";
      ui.pictureQualityNote.textContent =
        "This model's pictures are kept without loss (PNG), so there is no quality to choose.";
      return;
    }
    ui.pictureQualityOut.textContent = `${c.pictureQuality} % · ${working ? "making..." : formatBytes(bytes)}`;
    const format = c.webp ? "WebP" : "JPEG";
    const kept = m.pictures.length - lossy.length;
    const png =
      kept > 0
        ? ` ${kept} picture${kept > 1 ? "s" : ""} with see-through parts ${kept > 1 ? "stay" : "stays"} PNG.`
        : "";
    ui.pictureQualityNote.textContent =
      `Choose the size first, then lower the quality until a close-up looks worse than the original. ` +
      `${format} at ${c.pictureQuality} %; "about" sizes assume ${c.pictureQuality} % too.${png}`;
  }

  function renderWebpSaving(m) {
    const { texture, pictureQuality } = flow.choices;
    if (m.webpFailed) {
      ui.webp.disabled = true;
      ui.webpSave.textContent = "not available in this browser";
      return;
    }
    const jpeg = picturesBytes(m, { texture, webp: false, pictureQuality });
    const webp = picturesBytes(m, { texture, webp: true, pictureQuality });
    ui.webpSave.textContent =
      jpeg === null || webp === null
        ? "(measuring)"
        : `(${webp < jpeg ? "saves " + formatBytes(jpeg - webp) : "no saving"} at this size and quality)`;
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
      `Each step down keeps about a third of the bytes; a size is made when you choose it.`;
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
    const tris = m.level ? m.level.triangles.toLocaleString("en-US") : "-";
    const dev = m.chain ? deviationWords(m) : "measuring how much it moved...";
    ui.shapeFact.innerHTML = `<b>${tris}</b> of ${m.total.toLocaleString("en-US")} triangles. ${dev}`;
    const atMost = Math.round((100 * (all - fewest)) / total);
    ui.shapeCaution.hidden = false;
    ui.shapeCaution.textContent =
      `Small details such as eyes, fingers or lettering change first. If they do, keep all triangles: ` +
      `this whole step can save at most ${atMost} % of your file.`;
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
    const px = compactPixels(m);
    const near = `${COMPACT_RULE.closestM} m`;
    const verdict = m.compactOk
      ? `under ${COMPACT_RULE.visiblePx} pixel on a phone from ${near}, so it is on to start with`
      : `${px.toFixed(1)} pixels on a phone from ${near}, where a visitor may stand, so it is off to start with`;
    ui.pos8Save.textContent = `(saves ${formatBytes(c16 - c8)}, ${Math.round((100 * (c16 - c8)) / total)} %; points move by up to ${formatLength(m.compactError)}: ${verdict})`;
  }

  /** The compact points' measured error as pixels at the closest view. */
  function compactPixels(m) {
    return screenPixels(m.compactError, COMPACT_RULE.closestM, FOV);
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
    const verb = rec.first === "pictures" ? "are" : "is";
    // A quiet note on why the steps come in this order, not a call to act:
    // the order is already chosen for the author.
    if (flow.order[0] === rec.first) {
      ui.advice.innerHTML = `${name} ${verb} ${pct} % of this file, the larger part, so the steps start there. <button type="button" class="mi-link" data-act="swap">Start with ${other} instead</button>`;
    } else {
      ui.advice.innerHTML = `The steps start with ${other}. ${name} ${verb} ${pct} % of this file, the larger part. <button type="button" class="mi-link" data-act="swap">Swap back</button>`;
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
    const step = textureStep(c.texture);
    const rows = [
      [
        "pictures",
        "Pictures",
        `${c.texture === "original" ? "original size" : "at most " + step.label}, ${c.webp ? "WebP" : "JPEG"} at ${c.pictureQuality} % quality`,
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
    ui.pictureQuality.value = String(flow.choices.pictureQuality);
    ui.positions8.checked = flow.choices.positions8;
    ui.falloff.value = String(falloffSlider(flow.choices.falloff));
    ui.loadTest.checked = flow.loadTest;
    ui.loadCount.value = String(flow.loadCount);
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
    } else if (a.pictureQuality !== b.pictureQuality) {
      schedulePictures();
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
    if (
      prev.loadTest !== flow.loadTest ||
      prev.loadCount !== flow.loadCount
    ) {
      syncLoadTest();
    }
  }

  // ---- the load test: many copies of the shown version ----
  /** Grid offsets around the model, nearest first, the model's own cell
   *  left free: a busy scene in view of the unmoved camera. */
  function crowdOffsets(m, count) {
    const step = m.maxExtent * 1.5;
    const half = Math.ceil(Math.sqrt(count + 1) / 2) + 1;
    const cells = [];
    for (let i = -half; i <= half; i++) {
      for (let j = -half; j <= half; j++) {
        if (i !== 0 || j !== 0) {
          cells.push([i * step, j * step]);
        }
      }
    }
    cells.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
    return cells.slice(0, count);
  }

  function dropCrowd(m) {
    if (m?.crowd) {
      m.group.remove(m.crowd);
      m.crowd.dispose();
      m.crowd = null;
    }
  }

  function syncLoadTest() {
    const m = model;
    if (!m) {
      return;
    }
    const want = m.prog && flow.loadTest ? flow.loadCount : 0;
    if (m.crowd && m.crowd.count !== want) {
      dropCrowd(m);
    }
    if (want > 0 && !m.crowd) {
      const crowd = new THREE.InstancedMesh(
        m.mineMesh.geometry,
        m.mineMesh.material,
        want,
      );
      const at = new THREE.Matrix4();
      crowdOffsets(m, want).forEach(([x, z], i) => {
        crowd.setMatrixAt(i, at.makeTranslation(x, 0, z));
      });
      crowd.instanceMatrix.needsUpdate = true;
      // The copies spread far past the model; culling them as one block
      // by the model's own bounds would hide them all.
      crowd.frustumCulled = false;
      m.group.add(crowd);
      m.crowd = crowd;
    }
    fps.reset();
  }

  /** The copies follow Original / Yours and the triangle look, so the two
   *  versions can be compared under the same load. */
  function followCrowd(m) {
    const src = flow.showOriginal ? m.originalMesh : m.mineMesh;
    m.crowd.geometry = src.geometry;
    m.crowd.material = src.material;
  }

  function crowdTriangles(m) {
    if (!m.crowd) {
      return 0;
    }
    const each = flow.showOriginal ? m.total : (m.level?.triangles ?? 0);
    return each * (m.crowd.count + 1);
  }

  // ---- the frame rate: frames counted over half a second ----
  const fps = {
    frames: 0,
    since: 0,
    worst: 0,
    last: null,
    lastWorst: null,
    history: [],
    reset() {
      this.frames = 0;
      this.since = 0;
      this.worst = 0;
      this.last = null;
      this.lastWorst = null;
      this.history.length = 0;
    },
    tick(now, previous) {
      if (this.since === 0) {
        this.since = now;
        return false;
      }
      this.frames++;
      this.worst = Math.max(this.worst, now - previous);
      if (now - this.since < 500) {
        return false;
      }
      this.last = (1000 * this.frames) / (now - this.since);
      this.lastWorst = this.worst;
      this.history.push(this.last);
      if (this.history.length > 120) {
        this.history.shift();
      }
      this.frames = 0;
      this.worst = 0;
      this.since = now;
      return true;
    },
  };

  function renderFps() {
    const m = model;
    ui.fps.textContent =
      fps.last === null
        ? "-"
        : `${Math.round(fps.last)} frames a second (slowest ${Math.round(fps.lastWorst)} ms)`;
    if (!m?.crowd) {
      ui.loadFact.textContent =
        "Draws many copies of the version shown, as in a busy scene, to see whether this many triangles still draw smoothly. Smooth is about 60 frames a second.";
      return;
    }
    const tris = (crowdTriangles(m) / 1e6).toFixed(1);
    ui.loadFact.textContent = `${m.crowd.count.toLocaleString("en-US")} copies of ${flow.showOriginal ? "the original" : "your version"}, ${tris} million triangles in all. Smooth is about 60 frames a second; turn it off when done.`;
  }

  /** The slider shows the falloff mirrored: to the right, detail drops
   *  later, so the strip below it moves the same way as the thumb. */
  function falloffSlider(falloff) {
    return 101 - falloff;
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
    const step = textureStep(c.texture);
    return {
      model: {
        textureMaxSidePx: Number.isFinite(step.side) ? step.side : 16384,
        ...(c.webp ? { textureType: WEBP } : {}),
        textureQuality: c.pictureQuality / 100,
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
    dispatch({
      type: "set",
      name: "falloff",
      value: falloffSlider(Number(ui.falloff.value)),
    }),
  );
  ui.loadCount.replaceChildren(
    ...LOAD_COUNTS.map((n) => {
      const option = document.createElement("option");
      option.value = String(n);
      option.textContent = `${n.toLocaleString("en-US")} copies`;
      return option;
    }),
  );
  // A load test past what the graphics chip can take may make the browser
  // drop the 3D view. Say so plainly and switch the test off.
  listen(ui.canvas, "webglcontextlost", () => {
    dispatch({ type: "toggle", name: "loadTest", on: false });
    ui.error.hidden = false;
    ui.error.textContent =
      "The 3D view stopped, most likely under the load test. Reload the page to go on, and try fewer copies.";
  });
  listen(ui.loadTest, "change", () =>
    dispatch({ type: "toggle", name: "loadTest", on: ui.loadTest.checked }),
  );
  listen(ui.loadCount, "change", () =>
    dispatch({ type: "loadCount", count: Number(ui.loadCount.value) }),
  );
  listen(ui.distance, "input", () => applyDistance());
  ui.pictureQuality.min = String(PICTURE_QUALITY.min);
  ui.pictureQuality.max = String(PICTURE_QUALITY.max);
  ui.pictureQuality.step = String(PICTURE_QUALITY.step);
  listen(ui.pictureQuality, "input", () =>
    dispatch({
      type: "set",
      name: "pictureQuality",
      value: Number(ui.pictureQuality.value),
    }),
  );
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

  let previousFrame = 0;
  function frame(now) {
    resize();
    controls.update();
    if (model?.crowd) {
      followCrowd(model);
    }
    renderer.render(scene, camera);
    if (flow.current === "distance" && model?.closePose && !ui.inset.hidden) {
      renderInset();
    }
    if (fps.tick(now, previousFrame)) {
      renderFps();
    }
    previousFrame = now;
    ui.hook.textContent = `${lastUpdate.kind ? `live update ${lastUpdate.ms.toFixed(1)} ms` : "live update -"} · ${fps.last === null ? "-" : Math.round(fps.last)} fps · ${host.ownerDocument.getElementsByTagName("*").length} elements`;
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
    if ((m !== model && m !== null) || error?.cancelled) {
      return;
    }
    ui.error.hidden = false;
    ui.error.textContent = `Something went wrong: ${error.message}`;
  }

  function disposeModel(m) {
    if (!m) {
      return;
    }
    dropCrowd(m);
    scene.remove(m.group);
    for (const g of new Set([
      m.originalMesh.geometry,
      m.mineMesh.geometry,
      m.sourceGeometry,
    ])) {
      g.dispose();
    }
    for (const entry of m.mineTextures) {
      entry.texture.dispose();
      entry.bitmap?.close();
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
        // A clone shares the original's source (and so its GPU texture)
        // until a smaller picture replaces it with a texture of its own.
        const entry = {
          image,
          texture: tex.clone(),
          original: tex,
          bitmap: null,
          slots: [],
        };
        byTexture.set(tex, entry);
        entries.push(entry);
      }
      const entry = byTexture.get(tex);
      entry.slots.push(slot);
      mineMaterial[slot] = entry.texture;
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
    const pictures = pictureEntries(glb).map((p) => ({
      ...p,
      side: imageSide(p.bytes, p.mime),
    }));
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
    const maxExtent = Math.max(ext.x, ext.y, ext.z);
    const center = box.getCenter(new THREE.Vector3()).toArray();
    const compactError = compactPositions(
      flatten(geometry.attributes.position),
      center,
      maxExtent,
    ).maxError;
    return {
      label,
      glb,
      shares: byteShares(glb),
      pictures,
      maxSide: Math.max(0, ...pictures.map((p) => p.side)),
      cache: new Map(),
      queue: [],
      inflight: null,
      crowd: null,
      jobsTotal: 0,
      jobsDone: 0,
      encoding: false,
      picturesPending: false,
      pictureToken: 0,
      appliedPictures: "original|false|-",
      group,
      originalMesh,
      mineMesh,
      sourceGeometry: geometry,
      originalMaterial: material,
      mineMaterial,
      mineTextures,
      box,
      size: ext.length(),
      maxExtent,
      center,
      compactError,
      compactOk:
        screenPixels(compactError, COMPACT_RULE.closestM, FOV) <
        COMPACT_RULE.visiblePx,
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
    // Halving levels add up to under twice the author's level; writeIndex
    // grows the buffer if rounding ever needs more.
    mine.setIndex(
      new THREE.BufferAttribute(new Uint32Array(r.lod0.length * 2), 1),
    );
    base.dispose();
    setGeometry(m.originalMesh, original);
    setGeometry(m.mineMesh, mine);
    Object.assign(m, {
      prog: r.prog,
      positions: r.position,
      compactShape: compactPositions(r.position, m.center, m.maxExtent),
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
    ui.loadTest.disabled = false;
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
    // The outgoing model stays on screen until the new one is parsed, but
    // its helper threads stop here: nothing it asks for from now on may
    // reach the new model's threads, which do not hold its shape.
    if (model) {
      model.leaving = true;
    }
    clearTimeout(chainTimer);
    clearTimeout(pictureTimer);
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
      flow = initialFlow(recommendFirst(m.shares).first, {
        positions8: m.compactOk,
      });
      ui.modelName.textContent = label;
      ui.quality.disabled = true;
      ui.loadTest.disabled = true;
      fps.reset();
      timings.quality.length = 0;
      timings.distance.length = 0;
      lastUpdate = { kind: "", ms: 0 };
      applyLook();
      renderPicturesLead(m);
      renderFlow(null);
      updateSize();
      // Only the chosen size is made (and the other format at that size,
      // for the WebP saving); every other size waits until it is chosen.
      applyPictures();
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
    clearTimeout(pictureTimer);
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
    /** Sets one choice (quality, texture, webp, pictureQuality,
     *  positions8, falloff). */
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
      /** The picture choice the 3D view shows ("1024|true|80": size,
       *  WebP, quality in percent). */
      picturesShown: model?.appliedPictures ?? null,
      /** Frames a second over the last half second, its slowest frame
       *  (ms), and the median of the recent half-second readings. */
      fps: {
        last: fps.last,
        slowestMs: fps.lastWorst,
        median: median(fps.history),
        samples: fps.history.length,
      },
      /** The load test: copies drawn and triangles drawn in all. */
      loadTest: {
        on: Boolean(model?.crowd),
        copies: model?.crowd?.count ?? 0,
        triangles: model ? crowdTriangles(model) : 0,
      },
    }),
    /** Turns the load test on or off (it works in the shape step only). */
    loadTest(on, count = flow.loadCount) {
      dispatch({ type: "loadCount", count });
      dispatch({ type: "toggle", name: "loadTest", on });
    },
    /** Measuring hook: puts the camera at `position` looking at `target`
     *  (arrays of three numbers, in the model's units). */
    view(position, target) {
      controls.target.fromArray(target);
      camera.position.fromArray(position);
      camera.updateProjectionMatrix();
    },
    /** Measuring hook: the model's bounding box as [min, max]. */
    bounds: () =>
      model ? [model.box.min.toArray(), model.box.max.toArray()] : null,
  };
}
