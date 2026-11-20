// Travelling surface, round 1, prototype C - the model note. Throwaway prototype: not wired to the
// app, linked from nothing in it.
//
// A placed 3D model carries notes. Tapping a note's marker opens its card: one object that hangs
// beside its point while it can be read there and flies to the bottom-centre box when it cannot
// (the point is out of view, faces away, is hidden behind the model, or the card is too small or
// too wide). A leader line joins the card to its point in both places. Previous and Next move the
// card from point to point; "Back to its place" folds it into its marker. Exactly one copy of the
// card is drawn at any moment. The flight between the world and the screen is the one of the
// travelling box (6.2): the card's four corners fly in clip space, so the texture keeps its
// perspective all the way.
import * as THREE from "three";
import * as kind from "./kind.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Moves v toward target by at most step, never past it (no flicker at the target). */
const approach = (v, target, step) =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const { CARD, noteOpacity } = kind;

// ---------- settings (URL options and the tester panel) ----------
const params = new URLSearchParams(location.search);
function pick(key, allowed, fallback) {
  const v = params.get(key);
  return allowed.includes(v) ? v : fallback;
}
function pickNum(key, allowed, fallback) {
  const v = Number(params.get(key));
  return params.has(key) && allowed.includes(v) ? v : fallback;
}
const cfg = {
  thr: pickNum("thr", [10, 12, 14, 16], 12),
  letter: pickNum("letter", [6, 8, 10, 12], 10),
  measure: pickNum("measure", kind.MEASURES, 14),
  btns: pick("btns", ["pull", "gate"], "pull"),
  gate: pickNum("gate", [40, 48, 56], 48),
  face: pickNum("face", [45, 60, 75, 90], 75),
  hold: pickNum("hold", [0.15, 0.3, 0.6, 1], 0.3),
  hyst: pickNum("hyst", [5, 10, 15], 5),
  fly: pickNum("fly", [0, 0.35, 0.6, 1.2], 0.6),
  stage: pick("stage", ["auto", "portrait", "landscape"], "auto"),
  creator: pick("creator", ["world", "screen"], "world"),
};
const NUM_KEYS = ["thr", "letter", "measure", "gate", "face", "hold", "hyst", "fly"];

const RADIUS_M = 15; // the station circle around the model: nothing shows outside it
const EDGE = 0.88; // the point and the card centre must lie inside this much of the screen
const FIT = 0.96; // a card wider than this share of the screen is too close
const RELEASE_S = 0.6; // after a press on the card it does not move for this long
const FOLLOW_S = 1.5; // after Next or Previous in the world, the eyes get this long to follow the card
const TAP_SLOP = 8; // px a finger may move and still count as a tap
const MARKER_PX = 11; // a marker's radius on the screen
const MARKER_HIT_PX = 16; // extra px around a marker that still count as a tap on it
const PICK_KEY = "tour-words-pick"; // the visitor's one pick for the whole tour: world | box
const MODEL_CENTRE = new THREE.Vector3(0, 1.9, 0);

const stageEl = $("stage");
const device = $("device");
const canvas = $("cam");
const readoutEl = $("readout");
const costEl = $("cost");
const fingerEl = $("finger");
const voiceEl = $("voice");

// ---------- the renderer, the camera and a generic town square ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.autoClear = false;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
camera.rotation.order = "YXZ";

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function canvasTexture(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
function paintedTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  return canvasTexture(c);
}
scene.background = paintedTexture(4, 256, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#7fa6c9");
  grad.addColorStop(0.55, "#c4d6e3");
  grad.addColorStop(1, "#e3e9ec");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
});
scene.fog = new THREE.Fog(0xd5dfe6, 40, 200);
scene.add(new THREE.HemisphereLight(0xdfe9f2, 0x6b5e50, 1.5));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
sun.position.set(40, 80, 20);
scene.add(sun);

const cobbles = paintedTexture(256, 256, (g, w, h) => {
  const rand = rng(7);
  g.fillStyle = "#6f6a62";
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) {
    for (let x = (y / 16) % 2 ? -8 : 0; x < w; x += 16) {
      const v = 120 + Math.floor(rand() * 40);
      g.fillStyle = `rgb(${v} ${v - 6} ${v - 14})`;
      g.beginPath();
      g.roundRect(x + 1.5, y + 1.5, 13, 13, 4);
      g.fill();
    }
  }
});
cobbles.wrapS = THREE.RepeatWrapping;
cobbles.wrapT = THREE.RepeatWrapping;
cobbles.repeat.set(60, 60);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshLambertMaterial({ map: cobbles }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

(function houses() {
  const rand = rng(11);
  const spots = [];
  for (let z = -34; z <= 46; z += 9) {
    spots.push([-30, z], [30, z]);
  }
  for (let x = -21; x <= 21; x += 9) {
    spots.push([x, -36], [x, 52]);
  }
  const facade = paintedTexture(128, 128, (g, w, h) => {
    g.fillStyle = "#f4efe6";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#3b3f45";
    for (let y = 14; y < h - 30; y += 30) {
      for (let x = 14; x < w - 10; x += 28) {
        g.fillRect(x, y, 14, 18);
      }
    }
    g.fillStyle = "#5a4330";
    g.fillRect(52, h - 26, 22, 26);
  });
  const walls = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ map: facade }),
    spots.length,
  );
  const roofs = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.75, 1, 4),
    new THREE.MeshLambertMaterial({ color: 0xa04a30 }),
    spots.length,
  );
  const m = new THREE.Matrix4();
  const turn = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 4,
  );
  const colors = [0xffffff, 0xf0dcc0, 0xe6cfb0, 0xdfe3e0, 0xf3d9c6, 0xe9e0cf];
  const c = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const h = 9 + rand() * 7;
    m.compose(
      new THREE.Vector3(x, h / 2, z),
      new THREE.Quaternion(),
      new THREE.Vector3(8.4, h, 8.4),
    );
    walls.setMatrixAt(i, m);
    walls.setColorAt(i, c.setHex(colors[Math.floor(rand() * colors.length)]));
    m.compose(
      new THREE.Vector3(x, h + 1.6, z),
      turn,
      new THREE.Vector3(8.4, 3.2, 8.4),
    );
    roofs.setMatrixAt(i, m);
  });
  scene.add(walls, roofs);
})();

// ---------- the overlay: the same card texture, drawn in screen space while docked or flying ----------
const ovScene = new THREE.Scene();
const ovCam = new THREE.Camera();
const clipArr = new Float32Array(16);
const ovGeo = new THREE.BufferGeometry();
ovGeo.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array(12), 3),
);
const clipAttr = new THREE.BufferAttribute(clipArr, 4);
ovGeo.setAttribute("clipPos", clipAttr);
const uvAttr = new THREE.BufferAttribute(
  new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]),
  2,
);
ovGeo.setAttribute("uv", uvAttr);
ovGeo.setIndex([0, 2, 1, 2, 3, 1]);
const ovMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: null }, opacity: { value: 1 } },
  vertexShader:
    "attribute vec4 clipPos;\nvarying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = clipPos;\n}",
  fragmentShader:
    "uniform sampler2D map;\nuniform float opacity;\nvarying vec2 vUv;\nvoid main() {\n  vec4 c = texture2D(map, vUv);\n  gl_FragColor = vec4(c.rgb, c.a * opacity);\n  #include <colorspace_fragment>\n}",
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const ovMesh = new THREE.Mesh(ovGeo, ovMat);
ovMesh.frustumCulled = false;
ovMesh.visible = false;
ovMesh.renderOrder = 2;
ovScene.add(ovMesh);

