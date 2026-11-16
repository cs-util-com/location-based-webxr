// Model import, direction 3: protect what matters. The author paints the
// parts that must stay sharp (a face, the eyes, lettering) straight onto
// the model; the shape slider then takes its triangles from everywhere
// else first. A three.js ES module the editor's asset shelf can mount:
// `mountModelProtect(host, options)`. README.md has the API.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { stepsFor, levelIndices } from "../model-lod-1/lod-simplify.js";
import {
  PICTURE_STEPS,
  DISTANCE_PRESETS,
  KEEP_ABOVE,
  readGlb,
  pictureJobs,
  originalSplit,
  chainCounts,
  shapeBytes,
  formatBytes,
  formatShare,
  formatCount,
  formatMetres,
  pxPerMetre,
  switchDistance,
  VISITOR_SCREEN_PX,
  VISITOR_FOV_DEG,
} from "./protect-sizes.js";
import {
  STRENGTHS,
  BRUSH_MIN,
  BRUSH_MAX,
  applyDab,
  weightsFromDabs,
  anyMarked,
  regionCounts,
} from "./protect-mask.js";
import { initialState, protectReducer, allDabs } from "./protect-state.js";

const AMBER = new THREE.Color("#f29b1d");
const MARK_ALPHA = 0.62;
/** Brush dabs along a drag, as a share of the brush radius. */
const DAB_SPACING = 0.35;
/** Wait after a stroke before ordering again, so a burst of strokes
 *  costs one run. */
const REORDER_DELAY_MS = 250;
const VISITOR_MIN_M = 1;
const POSITION_ERROR_8BIT = 0.01;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") {
      node.textContent = v;
    } else if (k === "class") {
      node.className = v;
    } else if (v !== false && v !== null && v !== undefined) {
      node.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children) {
    node.append(c);
  }
  return node;
}

function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const FIGURE_SVG =
  '<svg viewBox="0 0 24 40" aria-hidden="true"><circle cx="12" cy="6" r="5"/><path d="M5 14h14l-2 13h-3l-1 12h-2l-1-12H7z"/></svg>';

function buildDom(host) {
  const canvas = el("canvas", { class: "mp-canvas" });
  const tools = el("div", { class: "mp-tools", role: "group", "aria-label": "What dragging does" });
  const toolButtons = {};
  for (const [id, label] of [
    ["look", "Turn"],
    ["mark", "Mark sharp"],
    ["erase", "Unmark"],
  ]) {
    toolButtons[id] = el("button", { type: "button", class: `mp-tool mp-tool-${id}`, "data-tool": id, text: label });
    tools.append(toolButtons[id]);
  }
  const brush = el("input", {
    type: "range",
    class: "mp-brush",
    min: BRUSH_MIN,
    max: BRUSH_MAX,
    step: 0.002,
    "aria-label": "Brush size",
  });
  const brushWrap = el("label", { class: "mp-brush-wrap" }, [el("span", { text: "Brush" }), brush]);
  tools.append(brushWrap);
  const hint = el("p", { class: "mp-hint" });
  const busy = el("div", { class: "mp-busy", role: "status", hidden: true }, [
    el("span", { class: "mp-busy-text" }),
    el("span", { class: "mp-busy-bar" }, [el("span", { class: "mp-busy-fill" })]),
  ]);
  const compare = el("div", { class: "mp-compare", role: "group", "aria-label": "Which version is shown" });
  const showButtons = {};
  for (const [id, label] of [
    ["original", "Original"],
    ["mine", "Mine"],
    ["unmarked", "Mine, no marks"],
  ]) {
    showButtons[id] = el("button", { type: "button", class: `mp-show mp-show-${id}`, "data-show": id }, [
      el("span", { class: "mp-show-label", text: label }),
      el("span", { class: "mp-show-size" }),
    ]);
    compare.append(showButtons[id]);
  }
  const visitorBox = el("div", { class: "mp-visitor", hidden: true }, [el("span", { class: "mp-visitor-label" })]);
  const hook = el("p", { class: "mp-hook", "aria-hidden": "true" });
  const stage = el("div", { class: "mp-stage" }, [canvas, tools, hint, busy, visitorBox, compare, hook]);

  const sizeBig = el("strong", { class: "mp-size-big", text: "-" });
  const sizeShare = el("span", { class: "mp-size-share" });
  const sizeNote = el("p", { class: "mp-size-note" });
  const sizeBar = el("div", { class: "mp-size-bar", "aria-hidden": "true" }, [
    el("span", { class: "mp-size-pictures" }),
    el("span", { class: "mp-size-shape" }),
  ]);
  const sizeCard = el("header", { class: "mp-card mp-size" }, [
    el("p", { class: "mp-kicker", text: "File size" }),
    el("p", { class: "mp-size-line" }, [sizeBig, sizeShare]),
    sizeBar,
    el("p", { class: "mp-size-legend" }, [
      el("span", { class: "mp-key mp-key-pictures", text: "pictures" }),
      el("span", { class: "mp-key mp-key-shape", text: "shape" }),
    ]),
    sizeNote,
  ]);

  // 1. What must stay sharp
  const strength = el("div", { class: "mp-seg", role: "group", "aria-label": "How strongly marks hold" });
  const strengthButtons = {};
  for (const s of STRENGTHS) {
    strengthButtons[s.id] = el("button", { type: "button", "data-strength": s.id, text: s.label });
    strength.append(strengthButtons[s.id]);
  }
  const markState = el("p", { class: "mp-mark-state" });
  const undo = el("button", { type: "button", class: "mp-small", text: "Undo last mark" });
  const clear = el("button", { type: "button", class: "mp-small", text: "Clear marks" });
  const showMarks = el("input", { type: "checkbox" });
  const keepCard = el("section", { class: "mp-card mp-keep" }, [
    el("h2", { text: "1. What must stay sharp" }),
    el("p", {
      class: "mp-lead",
      text: "Paint over the parts visitors look at closely: a face, the eyes, lettering. The shape slider takes triangles from everywhere else first.",
    }),
    el("p", { class: "mp-row" }, [el("span", { class: "mp-label", text: "Marks hold" }), strength]),
    markState,
    el("p", { class: "mp-row mp-row-buttons" }, [
      undo,
      clear,
      el("label", { class: "mp-check" }, [showMarks, el("span", { text: "Show marks" })]),
    ]),
  ]);

  // 2. Shape
  const share = el("input", { type: "range", class: "mp-share", min: 1, max: 100, step: 1, "aria-label": "Triangles kept" });
  const shareValue = el("output", { class: "mp-share-value" });
  const regionMarked = el("div", { class: "mp-region mp-region-marked" }, [
    el("span", { class: "mp-region-name", text: "Marked parts" }),
    el("span", { class: "mp-region-bar" }, [el("span", { class: "mp-region-fill" })]),
    el("span", { class: "mp-region-value" }),
  ]);
  const regionRest = el("div", { class: "mp-region mp-region-rest" }, [
    el("span", { class: "mp-region-name", text: "Everything else" }),
    el("span", { class: "mp-region-bar" }, [el("span", { class: "mp-region-fill" })]),
    el("span", { class: "mp-region-value" }),
  ]);
  const triangles = el("input", { type: "checkbox" });
  const positions8 = el("input", { type: "checkbox" });
  const positionsNote = el("span", { class: "mp-note" });
  const shapeCard = el("section", { class: "mp-card mp-shape" }, [
    el("h2", { text: "2. Shape detail" }),
    el("p", { class: "mp-row mp-share-row" }, [share, shareValue]),
    regionMarked,
    regionRest,
    el("p", { class: "mp-row mp-row-checks" }, [
      el("label", { class: "mp-check" }, [triangles, el("span", { text: "Show the triangles" })]),
      el("label", { class: "mp-check" }, [positions8, el("span", { text: "Compact points (8-bit)" }), positionsNote]),
    ]),
  ]);

  // 3. Pictures
  const steps = el("div", { class: "mp-steps", role: "group", "aria-label": "Picture size" });
  const stepButtons = {};
  for (const s of PICTURE_STEPS) {
    stepButtons[s.id] = el("button", { type: "button", "data-step": s.id }, [
      el("span", { class: "mp-step-label", text: s.id === "original" ? "Original" : `${s.label} px` }),
      el("span", { class: "mp-step-size", text: "..." }),
    ]);
    steps.append(stepButtons[s.id]);
  }
  const webp = el("input", { type: "checkbox" });
  const webpNote = el("span", { class: "mp-note" });
  const picturesCard = el("section", { class: "mp-card mp-pictures" }, [
    el("h2", { text: "3. Pictures" }),
    steps,
    el("p", { class: "mp-row mp-row-checks" }, [
      el("label", { class: "mp-check" }, [webp, el("span", { text: "WebP pictures" }), webpNote]),
    ]),
  ]);

  // 4. From afar
  const presets = el("div", { class: "mp-presets", role: "group", "aria-label": "How detail drops with distance" });
  const presetButtons = {};
  for (const p of DISTANCE_PRESETS) {
    presetButtons[p.id] = el("button", { type: "button", "data-preset": p.id }, [
      el("span", { class: "mp-preset-label", text: p.label }),
      el("span", { class: "mp-preset-hint", text: p.hint }),
    ]);
    presets.append(presetButtons[p.id]);
  }
  const walkStrip = el("div", { class: "mp-walk-strip" }, [
    el("span", { class: "mp-zone mp-zone-0" }),
    el("span", { class: "mp-zone mp-zone-1" }),
    el("span", { class: "mp-zone mp-zone-2" }),
    el("span", { class: "mp-figure" }),
  ]);
  walkStrip.querySelector(".mp-figure").innerHTML = FIGURE_SVG;
  const walkTicks = el("div", { class: "mp-walk-ticks" });
  const walk = el("input", { type: "range", class: "mp-walk", min: 0, max: 1, step: 0.001, "aria-label": "Visitor distance" });
  const play = el("button", { type: "button", class: "mp-small mp-play", text: "Walk away" });
  const walkNote = el("p", { class: "mp-walk-note" });
  const farCard = el("details", { class: "mp-card mp-far" }, [
    el("summary", {}, [el("h2", { text: "4. From afar" }), el("span", { class: "mp-optional", text: "optional" })]),
    el("p", {
      class: "mp-lead",
      text: "Further away a visitor gets a lighter copy. Choose how soon; the figure walks away and the small view shows what it sees.",
    }),
    presets,
    walkStrip,
    walkTicks,
    el("p", { class: "mp-row" }, [play, walk]),
    walkNote,
  ]);

  const back = el("button", { type: "button", class: "mp-back", text: "Back" });
  const accept = el("button", { type: "button", class: "mp-accept", text: "Use this version" });
  const footer = el("footer", { class: "mp-footer" }, [back, accept]);
  const panel = el("aside", { class: "mp-panel" }, [sizeCard, keepCard, shapeCard, picturesCard, farCard, footer]);
  const root = el("div", { class: "mp" }, [stage, panel]);
  host.append(root);
  return {
    root,
    canvas,
    stage,
    toolButtons,
    brush,
    brushWrap,
    hint,
    busy,
    compare,
    showButtons,
    visitorBox,
    hook,
    sizeBig,
    sizeShare,
    sizeNote,
    sizeBar,
    strengthButtons,
    markState,
    undo,
    clear,
    showMarks,
    share,
    shareValue,
    regionMarked,
    regionRest,
    triangles,
    positions8,
    positionsNote,
    stepButtons,
    webp,
    webpNote,
    presetButtons,
    walkStrip,
    walkTicks,
    walk,
    play,
    walkNote,
    farCard,
    back,
    accept,
  };
}

