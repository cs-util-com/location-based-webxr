// Travelling surface, round 1, prototype E - the pin opens in place. Throwaway prototype: not
// wired to the app, linked from nothing in it.
//
// A pin's tag is one card. A tap on the tag unfolds the description under the caption, on the
// same card, in the world. When the open card cannot be read (too small, out of view, seen too
// far from the side) the same texture flies to the screen and flies back when it can be read
// again; closing it (a tap anywhere else, or leaving the station) flies it home and folds it.
// Exactly one copy is drawn at any moment, and only one pin is open at a time.
import * as THREE from "three";
import * as kind from "./kind.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const approach = (v, target, step) =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const { CARD } = kind;

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
const NUMERIC = [
  "thr",
  "desc",
  "read",
  "fly",
  "hold",
  "hyst",
  "angle",
  "touch",
  "fs",
];
const cfg = {
  thr: pickNum("thr", [10, 12, 14, 16], 12),
  desc: pickNum("desc", [0.62, 0.8, 1], 0.62),
  read: pickNum("read", [4, 8, 15], 4),
  away: pick("away", ["dock", "edge"], "dock"),
  fly: pickNum("fly", [0, 0.35, 0.6, 1.2], 0.6),
  hold: pickNum("hold", [0.15, 0.3, 0.6, 1], 0.3),
  hyst: pickNum("hyst", [5, 10, 15], 5),
  angle: pickNum("angle", [35, 45, 60], 60),
  turn: pick("turn", ["on", "off"], "on"),
  touch: pickNum("touch", [0, 8, 16, 24], 16),
  fs: pickNum("fs", [14, 16, 18], 16),
  text: pick("text", ["normal", "longest"], "normal"),
  stage: pick("stage", ["auto", "portrait", "landscape"], "auto"),
  creator: pick("creator", ["pin", "screen"], "pin"),
};

const RADIUS_M = 20; // the station circle around the first pin
const UNFOLD_S = 0.25; // the description unfolds under the caption in this time
const LOCK_AFTER_S = 0.6; // after a finger lifts, nothing moves for this long
const TAP_SLOP = 8;
const PICK_KEY = "tour-words-pick"; // one pick for the whole tour, shared with the other pages

const stageEl = $("stage");
const device = $("device");
const canvas = $("cam");
const readoutEl = $("readout");
const costEl = $("cost");
const tableEl = $("table");
const fingerEl = $("finger");
const arrowEl = $("edgeArrow");
const voiceEl = $("voicebox");

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

// ---------- the overlay: a card's own texture, drawn in screen space while it is away ----------
// Each corner carries a clip-space position, so a corner flying from the card's projected corner
// to the screen place keeps the texture mapped in perspective all the way.
const ovScene = new THREE.Scene();
const ovCam = new THREE.Camera();
function makeOverlay() {
  const clipArr = new Float32Array(16);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(12), 3),
  );
  const clipAttr = new THREE.BufferAttribute(clipArr, 4);
  geo.setAttribute("clipPos", clipAttr);
  geo.setAttribute(
    "uv",
    new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2),
  );
  geo.setIndex([0, 2, 1, 2, 3, 1]);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, opacity: { value: 1 } },
    vertexShader:
      "attribute vec4 clipPos;\nvarying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = clipPos;\n}",
    fragmentShader:
      "uniform sampler2D map;\nuniform float opacity;\nvarying vec2 vUv;\nvoid main() {\n  vec4 c = texture2D(map, vUv);\n  gl_FragColor = vec4(c.rgb, c.a * opacity);\n  #include <colorspace_fragment>\n}",
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  ovScene.add(mesh);
  return { mesh, mat, clipArr, clipAttr };
}

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
  const vb = voiceRect();
  voiceEl.style.width = `${vb.w}px`;
  voiceEl.style.height = `${vb.h}px`;
  voiceEl.style.bottom = `${H - vb.y - vb.h}px`;
  showTable();
}
addEventListener("resize", sizeStage);
desktopMq.addEventListener("change", sizeStage);
function toDevice(e) {
  const r = device.getBoundingClientRect();
  return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
}

// ---------- the pins ----------
const env = { mode: "play", canvasTexture, descEm: cfg.desc };
let sample = null;
let pins = [];