// the leader line: a thin screen-space quad from the note's point to the card's nearest edge,
// dashed while the point is hidden behind the model or faces away
const leadArr = new Float32Array(16);
const leadGeo = new THREE.BufferGeometry();
leadGeo.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array(12), 3),
);
const leadAttr = new THREE.BufferAttribute(leadArr, 4);
leadGeo.setAttribute("clipPos", leadAttr);
const alongAttr = new THREE.BufferAttribute(new Float32Array(4), 1);
leadGeo.setAttribute("along", alongAttr);
leadGeo.setIndex([0, 2, 1, 2, 3, 1]);
const leadMat = new THREE.ShaderMaterial({
  uniforms: {
    color: { value: new THREE.Color(0x7dd3fc) },
    opacity: { value: 1 },
    dashed: { value: 0 },
  },
  vertexShader:
    "attribute vec4 clipPos;\nattribute float along;\nvarying float vAlong;\nvoid main() {\n  vAlong = along;\n  gl_Position = clipPos;\n}",
  fragmentShader:
    "uniform vec3 color;\nuniform float opacity;\nuniform float dashed;\nvarying float vAlong;\nvoid main() {\n  if (dashed > 0.5 && mod(vAlong, 12.0) > 6.5) discard;\n  gl_FragColor = vec4(color, opacity);\n  #include <colorspace_fragment>\n}",
  transparent: true,
  side: THREE.DoubleSide,
  depthTest: false,
  depthWrite: false,
});
const leadMesh = new THREE.Mesh(leadGeo, leadMat);
leadMesh.frustumCulled = false;
leadMesh.visible = false;
leadMesh.renderOrder = 1;
ovScene.add(leadMesh);

// ---------- the stage: the window on a phone, a phone frame on a desktop ----------
let W = 390;
let H = 844;
let k = 1;
const desktopMq = matchMedia("(min-width: 960px) and (min-height: 600px)");
function sizeStage() {
  const desktop = desktopMq.matches;
  let w = innerWidth;
  let h = innerHeight;
  if (cfg.stage === "portrait" || (cfg.stage === "auto" && desktop)) {
    w = 390;
    h = 844;
  } else if (cfg.stage === "landscape") {
    w = 844;
    h = 390;
  }
  const availW = desktop ? innerWidth - 400 - 36 - 48 - 24 : innerWidth;
  const availH = desktop ? innerHeight - 48 - 24 : innerHeight;
  k = Math.min(1, availW / w, availH / h);
  W = w;
  H = h;
  device.style.width = `${w}px`;
  device.style.height = `${h}px`;
  device.style.transform = k === 1 ? "" : `scale(${k})`;
  stageEl.style.width = desktop ? `${w * k}px` : "";
  stageEl.style.height = desktop ? `${h * k}px` : "";
  device.classList.toggle("landscape", w > h);
  renderer.setSize(w, h, false);
  // an upright phone sees about 42 degrees across, a sideways one about 50 degrees top to bottom
  camera.fov =
    w <= h
      ? THREE.MathUtils.radToDeg(
          2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(21)) * (h / w)),
        )
      : 50;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", sizeStage);
desktopMq.addEventListener("change", sizeStage);
function toDevice(e) {
  const r = device.getBoundingClientRect();
  return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
}

// ---------- the item ----------
const env = { mode: "play", canvasTexture };
let sample = null;
let block = null;
let part = null;

function mount() {
  kind.setMeasure(cfg.measure);
  const r = kind.read(sample.records.normal);
  if (r.problems.length) {
    console.warn("model note:", r.problems.join("; "));
  }
  block = r.block;
  part = kind.world(block, env);
  scene.add(part.object);
  ovMat.uniforms.map.value = part.card.texture;
}

/** A new card width needs a new card: the open note opens again on the new part. */
function remount() {
  const was = open;
  part.dispose();
  mount();
  plateKey = "";
  lastPaint.key = "";
  havePlate = false;
  open = -1;
  closing = false;
  place = "hidden";
  presence = 0;
  if (was >= 0) {
    openNote(was);
  }
}

// ---------- the card's state: which note is open and where its card is ----------
let open = -1; // the open note, -1 for none
let place = "hidden"; // hidden | plate | dock | fold (in its marker, while the voice holds the box)
let pending = "";
let pendingFor = 0;
let why = "";
let whyCode = "";
let presence = 0; // fades the card in and out at the station's edge
let pulled = false; // the visitor brought the card close; it stays in the box until Back
let closing = false;
let voiceOn = false;
let releaseUntil = 0;
let pressed = "";
let pressedUntil = 0;
let voiceNoteUntil = 0;
let followUntil = 0;
/** The flight: from and to are endpoints (plate | dock | marker | snap); f runs 0 to 1. */
let flight = { from: { kind: "marker" }, to: "marker", f: 1 };
/** Next or Previous while the card hangs in the world: its anchor moves from one point to the next. */
let tween = null;

let visitorPick = null;
try {
  visitorPick = localStorage.getItem(PICK_KEY);
} catch {
  visitorPick = null;
}
if (visitorPick !== "world" && visitorPick !== "box") {
  visitorPick = null;
}
const effectiveView = () =>
  visitorPick ?? (cfg.creator === "world" ? "world" : "box");
const plateFrac = () =>
  cfg.btns === "pull" ? CARD.cropPx / CARD.canvasH : 1;
const metresPerPx = () => cfg.letter / 100 / CARD.fontPx;

// ---------- projection helpers ----------
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const pv = new THREE.Matrix4();
const tmpM = new THREE.Matrix4();
const v4 = new THREE.Vector4();
const toCam = new THREE.Vector3();
const dirH = new THREE.Vector3();
const sx = (x, w) => (x / w / 2 + 0.5) * W;
const sy = (y, w) => (0.5 - y / w / 2) * H;

/** Projects the card plate's corners (TL, TR, BL, BR) into clip space; returns the smallest w. */
function projectCard(pos, quat, w, h, out) {
  tmpM.compose(pos, quat, ONE);
  let minW = Infinity;
  for (let i = 0; i < 4; i++) {
    v4.set(i & 1 ? w / 2 : -w / 2, i < 2 ? 0 : -h, 0, 1)
      .applyMatrix4(tmpM)
      .applyMatrix4(pv);
    out[i * 4] = v4.x;
    out[i * 4 + 1] = v4.y;
    out[i * 4 + 2] = v4.z;
    out[i * 4 + 3] = v4.w;
    minW = Math.min(minW, v4.w);
  }
  return minW;
}
function projectPoint(p, out) {
  v4.set(p.x, p.y, p.z, 1).applyMatrix4(pv);
  out.x = v4.x;
  out.y = v4.y;
  out.z = v4.z;
  out.w = v4.w;
  return out;
}