/**
 * Mount the protect workbench into `host` (an element with a size).
 * @param {HTMLElement} host
 * @param {{ onAccept?: (settings: object) => void, onBack?: () => void,
 *   workerBase?: string | URL }} [options]
 */
export function mountModelProtect(host, options = {}) {
  if (!(host instanceof HTMLElement)) {
    throw new TypeError("mountModelProtect needs an element to draw into");
  }
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = new URL("./protect.css", import.meta.url).href;
  document.head.append(css);
  const ui = buildDom(host);
  const base = options.workerBase ? new URL(options.workerBase, location.href) : new URL(".", import.meta.url);

  let state = initialState();
  const listeners = new Set();
  function dispatch(action) {
    const next = protectReducer(state, action);
    if (next === state) {
      return;
    }
    const prev = state;
    state = next;
    const t0 = performance.now();
    react(prev, next, action);
    if (action.type === "share" || action.type === "show") {
      recordUpdate(performance.now() - t0, action);
    }
    for (const l of listeners) {
      l(state);
    }
  }

  // ---- three.js ----
  const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#d8d3c8");
  scene.add(new THREE.HemisphereLight("#fffaf0", "#5b5246", 1.6));
  const sun = new THREE.DirectionalLight("#ffffff", 2.2);
  sun.position.set(2, 3, 2.5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 5000);
  const visitorCam = new THREE.PerspectiveCamera(VISITOR_FOV_DEG, 1, 0.05, 20000);
  const controls = new OrbitControls(camera, ui.canvas);
  controls.enableDamping = true;
  controls.addEventListener("change", () => requestRender());
  const flatMaterial = new THREE.MeshStandardMaterial({ color: "#bdb6aa", flatShading: true, roughness: 0.9 });
  const wireMaterial = new THREE.MeshBasicMaterial({ color: "#2a2622", wireframe: true });

  let dirty = true;
  let disposed = false;
  let walking = null;
  function requestRender() {
    dirty = true;
  }

  // ---- the model ----
  let model = null; // see load()
  let loadTicket = 0;
  const updateTimes = [];
  const slowUpdates = [];
  const metrics = { buildMs: [], updates: 0, lastUpdateMs: 0 };

  // Each model gets fresh Workers: a job still running for the previous
  // model can then never answer into this one (its part ids and picture
  // keys would look valid and carry the wrong data).
  let simplifier = null;
  let painter = null;
  function startWorkers() {
    simplifier?.terminate();
    painter?.terminate();
    const s = new Worker(new URL("simplify-worker.js", base), { type: "module" });
    const p = new Worker(new URL("picture-worker.js", base), { type: "module" });
    s.addEventListener("message", (e) => s === simplifier && onSimplifier(e.data));
    p.addEventListener("message", (e) => p === painter && onPicture(e.data));
    s.addEventListener("error", (e) => s === simplifier && fail(`the shape helper stopped: ${e.message ?? "unknown error"}`));
    p.addEventListener("error", (e) => p === painter && fail(`the picture helper stopped: ${e.message ?? "unknown error"}`));
    simplifier = s;
    painter = p;
  }

  function fail(reason) {
    showBusy(null);
    ui.hint.textContent = `Something went wrong: ${reason}`;
    ui.hint.classList.add("mp-hint-error");
  }

  function clearModel() {
    if (!model) {
      return;
    }
    scene.remove(model.origRoot, model.mineRoot);
    for (const part of model.parts) {
      part.geometry?.dispose();
      part.overlayGeometry?.dispose();
      part.overlay?.material.dispose();
      part.mineMaterial?.dispose?.();
    }
    for (const t of model.madeTextures) {
      t.dispose();
    }
    // One texture often fills several slots and parts share materials, so
    // each is disposed once; the model left the scene above, nothing draws it.
    const textures = new Set();
    const materials = new Set();
    model.origRoot.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        for (const m of [o.material].flat()) {
          materials.add(m);
          for (const v of Object.values(m)) {
            if (v?.isTexture) {
              textures.add(v);
            }
          }
        }
      }
    });
    for (const t of textures) {
      t.dispose();
    }
    for (const m of materials) {
      m.dispose();
    }
    model = null;
  }

  async function load(source, name = "Model") {
    const ticket = ++loadTicket;
    showBusy({ text: "Opening the model", done: 0 });
    ui.hint.classList.remove("mp-hint-error");
    let bytes;
    if (source instanceof Blob) {
      bytes = new Uint8Array(await source.arrayBuffer());
    } else if (source instanceof ArrayBuffer) {
      bytes = new Uint8Array(source);
    } else {
      const res = await fetch(source);
      if (!res.ok) {
        throw new Error(`the model could not be fetched (${res.status})`);
      }
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    if (ticket !== loadTicket) {
      return;
    }
    const glb = readGlb(bytes);
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    if (ticket !== loadTicket) {
      return;
    }
    clearModel();
    startWorkers();
    state = { ...initialState(), share: 100 };
    const origRoot = gltf.scene;
    const mineRoot = origRoot.clone(true);
    const origMeshes = [];
    const mineMeshes = [];
    origRoot.traverse((o) => o.isMesh && origMeshes.push(o));
    mineRoot.traverse((o) => o.isMesh && mineMeshes.push(o));
    if (origMeshes.length === 0) {
      throw new Error("this model has no shape to show");
    }
    const imageOfTexture = (tex) => {
      const ti = gltf.parser.associations.get(tex)?.textures;
      const source2 = glb.json.textures?.[ti]?.source;
      return Number.isInteger(source2) ? source2 : null;
    };
    const parts = origMeshes.map((orig, i) => {
      const mine = mineMeshes[i];
      const mineMaterial = [orig.material].flat()[0].clone();
      mine.material = mineMaterial;
      return {
        id: i,
        orig,
        origMaterial: orig.material,
        origWire: null,
        mine,
        mineMaterial,
        geometry: null,
        overlay: null,
        overlayGeometry: null,
        wire: null,
        weights: null,
        positions: null,
        positions8: null,
        normals: null,
        full: null,
        remap: null,
        plain: null,
        prot: null,
        protTicket: 0,
        protDone: 0,
        protWanted: false,
        protBusy: false,
        progress: 0,
        errors: {},
        index: null,
        level: null,
        triangles: orig.geometry.index ? orig.geometry.index.count / 3 : orig.geometry.attributes.position.count / 3,
      };
    });
    scene.add(origRoot, mineRoot);
    origRoot.updateMatrixWorld(true);
    mineRoot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(origRoot);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const split = originalSplit(glb.json, bytes.length);
    model = {
      name,
      bytes: bytes.length,
      split,
      jsonBytes: glb.jsonLength,
      origRoot,
      mineRoot,
      parts,
      imageOfTexture,
      box,
      diag: box.getSize(new THREE.Vector3()).length(),
      centre: sphere.center.clone(),
      radius: sphere.radius,
      pictureBytes: new Map(),
      pictureProgress: 0,
      madeTextures: [],
      shownKey: null,
      wantedKey: null,
      pictureTicket: 0,
      imagesTotal: split.pictures,
      ready: false,
    };
    frame();
    // Pictures: measure every step, the default one first.
    const jobs = pictureJobs(glb.json, glb.bin);
    painter.postMessage({
      type: "images",
      images: jobs.map((j) => ({
        index: j.index,
        blob: new Blob([j.bytes], { type: j.mime }),
        mime: j.mime,
        use: j.use,
        rewritable: j.rewritable,
      })),
    });
    queuePictures();
    // Shape: weld and order every part in the Worker.
    for (const part of parts) {
      const g = part.orig.geometry;
      const attributes = [];
      for (const [name2, key] of [
        ["position", "position"],
        ["normal", "normal"],
        ["uv", "uv"],
      ]) {
        const a = g.attributes[key];
        if (a) {
          const data = new Float32Array(a.count * a.itemSize);
          for (let v = 0; v < a.count; v++) {
            for (let c = 0; c < a.itemSize; c++) {
              data[v * a.itemSize + c] = a.getComponent(v, c);
            }
          }
          attributes.push({ name: name2, size: a.itemSize, data });
        }
      }
      const index = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: g.attributes.position.count }, (_, k) => k);
      simplifier.postMessage({ type: "weld", id: part.id, attributes, index }, [...attributes.map((a) => a.data.buffer), index.buffer]);
    }
    showBusy({ text: "Studying the shape", done: 0 });
    syncControls();
    renderAll();
  }

  function frame() {
    const dist = model.radius / Math.sin((camera.fov * Math.PI) / 360) * 1.15;
    camera.near = model.radius / 200;
    camera.far = model.radius * 400;
    camera.position.copy(model.centre).add(new THREE.Vector3(0, model.radius * 0.15, dist));
    controls.target.copy(model.centre);
    camera.updateProjectionMatrix();
    controls.update();
  }

  // ---- worker answers ----
  function onSimplifier(m) {
    const part = model?.parts[m.id];
    if (!part) {
      return;
    }
    if (m.type === "welded") {
      setupPart(part, m);
    } else if (m.type === "progress") {
      if (m.variant === "protected" && m.ticket !== part.protTicket) {
        return;
      }
      part.progress = m.done;
      showProgress();
    } else if (m.type === "ordered") {
      metrics.buildMs.push({ part: m.id, variant: m.variant, ms: Math.round(m.buildMs) });
      part.progress = 1;
      if (m.variant === "plain") {
        part.plain = m.prog;
      } else {
        part.protBusy = false;
        if (m.ticket === part.protTicket) {
          part.prot = m.prog;
          part.protDone = m.ticket;
        } else {
          sendProtect(part);
        }
      }
      model.ready = model.parts.every((p) => p.plain);
      showProgress();
      updateLevels();
      syncControls();
    } else if (m.type === "measured") {
      part.errors[m.variant] = { ticket: m.ticket, errors: m.errors };
      renderFar();
    } else if (m.type === "failed") {
      fail(m.reason);
    }
  }

  function setupPart(part, m) {
    const by = Object.fromEntries(m.attributes.map((a) => [a.name, a]));
    const g = new THREE.BufferGeometry();
    part.positions = by.position.data;
    part.normals = by.normal?.data ?? null;
    const position = new THREE.BufferAttribute(part.positions, 3);
    g.setAttribute("position", position);
    if (by.normal) {
      g.setAttribute("normal", new THREE.BufferAttribute(by.normal.data, 3));
    }
    if (by.uv) {
      g.setAttribute("uv", new THREE.BufferAttribute(by.uv.data, 2));
    }
    part.full = m.full;
    part.remap = m.remap;
    part.index = new THREE.BufferAttribute(new Uint32Array(m.full), 1);
    part.index.setUsage(THREE.DynamicDrawUsage);
    g.setIndex(part.index);
    part.geometry = g;
    part.mine.geometry = g;
    part.weights = new Float32Array(part.positions.length / 3);
    // The marks overlay shares the shape and the index list.
    const og = new THREE.BufferGeometry();
    og.setAttribute("position", position);
    part.colours = new THREE.BufferAttribute(new Float32Array(part.weights.length * 4), 4);
    og.setAttribute("color", part.colours);
    og.setIndex(part.index);
    part.overlayGeometry = og;
    part.overlay = new THREE.Mesh(
      og,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    part.overlay.renderOrder = 2;
    part.mine.add(part.overlay);
    part.wire = new THREE.Mesh(g, wireMaterial);
    part.wire.visible = false;
    part.mine.add(part.wire);
    // the 8-bit copy of the positions, over the part's own box
    const p = part.positions;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], p[i]);
      hi[i % 3] = Math.max(hi[i % 3], p[i]);
    }
    const q = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) {
      const c = i % 3;
      const span = hi[c] - lo[c] || 1;
      q[i] = lo[c] + (Math.round(((p[i] - lo[c]) / span) * 255) / 255) * span;
    }
    part.positions8 = q;
    part.step8 = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 255 / 2;
    applyPositions(part);
    paintOverlay(part);
  }

  function applyPositions(part) {
    const attr = part.geometry.attributes.position;
    attr.array = state.positions8 ? part.positions8 : part.positions;
    attr.needsUpdate = true;
    part.geometry.computeBoundingSphere();
    part.geometry.computeBoundingBox();
  }

  // ---- marks ----
  function paintOverlay(part) {
    const c = part.colours.array;
    const w = part.weights;
    for (let i = 0; i < w.length; i++) {
      c[4 * i] = AMBER.r;
      c[4 * i + 1] = AMBER.g;
      c[4 * i + 2] = AMBER.b;
      c[4 * i + 3] = w[i] * MARK_ALPHA;
    }
    part.colours.needsUpdate = true;
    requestRender();
  }

  function rebuildWeights() {
    if (!model) {
      return;
    }
    const dabs = allDabs(state);
    for (const part of model.parts) {
      if (!part.weights) {
        continue;
      }
      const mine = dabs.filter((d) => d.part === part.id);
      const next = weightsFromDabs(part.weights.length, part.positions, part.normals, mine);
      const changed = next.some((x, i) => x !== part.weights[i]);
      part.weights = next;
      paintOverlay(part);
      if (changed) {
        scheduleProtect(part);
      }
    }
  }

  let reorderTimer = 0;
  const reorderParts = new Set();
  function scheduleProtect(part) {
    reorderParts.add(part);
    clearTimeout(reorderTimer);
    reorderTimer = setTimeout(() => {
      for (const p of reorderParts) {
        p.protTicket++;
        if (!anyMarked(p.weights)) {
          p.prot = null;
          p.protDone = p.protTicket;
          continue;
        }
        sendProtect(p);
      }
      reorderParts.clear();
      showProgress();
      updateLevels();
      syncControls();
    }, REORDER_DELAY_MS);
  }

  function sendProtect(part) {
    if (part.protBusy || part.protDone === part.protTicket || !anyMarked(part.weights)) {
      return;
    }
    part.protBusy = true;
    part.progress = 0;
    const strength = STRENGTHS.find((s) => s.id === state.strength).value;
    simplifier.postMessage({ type: "protect", id: part.id, ticket: part.protTicket, weights: part.weights.slice(), strength });
  }

  // painting
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let painting = null;
  function pick(event) {
    const rect = ui.canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const showOrig = state.show === "original";
    const targets = model.parts.map((p) => (showOrig ? p.orig : p.mine));
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) {
      return null;
    }
    const part = model.parts.find((p) => p.orig === hit.object || p.mine === hit.object);
    return part ? { part, point: hit.point } : null;
  }

  /** A dab at a world point, seen from the current camera. */
  function dabAt(part, world) {
    const mesh = part.mine;
    const local = mesh.worldToLocal(world.clone());
    const dir = world.clone().sub(camera.position).normalize();
    const ahead = mesh.worldToLocal(world.clone().add(dir));
    const view = ahead.sub(local).normalize();
    const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1;
    const dab = {
      part: part.id,
      center: [local.x, local.y, local.z],
      radius: (state.brush * model.diag) / scale,
      view: [view.x, view.y, view.z],
    };
    const erase = state.strokes[state.strokes.length - 1]?.erase === true;
    if (applyDab(part.weights, part.positions, part.normals, { ...dab, erase })) {
      paintOverlay(part);
    }
    dispatch({ type: "dab", dab });
    return dab;
  }

  ui.canvas.addEventListener("pointerdown", (event) => {
    if (painting) {
      // a second finger: the stroke ends and the view turns
      endPaint({ pointerId: painting.id });
      return;
    }
    if (!model?.ready || state.tool === "look" || event.button !== 0) {
      return;
    }
    const hit = pick(event);
    if (!hit) {
      return;
    }
    event.preventDefault();
    ui.canvas.setPointerCapture(event.pointerId);
    dispatch({ type: "strokeStart", erase: state.tool === "erase" });
    dabAt(hit.part, hit.point);
    painting = { id: event.pointerId, last: hit.point.clone(), parts: new Set([hit.part]) };
  });
  ui.canvas.addEventListener("pointermove", (event) => {
    if (!painting || event.pointerId !== painting.id) {
      updateCursor(event);
      return;
    }
    const hit = pick(event);
    if (!hit) {
      return;
    }
    const spacing = state.brush * model.diag * DAB_SPACING;
    if (hit.point.distanceTo(painting.last) < spacing) {
      return;
    }
    dabAt(hit.part, hit.point);
    painting.last.copy(hit.point);
    painting.parts.add(hit.part);
  });
  function endPaint(event) {
    if (!painting || event.pointerId !== painting.id) {
      return;
    }
    for (const part of painting.parts) {
      scheduleProtect(part);
    }
    painting = null;
    syncControls();
  }
  ui.canvas.addEventListener("pointerup", endPaint);
  ui.canvas.addEventListener("pointercancel", endPaint);
  ui.canvas.addEventListener("dblclick", (event) => {
    if (!model) {
      return;
    }
    const hit = pick(event);
    if (hit) {
      lookCloser(hit.point);
    }
  });

  // brush cursor: a ring on the surface
  const cursor = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 48),
    new THREE.MeshBasicMaterial({ color: "#1d1a16", depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  cursor.renderOrder = 5;
  cursor.visible = false;
  scene.add(cursor);
  function updateCursor(event) {
    if (!model?.ready || state.tool === "look") {
      if (cursor.visible) {
        cursor.visible = false;
        requestRender();
      }
      return;
    }
    const hit = pick(event);
    cursor.visible = Boolean(hit);
    if (hit) {
      cursor.position.copy(hit.point);
      cursor.lookAt(camera.position);
      cursor.scale.setScalar(state.brush * model.diag);
    }
    requestRender();
  }

  /** Move the orbit centre to a point and halve the distance: the
   *  author's own camera move, never a reset. */
  function lookCloser(point) {
    const from = { target: controls.target.clone(), position: camera.position.clone() };
    const offset = camera.position.clone().sub(controls.target).multiplyScalar(0.5);
    const to = { target: point.clone(), position: point.clone().add(offset) };
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 350);
      const e = t * (2 - t);
      controls.target.lerpVectors(from.target, to.target, e);
      camera.position.lerpVectors(from.position, to.position, e);
      controls.update();
      requestRender();
      if (t < 1 && !disposed) {
        requestAnimationFrame(step);
      }
    };
    step();
  }

  // ---- levels ----
  function minShare() {
    return Math.max(0, ...model.parts.map((p) => (p.plain ? p.plain.minTriangles / p.plain.triangleCount : 0)));
  }

  function targetOf(part, share) {
    const prog = part.plain;
    const lo = minShare();
    const s = lo + ((1 - lo) * (share - 1)) / 99;
    return Math.max(prog.minTriangles, Math.round(prog.triangleCount * s));
  }

  function progFor(part, variant) {
    if (variant === "unmarked") {
      return part.plain;
    }
    return part.prot && anyMarked(part.weights) ? part.prot : part.plain;
  }

  /** The measuring hook's live update time: one slider position or one
   *  switch, from the action to the panel's last number. */
  function recordUpdate(ms, action) {
    metrics.updates++;
    metrics.lastUpdateMs = ms;
    updateTimes.push(ms);
    if (updateTimes.length > 1000) {
      updateTimes.shift();
    }
    slowUpdates.push({
      ms: Math.round(ms * 10) / 10,
      action: action.type,
      value: action.value,
      levelMs: Math.round((metrics.levelMs ?? 0) * 10) / 10,
    });
    slowUpdates.sort((a, b) => b.ms - a.ms);
    slowUpdates.length = Math.min(slowUpdates.length, 5);
  }

  function updateLevels() {
    if (!model?.ready) {
      return;
    }
    const t0 = performance.now();
    const variant = state.show === "unmarked" ? "unmarked" : "mine";
    for (const part of model.parts) {
      const prog = progFor(part, variant);
      const level = state.share >= 100 ? part.full : levelIndices(prog, stepsFor(prog, targetOf(part, state.share)));
      part.level = level;
      part.index.array.set(level);
      part.index.needsUpdate = true;
      part.geometry.setDrawRange(0, level.length);
      part.overlayGeometry.setDrawRange(0, level.length);
      part.counts = regionCounts(level, part.weights);
      part.fullCounts = regionCounts(part.full, part.weights);
    }
    metrics.levelMs = performance.now() - t0;
    requestRender();
    renderShape();
    renderSize();
    scheduleMeasure();
  }

  let measureTimer = 0;
  let measureTicket = 0;
  function levelTargets(part) {
    const author = part.level.length / 3;
    return [author, ...chainCounts(author, part.plain.minTriangles)];
  }
  function scheduleMeasure() {
    clearTimeout(measureTimer);
    measureTimer = setTimeout(() => {
      if (!model?.ready || !ui.farCard.open) {
        return;
      }
      measureTicket++;
      for (const part of model.parts) {
        const variant = progFor(part, "mine") === part.prot ? "protected" : "plain";
        simplifier.postMessage({ type: "measure", id: part.id, ticket: measureTicket, variant, targets: levelTargets(part) });
      }
    }, 400);
  }

  // ---- pictures ----
  const pictureKey = (step, webp) => `${step}|${webp ? "webp" : "jpeg"}`;
  function queuePictures() {
    const first = state.pictureStep;
    const order = [first, ...PICTURE_STEPS.map((s) => s.id).filter((id) => id !== first)];
    const jobs = order.map((id) => ({ key: pictureKey(id, state.webp), side: PICTURE_STEPS.find((s) => s.id === id).side, webp: state.webp }));
    // the same step in the other format, for the WebP saving line
    jobs.push({ key: pictureKey(first, !state.webp), side: PICTURE_STEPS.find((s) => s.id === first).side, webp: !state.webp });
    model.wantedKey = pictureKey(first, state.webp);
    painter.postMessage({ type: "jobs", jobs });
    askPictures();
  }
  function askPictures() {
    const key = model.wantedKey;
    if (model.pictureBytes.has(key) && model.shownKey !== key) {
      painter.postMessage({ type: "pictures", key, ticket: ++model.pictureTicket });
    }
    renderPictures();
  }
  function onPicture(m) {
    if (!model) {
      return;
    }
    if (m.type === "made") {
      model.pictureBytes.set(m.key, m.bytes);
      if (m.key === model.wantedKey) {
        askPictures();
      }
      renderPictures();
      renderSize();
    } else if (m.type === "progress") {
      if (m.key === model.wantedKey) {
        model.pictureProgress = m.done;
        renderPictures();
      }
    } else if (m.type === "pictures") {
      if (m.ticket !== model.pictureTicket) {
        for (const b of m.bitmaps) {
          b.bitmap.close();
        }
        return;
      }
      swapPictures(m.key, m.bitmaps);
    } else if (m.type === "failed") {
      fail(m.reason);
    }
  }
  function swapPictures(key, bitmaps) {
    const byImage = new Map(bitmaps.map((b) => [b.index, b.bitmap]));
    const made = [];
    for (const part of model.parts) {
      const orig = [part.orig.material].flat()[0];
      for (const slot of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"]) {
        const tex = orig[slot];
        if (!tex) {
          continue;
        }
        const image = model.imageOfTexture(tex);
        const bitmap = byImage.get(image);
        if (!bitmap) {
          continue;
        }
        // A clone keeps every sampling setting of the glTF texture (flipY
        // false, colour space, UV channel, wrapping, texture transform); only
        // its picture is replaced, by a new Source so the original keeps its own.
        const next = tex.clone();
        next.source = new THREE.Source(bitmap);
        next.needsUpdate = true;
        part.mineMaterial[slot] = next;
        made.push(next);
      }
      part.mineMaterial.needsUpdate = true;
    }
    for (const t of model.madeTextures) {
      t.dispose();
    }
    model.madeTextures = made;
    model.shownKey = key;
    renderPictures();
    requestRender();
  }

  // ---- what is drawn ----
  function applyShow() {
    if (!model) {
      return;
    }
    const orig = state.show === "original";
    model.origRoot.visible = orig;
    model.mineRoot.visible = !orig;
    for (const part of model.parts) {
      if (part.overlay) {
        part.overlay.visible = state.showMarks || state.tool !== "look";
      }
      if (part.wire) {
        part.wire.visible = state.triangles;
      }
      const flat = state.triangles;
      part.mine.material = flat ? flatMaterial : part.mineMaterial;
      part.orig.material = flat ? flatMaterial : part.origMaterial;
      if (flat && !part.origWire) {
        // the original's wireframe, so both versions show their triangles
        part.origWire = new THREE.Mesh(part.orig.geometry, wireMaterial);
        part.orig.add(part.origWire);
      }
      if (part.origWire) {
        part.origWire.visible = flat;
      }
    }
    requestRender();
  }

  function react(prev, next, action) {
    if (!model) {
      return;
    }
    if (prev.share !== next.share || (prev.show === "unmarked") !== (next.show === "unmarked")) {
      updateLevels();
    }
    if (prev.positions8 !== next.positions8) {
      for (const part of model.parts) {
        if (part.geometry) {
          applyPositions(part);
        }
      }
      renderSize();
    }
    if (prev.pictureStep !== next.pictureStep || prev.webp !== next.webp) {
      queuePictures();
      renderSize();
    }
    if (prev.strength !== next.strength) {
      for (const part of model.parts) {
        if (part.weights && anyMarked(part.weights)) {
          scheduleProtect(part);
        }
      }
    }
    if (action.type === "undo" || action.type === "clear") {
      rebuildWeights();
    }
    if (prev.preset !== next.preset || prev.visitor !== next.visitor) {
      renderFar();
      requestRender();
    }
    applyShow();
    syncControls();
  }

  // ---- panel rendering ----
  function showBusy(b) {
    ui.busy.hidden = !b;
    if (b) {
      ui.busy.querySelector(".mp-busy-text").textContent = b.text;
      ui.busy.querySelector(".mp-busy-fill").style.width = `${Math.round(b.done * 100)}%`;
    }
  }
  function showProgress() {
    if (!model) {
      return;
    }
    if (!model.ready) {
      const done = model.parts.reduce((s, p) => s + (p.plain ? 1 : p.progress), 0) / model.parts.length;
      showBusy({ text: "Studying the shape. You can turn the original already.", done });
      return;
    }
    const busyParts = model.parts.filter((p) => p.protTicket !== p.protDone && anyMarked(p.weights));
    if (busyParts.length > 0) {
      const done = busyParts.reduce((s, p) => s + p.progress, 0) / busyParts.length;
      showBusy({ text: "Re-ordering the triangles around your marks. The slider keeps working.", done });
    } else {
      showBusy(null);
    }
  }

  function markedShare() {
    let marked = 0;
    let total = 0;
    for (const part of model.parts) {
      if (part.fullCounts) {
        marked += part.fullCounts.marked;
        total += part.fullCounts.marked + part.fullCounts.rest;
      }
    }
    return { marked, total };
  }

  function renderShape() {
    if (!model?.ready) {
      return;
    }
    let kept = 0;
    let total = 0;
    const sum = { marked: 0, rest: 0, fullMarked: 0, fullRest: 0 };
    for (const part of model.parts) {
      kept += part.level.length / 3;
      total += part.full.length / 3;
      sum.marked += part.counts.marked;
      sum.rest += part.counts.rest;
      sum.fullMarked += part.fullCounts.marked;
      sum.fullRest += part.fullCounts.rest;
    }
    ui.shareValue.textContent = `${formatShare(kept, total)} of the triangles (${formatCount(kept)})`;
    const setRegion = (node, keptN, fullN, empty) => {
      const fill = node.querySelector(".mp-region-fill");
      const value = node.querySelector(".mp-region-value");
      if (fullN === 0) {
        fill.style.width = "0%";
        value.textContent = empty;
        node.classList.add("mp-region-empty");
        return;
      }
      node.classList.remove("mp-region-empty");
      const share = Math.min(1, keptN / fullN);
      fill.style.width = `${(share * 100).toFixed(1)}%`;
      value.textContent = `keep ${formatShare(Math.min(keptN, fullN), fullN)}`;
    };
    setRegion(ui.regionMarked, sum.marked, sum.fullMarked, "nothing marked yet");
    setRegion(ui.regionRest, sum.rest, sum.fullRest, "-");
    const step8 = Math.max(...model.parts.map((p) => p.step8 ?? 0));
    ui.positionsNote.textContent = ` points move up to ${(step8 * 1000).toFixed(1)} mm`;
    const { marked, total: all } = markedShare();
    ui.markState.textContent =
      marked === 0
        ? "Nothing marked yet. Choose Mark sharp above the model and paint."
        : `Marked: ${formatShare(marked, all)} of the surface (${formatCount(marked)} triangles).`;
  }

  function estimate() {
    if (!model?.ready) {
      return null;
    }
    const key = pictureKey(state.pictureStep, state.webp);
    const pictures = model.pictureBytes.get(key);
    let shape = 0;
    for (const part of model.parts) {
      const used = new Uint8Array(part.weights.length);
      let vertices = 0;
      for (const i of part.level) {
        if (!used[i]) {
          used[i] = 1;
          vertices++;
        }
      }
      const tris = part.level.length / 3;
      shape += shapeBytes({
        vertices,
        triangles: tris,
        chain: chainCounts(tris, part.plain.minTriangles),
        hasNormals: Boolean(part.geometry.attributes.normal),
        hasUvs: Boolean(part.geometry.attributes.uv),
        positionBits: state.positions8 ? 8 : 16,
      });
    }
    shape += model.jsonBytes + 28;
    if (pictures === undefined) {
      return { pictures: null, shape, total: null };
    }
    return { pictures, shape, total: pictures + shape };
  }

  function renderSize() {
    if (!model) {
      return;
    }
    const e = estimate();
    const orig = model.bytes;
    ui.showButtons.original.querySelector(".mp-show-size").textContent = formatBytes(orig);
    if (!e || e.total === null) {
      ui.sizeBig.textContent = "measuring...";
      ui.sizeShare.textContent = "";
      ui.sizeNote.textContent = "Pictures are being measured one size after the other.";
      ui.showButtons.mine.querySelector(".mp-show-size").textContent = "...";
      return;
    }
    const keep = e.total > KEEP_ABOVE * orig;
    const shown = keep ? orig : e.total;
    ui.sizeBig.textContent = formatBytes(shown);
    ui.sizeShare.textContent = `${formatShare(shown, orig)} of ${formatBytes(orig)}`;
    ui.sizeNote.textContent = keep
      ? "Less than a tenth smaller, so the editor keeps the original file."
      : `Pictures ${formatBytes(e.pictures)}, shape ${formatBytes(e.shape)}.`;
    const pics = ui.sizeBar.querySelector(".mp-size-pictures");
    const shp = ui.sizeBar.querySelector(".mp-size-shape");
    pics.style.width = `${((100 * (keep ? model.split.pictures : e.pictures)) / orig).toFixed(1)}%`;
    shp.style.width = `${((100 * (keep ? model.split.shape : e.shape)) / orig).toFixed(1)}%`;
    ui.showButtons.mine.querySelector(".mp-show-size").textContent = formatBytes(shown);
    ui.showButtons.unmarked.querySelector(".mp-show-size").textContent = "same size";
  }

  function renderPictures() {
    if (!model) {
      return;
    }
    for (const s of PICTURE_STEPS) {
      const b = ui.stepButtons[s.id];
      const bytes = model.pictureBytes.get(pictureKey(s.id, state.webp));
      b.querySelector(".mp-step-size").textContent = bytes === undefined ? "measuring" : formatBytes(bytes);
      b.setAttribute("aria-pressed", String(state.pictureStep === s.id));
      const filling = state.pictureStep === s.id && bytes === undefined;
      b.style.setProperty("--fill", filling ? `${Math.round(model.pictureProgress * 100)}%` : "0%");
    }
    const now = model.pictureBytes.get(pictureKey(state.pictureStep, state.webp));
    const other = model.pictureBytes.get(pictureKey(state.pictureStep, !state.webp));
    if (now !== undefined && other !== undefined) {
      const jpeg = state.webp ? other : now;
      const webpBytes = state.webp ? now : other;
      ui.webpNote.textContent = ` ${jpeg > webpBytes ? "saves" : "adds"} ${formatBytes(Math.abs(jpeg - webpBytes))} here`;
    } else {
      ui.webpNote.textContent = "";
    }
    if (model.wantedKey !== model.shownKey && model.ready) {
      ui.hint.dataset.pictures = "waiting";
    }
  }

  // ---- distance ----
  function farLevels() {
    // per level: triangles and the largest deviation in metres
    const preset = DISTANCE_PRESETS.find((p) => p.id === state.preset);
    let levels = null;
    for (const part of model.parts) {
      const variant = progFor(part, "mine") === part.prot ? "protected" : "plain";
      const measured = part.errors[variant];
      const targets = levelTargets(part);
      const scale = part.mine.matrixWorld.getMaxScaleOnAxis() || 1;
      levels ??= targets.map(() => ({ triangles: 0, error: 0 }));
      targets.forEach((t, i) => {
        if (!levels[i]) {
          return;
        }
        levels[i].triangles += t;
        const err = measured?.errors[i];
        levels[i].error = Math.max(levels[i].error, err === undefined ? NaN : err * scale);
      });
    }
    const out = levels.map((l, i) => ({
      ...l,
      from: i === 0 ? 0 : switchDistance(l.error, preset.budgetPx),
    }));
    return out;
  }

  function visitorDistance(levels) {
    const last = levels[levels.length - 1]?.from;
    const far = Math.max(20, Number.isFinite(last) ? last * 2.5 : 40);
    return VISITOR_MIN_M * Math.pow(far / VISITOR_MIN_M, state.visitor);
  }

  function renderFar() {
    if (!model?.ready || !ui.farCard.open) {
      ui.visitorBox.hidden = true;
      return;
    }
    const levels = farLevels();
    const known = levels.every((l) => Number.isFinite(l.from));
    const d = visitorDistance(levels);
    const far = known ? Math.max(20, levels[levels.length - 1].from * 2.5) : 40;
    const pos = (m) => (Math.log(Math.max(m, VISITOR_MIN_M) / VISITOR_MIN_M) / Math.log(far / VISITOR_MIN_M)) * 100;
    const zones = ui.walkStrip.querySelectorAll(".mp-zone");
    zones.forEach((z, i) => {
      const l = levels[i];
      if (!l || !known) {
        z.style.left = "0%";
        z.style.width = i === 0 && !known ? "100%" : "0%";
        return;
      }
      const start = pos(l.from);
      const end = levels[i + 1] ? pos(levels[i + 1].from) : 100;
      z.style.left = `${Math.min(100, start)}%`;
      z.style.width = `${Math.max(0, Math.min(100, end) - Math.min(100, start))}%`;
    });
    ui.walkStrip.querySelector(".mp-figure").style.left = `${pos(d)}%`;
    ui.walkTicks.replaceChildren(
      ...(known
        ? levels.slice(1).map((l) => {
            const t = el("span", { class: "mp-tick", text: formatMetres(l.from) });
            t.style.left = `${Math.min(100, pos(l.from))}%`;
            return t;
          })
        : [el("span", { class: "mp-tick-wait", text: "measuring how far each lighter copy is off..." })]),
    );
    const at = levels.reduce((best, l, i) => (Number.isFinite(l.from) && d >= l.from ? i : best), 0);
    const names = ["full detail", "a quarter of it", "a sixteenth of it"];
    const heightPx = model.box.getSize(new THREE.Vector3()).y * pxPerMetre(d);
    ui.walkNote.textContent = `At ${formatMetres(d)} a visitor sees ${names[at] ?? "the lightest copy"} (${formatCount(levels[at].triangles)} triangles); the model is about ${Math.max(1, Math.round(heightPx))} px tall on their phone.`;
    ui.visitorBox.hidden = false;
    ui.visitorBox.querySelector(".mp-visitor-label").textContent = `Visitor at ${formatMetres(d)}, life size`;
    model.visitorLevel = at;
    model.visitorDistance = d;
    requestRender();
  }

  // ---- controls ----
  function syncControls() {
    for (const [id, b] of Object.entries(ui.toolButtons)) {
      b.setAttribute("aria-pressed", String(state.tool === id));
      b.disabled = id !== "look" && !model?.ready;
    }
    ui.brushWrap.hidden = state.tool === "look";
    ui.brush.value = String(state.brush);
    for (const [id, b] of Object.entries(ui.showButtons)) {
      b.setAttribute("aria-pressed", String(state.show === id));
    }
    const hasMarks = Boolean(model?.parts.some((p) => p.weights && anyMarked(p.weights)));
    ui.showButtons.unmarked.hidden = !hasMarks;
    if (!hasMarks && state.show === "unmarked") {
      queueMicrotask(() => dispatch({ type: "show", value: "mine" }));
    }
    for (const [id, b] of Object.entries(ui.strengthButtons)) {
      b.setAttribute("aria-pressed", String(state.strength === id));
    }
    for (const [id, b] of Object.entries(ui.presetButtons)) {
      b.setAttribute("aria-pressed", String(state.preset === id));
    }
    ui.undo.disabled = state.strokes.length === 0;
    ui.clear.disabled = state.strokes.length === 0;
    ui.showMarks.checked = state.showMarks;
    ui.share.value = String(state.share);
    ui.share.disabled = !model?.ready;
    ui.triangles.checked = state.triangles;
    ui.positions8.checked = state.positions8;
    ui.webp.checked = state.webp;
    ui.walk.value = String(state.visitor);
    ui.accept.disabled = !model?.ready;
    const hints = {
      look: "Drag to turn, pinch or scroll to zoom, double-tap to look closer.",
      mark: "Paint what must stay sharp. Two fingers or right-drag still turn the view.",
      erase: "Paint over a mark to remove it. Two fingers or right-drag turn the view.",
    };
    if (!ui.hint.classList.contains("mp-hint-error")) {
      ui.hint.textContent =
        state.show === "original" && state.tool !== "look"
          ? "Showing the original: your marks show on Mine."
          : hints[state.tool];
    }
    // painting takes the left button and one finger; turning stays on the rest
    const painting2 = state.tool !== "look";
    controls.mouseButtons = painting2
      ? { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = painting2
      ? { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE }
      : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    ui.canvas.style.touchAction = "none";
    ui.root.dataset.tool = state.tool;
    renderShape();
    renderSize();
    renderPictures();
  }

  for (const b of Object.values(ui.toolButtons)) {
    b.addEventListener("click", () => dispatch({ type: "tool", value: b.dataset.tool }));
  }
  ui.brush.addEventListener("input", () => dispatch({ type: "brush", value: Number(ui.brush.value) }));
  for (const b of Object.values(ui.showButtons)) {
    b.addEventListener("click", () => dispatch({ type: "show", value: b.dataset.show }));
  }
  for (const b of Object.values(ui.strengthButtons)) {
    b.addEventListener("click", () => dispatch({ type: "strength", value: b.dataset.strength }));
  }
  for (const b of Object.values(ui.presetButtons)) {
    b.addEventListener("click", () => dispatch({ type: "preset", value: b.dataset.preset }));
  }
  for (const b of Object.values(ui.stepButtons)) {
    b.addEventListener("click", () => dispatch({ type: "pictureStep", value: b.dataset.step }));
  }
  ui.undo.addEventListener("click", () => dispatch({ type: "undo" }));
  ui.clear.addEventListener("click", () => dispatch({ type: "clear" }));
  ui.showMarks.addEventListener("change", () => dispatch({ type: "toggle", key: "showMarks", value: ui.showMarks.checked }));
  ui.share.addEventListener("input", () => dispatch({ type: "share", value: Number(ui.share.value) }));
  ui.triangles.addEventListener("change", () => dispatch({ type: "toggle", key: "triangles", value: ui.triangles.checked }));
  ui.positions8.addEventListener("change", () => dispatch({ type: "toggle", key: "positions8", value: ui.positions8.checked }));
  ui.webp.addEventListener("change", () => dispatch({ type: "toggle", key: "webp", value: ui.webp.checked }));
  ui.walk.addEventListener("input", () => {
    walking = null;
    dispatch({ type: "visitor", value: Number(ui.walk.value) });
  });
  ui.farCard.addEventListener("toggle", () => {
    scheduleMeasure();
    renderFar();
    requestRender();
  });
  ui.play.addEventListener("click", () => {
    walking = { t0: performance.now(), from: state.visitor >= 0.99 ? 0 : state.visitor };
  });
  window.addEventListener("keydown", onKey);
  function onKey(event) {
    if (event.target instanceof HTMLInputElement && event.target.type !== "range" && event.target.type !== "checkbox") {
      return;
    }
    if (event.key === "o" || event.key === "O") {
      dispatch({ type: "show", value: state.show === "original" ? "mine" : "original" });
    }
  }
  ui.back.addEventListener("click", () => options.onBack?.());
  ui.accept.addEventListener("click", () => options.onAccept?.(settings()));

  // ---- loop ----
  function resize() {
    const r = ui.stage.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width));
    const h = Math.max(1, Math.floor(r.height));
    if (ui.canvas.width !== Math.floor(w * renderer.getPixelRatio()) || ui.canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      requestRender();
    }
  }
  function renderAll() {
    renderShape();
    renderSize();
    renderPictures();
  }

  function renderVisitor() {
    if (!model || ui.visitorBox.hidden || state.show === "original") {
      return;
    }
    const stageRect = ui.stage.getBoundingClientRect();
    const r = ui.visitorBox.getBoundingClientRect();
    const pr = renderer.getPixelRatio();
    const x = r.left - stageRect.left;
    const yBottom = stageRect.bottom - r.bottom;
    const w = r.width;
    const h = r.height;
    // life size: the box covers as many phone pixels as it has device pixels
    const fov = (2 * Math.atan((Math.tan((VISITOR_FOV_DEG * Math.PI) / 360) * h * pr) / VISITOR_SCREEN_PX) * 180) / Math.PI;
    visitorCam.fov = fov;
    visitorCam.aspect = w / h;
    const dir = camera.position.clone().sub(controls.target).normalize();
    visitorCam.position.copy(model.centre).addScaledVector(dir, model.visitorDistance);
    visitorCam.lookAt(model.centre);
    visitorCam.near = Math.max(0.05, model.visitorDistance - model.radius * 2);
    visitorCam.far = model.visitorDistance + model.radius * 2;
    visitorCam.updateProjectionMatrix();
    // draw the level the visitor gets, then put the author's level back
    const levelAt = model.visitorLevel ?? 0;
    const swapped = [];
    if (levelAt > 0) {
      for (const part of model.parts) {
        const prog = progFor(part, "mine");
        const target = levelTargets(part)[levelAt];
        const ix = levelIndices(prog, stepsFor(prog, target));
        part.geometry.setDrawRange(0, ix.length);
        part.index.array.set(ix);
        part.index.needsUpdate = true;
        swapped.push(part);
      }
    }
    const overlays = model.parts.map((p) => p.overlay && p.overlay.visible);
    for (const p of model.parts) {
      if (p.overlay) {
        p.overlay.visible = false;
      }
    }
    cursor.visible = false;
    renderer.setScissorTest(true);
    renderer.setScissor(x, yBottom, w, h);
    renderer.setViewport(x, yBottom, w, h);
    const bg = scene.background;
    scene.background = new THREE.Color("#a9b8c4");
    renderer.render(scene, visitorCam);
    scene.background = bg;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, stageRect.width, stageRect.height);
    model.parts.forEach((p, i) => {
      if (p.overlay) {
        p.overlay.visible = overlays[i];
      }
    });
    for (const part of swapped) {
      part.index.array.set(part.level);
      part.index.needsUpdate = true;
      part.geometry.setDrawRange(0, part.level.length);
    }
  }

  function tick() {
    if (disposed) {
      return;
    }
    requestAnimationFrame(tick);
    resize();
    if (controls.update()) {
      dirty = true;
    }
    if (walking) {
      const t = Math.min(1, (performance.now() - walking.t0) / 5000);
      dispatch({ type: "visitor", value: walking.from + (1 - walking.from) * t });
      if (t >= 1) {
        walking = null;
      }
    }
    if (!dirty) {
      return;
    }
    dirty = false;
    renderer.render(scene, camera);
    renderVisitor();
    const med = median(updateTimes);
    ui.hook.textContent = `${document.querySelectorAll(".mp *").length} elements · update ${metrics.lastUpdateMs.toFixed(1)} ms (median ${med.toFixed(1)})`;
  }
  requestAnimationFrame(tick);

  // ---- the result ----
  function marksForShelf() {
    const out = [];
    for (const part of model.parts) {
      if (!part.weights || !anyMarked(part.weights)) {
        continue;
      }
      // per vertex of the ORIGINAL primitive, through the weld map
      const original = new Float32Array(part.remap.length);
      for (let i = 0; i < part.remap.length; i++) {
        original[i] = part.weights[part.remap[i]];
      }
      out.push({
        mesh: part.orig.name || `mesh ${part.id}`,
        part: part.id,
        vertexWeights: original,
        dabs: allDabs(state).filter((d) => d.part === part.id),
      });
    }
    return out;
  }

  function settings() {
    const step = PICTURE_STEPS.find((s) => s.id === state.pictureStep);
    const preset = DISTANCE_PRESETS.find((p) => p.id === state.preset);
    const marks = model ? marksForShelf() : [];
    const result = {
      textureMaxSidePx: step.side,
      distanceBudgetPx: preset.budgetPx,
    };
    if (state.webp) {
      result.textureType = "image/webp";
    }
    if (state.share < 100 && model?.ready) {
      const kept = model.parts.reduce((s, p) => s + p.level.length / 3, 0);
      const total = model.parts.reduce((s, p) => s + p.full.length / 3, 0);
      result.detailShare = kept / total;
    }
    if (state.positions8) {
      result.positionBits = 8;
      result.maxPositionError = POSITION_ERROR_8BIT;
    }
    if (marks.length > 0) {
      result.protect = {
        strength: STRENGTHS.find((s) => s.id === state.strength).value,
        parts: marks,
      };
    }
    return result;
  }

  return {
    load: async (source, name) => {
      try {
        await load(source, name);
      } catch (error) {
        fail(String(error?.message ?? error));
        throw error;
      }
    },
    dispatch,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    settings,
    /** The measuring hook. */
    metrics() {
      const regions = model?.ready
        ? model.parts.map((p) => ({
            part: p.id,
            marked: p.counts.marked,
            markedFull: p.fullCounts.marked,
            rest: p.counts.rest,
            restFull: p.fullCounts.rest,
          }))
        : [];
      return {
        elements: document.querySelectorAll(".mp *").length,
        ready: Boolean(model?.ready),
        protectedReady: Boolean(model?.parts.every((p) => p.protDone === p.protTicket && !p.protBusy)),
        updates: metrics.updates,
        lastUpdateMs: metrics.lastUpdateMs,
        medianUpdateMs: median(updateTimes),
        worstUpdateMs: Math.max(0, ...updateTimes),
        slowestUpdates: [...slowUpdates],
        buildMs: [...metrics.buildMs],
        regions,
        pictures: Object.fromEntries(model?.pictureBytes ?? []),
        shownPictures: model?.shownKey ?? null,
        estimate: estimate(),
        triangles: model?.ready ? model.parts.reduce((s, p) => s + p.level.length / 3, 0) : null,
        camera: { position: camera.position.toArray(), target: controls.target.toArray() },
      };
    },
    /** For the measuring run: put the camera somewhere (the author's own
     *  move, as a double-tap would). */
    setView(position, target) {
      camera.position.fromArray(position);
      controls.target.fromArray(target);
      controls.update();
      requestRender();
    },
    /** For the measuring run: one stroke at a world point. */
    markAt(world, erase = false) {
      if (!model?.ready) {
        return false;
      }
      const p = new THREE.Vector3().fromArray(world);
      const dir = p.clone().sub(camera.position).normalize();
      raycaster.set(camera.position, dir);
      const hit = raycaster.intersectObjects(model.parts.map((q) => (state.show === "original" ? q.orig : q.mine)), false)[0];
      if (!hit) {
        return false;
      }
      const part = model.parts.find((q) => q.orig === hit.object || q.mine === hit.object);
      dispatch({ type: "strokeStart", erase });
      dabAt(part, hit.point);
      scheduleProtect(part);
      return true;
    },
    /** World point under a canvas position (CSS px), for the measuring run. */
    pointAt(x, y) {
      const rect = ui.canvas.getBoundingClientRect();
      const hit = model && pick({ clientX: rect.left + x, clientY: rect.top + y });
      return hit ? hit.point.toArray() : null;
    },
    destroy() {
      disposed = true;
      window.removeEventListener("keydown", onKey);
      clearTimeout(reorderTimer);
      clearTimeout(measureTimer);
      simplifier?.terminate();
      painter?.terminate();
      clearModel();
      controls.dispose();
      renderer.dispose();
      flatMaterial.dispose();
      wireMaterial.dispose();
      ui.root.remove();
      css.remove();
    },
  };
}