function mountPins() {
  for (const p of pins) {
    p.part.dispose();
    ovScene.remove(p.ov.mesh);
    p.ov.mesh.geometry.dispose();
    p.ov.mat.dispose();
  }
  env.descEm = cfg.desc;
  const names = [cfg.text === "longest" ? "longest" : "a", "b"];
  pins = names.map((name, i) => {
    const r = kind.read(sample.records[name]);
    r.block.readAtM = cfg.read;
    const part = kind.world(r.block, env);
    scene.add(part.object);
    const ov = makeOverlay();
    ov.mat.uniforms.map.value = part.card.texture;
    return {
      id: i === 0 ? "a" : "b",
      block: r.block,
      part,
      ov,
      open: false,
      openF: 0,
      place: "hidden",
      pending: "",
      pendingFor: 0,
      why: "",
      u: 0,
      uTarget: 0,
      presence: 0,
      rect: null,
      ringAt: -9,
      clip: new Float32Array(16),
      lastClip: new Float32Array(16),
      haveClip: false,
      mt: {
        valid: false,
        onScreen: false,
        ndcX: 0,
        ndcY: 0,
        letterPx: 0,
        headPx: 0,
        pxV: 0,
        angle: 0,
        dist: 0,
        head: { x: 0, y: 0, w: 1, behind: false },
      },
      paintKey: "",
    };
  });
}

// ---------- measuring a card on the screen ----------
const pv = new THREE.Matrix4();
const v4 = new THREE.Vector4();
const nrm = new THREE.Vector3();
const toCam = new THREE.Vector3();
const cardPos = new THREE.Vector3();
const tmp4 = [0, 0, 0, 0];

function projectLocal(x, y, m, out, at) {
  v4.set(x, y, 0, 1).applyMatrix4(m).applyMatrix4(pv);
  out[at] = v4.x;
  out[at + 1] = v4.y;
  out[at + 2] = v4.z;
  out[at + 3] = v4.w;
  return v4.w;
}
const sx = (x, w) => (x / w / 2 + 0.5) * W;
const sy = (y, w) => (0.5 - y / w / 2) * H;
/** A canvas point of a card, projected to device px (w <= 0 when behind the eye). */
function canvasToScreen(p, cx, cy) {
  const { card, m } = p.part;
  const w = projectLocal(
    (cx - card.W / 2) * m.mPerPx,
    (card.H / 2 - cy) * m.mPerPx,
    p.part.plate.matrixWorld,
    tmp4,
    0,
  );
  return { x: sx(tmp4[0], w), y: sy(tmp4[1], w), w, nx: tmp4[0], ny: tmp4[1] };
}

function measure(p) {
  const { card, m } = p.part;
  const mtx = p.part.plate.matrixWorld;
  const hw = (card.W * m.mPerPx) / 2;
  const hh = (card.H * m.mPerPx) / 2;
  let ok = true;
  [
    [-hw, hh],
    [hw, hh],
    [-hw, -hh],
    [hw, -hh],
  ].forEach(([x, y], i) => {
    if (projectLocal(x, y, mtx, p.clip, i * 4) < 0.05) {
      ok = false;
    }
  });
  const mt = p.mt;
  // the open card's middle decides "in view"; a folded tag's middle is its caption
  const shape = card.shape(p.open ? 1 : 0);
  const mid = canvasToScreen(p, card.W / 2, shape.y + shape.h / 2);
  mt.ndcX = mid.nx / Math.max(1e-4, Math.abs(mid.w));
  mt.ndcY = mid.ny / Math.max(1e-4, Math.abs(mid.w));
  mt.valid = ok && mid.w > 0.05;
  const head = canvasToScreen(p, card.W / 2, 3 + card.headH / 2);
  mt.head = {
    x: head.x,
    y: head.y,
    nx: head.nx / Math.max(1e-4, Math.abs(head.w)),
    ny: head.ny / Math.max(1e-4, Math.abs(head.w)),
    behind: head.w <= 0.05,
  };
  if (mt.valid) {
    // the letters are judged by the smaller of their height and width on the screen, so a card
    // seen from the side counts as small as it looks
    const t = canvasToScreen(p, card.W / 2, 0);
    const b = canvasToScreen(p, card.W / 2, card.H);
    const l = canvasToScreen(p, 0, card.H / 2);
    const r = canvasToScreen(p, card.W, card.H / 2);
    const pxV = Math.abs(t.y - b.y) / card.H;
    const pxH = Math.hypot(r.x - l.x, r.y - l.y) / card.W;
    mt.pxV = pxV;
    mt.letterPx = Math.min(pxV, pxH) * CARD.descPx;
    mt.headPx = pxV * card.headH;
  } else {
    mt.letterPx = 0;
    mt.headPx = 0;
  }
  cardPos.setFromMatrixPosition(mtx);
  nrm.set(0, 0, 1).transformDirection(mtx);
  nrm.y = 0;
  toCam.subVectors(camera.position, cardPos);
  toCam.y = 0;
  mt.angle = THREE.MathUtils.radToDeg(nrm.angleTo(toCam));
  mt.onScreen = mt.valid && Math.abs(mt.ndcX) < 1 && Math.abs(mt.ndcY) < 1;
  if (mt.onScreen) {
    p.lastClip.set(p.clip);
    p.haveClip = true;
  }
  mt.dist = Math.hypot(
    camera.position.x - p.part.object.position.x,
    camera.position.z - p.part.object.position.z,
  );
}