/**
 * Where a note's card hangs: beside its point, on the note's side as seen from the viewer, its
 * middle at the point's height but never lower than 0.2 m off the ground, turned to the viewer.
 * The side follows the direction to the point, not the gaze, so turning the phone moves nothing.
 */
function hang(i, out) {
  const n = part.notes[i];
  const mpp = metresPerPx();
  const w = CARD.canvasW * mpp;
  const h = CARD.canvasH * plateFrac() * mpp;
  dirH.subVectors(n.at, camera.position);
  dirH.y = 0;
  if (dirH.lengthSq() < 1e-6) {
    dirH.set(0, 0, -1);
  }
  dirH.normalize();
  const side = n.side === "left" ? -1 : 1;
  out.pos.set(
    n.at.x - dirH.z * side * (0.3 + w / 2),
    0,
    n.at.z + dirH.x * side * (0.3 + w / 2),
  );
  out.pos.y = Math.max(n.at.y + h / 2, 0.2 + h);
  const yaw = Math.atan2(
    camera.position.x - out.pos.x,
    camera.position.z - out.pos.z,
  );
  out.quat.setFromAxisAngle(UP, yaw);
  out.w = w;
  out.h = h;
  return out;
}
const mkHang = () => ({
  pos: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  w: 0,
  h: 0,
});
const hsTarget = mkHang();
const hsFrom = mkHang();
const hsMesh = mkHang();

// ---------- what the viewer sees of each note ----------
const raycaster = new THREE.Raycaster();
const facing = [];
const hiddenBy = [];
function occluded(i) {
  const at = part.notes[i].at;
  toCam.subVectors(at, camera.position);
  const d = toCam.length();
  raycaster.set(camera.position, toCam.divideScalar(d || 1));
  raycaster.near = 0;
  raycaster.far = d;
  const hit = raycaster.intersectObjects(part.solids, false)[0];
  return Boolean(hit && hit.distance < d - 0.06);
}
function seeNotes() {
  part.notes.forEach((n, i) => {
    toCam.subVectors(camera.position, n.at).normalize();
    facing[i] = n.normal.dot(toCam);
    hiddenBy[i] = occluded(i);
  });
}

/** The card as it would hang at note i, seen from the camera now. */
const tgtClip = new Float32Array(16);
const pt = { x: 0, y: 0, z: 0, w: 0 };
function measure(i, m) {
  hang(i, hsTarget);
  const frac = plateFrac();
  const minW = projectCard(
    hsTarget.pos,
    hsTarget.quat,
    hsTarget.w,
    hsTarget.h,
    tgtClip,
  );
  const n = part.notes[i];
  m.dist = Math.hypot(camera.position.x, camera.position.z);
  toCam.subVectors(camera.position, n.at).normalize();
  m.faceDeg = THREE.MathUtils.radToDeg(
    Math.acos(clamp(n.normal.dot(toCam), -1, 1)),
  );
  m.occluded = occluded(i);
  projectPoint(n.at, pt);
  m.valid = minW > 0.05 && pt.w > 0.05;
  if (!m.valid) {
    m.letterPx = 0;
    m.btnPx = 0;
    m.spanW = 0;
    m.ptX = m.ptY = m.ndcX = m.ndcY = 9;
    return m;
  }
  m.ptX = pt.x / pt.w;
  m.ptY = pt.y / pt.w;
  const X = [];
  const Y = [];
  let cx = 0;
  let cy = 0;
  for (let c = 0; c < 4; c++) {
    const w = tgtClip[c * 4 + 3];
    X.push(sx(tgtClip[c * 4], w));
    Y.push(sy(tgtClip[c * 4 + 1], w));
    cx += tgtClip[c * 4] / w / 4;
    cy += tgtClip[c * 4 + 1] / w / 4;
  }
  const hgt =
    (Math.hypot(X[2] - X[0], Y[2] - Y[0]) +
      Math.hypot(X[3] - X[1], Y[3] - Y[1])) /
    2;
  const wid =
    (Math.hypot(X[1] - X[0], Y[1] - Y[0]) +
      Math.hypot(X[3] - X[2], Y[3] - Y[2])) /
    2;
  const pxY = hgt / (CARD.canvasH * frac);
  const pxX = wid / CARD.canvasW;
  // letters count by the smaller of their projected height and width (a card seen at an angle)
  m.letterPx = CARD.fontPx * Math.min(pxX, pxY);
  m.btnPx = CARD.btnPx * pxY;
  m.spanW = Math.max(...X) - Math.min(...X);
  // the card and its point must fit on the screen together
  const px = sx(pt.x, pt.w);
  m.needW = Math.max(px, ...X) - Math.min(px, ...X);
  m.cornerMax = 0;
  for (let c = 0; c < 4; c++) {
    const w = tgtClip[c * 4 + 3];
    m.cornerMax = Math.max(
      m.cornerMax,
      Math.abs(tgtClip[c * 4] / w),
      Math.abs(tgtClip[c * 4 + 1] / w),
    );
  }
  m.ndcX = cx;
  m.ndcY = cy;
  return m;
}
const tgt = {};

/** Whether the card can hang beside its point; keep relaxes every limit by the hysteresis. */
function worldCheck(m, keep) {
  const h = keep ? cfg.hyst / 100 : 0;
  const edge = Math.min(0.98, EDGE * (1 + h));
  if (!m.valid || Math.abs(m.ptX) > edge || Math.abs(m.ptY) > edge) {
    return { ok: false, why: "the point is out of view", code: "out" };
  }
  if (m.needW > W * FIT * (1 + h)) {
    return {
      ok: false,
      why: `too close: the card and its point need ${Math.round(m.needW)} px`,
      code: "near",
    };
  }
  if (m.cornerMax > Math.min(1, 0.97 * (1 + h))) {
    return { ok: false, why: "the card runs off the screen", code: "out" };
  }
  if (m.faceDeg > cfg.face * (1 + h)) {
    return {
      ok: false,
      why: `the point faces away (${Math.round(m.faceDeg)} deg)`,
      code: "far",
    };
  }
  if (m.occluded) {
    return { ok: false, why: "the model hides the point", code: "far" };
  }
  if (m.letterPx < cfg.thr * (1 - h)) {
    return {
      ok: false,
      why: `letters ${m.letterPx.toFixed(1)} px, under ${cfg.thr} px`,
      code: "small",
    };
  }
  if (cfg.btns === "gate" && m.btnPx < cfg.gate * (1 - h)) {
    return {
      ok: false,
      why: `buttons ${Math.round(m.btnPx)} px, under ${cfg.gate} px`,
      code: "small",
    };
  }
  return { ok: true, why: `letters ${m.letterPx.toFixed(1)} px`, code: "" };
}

function wantPlace(m, keep) {
  whyCode = "";
  if (open < 0) {
    why = "no note open";
    return "hidden";
  }
  if (m.dist > RADIUS_M) {
    why = "outside the station circle";
    return "hidden";
  }
  let want;
  if (pulled) {
    why = "brought close";
    want = "dock";
  } else if (effectiveView() === "box") {
    why = visitorPick ? "your pick: in the box" : "the creator chose the screen";
    want = "dock";
  } else {
    const c = worldCheck(m, keep);
    why = c.why;
    whyCode = c.code;
    want = c.ok ? "plate" : "dock";
    // the card just moved to the next point: the visitor turns to follow it before it may leave
    if (!c.ok && c.code === "out" && place === "plate" && clock < followUntil) {
      why = "following the card to its next point";
      whyCode = "";
      want = "plate";
    }
  }
  if (want === "dock" && voiceOn) {
    why += "; the voice holds the box";
    return "fold";
  }
  return want;
}

// ---------- the flight ----------
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const instant = () => cfg.fly === 0 || reduceMotion;
const atRest = () => flight.f >= 1;
const endKind = (p) => (p === "fold" ? "marker" : p);
let curFrac = 1;

function startFlight(to) {
  if (atRest() && flight.to === to) {
    return;
  }
  const from = atRest()
    ? { kind: flight.to }
    : { kind: "snap", clip: Float32Array.from(clipArr), frac: curFrac };
  flight = { from, to, f: instant() ? 1 : 0 };
}

function setPlace(want) {
  const prev = place;
  place = want;
  pending = want;
  pendingFor = 0;
  if (want === "hidden") {
    return;
  }
  const to = endKind(want);
  if (prev === "hidden" && presence < 0.05) {
    flight = { from: { kind: to }, to, f: 1 };
  } else {
    startFlight(to);
  }
}

function decide(dt) {
  if (open >= 0 && !closing) {
    const keep = place === "plate" && atRest();
    const want = wantPlace(tgt, keep);
    if (want !== pending) {
      pending = want;
      pendingFor = 0;
    } else {
      pendingFor += dt;
    }
    // appearing, hiding and making room for the voice need no settling time
    const quick =
      want === "hidden" ||
      place === "hidden" ||
      place === "fold" ||
      (place === "dock" && want === "fold");
    const locked = (press && press.what === "card") || clock < releaseUntil;
    if (want !== place && (quick || pendingFor >= cfg.hold) && !locked) {
      setPlace(want);
    }
  }
  presence = reduceMotion
    ? place === "hidden"
      ? 0
      : 1
    : approach(presence, place === "hidden" ? 0 : 1, dt / 0.3);
  if (place === "hidden" && presence === 0 && open >= 0) {
    // walked out of the station: the card is gone, and so is the open note
    open = -1;
    pulled = false;
    tween = null;
  }
  if (!atRest()) {
    flight.f = instant() ? 1 : Math.min(1, flight.f + dt / cfg.fly);
  }
  if (closing && atRest()) {
    closing = false;
    open = -1;
    place = "hidden";
    presence = 0;
  }
  if (tween) {
    tween.f = instant()
      ? 1
      : Math.min(1, tween.f + dt / Math.max(0.35, cfg.fly));
    if (tween.f >= 1) {
      tween = null;
    }
  }
}

function dockRect() {
  // big enough that the buttons reach the touch gate and the text 15 px; never past the screen
  const s = Math.max(cfg.gate / CARD.btnPx, 15 / CARD.fontPx);
  let w = Math.min(CARD.canvasW * s, W - 24);
  const capH = 0.55 * H;
  if ((w * CARD.canvasH) / CARD.canvasW > capH) {
    w = (capH * CARD.canvasW) / CARD.canvasH;
  }
  const h = (w * CARD.canvasH) / CARD.canvasW;
  const bottom = W > H ? 10 : 18;
  return { x: (W - w) / 2, y: H - bottom - h, w, h };
}

// the plate's projected corners this frame, and the last ones seen on the screen
const plateClip = new Float32Array(16);
const lastPlateClip = new Float32Array(16);
let havePlate = false;
let plateOnScreen = false;
let plateKey = "";

function poseMesh() {
  if (open < 0) {
    return;
  }
  hang(open, hsMesh);
  if (tween) {
    hang(tween.from, hsFrom);
    const e = ease(tween.f);
    hsMesh.pos.lerpVectors(hsFrom.pos, hsMesh.pos, e);
    hsMesh.quat.slerpQuaternions(hsFrom.quat, hsMesh.quat, e);
  }
  part.plate.position.copy(hsMesh.pos);
  part.plate.quaternion.copy(hsMesh.quat);
  const key = `${cfg.letter}|${cfg.btns}`;
  if (key !== plateKey) {
    plateKey = key;
    part.setPlateSize(metresPerPx(), plateFrac());
  }
  const minW = projectCard(
    hsMesh.pos,
    hsMesh.quat,
    hsMesh.w,
    hsMesh.h,
    plateClip,
  );
  let cx = 0;
  let cy = 0;
  for (let c = 0; c < 4; c++) {
    cx += plateClip[c * 4] / plateClip[c * 4 + 3] / 4;
    cy += plateClip[c * 4 + 1] / plateClip[c * 4 + 3] / 4;
  }
  plateOnScreen = minW > 0.05 && Math.abs(cx) < 1 && Math.abs(cy) < 1;
  // a flight starts from where the plate was last seen, frozen there once it leaves the screen
  if (plateOnScreen) {
    lastPlateClip.set(plateClip);
    havePlate = true;
  }
}

const epA = new Float32Array(16);
const epB = new Float32Array(16);
/** Fills out with an endpoint's clip corners; returns its frac, or -frac for the screen box. */
function endpoint(ep, out) {
  const kindOf = typeof ep === "string" ? ep : ep.kind;
  if (kindOf === "snap") {
    out.set(ep.clip);
    return ep.frac;
  }
  if (kindOf === "plate") {
    const src = plateOnScreen ? plateClip : havePlate ? lastPlateClip : null;
    if (src) {
      out.set(src);
      return plateFrac();
    }
    return -1;
  }
  if (kindOf === "marker" && open >= 0) {
    projectPoint(part.notes[open].at, pt);
    if (pt.w > 0.05) {
      const hw = (22 / W) * 2 * pt.w;
      const hh = (((22 * CARD.canvasH) / CARD.canvasW) / H) * 2 * pt.w;
      for (let c = 0; c < 4; c++) {
        out[c * 4] = pt.x + (c & 1 ? hw : -hw);
        out[c * 4 + 1] = pt.y + (c < 2 ? hh : -hh);
        out[c * 4 + 2] = pt.z;
        out[c * 4 + 3] = pt.w;
      }
      return 1;
    }
  }
  return -1;
}