// ---------- where a card is: under its pin, on the screen, folded, or nowhere ----------
let voiceOn = false;
let stationIn = false;
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
  visitorPick ?? (cfg.creator === "pin" ? "world" : "box");
const screenish = (pl) => pl === "dock" || pl === "edge" || pl === "over";

function worldReason(p) {
  const mt = p.mt;
  const keep = p.place === "plate" && p.u === 0 && p.openF >= 1;
  const edge = keep ? 0.95 : 0.88;
  if (
    !mt.valid ||
    Math.abs(mt.ndcX) > edge ||
    Math.abs(mt.ndcY) > edge
  ) {
    return { ok: false, inView: false, why: "the pin is out of view" };
  }
  if (cfg.turn === "off" && mt.angle > cfg.angle) {
    return {
      ok: false,
      inView: true,
      why: `seen ${Math.round(mt.angle)} deg from the side`,
    };
  }
  const need = cfg.thr * (keep ? 1 - cfg.hyst / 100 : 1);
  if (mt.letterPx < need) {
    return {
      ok: false,
      inView: true,
      why: `letters ${mt.letterPx.toFixed(1)} px, under ${cfg.thr} px`,
    };
  }
  return { ok: true, inView: true, why: `letters ${mt.letterPx.toFixed(1)} px` };
}

function wantPlace(p) {
  if (!stationIn) {
    return { place: "hidden", why: "outside the station" };
  }
  if (!p.open) {
    return { place: "plate", why: "closed: the tag shows the caption" };
  }
  const w = worldReason(p);
  let place = "plate";
  let why = w.why;
  const view = effectiveView();
  if (view === "box") {
    place = cfg.away === "edge" && !w.inView ? "edge" : "dock";
    why = visitorPick ? "your pick: in the box" : "the creator chose the screen";
  } else if (!w.ok && !visitorPick) {
    place = cfg.away === "dock" ? "dock" : w.inView ? "over" : "edge";
  } else if (!w.ok) {
    why = `your pick: in the world (${w.why})`;
  }
  // the voice owns the bottom-centre dock: a silent card stays in the world if it can be read
  // there, otherwise it folds back into its tag until the dock is free
  if (place === "dock" && voiceOn) {
    place = w.ok ? "plate" : "fold";
    why = `a voice holds the box (${w.why})`;
  }
  // one card on the screen at a time: another card still away keeps the screen
  if (screenish(place) && pins.some((q) => q !== p && q.u > 0)) {
    place = w.ok ? "plate" : "fold";
    why = "another card is still on the screen";
  }
  return { place, why };
}

let press = null;
let lockUntil = 0;
let clock = 0;

function decide(p, dt) {
  const want = wantPlace(p);
  p.why = want.why;
  if (want.place !== p.pending) {
    p.pending = want.place;
    p.pendingFor = 0;
  } else {
    p.pendingFor += dt;
  }
  // appearing, hiding and closing need no settling; a finger on the screen holds every card
  const quick = want.place === "hidden" || p.place === "hidden" || !p.open;
  let may = quick || p.pendingFor >= cfg.hold;
  if (screenish(want.place) && p.u === 0 && p.openF < 1 && p.place !== "fold") {
    may = false; // the description unfolds where it was tapped before it travels
  }
  const locked = !p.open ? false : press !== null || clock < lockUntil;
  if (want.place !== p.place && may && !locked) {
    const appearing = p.place === "hidden" || p.presence === 0;
    p.place = want.place;
    if (want.place !== "hidden") {
      p.uTarget = screenish(want.place) ? 1 : 0;
      if (appearing) {
        p.u = p.uTarget;
      }
    }
  }
  if (cfg.fly === 0 || reduceMotion) {
    p.u = p.uTarget;
  } else {
    p.u = approach(p.u, p.uTarget, dt / cfg.fly);
  }
  // a card folds only once it is home under its pin
  const fTarget = p.open && p.place !== "fold" ? 1 : p.u === 0 ? 0 : p.openF;
  p.openF = reduceMotion ? fTarget : approach(p.openF, fTarget, dt / UNFOLD_S);
  p.presence = reduceMotion
    ? Number(p.place !== "hidden")
    : approach(p.presence, p.place === "hidden" ? 0 : 1, dt / 0.3);
  if (screenish(p.place)) {
    const target = rectFor(p, p.place);
    if (!p.rect || p.u < 1 || reduceMotion) {
      p.rect = target;
    } else {
      const f = 1 - Math.exp(-dt * 10);
      for (const key of ["x", "y", "w", "h"]) {
        p.rect[key] += (target[key] - p.rect[key]) * f;
      }
    }
  }
}