function layoutCard() {
  const show = open >= 0 && presence > 0;
  const rest = atRest();
  const onPlate = show && rest && flight.to === "plate";
  part.plate.visible = onPlate;
  part.plate.material.opacity = presence;
  ovMesh.visible = show && !(rest && (flight.to === "plate" || flight.to === "marker"));
  if (!ovMesh.visible) {
    curFrac = onPlate ? plateFrac() : 1;
    return;
  }
  const r = dockRect();
  const nx = (x) => (x / W) * 2 - 1;
  const ny = (y) => 1 - (y / H) * 2;
  const dock = [
    nx(r.x),
    ny(r.y),
    nx(r.x + r.w),
    ny(r.y),
    nx(r.x),
    ny(r.y + r.h),
    nx(r.x + r.w),
    ny(r.y + r.h),
  ];
  const e = rest ? 1 : ease(flight.f);
  const fa = rest ? -1 : endpoint(flight.from, epA);
  const fb = endpoint(flight.to, epB);
  const hasA = fa > 0;
  const hasB = fb > 0;
  let wRef = 1;
  if (hasA || hasB) {
    const s = hasA ? epA : epB;
    wRef = (s[3] + s[7] + s[11] + s[15]) / 4;
  }
  for (let c = 0; c < 4; c++) {
    const a = c * 4;
    for (let j = 0; j < 4; j++) {
      const dockV =
        j === 0 ? dock[c * 2] * wRef : j === 1 ? dock[c * 2 + 1] * wRef : j === 2 ? 0 : wRef;
      const va = hasA ? epA[a + j] : dockV;
      const vb = hasB ? epB[a + j] : dockV;
      clipArr[a + j] = va * (1 - e) + vb * e;
    }
  }
  clipAttr.needsUpdate = true;
  // the visible share of the card: the plate may hide the buttons, the box always shows them
  const fracA = rest ? 1 : Math.abs(fa);
  curFrac = fracA * (1 - e) + Math.abs(fb) * e;
  uvAttr.setY(2, 1 - curFrac);
  uvAttr.setY(3, 1 - curFrac);
  uvAttr.needsUpdate = true;
  // into and out of the marker the card fades over the last and first third of the flight
  let fade = 1;
  if (!rest && flight.to === "marker") {
    fade = clamp((1 - flight.f) / 0.35, 0, 1);
  } else if (!rest && flight.from.kind === "marker") {
    fade = clamp(flight.f / 0.35, 0, 1);
  }
  ovMat.uniforms.opacity.value = presence * fade;
}

/** The card's outline on the screen, in device px: TL, TR, BR, BL. */
function cardQuad() {
  const src = ovMesh.visible ? clipArr : plateClip;
  const p = (i) => ({
    x: sx(src[i * 4], src[i * 4 + 3]),
    y: sy(src[i * 4 + 1], src[i * 4 + 3]),
  });
  return [p(0), p(1), p(3), p(2)];
}
function inQuad(x, y, q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c !== 0) {
      if (sign === 0) {
        sign = Math.sign(c);
      } else if (Math.sign(c) !== sign) {
        return false;
      }
    }
  }
  return true;
}

function layoutLeader() {
  leadMesh.visible = false;
  const cardShown = part.plate.visible || ovMesh.visible;
  if (open < 0 || !cardShown || presence < 0.05) {
    return;
  }
  projectPoint(part.notes[open].at, pt);
  if (pt.w < 0.05) {
    return;
  }
  const ax = sx(pt.x, pt.w);
  const ay = sy(pt.y, pt.w);
  if (ax < 0 || ax > W || ay < 0 || ay > H) {
    return;
  }
  const q = cardQuad();
  if (inQuad(ax, ay, q)) {
    return;
  }
  let bx = 0;
  let by = 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const d = Math.hypot(mx - ax, my - ay);
    if (d < best) {
      best = d;
      bx = mx;
      by = my;
    }
  }
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 6) {
    return;
  }
  const hx = (-(by - ay) / len) * 1.5;
  const hy = ((bx - ax) / len) * 1.5;
  const corners = [
    [ax - hx, ay - hy, 0],
    [ax + hx, ay + hy, 0],
    [bx - hx, by - hy, len],
    [bx + hx, by + hy, len],
  ];
  corners.forEach(([x, y, along], c) => {
    leadArr[c * 4] = (x / W) * 2 - 1;
    leadArr[c * 4 + 1] = 1 - (y / H) * 2;
    leadArr[c * 4 + 2] = 0;
    leadArr[c * 4 + 3] = 1;
    alongAttr.setX(c, along);
  });
  leadAttr.needsUpdate = true;
  alongAttr.needsUpdate = true;
  leadMat.uniforms.dashed.value =
    hiddenBy[open] || facing[open] < 0 ? 1 : 0;
  leadMat.uniforms.opacity.value =
    0.95 * (ovMesh.visible ? ovMat.uniforms.opacity.value : presence);
  leadMesh.visible = true;
}

// ---------- the markers ----------
function layoutMarkers() {
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const inside = Math.hypot(camera.position.x, camera.position.z) <= RADIUS_M;
  part.notes.forEach((n, i) => {
    const d = camera.position.distanceTo(n.at);
    // the open note keeps its marker in sight (dimmed), so a card folded into it can be found
    const rule = noteOpacity(facing[i], hiddenBy[i]);
    const op = !inside ? 0 : i === open ? Math.max(0.45, rule) : rule;
    const state =
      i !== open ? "idle" : place === "fold" || closing ? "waiting" : "open";
    part.setMarker(i, op, state, (MARKER_PX * 2 * tanH * d) / H);
  });
}

// ---------- opening, Next, Previous, Back ----------
function openNote(i) {
  if (i === open && !closing) {
    closeNote();
    return;
  }
  if (open >= 0 && !closing) {
    switchTo(i);
    return;
  }
  open = i;
  closing = false;
  pulled = false;
  tween = null;
  camera.updateMatrixWorld();
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  poseMesh();
  measure(open, tgt);
  const want = wantPlace(tgt, false);
  place = want;
  pending = want;
  pendingFor = 0;
  if (want === "hidden") {
    return;
  }
  presence = 1;
  // the card unfolds from its marker
  flight = { from: { kind: "marker" }, to: endKind(want), f: instant() ? 1 : 0 };
}
function switchTo(i) {
  const old = open;
  open = i;
  pending = "";
  pendingFor = 0;
  if (place === "plate" && atRest()) {
    tween = { from: old, f: instant() ? 1 : 0 };
    followUntil = clock + FOLLOW_S;
  }
}
function step(d) {
  const n = part.notes.length;
  switchTo((open + d + n) % n);
}
function closeNote() {
  if (open < 0 || closing) {
    return;
  }
  closing = true;
  pulled = false;
  tween = null;
  startFlight("marker");
  if (atRest()) {
    closing = false;
    open = -1;
    place = "hidden";
    presence = 0;
  }
}
function pressButton(id) {
  pressed = id;
  pressedUntil = clock + 0.25;
  releaseUntil = clock + RELEASE_S;
  if (id === "prev") {
    step(-1);
  } else if (id === "next") {
    step(1);
  } else if (id === "back") {
    closeNote();
  }
}
function pull() {
  if (voiceOn) {
    voiceNoteUntil = clock + 2;
    return;
  }
  pulled = true;
  releaseUntil = clock + RELEASE_S;
  setPlace("dock");
}