// ---------- the screen places ----------
/**
 * The direction from the screen's middle toward a pin, in device px (y down). The head's nx, ny
 * are divided by |w|, so nx keeps the right side even for a pin behind the viewer.
 */
function towardPin(p) {
  const hd = p.mt.head;
  if (hd.behind) {
    // behind the viewer only the side to turn to means anything
    return { dx: hd.nx < 0 ? -1 : 1, dy: 0 };
  }
  const dx = hd.nx;
  const dy = -hd.ny;
  const len = Math.hypot(dx, dy);
  return len < 1e-3 ? { dx: 1, dy: 0 } : { dx: dx / len, dy: dy / len };
}
function cardSize(p) {
  const { card } = p.part;
  const w = Math.min((card.W * cfg.fs) / CARD.descPx, 0.86 * W, 560);
  return { w, h: (w * card.H) / card.W };
}
function voiceRect() {
  const w = Math.min(17 * 16, 0.8 * W, 720);
  const h = W > H ? 96 : 112;
  return { x: (W - w) / 2, y: H - (W > H ? 10 : 18) - h, w, h };
}
function insets() {
  const top = W > H ? 132 : 150;
  const bottom = voiceOn ? voiceRect().y - 8 : H - 12;
  const side = cfg.away === "edge" ? 26 : 8; // room for the arrow beside an edge card
  return { left: side, right: W - side, top, bottom };
}
function clampRect(r) {
  const s = insets();
  r.x = clamp(r.x, s.left, Math.max(s.left, s.right - r.w));
  r.y = clamp(r.y, s.top, Math.max(s.top, s.bottom - r.h));
  return r;
}
function rectFor(p, place) {
  const { w, h } = cardSize(p);
  if (place === "dock") {
    const bottom = W > H ? 10 : 18;
    return { x: (W - w) / 2, y: H - bottom - h, w, h };
  }
  const hd = p.mt.head;
  if (place === "over" && !hd.behind) {
    // as the app's edge hint: the card at a size that reads, standing over its pin
    return clampRect({ x: hd.x - w / 2, y: hd.y - 30, w, h });
  }
  // at the screen's edge on the pin's side
  const { dx, dy } = towardPin(p);
  const s = insets();
  const cx = W / 2;
  const cy = (s.top + s.bottom) / 2;
  const ax = (s.right - s.left - w) / 2;
  const ay = (s.bottom - s.top - h) / 2;
  const scale = 1 / Math.max(Math.abs(dx) / Math.max(1, ax), Math.abs(dy) / Math.max(1, ay));
  return clampRect({
    x: cx + dx * scale - w / 2,
    y: cy + dy * scale - h / 2,
    w,
    h,
  });
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
function layout(p) {
  const showPlate = p.presence > 0 && p.u === 0;
  const showOv = p.presence > 0 && p.u > 0 && p.rect !== null;
  p.part.plate.visible = showPlate;
  p.part.plate.material.opacity = p.presence;
  p.part.dot.visible = p.presence > 0 && p.u > 0;
  p.ov.mesh.visible = showOv;
  if (!showOv) {
    return;
  }
  p.ov.mat.uniforms.opacity.value = p.presence;
  const r = p.rect;
  const nx = (x) => (x / W) * 2 - 1;
  const ny = (y) => 1 - (y / H) * 2;
  const dst = [
    nx(r.x),
    ny(r.y),
    nx(r.x + r.w),
    ny(r.y),
    nx(r.x),
    ny(r.y + r.h),
    nx(r.x + r.w),
    ny(r.y + r.h),
  ];
  const src = p.mt.onScreen ? p.clip : p.haveClip ? p.lastClip : null;
  const e = src ? ease(p.u) : 1;
  const wRef = src ? (src[3] + src[7] + src[11] + src[15]) / 4 : 1;
  const out = p.ov.clipArr;
  for (let i = 0; i < 4; i++) {
    const a = i * 4;
    out[a] = src ? src[a] * (1 - e) + dst[i * 2] * wRef * e : dst[i * 2];
    out[a + 1] = src
      ? src[a + 1] * (1 - e) + dst[i * 2 + 1] * wRef * e
      : dst[i * 2 + 1];
    out[a + 2] = src ? src[a + 2] * (1 - e) : 0;
    out[a + 3] = src ? src[a + 3] * (1 - e) + wRef * e : 1;
  }
  p.ov.clipAttr.needsUpdate = true;
}

function showArrow() {
  const p = pins.find((q) => q.place === "edge" && q.u === 1 && q.presence > 0.5);
  if (!p || !p.rect) {
    arrowEl.hidden = true;
    return;
  }
  const c = { x: p.rect.x + p.rect.w / 2, y: p.rect.y + p.rect.h / 2 };
  const { dx, dy } = towardPin(p);
  const reach = Math.min(
    Math.abs(dx) > 1e-3 ? p.rect.w / 2 / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-3 ? p.rect.h / 2 / Math.abs(dy) : Infinity,
  );
  arrowEl.hidden = false;
  arrowEl.style.left = `${c.x + dx * (reach + 12)}px`;
  arrowEl.style.top = `${c.y + dy * (reach + 12)}px`;
  arrowEl.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(dy, dx)}rad)`;
}

/** A card's outline on the screen, in device px: TL, TR, BR, BL. */
function overlayQuad(p) {
  const src = p.ov.clipArr;
  const pt = (i) => ({
    x: sx(src[i * 4], src[i * 4 + 3]),
    y: sy(src[i * 4 + 1], src[i * 4 + 3]),
  });
  return [pt(0), pt(1), pt(3), pt(2)];
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
/** The tag or card under its pin, as a box on the screen at its current fold. */
function worldBox(p) {
  const s = p.part.card.shape(p.openF);
  const pts = [
    canvasToScreen(p, s.x, s.y),
    canvasToScreen(p, s.x + s.w, s.y),
    canvasToScreen(p, s.x, s.y + s.h),
    canvasToScreen(p, s.x + s.w, s.y + s.h),
  ];
  if (pts.some((q) => q.w <= 0.05)) {
    return null;
  }
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
}

// ---------- taps: a tag opens, anything else closes ----------
function hitTest(x, y) {
  for (const p of pins) {
    if (p.presence > 0.5 && p.u > 0 && p.ov.mesh.visible) {
      if (inQuad(x, y, overlayQuad(p))) {
        return { what: "card", p };
      }
    }
  }
  let best = null;
  for (const p of pins) {
    if (p.presence <= 0.5 || p.u > 0 || !p.mt.valid) {
      continue;
    }
    const b = worldBox(p);
    if (!b) {
      continue;
    }
    const r = cfg.touch;
    if (x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r) {
      const d = Math.hypot(x - (b.x0 + b.x1) / 2, y - (b.y0 + b.y1) / 2);
      if (!best || d < best.d) {
        best = { p, d };
      }
    }
  }
  if (best) {
    return { what: best.p.open ? "card" : "tag", p: best.p };
  }
  for (const p of pins) {
    if (p.u > 0 && p.part.dot.visible && !p.mt.head.behind) {
      const top = canvasToScreen(p, p.part.card.W / 2, p.part.tipPx);
      if (top.w > 0.05 && Math.hypot(x - top.x, y - top.y) < 22 + cfg.touch) {
        return { what: "dot", p };
      }
    }
  }
  return { what: "look" };
}

function pressStart(x, y, id) {
  press = { id, x, y, ...hitTest(x, y), yaw0: userYaw, moved: false };
}
function pressMove(x, y) {
  if (!press) {
    return;
  }
  const dx = x - press.x;
  if (!press.moved && Math.hypot(dx, y - press.y) > TAP_SLOP) {
    press.moved = true;
  }
  if (press.moved) {
    // a drag anywhere turns the view (in AR the phone does); it is never a tap
    userYaw = press.yaw0 + dx * 0.005;
  }
}
function pressEnd(x, y, cancelled) {
  const pr = press;
  press = null;
  if (!pr) {
    return;
  }
  lockUntil = clock + LOCK_AFTER_S;
  if (cancelled || pr.moved) {
    return;
  }
  if (pr.what === "tag" && pr.p) {
    openPin(pr.p, x, y);
  } else if (pr.what === "dot" && pr.p) {
    pr.p.ringAt = clock;
  } else if (pr.what === "look") {
    closeAll();
  }
  // a tap on the open card itself does nothing: it is there to be read
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
    const p = toDevice(e);
    pressEnd(p.x, p.y, e.type === "pointercancel");
  }
};
canvas.addEventListener("pointerup", onUp);
canvas.addEventListener("pointercancel", onUp);

function openPin(p, x, y) {
  if (!p.part.card.canOpen) {
    p.ringAt = clock; // a pin without a description has nothing to open
    return;
  }
  for (const q of pins) {
    if (q !== p) {
      q.open = false;
    }
  }
  p.open = true;
  tapMark(x, y);
}
function closeAll() {
  for (const p of pins) {
    p.open = false;
  }
}
function tapMark(x, y) {
  const fx = document.createElement("div");
  fx.className = "tapfx";
  fx.style.left = `${x}px`;
  fx.style.top = `${y}px`;
  device.append(fx);
  fx.addEventListener("animationend", () => fx.remove());
  setTimeout(() => fx.remove(), 1500);
}

// ---------- painting a card (only when something changed) ----------
const paintStats = { total: 0, sum: 0, max: 0 };
function paintCard(p) {
  if (p.presence === 0 && p.paintKey) {
    return;
  }
  const ring = clamp(1 - (clock - p.ringAt) / 0.8, 0, 1);
  const hint = "Tap anywhere else to close";
  const key = `${p.openF.toFixed(3)}|${ring.toFixed(2)}`;
  if (key === p.paintKey) {
    return;
  }
  p.paintKey = key;
  const t0 = performance.now();
  p.part.card.paint({ open: p.openF, ring, hint });
  const dt = performance.now() - t0;
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
};
let userYaw = 0;
let turnCur = 0;
let turnTarget = 0;
function goTo(x, z, dur) {
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
  if (viewer.to) {
    const f = clamp((clock - viewer.t0) / viewer.dur, 0, 1);
    viewer.pos.lerpVectors(viewer.from, viewer.to, f * f * (3 - 2 * f));
    if (f >= 1) {
      viewer.to = null;
    }
  }
  turnCur +=
    (turnTarget - turnCur) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 2.6));
  camera.position.copy(viewer.pos);
  const lookH = pins.length ? pins[0].part.m.liftM : 2;
  const yaw = Math.atan2(viewer.pos.x, viewer.pos.z);
  const pitch = Math.atan2(
    lookH - viewer.pos.y,
    Math.max(0.5, Math.hypot(viewer.pos.x, viewer.pos.z)),
  );
  const sway = reduceMotion ? 0 : 1;
  camera.rotation.y = yaw + userYaw + turnCur + Math.sin(clock * 0.53) * 0.01 * sway;
  camera.rotation.x = pitch + Math.sin(clock * 0.71) * 0.005 * sway;
}

// ---------- the beats ----------
let script = null; // a scripted tap, while it runs
function cancelScript() {
  if (!script) {
    return;
  }
  script.cancelled = true;
  for (const id of script.timers) {
    clearTimeout(id);
  }
  script = null;
  fingerEl.hidden = true;
  if (press && press.id === "script") {
    pressEnd(press.x, press.y, true);
  }
}
const wait = (ms, run) =>
  new Promise((resolve) => {
    const id = setTimeout(() => {
      run.timers.delete(id);
      if (!run.cancelled) {
        resolve();
      }
    }, ms);
    run.timers.add(id);
  });
function setTurn(on) {
  turnTarget = on ? 2.4 : 0;
  $("turnBtn").setAttribute("aria-pressed", String(on));
  $("turnBtn").textContent = on ? "Turn back" : "Turn away";
}
function setVoice(on) {
  voiceOn = on;
  voiceEl.hidden = !on;
  $("voiceBtn").setAttribute("aria-pressed", String(on));
}
/** A finger taps a screen point that is read when it is needed (null: nothing to tap). */
async function scriptedTap(where, before = 0) {
  cancelScript();
  const run = { cancelled: false, timers: new Set() };
  script = run;
  if (before > 0) {
    await wait(before, run);
  }
  const pt = where();
  if (!pt) {
    note = { text: "That pin is not in view.", until: clock + 2.5 };
  } else {
    fingerEl.hidden = false;
    fingerEl.style.left = `${pt.x}px`;
    fingerEl.style.top = `${pt.y}px`;
    await wait(380, run);
    const p2 = where() ?? pt;
    pressStart(p2.x, p2.y, "script");
    await wait(90, run);
    pressEnd(p2.x, p2.y, false);
    await wait(420, run);
  }
  if (script === run) {
    script = null;
    fingerEl.hidden = true;
  }
}
function tagPoint(i) {
  const p = pins[i];
  if (!p || p.u > 0 || !p.mt.valid) {
    return null;
  }
  const b = worldBox(p);
  if (!b) {
    return null;
  }
  const x = (b.x0 + b.x1) / 2;
  const y = (b.y0 + Math.min(b.y1, b.y0 + p.mt.headPx)) / 2;
  return x > 0 && x < W && y > 0 && y < H ? { x, y } : null;
}
function emptyPoint() {
  // the sky above the square: nothing is there to tap
  return { x: W * 0.5, y: insets().top + 24 };
}
function beat(name) {
  cancelScript();
  userYaw = 0;
  if (name !== "turn") {
    setTurn(false);
  }
  const inStation = Math.hypot(viewer.pos.x, viewer.pos.z) <= RADIUS_M;
  if (name === "walk") {
    closeAll();
    standAt(30, 0, 0);
    standAt(4, 0, 12);
  } else if (name === "tap") {
    if (!inStation || viewer.to) {
      standAt(4, 0, 0);
    }
    scriptedTap(() => tagPoint(0), 250);
  } else if (/^d\d+$/.test(name)) {
    standAt(Number(name.slice(1)), 0, 1.4);
  } else if (name === "side") {
    standAt(4, 65, 1.6);
  } else if (name === "turn") {
    setTurn(turnTarget === 0);
  } else if (name === "other") {
    if (!inStation || viewer.to) {
      standAt(4, 0, 0);
    }
    scriptedTap(() => tagPoint(1), 250);
  } else if (name === "voice") {
    setVoice(!voiceOn);
  } else if (name === "away") {
    scriptedTap(emptyPoint, 0);
  } else if (name === "leave") {
    standAt(28, 0, 3);
  }
}
document.querySelectorAll("[data-beat]").forEach((b) => {
  b.addEventListener("click", () => beat(b.dataset.beat));
});

// ---------- the tour pill (the visitor's one pick) and the settings ----------
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
function showTable() {
  if (!pins.length) {
    return;
  }
  // standing straight in front, the screen shows pxPerM1 / d device px per metre at d metres
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const pxPerM1 = H / (2 * Math.tan(vfov / 2));
  const m = kind.measures(cfg.read, cfg.desc);
  const reads = [10, 12, 14, 16]
    .map((t) => `${((pxPerM1 * m.descM) / t).toFixed(1)} m at ${t} px`)
    .join(", ");
  const headM = pins[0].part.card.headH * m.mPerPx;
  const tag = [48, 44]
    .map((t) => `${((pxPerM1 * headM) / t).toFixed(1)} m for ${t} px`)
    .join(", ");
  tableEl.textContent =
    `Pin read from ${cfg.read} m, description ${cfg.desc} of the caption (${(m.descM * 100).toFixed(1)} cm letters), phone ${W > H ? "sideways" : "upright"}: ` +
    `the open card reads under its pin out to ${reads}. ` +
    `The folded tag is ${(headM * 100).toFixed(0)} cm tall: ${tag}; the touch radius adds ${cfg.touch} px on each side.`;
}
function applyCfg() {
  document.querySelectorAll("[data-cfg]").forEach((b) => {
    b.classList.toggle("on", String(cfg[b.dataset.cfg]) === b.dataset.v);
  });
  showPill();
  sizeStage();
}
function saveCfg() {
  const q = new URLSearchParams(location.search);
  for (const [key, v] of Object.entries(cfg)) {
    q.set(key, String(v));
  }
  history.replaceState(null, "", `?${q}`);
}
document.querySelectorAll("[data-cfg]").forEach((b) => {
  b.addEventListener("click", () => {
    const key = b.dataset.cfg;
    const before = cfg[key];
    cfg[key] = NUMERIC.includes(key) ? Number(b.dataset.v) : b.dataset.v;
    if (
      ["desc", "read", "text"].includes(key) &&
      before !== cfg[key] &&
      sample
    ) {
      const open = pins.findIndex((p) => p.open);
      mountPins();
      if (open >= 0 && pins[open]) {
        pins[open].open = true;
      }
    }
    applyCfg();
    saveCfg();
  });
});
$("menuBtn").addEventListener("click", () => {
  $("demo").hidden = !$("demo").hidden;
});
$("demoClose").addEventListener("click", () => {
  $("demo").hidden = true;
});
let note = { text: "", until: 0 };
$("exitBtn").addEventListener("click", () => {
  note = { text: "Exit is not part of this prototype.", until: clock + 2.5 };
});

// ---------- readout and cost ----------
const frameStats = { workMax: 0, workSum: 0, n: 0, over50: 0, gapMax: 0 };
let statsAt = 0;
let costAt = -1;
function itemCost() {
  let draws = 0;
  let tris = 0;
  for (const p of pins) {
    p.part.object.traverse((o) => {
      if (o.isMesh && o.visible && o.parent && o.parent.visible !== false) {
        draws++;
        const gm = o.geometry;
        tris += (gm.index ? gm.index.count : gm.attributes.position.count) / 3;
      }
    });
    if (p.ov.mesh.visible) {
      draws++;
      tris += 2;
    }
  }
  return { draws, tris };
}
function whereOf(p) {
  if (p.presence === 0) {
    return "hidden";
  }
  if (p.u > 0 && p.u < 1) {
    return "flying";
  }
  if (p.u === 1) {
    return { dock: "in the box", edge: "at the edge", over: "over the pin" }[
      p.place
    ] ?? "on the screen";
  }
  if (p.place === "fold") {
    return p.openF > 0 ? "folding, the box is taken" : "folded, the box is taken";
  }
  if (!p.open) {
    return p.openF > 0 ? "folding" : "folded tag";
  }
  return p.openF < 1 ? "unfolding" : "open under the pin";
}
function report(now) {
  if (now - statsAt < 250 || !pins.length) {
    return;
  }
  const p = pins.find((q) => q.open) ?? pins.find((q) => q.u > 0) ?? pins[0];
  readoutEl.textContent =
    clock < note.until
      ? note.text
      : `${p.mt.dist.toFixed(1)} m, ${Math.round(p.mt.angle)} deg - pin ${p.id.toUpperCase()}: ${whereOf(p)}\n` +
        `description ${p.mt.letterPx.toFixed(1)} px (from ${cfg.thr}) - tag ${p.mt.headPx.toFixed(0)} px tall\n` +
        `${p.why}`;
  if (costAt < 0 || now - costAt >= 1000) {
    costAt = now;
    const c = itemCost();
    const info = renderer.info.render;
    const boxFont = (cardSize(p).w / p.part.card.W) * CARD.descPx;
    costEl.textContent =
      `Frame work avg ${(frameStats.workSum / Math.max(1, frameStats.n)).toFixed(1)} ms, max ${frameStats.workMax.toFixed(1)} ms; ` +
      `longest gap ${Math.round(frameStats.gapMax)} ms; frames over 50 ms since load: ${frameStats.over50}. ` +
      `The two pins: ${c.draws} draws, ${c.tris} triangles (whole frame ${info.calls} draws). ` +
      `Card repaints since load: ${paintStats.total}, avg ${(paintStats.sum / Math.max(1, paintStats.total)).toFixed(2)} ms, max ${paintStats.max.toFixed(2)} ms. ` +
      `Box text ${boxFont.toFixed(1)} px.`;
    frameStats.workMax = 0;
    frameStats.workSum = 0;
    frameStats.n = 0;
    frameStats.gapMax = 0;
  }
  statsAt = now;
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
  const turns = cfg.turn === "on";
  for (const p of pins) {
    p.part.update({ viewer: camera.position, turns });
  }
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  // the station: leaving it closes every card; coming back opens nothing by itself
  const wasIn = stationIn;
  stationIn = Math.hypot(viewer.pos.x, viewer.pos.z) <= RADIUS_M;
  if (wasIn && !stationIn) {
    closeAll();
  }
  for (const p of pins) {
    measure(p);
    decide(p, dt);
    p.part.setFade(p.presence);
    paintCard(p);
    layout(p);
  }
  showArrow();

  renderer.clear();
  renderer.render(scene, camera);
  if (pins.some((p) => p.ov.mesh.visible)) {
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

// ---------- start: 4 m in front of the first pin, both tags folded ----------
applyCfg();
try {
  const res = await fetch("sample.json");
  if (!res.ok) {
    throw new Error(`sample.json: HTTP ${res.status}`);
  }
  sample = await res.json();
  mountPins();
  showTable();
  const at = params.get("at");
  const spots = { d2: [2, 0], d4: [4, 0], d8: [8, 0], d15: [15, 0], side: [4, 65] };
  if (at === "walk") {
    beat("walk");
  } else {
    const [d, deg] = spots[at] ?? spots.d4;
    standAt(d, deg, 0);
  }
  const open = params.get("open");
  if (open === "a" || open === "b") {
    pins[open === "a" ? 0 : 1].open = true;
  }
  setVoice(params.get("voice") === "on");
  requestAnimationFrame(frame);
} catch (err) {
  readoutEl.textContent = `Could not load the sample (${err.message}).`;
}