// ---------- gestures ----------
const ndc = new THREE.Vector2();
let press = null;
let clock = 0;

function hitTest(x, y) {
  if (open >= 0 && presence > 0.5 && !closing) {
    if (ovMesh.visible) {
      if (inQuad(x, y, cardQuad())) {
        if (atRest() && flight.to === "dock") {
          const r = dockRect();
          return {
            what: "card",
            cx: ((x - r.x) / r.w) * CARD.canvasW,
            cy: ((y - r.y) / r.h) * CARD.canvasH,
          };
        }
        return { what: "card", cx: null, cy: null };
      }
    } else if (part.plate.visible) {
      ndc.set((x / W) * 2 - 1, 1 - (y / H) * 2);
      raycaster.setFromCamera(ndc, camera);
      raycaster.near = 0;
      raycaster.far = Infinity;
      const hit = raycaster.intersectObject(part.plate, false)[0];
      if (hit && hit.uv) {
        return {
          what: "card",
          cx: hit.uv.x * CARD.canvasW,
          cy: (1 - hit.uv.y) * CARD.canvasH,
        };
      }
    }
  }
  let bestI = -1;
  let best = Infinity;
  part.notes.forEach((n, i) => {
    if (!n.marker.visible || n.marker.material.opacity < 0.05) {
      return;
    }
    projectPoint(n.at, pt);
    if (pt.w < 0.05) {
      return;
    }
    const d = Math.hypot(sx(pt.x, pt.w) - x, sy(pt.y, pt.w) - y);
    if (d <= MARKER_PX + MARKER_HIT_PX && d < best) {
      best = d;
      bestI = i;
    }
  });
  if (bestI >= 0) {
    return { what: "marker", i: bestI };
  }
  return { what: "look" };
}

function pressStart(x, y, id) {
  press = { id, x, y, ...hitTest(x, y), yaw0: userYaw, moved: false };
}
function pressMove(x, y) {
  if (!press.moved && Math.hypot(x - press.x, y - press.y) > TAP_SLOP) {
    press.moved = true;
    if (press.what !== "card") {
      press.what = "look";
    }
  }
  if (press.what === "look") {
    userYaw = press.yaw0 + (x - press.x) * 0.005;
  }
}
function pressEnd(cancelled) {
  const pr = press;
  press = null;
  if (cancelled || pr.moved) {
    if (pr.what === "card") {
      releaseUntil = clock + RELEASE_S;
    }
    return;
  }
  if (pr.what === "card") {
    releaseUntil = clock + RELEASE_S;
    const b = pr.cx === null ? null : part.card.buttonAt(pr.cx, pr.cy);
    if (b && (ovMesh.visible || plateFrac() === 1)) {
      pressButton(b);
    } else if (part.plate.visible) {
      pull();
    }
  } else if (pr.what === "marker") {
    openNote(pr.i);
  }
}
canvas.addEventListener("pointerdown", (e) => {
  if (press || script) {
    return;
  }
  const p = toDevice(e);
  pressStart(p.x, p.y, e.pointerId);
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (press && e.pointerId === press.id) {
    const p = toDevice(e);
    pressMove(p.x, p.y);
  }
});
const onUp = (e) => {
  if (press && e.pointerId === press.id) {
    pressEnd(e.type === "pointercancel");
  }
};
canvas.addEventListener("pointerup", onUp);
canvas.addEventListener("pointercancel", onUp);

// ---------- painting the card (only when something changed) ----------
const lastPaint = { key: "" };
const paintStats = { n: 0, sum: 0, max: 0, total: 0 };
function tagText() {
  if (clock < voiceNoteUntil) {
    return "the voice has the box";
  }
  if (place === "plate" && cfg.btns === "pull") {
    return "tap to bring it close";
  }
  if (place === "dock" || place === "fold") {
    if (whyCode === "far") {
      return "on the far side";
    }
    if (whyCode === "out") {
      return "out of view";
    }
  }
  return "";
}
function paintCard() {
  if (open < 0) {
    return;
  }
  if (clock >= pressedUntil) {
    pressed = "";
  }
  const tag = tagText();
  const key = `${open}|${tag}|${pressed}`;
  if (key === lastPaint.key) {
    return;
  }
  lastPaint.key = key;
  const t0 = performance.now();
  part.card.paint({
    note: block.notes[open],
    index: open,
    count: block.notes.length,
    tag,
    pressed,
    buttons: true,
  });
  const dt = performance.now() - t0;
  paintStats.n++;
  paintStats.total++;
  paintStats.sum += dt;
  paintStats.max = Math.max(paintStats.max, dt);
}

// ---------- the viewer: beats move them, a sideways drag turns them (in AR the phone does) ----------
const viewer = {
  pos: new THREE.Vector3(0, 1.6, 4),
  from: null,
  to: null,
  t0: 0,
  dur: 0,
  orbit: null,
};
let userYaw = 0;
let turnCur = 0;
let turnTarget = 0;
const look = MODEL_CENTRE.clone();
const lookWant = new THREE.Vector3();
function goTo(x, z, dur) {
  viewer.orbit = null;
  const to = new THREE.Vector3(x, 1.6, z);
  if (dur <= 0 || reduceMotion) {
    viewer.pos.copy(to);
    viewer.to = null;
    return;
  }
  viewer.from = viewer.pos.clone();
  viewer.to = to;
  viewer.t0 = clock;
  viewer.dur = dur;
}
function standAt(dist, deg, dur) {
  const a = THREE.MathUtils.degToRad(deg);
  goTo(Math.sin(a) * dist, Math.cos(a) * dist, dur);
}
function updateViewer(dt) {
  if (viewer.orbit) {
    const o = viewer.orbit;
    const f = clamp((clock - o.t0) / o.dur, 0, 1);
    const a = THREE.MathUtils.degToRad(o.a0 + (o.a1 - o.a0) * f * f * (3 - 2 * f));
    viewer.pos.set(Math.sin(a) * o.r, 1.6, Math.cos(a) * o.r);
    if (f >= 1) {
      viewer.orbit = null;
    }
  } else if (viewer.to) {
    const f = clamp((clock - viewer.t0) / viewer.dur, 0, 1);
    viewer.pos.lerpVectors(viewer.from, viewer.to, f * f * (3 - 2 * f));
    if (f >= 1) {
      viewer.to = null;
    }
  }
  turnCur +=
    (turnTarget - turnCur) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 2.6));
  camera.position.copy(viewer.pos);
  // the visitor looks at what they opened: between the point and where its card hangs (in the
  // box too, so the camera does not lock the card out of the world), else at the model
  if (open >= 0 && !closing) {
    lookAtNote(open, lookWant);
  } else {
    lookWant.copy(MODEL_CENTRE);
  }
  look.lerp(lookWant, reduceMotion ? 1 : 1 - Math.exp(-dt * 3));
  const dx = look.x - viewer.pos.x;
  const dz = look.z - viewer.pos.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(look.y - viewer.pos.y, Math.max(0.5, Math.hypot(dx, dz)));
  const sway = reduceMotion ? 0 : 1;
  camera.rotation.set(
    pitch + Math.sin(clock * 0.71) * 0.005 * sway,
    yaw + userYaw + turnCur + Math.sin(clock * 0.53) * 0.01 * sway,
    0,
  );
}

/** The middle of what the visitor wants to see of note i: from its point to the card's far edge. */
function lookAtNote(i, out) {
  const at = part.notes[i].at;
  hang(i, hsTarget);
  const reach = (0.3 + hsTarget.w) / (2 * (0.3 + hsTarget.w / 2));
  out.set(
    at.x + (hsTarget.pos.x - at.x) * reach,
    (at.y + hsTarget.pos.y - hsTarget.h / 2) / 2,
    at.z + (hsTarget.pos.z - at.z) * reach,
  );
  return out;
}

// ---------- the beats ----------
let script = null;
function cancelScript() {
  if (script) {
    script.cancelled = true;
    script = null;
    fingerEl.hidden = true;
  }
}
function setTurn(on) {
  turnTarget = on ? 2.4 : 0;
  $("turnBtn").setAttribute("aria-pressed", String(on));
  $("turnBtn").textContent = on ? "Turn back" : "Turn";
}
function setVoice(on) {
  voiceOn = on;
  voiceEl.hidden = !on;
  $("voiceBtn").setAttribute("aria-pressed", String(on));
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
async function tapMarkerScripted(i, run) {
  while (viewer.to || viewer.orbit) {
    await nextFrame();
    if (run.cancelled) {
      return;
    }
  }
  projectPoint(part.notes[i].at, pt);
  const x = sx(pt.x, pt.w);
  const y = sy(pt.y, pt.w);
  fingerEl.hidden = false;
  fingerEl.style.left = `${x}px`;
  fingerEl.style.top = `${y}px`;
  const t0 = performance.now();
  while (performance.now() - t0 < 450) {
    await nextFrame();
    if (run.cancelled) {
      return;
    }
  }
  if (open !== i) {
    openNote(i);
  }
  fingerEl.hidden = true;
}
function runScript(fn) {
  const run = { cancelled: false };
  script = run;
  fn(run).finally(() => {
    if (script === run) {
      script = null;
    }
    fingerEl.hidden = true;
  });
}
function ensureOpen(i) {
  if (open !== i || closing) {
    if (closing) {
      closing = false;
      open = -1;
      place = "hidden";
      presence = 0;
    }
    openNote(i);
  }
}
function beat(name) {
  cancelScript();
  userYaw = 0;
  if (name !== "turn") {
    setTurn(false);
  }
  if (name === "walk") {
    if (open >= 0) {
      open = -1;
      place = "hidden";
      presence = 0;
      closing = false;
    }
    pulled = false;
    standAt(22, 0, 0);
    standAt(4, 0, 11);
    runScript((run) => tapMarkerScripted(1, run));
  } else if (name === "d4" || name === "d7" || name === "d11") {
    standAt(Number(name.slice(1)), 0, 1.2);
    if (open < 0) {
      runScript((run) => tapMarkerScripted(1, run));
    }
  } else if (name === "round") {
    standAt(4, 0, 0);
    ensureOpen(0);
    pulled = false;
    viewer.orbit = { r: 4, a0: 0, a1: 180, t0: clock + 0.8, dur: 9 };
  } else if (name === "pull") {
    if (open < 0) {
      ensureOpen(1);
    } else if (place === "plate") {
      pull();
    }
  } else if (name === "next") {
    if (open < 0) {
      ensureOpen(1);
    } else {
      pressButton("next");
    }
  } else if (name === "far") {
    standAt(4, 0, 0.8);
    pulled = false;
    ensureOpen(4);
  } else if (name === "turn") {
    setTurn(turnTarget === 0);
  } else if (name === "voice") {
    setVoice(!voiceOn);
  } else if (name === "back") {
    pressButton("back");
  } else if (name === "leave") {
    standAt(20, 0, 4);
  }
}
document.querySelectorAll("[data-beat]").forEach((b) => {
  b.addEventListener("click", () => beat(b.dataset.beat));
});

// ---------- the view pill (the visitor's one pick for the whole tour) and the settings ----------
function savePick() {
  try {
    if (visitorPick) {
      localStorage.setItem(PICK_KEY, visitorPick);
    } else {
      localStorage.removeItem(PICK_KEY);
    }
  } catch {
    // storage blocked: the pick lasts for this page only
  }
}
function showPill() {
  $("viewLabel").textContent =
    effectiveView() === "world" ? "in the world" : "in the box";
  $("viewPill").dataset.mine = visitorPick ? "yes" : "no";
}
$("viewPill").addEventListener("click", () => {
  visitorPick = effectiveView() === "world" ? "box" : "world";
  savePick();
  showPill();
});
$("resetPick").addEventListener("click", () => {
  visitorPick = null;
  savePick();
  showPill();
});

/**
 * Where note i's card can hang in the world with the current settings: the distances (0.5 to
 * 15 m, every 0.1 m) at which the viewer, standing on the note's facing side at eye height and
 * looking at it, sees it pass every check. keep applies the hysteresis (a card already hanging).
 */
function worldRange(i, keep = false) {
  const savedPos = camera.position.clone();
  const savedRot = camera.rotation.clone();
  const n = part.notes[i];
  const hn = new THREE.Vector3(n.normal.x, 0, n.normal.z);
  if (hn.lengthSq() < 1e-6) {
    hn.set(0, 0, 1);
  }
  hn.normalize();
  const m = {};
  let from = null;
  let to = null;
  let nearWhy = "";
  let farWhy = "";
  for (let d = 0.5; d <= 15.001; d += 0.1) {
    camera.position.set(n.at.x + hn.x * d, 1.6, n.at.z + hn.z * d);
    camera.lookAt(lookAtNote(i, lookWant));
    camera.updateMatrixWorld();
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    measure(i, m);
    const c = worldCheck(m, keep);
    if (c.ok) {
      from ??= Math.round(d * 10) / 10;
      to = Math.round(d * 10) / 10;
    } else if (from === null) {
      nearWhy = c.why;
    } else if (!farWhy) {
      farWhy = c.why;
    }
  }
  camera.position.copy(savedPos);
  camera.rotation.copy(savedRot);
  camera.updateMatrixWorld();
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return { note: n.title, from, to, nearWhy, farWhy };
}
function showRange() {
  if (!part) {
    return;
  }
  const r = worldRange(1);
  const d = dockRect();
  $("range").textContent =
    r.from === null
      ? `With these settings the ${r.note} card never hangs in the world (${r.nearWhy}).`
      : `With these settings the ${r.note} card hangs in the world from ${r.from} m to ${r.to} m, facing it (nearer: ${r.nearWhy}; farther: ${r.farWhy || "the station edge"}). The box shows text at ${((d.w / CARD.canvasW) * CARD.fontPx).toFixed(1)} px, buttons at ${Math.round((d.h / CARD.canvasH) * CARD.btnPx)} px.`;
}

function applyCfg() {
  document.querySelectorAll("[data-cfg]").forEach((b) => {
    b.classList.toggle("on", String(cfg[b.dataset.cfg]) === b.dataset.v);
  });
  showPill();
  sizeStage();
  showRange();
}
function saveCfg() {
  const q = new URLSearchParams(location.search);
  for (const [key, v] of Object.entries(cfg)) {
    q.set(key, String(v));
  }
  history.replaceState(null, "", `?${q}`);
}
function setCfg(key, v) {
  const before = cfg[key];
  cfg[key] = NUM_KEYS.includes(key) ? Number(v) : v;
  if (key === "measure" && before !== cfg.measure && part) {
    remount();
  }
  applyCfg();
  saveCfg();
}
document.querySelectorAll("[data-cfg]").forEach((b) => {
  b.addEventListener("click", () => setCfg(b.dataset.cfg, b.dataset.v));
});
$("menuBtn").addEventListener("click", () => {
  $("demo").hidden = !$("demo").hidden;
});
$("demoClose").addEventListener("click", () => {
  $("demo").hidden = true;
});
let exitNote = 0;
$("exitBtn").addEventListener("click", () => {
  exitNote = clock + 2.5;
});

// ---------- readout and cost ----------
const frameStats = { workMax: 0, workSum: 0, n: 0, over50: 0, gapMax: 0 };
let statsAt = 0;
let costAt = -1;
function partCost() {
  let draws = 0;
  let tris = 0;
  part.object.traverse((o) => {
    if (o.isMesh && o.visible) {
      draws++;
      const gm = o.geometry;
      tris += (gm.index ? gm.index.count : gm.attributes.position.count) / 3;
    }
  });
  for (const m of [ovMesh, leadMesh]) {
    if (m.visible) {
      draws++;
      tris += 2;
    }
  }
  return { draws, tris };
}
function whereNow() {
  if (open < 0 || presence === 0) {
    return "closed";
  }
  if (!atRest()) {
    return "flying";
  }
  return { plate: "in the world", dock: "in the box", marker: "folded" }[
    flight.to
  ];
}
function report(now) {
  if (now - statsAt < 250) {
    return;
  }
  statsAt = now;
  const title = open >= 0 ? block.notes[open].title : "no note open";
  readoutEl.textContent =
    clock < exitNote
      ? "Exit is not part of this prototype."
      : open < 0
        ? `${Math.hypot(camera.position.x, camera.position.z).toFixed(1)} m - no note open - tap a marker on the fountain`
        : `${tgt.dist.toFixed(1)} m - ${title} - ${Math.round(tgt.faceDeg)} deg${tgt.occluded ? ", hidden" : ""} - letters ${tgt.letterPx.toFixed(1)} px, buttons ${Math.round(tgt.btnPx)} px - ${whereNow()}: ${why}`;
  if (costAt < 0 || now - costAt >= 1000) {
    costAt = now;
    const c = partCost();
    const info = renderer.info.render;
    const d = dockRect();
    costEl.textContent =
      `Frame work avg ${(frameStats.workSum / Math.max(1, frameStats.n)).toFixed(1)} ms, max ${frameStats.workMax.toFixed(1)} ms; ` +
      `longest gap ${Math.round(frameStats.gapMax)} ms; frames over 50 ms since load: ${frameStats.over50}. ` +
      `This item: ${c.draws} draws, ${c.tris} triangles (whole frame ${info.calls} draws). ` +
      `Card repaints: ${paintStats.n} in the last second, avg ${(paintStats.sum / Math.max(1, paintStats.n)).toFixed(2)} ms, max ${paintStats.max.toFixed(2)} ms; ${paintStats.total} since load. ` +
      `Box text ${((d.w / CARD.canvasW) * CARD.fontPx).toFixed(1)} px, box buttons ${Math.round((d.h / CARD.canvasH) * CARD.btnPx)} px.`;
    frameStats.workMax = 0;
    frameStats.workSum = 0;
    frameStats.n = 0;
    frameStats.gapMax = 0;
    paintStats.n = 0;
    paintStats.sum = 0;
    paintStats.max = 0;
  }
}

// ---------- the frame loop ----------
let lastNow = performance.now();
function frame(now) {
  const gap = now - lastNow;
  const dt = Math.min(0.1, gap / 1000);
  lastNow = now;
  clock += dt;
  const t0 = performance.now();
  renderer.info.reset();

  updateViewer(dt);
  camera.updateMatrixWorld();
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  part.update({ cameraQuaternion: camera.quaternion });
  seeNotes();
  if (open >= 0) {
    measure(open, tgt);
  }
  decide(dt);
  poseMesh();
  layoutMarkers();
  paintCard();
  layoutCard();
  layoutLeader();
  scene.updateMatrixWorld();

  renderer.clear();
  renderer.render(scene, camera);
  if (ovMesh.visible || leadMesh.visible) {
    renderer.render(ovScene, ovCam);
  }
  const work = performance.now() - t0;
  if (clock > 1 && !document.hidden) {
    frameStats.workMax = Math.max(frameStats.workMax, work);
    frameStats.workSum += work;
    frameStats.n++;
    frameStats.gapMax = Math.max(frameStats.gapMax, gap);
    if (gap > 50) {
      frameStats.over50++;
    }
  }
  report(now);
  requestAnimationFrame(frame);
}

// a small check surface for the screenshots and the sweeps (not part of the design)
window.__note = {
  state: () => ({
    open,
    place,
    where: whereNow(),
    why,
    presence,
    flight: flight.f,
    W,
    H,
    metrics: { ...tgt },
    pick: effectiveView(),
    voice: voiceOn,
  }),
  beat,
  set: setCfg,
  open: openNote,
  worldRange,
  dockRect,
  sweep(notes = [0, 1, 2, 3]) {
    return notes.map((i) => ({
      ...worldRange(i),
      keepTo: worldRange(i, true).to,
    }));
  },
};

// ---------- start: 4 m in front of the fountain, the lion spout's note open beside it ----------
try {
  const res = await fetch("sample.json");
  if (!res.ok) {
    throw new Error(`sample.json: HTTP ${res.status}`);
  }
  sample = await res.json();
  mount();
  applyCfg();
  const at = params.get("at");
  if (at === "walk") {
    beat("walk");
  } else {
    const d = { d7: 7, d11: 11 }[at] ?? 4;
    viewer.pos.set(0, 1.6, d);
    updateViewer(0);
    if (at === "far") {
      openNote(4);
    } else if (at === "round") {
      beat("round");
    } else {
      openNote(1);
    }
  }
  requestAnimationFrame(frame);
} catch (err) {
  readoutEl.textContent = `Could not load the sample (${err.message}).`;
}
