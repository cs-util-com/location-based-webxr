// Travelling surface, round 1, variant A - the bubble travels. Throwaway prototype: not wired to
// the app, linked from nothing in it.
//
// A character's speech bubble is one object. While it can be read (its letters, and in a story
// step its choice buttons, big enough on screen), is in view and he is within the open distance,
// it hangs beside his head with its tail. Otherwise the same texture flies down to the dock at the
// bottom centre, its tail shrinking into the edge, and becomes the box; when the bubble can be read
// again it flies back. Exactly one of the two is drawn, so his words never show twice, and only
// one figure's words show at all: the figure whose voice runs owns the surface (a tap wins).
import * as THREE from "three";
import * as kind from "./kind.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Moves `cur` toward `target` by `step`, stopping on it (never past it, never away from it). */
const approach = (cur, target, step) =>
  cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const { SURF, FIG } = kind;

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
const NUM_KEYS = ["thr", "gate", "fs", "fly", "settle", "hyst"];
const cfg = {
  thr: pickNum("thr", [10, 12, 14, 16], 12),
  gate: pickNum("gate", [40, 48, 56], 48),
  open: pick("open", ["9", "15", "none"], "9"),
  fs: pickNum("fs", [14, 16, 18], 16),
  fly: pickNum("fly", [0, 0.35, 0.6, 1.2], 0.6),
  settle: pickNum("settle", [0.3, 0.6, 1], 0.3),
  hyst: pickNum("hyst", [5, 10, 15], 5),
  holder: pick("holder", ["voice", "tapped"], "voice"),
  docks: pick("docks", ["started", "always"], "started"),
  who: pick("who", ["one", "two"], "one"),
  grow: pick("grow", ["on", "off"], "on"),
  shake: pick("shake", ["on", "off"], "on"),
  sound: pick("sound", ["tone", "silent"], "tone"),
  text: pick("text", ["normal", "longest"], "normal"),
  stage: pick("stage", ["auto", "portrait", "landscape"], "auto"),
  creator: pick("creator", ["speaker", "box"], "speaker"),
};

const RADIUS_M = 20; // the station circle: voices play and surfaces show only inside it
const LOCK_S = 0.6; // after a finger lifts, the surface stays put this long
const TAP_SLOP = 8; // px a finger may move and still count as a tap
const FOLLOW_ROW = 1; // the spoken line sits in the middle row
const PICK_KEY = "travelling-surface-tour-words";
const openM = () => (cfg.open === "none" ? Infinity : Number(cfg.open));

const stageEl = $("stage");
const device = $("device");
const canvas = $("cam");
const readoutEl = $("readout");
const costEl = $("cost");
const fingerEl = $("finger");

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
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  const colors = [0xffffff, 0xf0dcc0, 0xe6cfb0, 0xdfe3e0, 0xf3d9c6, 0xe9e0cf];
  const c = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const h = 9 + rand() * 7;
    m.compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion(), new THREE.Vector3(8.4, h, 8.4));
    walls.setMatrixAt(i, m);
    walls.setColorAt(i, c.setHex(colors[Math.floor(rand() * colors.length)]));
    m.compose(new THREE.Vector3(x, h + 1.6, z), turn, new THREE.Vector3(8.4, 3.2, 8.4));
    roofs.setMatrixAt(i, m);
  });
  scene.add(walls, roofs);
})();

// ---------- the overlay: the same surface texture, drawn in screen space while docked or flying ----------
// Each corner carries a clip-space position, so a corner flying from the bubble's projected corner
// to the dock's keeps the texture mapped in perspective all the way down. `crop` is the share of
// the canvas height shown from the top: the body, plus what is left of the tail.
const ovScene = new THREE.Scene();
const ovCam = new THREE.Camera();
const clipArr = new Float32Array(16);
const ovGeo = new THREE.BufferGeometry();
ovGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
const clipAttr = new THREE.BufferAttribute(clipArr, 4);
ovGeo.setAttribute("clipPos", clipAttr);
ovGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2));
ovGeo.setIndex([0, 2, 1, 2, 3, 1]);
const ovMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: null }, opacity: { value: 1 }, crop: { value: 1 } },
  vertexShader:
    "attribute vec4 clipPos;\nuniform float crop;\nvarying vec2 vUv;\nvoid main() {\n  vUv = vec2(uv.x, 1.0 - (1.0 - uv.y) * crop);\n  gl_Position = clipPos;\n}",
  fragmentShader:
    "uniform sampler2D map;\nuniform float opacity;\nvarying vec2 vUv;\nvoid main() {\n  vec4 c = texture2D(map, vUv);\n  gl_FragColor = vec4(c.rgb, c.a * opacity);\n  #include <colorspace_fragment>\n}",
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const ovMesh = new THREE.Mesh(ovGeo, ovMat);
ovMesh.frustumCulled = false;
ovMesh.visible = false;
ovScene.add(ovMesh);

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
      ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(21)) * (h / w)))
      : 50;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  showDockTable();
}
addEventListener("resize", sizeStage);
desktopMq.addEventListener("change", sizeStage);
function toDevice(e) {
  const r = device.getBoundingClientRect();
  return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
}

// ---------- the item: one or two characters and their one speech surface ----------
const env = { mode: "play", canvasTexture };
let sample = null;
let part = null;
/** Per figure: its step, its line's words and times, and where its voice stands. */
let figs = [];
let lastTapped = -1;

function fakeTimes(texts) {
  let t = 0;
  return texts.map((w) => {
    const letters = w.replace(/[^\p{L}\p{N}]/gu, "").length;
    const d = clamp(0.11 + 0.052 * letters, 0.17, 0.64);
    const start = t;
    t += d;
    if (/[.!?]["']?$/.test(w)) {
      t += 0.42;
    } else if (/[,;:]$/.test(w)) {
      t += 0.22;
    }
    return { start, end: start + d };
  });
}
function setStep(f, id) {
  const step = f.spec.steps.find((s) => s.id === id) ?? f.spec.steps[0];
  const texts = step.line.split(/\s+/).filter(Boolean);
  const times = fakeTimes(texts);
  const words = texts.map((text, i) => ({ text, start: times[i].start, end: times[i].end }));
  const sentences = [];
  let first = 0;
  words.forEach((w, i) => {
    if (/[.!?]["']?$/.test(w.text) || i === words.length - 1) {
      sentences.push({ first, last: i });
      first = i + 1;
    }
  });
  f.step = step;
  f.words = words;
  f.sentences = sentences;
  f.total = words.length ? words[words.length - 1].end + 0.3 : 0;
  f.t = 0;
  f.playing = false;
  f.finished = false;
  f.chosen = -1;
  if (f.i === shown) {
    bind(f);
  }
}

// the line bound to the surface: the shown figure's line breaks
let lineOf = [];
let lineStart = [];
let nLines = 1;
let s = 0;
function bind(f) {
  const lay = part.surface.setText(
    f.words,
    { name: f.spec.name, color: f.spec.color },
    f.step.choices.map((c) => c.label),
  );
  lineOf = lay.lineOf;
  nLines = lay.nLines;
  lineStart = [];
  f.words.forEach((w, i) => {
    if (lineStart[lineOf[i]] === undefined) {
      lineStart[lineOf[i]] = w.start;
    }
  });
  lineStart[nLines] = f.total;
  if (f.step.choices.length) {
    cN = f.step.choices.length;
  }
  s = followTarget(f);
  lastPaint.key = "";
}

function mountRecord() {
  if (part) {
    part.dispose();
  }
  hush();
  const ids = ["baker", "keeper"].slice(0, cfg.who === "two" ? 2 : 1);
  const specs = ids.map((id) => {
    const name = id === "baker" && cfg.text === "longest" ? "bakerLongest" : id;
    return { ...kind.read(sample.records[name]).block, id };
  });
  part = kind.world({ figures: specs }, env);
  scene.add(part.object);
  ovMat.uniforms.map.value = part.surface.texture;
  figs = specs.map((spec, i) => {
    const f = { spec, i, started: false, lastActive: -1, dist: 0, resume: false };
    setStep(f, spec.steps[0].id);
    return f;
  });
  shown = -1;
  lastTapped = -1;
  place = "hidden";
  pending = "";
  presence = 0;
  havePlateClip = false;
  cAmt = 0;
  pressedIdx = -1;
}

// ---------- the voice: a soft generated tone, one note per word (no recording) ----------
let actx = null;
const tones = [];
let lastToneWord = -1;
function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      actx = new AC();
    }
  }
  if (actx && actx.state === "suspended") {
    actx.resume();
  }
}
function tone(f, i) {
  if (cfg.sound !== "tone" || !actx || actx.state !== "running") {
    return;
  }
  const w = f.words[i];
  const now = actx.currentTime;
  const dur = Math.max(0.08, (w.end - w.start) * 0.85);
  const letters = w.text.replace(/[^\p{L}]/gu, "").length;
  const osc = actx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(f.spec.pitch + (letters % 6) * 14 - (/[.!?]$/.test(w.text) ? 25 : 0), now);
  const lp = actx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  const g = actx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.05, now + 0.02);
  g.gain.setValueAtTime(0.05, now + dur * 0.6);
  g.gain.linearRampToValueAtTime(0, now + dur);
  osc.connect(lp).connect(g).connect(actx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
  const rec = { osc, g };
  tones.push(rec);
  osc.onended = () => {
    const at = tones.indexOf(rec);
    if (at >= 0) {
      tones.splice(at, 1);
    }
  };
}
function hush() {
  if (!actx) {
    return;
  }
  const now = actx.currentTime;
  for (const r of tones) {
    r.g.gain.cancelScheduledValues(now);
    r.g.gain.setValueAtTime(0, now);
    try {
      r.osc.stop(now + 0.02);
    } catch {
      // already stopped
    }
  }
}

// ---------- playback: one voice at a time, a tap wins ----------
function wordAt(f, time) {
  let lo = 0;
  let hi = f.words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (f.words[m].start <= time) {
      found = m;
      lo = m + 1;
    } else {
      hi = m - 1;
    }
  }
  return found;
}
function setPlaying(f, on) {
  lastToneWord = -1;
  if (on) {
    for (const o of figs) {
      if (o !== f && o.playing) {
        o.playing = false;
      }
    }
    hush();
    f.playing = true;
    f.started = true;
    f.lastActive = clock;
    if (f.finished || f.t >= f.total) {
      f.t = 0;
      f.finished = false;
    }
  } else {
    f.playing = false;
    hush();
  }
}
function finish(f) {
  f.playing = false;
  f.finished = true;
  f.t = f.total;
  hush();
}
function advance(dt) {
  const f = figs.find((o) => o.playing);
  if (!f || (dragging && f.i === shown) || !f.words.length) {
    return;
  }
  f.t = Math.min(f.t + dt, f.total);
  const cur = wordAt(f, f.t);
  if (cur !== lastToneWord) {
    lastToneWord = cur;
    if (cur >= 0 && f.t < f.words[cur].end) {
      tone(f, cur);
    }
  }
  if (f.t >= f.total) {
    finish(f);
  }
}
/** A figure holds the voice while it plays, is paused mid-line, or waits for a choice. */
const awaitsChoice = (f) => f.finished && f.step.choices.length > 0 && f.chosen < 0;
const holds = (f) => f.playing || (f.started && !f.finished && f.t > 0) || awaitsChoice(f);

function lineFloatAt(time) {
  const f = figs[shown];
  if (time >= f.total) {
    return nLines;
  }
  let i = 0;
  while (i + 1 < nLines && lineStart[i + 1] <= time) {
    i++;
  }
  const span = lineStart[i + 1] - lineStart[i];
  return i + (span > 0 ? clamp((time - lineStart[i]) / span, 0, 1) : 0);
}
function timeAtLine(x) {
  const f = figs[shown];
  const v = clamp(x, 0, nLines);
  const i = Math.floor(v);
  return i >= nLines ? f.total : lineStart[i] + (v - i) * (lineStart[i + 1] - lineStart[i]);
}
const maxScroll = () => Math.max(0, nLines - SURF.rows);
function followTarget(f) {
  const cur = Math.max(0, wordAt(f, f.t));
  return clamp((lineOf[cur] ?? 0) - FOLLOW_ROW, 0, maxScroll());
}

// ---------- who owns the one surface ----------
// "voice" (the default): the figure whose voice runs; else the last one that ran and still holds
// it (paused mid-line or waiting for a choice); else the nearest figure in the station.
// "tapped": the figure tapped last, whatever its voice does; before any tap, the nearest.
let shown = -1; // the figure whose words the surface carries now
function wantedHolder() {
  const inside = figs.filter((f) => f.dist <= RADIUS_M);
  if (!inside.length) {
    return -1;
  }
  const playing = inside.find((f) => f.playing);
  if (playing) {
    return playing.i;
  }
  if (cfg.holder === "tapped") {
    if (lastTapped >= 0 && figs[lastTapped].dist <= RADIUS_M) {
      return lastTapped;
    }
  } else {
    const held = inside.filter(holds).sort((a, b) => b.lastActive - a.lastActive);
    if (held.length) {
      return held[0].i;
    }
  }
  return inside.reduce((a, b) => (b.dist < a.dist ? b : a)).i;
}
/** May this figure's words go to the dock? Only once its voice was started, unless a knob says always. */
function dockAllowed(f) {
  return (
    cfg.docks === "always" || holds(f) || (cfg.holder === "tapped" && f.started && lastTapped === f.i)
  );
}

// ---------- where the surface is: the bubble, the dock, or nowhere ----------
let place = "hidden"; // hidden | plate | dock
let pending = "";
let pendingFor = 0;
let why = "";
let u = 1; // 0 = the bubble in the world, 1 = docked; in between it is flying
let uTarget = 1;
let presence = 0;
let side = "right";
const baseTipX = (sd) => (sd === "left" ? SURF.canvasW - SURF.tailTip : SURF.tailTip);
let tipX = baseTipX("right"); // canvas x of the tail's tip; off its base value the bubble is slid
let cAmt = 0; // how far the choices are open (0 to 1)
let cN = 2; // how many choices the open area is sized for
let pressedIdx = -1;
let pressedUntil = 0;
let releasedAt = -10;
let visitorPick = null;
try {
  visitorPick = localStorage.getItem(PICK_KEY);
} catch {
  visitorPick = null;
}
if (visitorPick !== "speaker" && visitorPick !== "box") {
  visitorPick = null;
}
const effectiveView = () => visitorPick ?? cfg.creator;

const pv = new THREE.Matrix4();
const v4 = new THREE.Vector4();
const plateClip = new Float32Array(16);
const lastPlateClip = new Float32Array(16);
let lastPlateVisH = 1;
let havePlateClip = false;
const metrics = { valid: false, onFrac: 0, letterPx: 0, btnPx: 0, pxPerCanvas: 0 };
const tmpV = new THREE.Vector3();

function project(x, y, m, out, at) {
  v4.set(x, y, 0, 1).applyMatrix4(m).applyMatrix4(pv);
  out[at] = v4.x;
  out[at + 1] = v4.y;
  out[at + 2] = v4.z;
  out[at + 3] = v4.w;
  return v4.w;
}
const sx = (x, w) => (x / w / 2 + 0.5) * W;
const sy = (y, w) => (0.5 - y / w / 2) * H;
function toScreen(p) {
  v4.set(p.x, p.y, p.z, 1).applyMatrix4(pv);
  return { x: sx(v4.x, v4.w), y: sy(v4.y, v4.w), ok: v4.w > 0.05 };
}

/** The shown height of the surface in canvas px: the body, and `tail` (0 to 1) of the tail. */
const bodyNow = () => kind.bodyH(cAmt, cN);
const visHAt = (tail) => bodyNow() + SURF.tailH * tail;

function measurePlate() {
  metrics.valid = false;
  metrics.letterPx = 0;
  metrics.btnPx = 0;
  metrics.onFrac = 0;
  if (shown < 0) {
    return;
  }
  const m = part.plate.matrixWorld;
  let ok = true;
  [
    [-0.5, 0.5],
    [0.5, 0.5],
    [-0.5, -0.5],
    [0.5, -0.5],
  ].forEach(([x, y], i) => {
    if (project(x, y, m, plateClip, i * 4) < 0.05) {
      ok = false;
    }
  });
  metrics.valid = ok;
  if (!ok) {
    return;
  }
  const xs = [0, 1, 2, 3].map((i) => sx(plateClip[i * 4], plateClip[i * 4 + 3]));
  const ys = [0, 1, 2, 3].map((i) => sy(plateClip[i * 4 + 1], plateClip[i * 4 + 3]));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  const ix = Math.max(0, Math.min(W, x1) - Math.max(0, x0));
  const iy = Math.max(0, Math.min(H, y1) - Math.max(0, y0));
  metrics.onFrac = (ix * iy) / area;
  metrics.pxPerCanvas = (y1 - y0) / visHAt(1);
  metrics.letterPx = metrics.pxPerCanvas * SURF.fontPx;
  metrics.btnPx = metrics.pxPerCanvas * SURF.btnH;
  metrics.screen = { x0, x1, y0, y1 };
  if (metrics.onFrac > 0.5) {
    lastPlateClip.set(plateClip);
    lastPlateVisH = visHAt(1);
    havePlateClip = true;
  }
}

// The bubble hangs on the side toward the screen's middle, as in the app, unless that side would
// cover a face (his own or the other figure's); a side is kept until the other is clearly better.
const faces = [];
function measureFaces() {
  faces.length = 0;
  for (const f of figs) {
    tmpV.copy(part.figures[f.i].root.position).setY(FIG.faceY * FIG.heightM);
    const c = toScreen(tmpV);
    tmpV.y += FIG.faceR * FIG.heightM;
    const t = toScreen(tmpV);
    if (c.ok) {
      faces.push({ x: c.x, y: c.y, r: Math.abs(c.y - t.y) * 1.1 });
    }
  }
}
function rectHitsFace(r) {
  return faces.some(
    (fc) =>
      fc.x + fc.r > r.x0 && fc.x - fc.r < r.x1 && fc.y + fc.r > r.y0 && fc.y - fc.r < r.y1,
  );
}
function bubbleRect(sd) {
  if (!metrics.pxPerCanvas) {
    return null;
  }
  const tip = toScreen(part.tipPoint(shown, sd, tmpV));
  if (!tip.ok) {
    return null;
  }
  const pp = metrics.pxPerCanvas;
  const w = SURF.canvasW * pp;
  const h = visHAt(1) * pp;
  const fromTip = baseTipX(sd) * pp;
  // the body only: the tail is meant to reach his head
  return { x0: tip.x - fromTip, x1: tip.x - fromTip + w, y0: tip.y - h, y1: tip.y - SURF.tailH * pp };
}
function overflow(r) {
  return Math.max(0, -r.x0) + Math.max(0, r.x1 - W);
}
let faceCovered = false;
let faceFrames = 0;
function pickSide(dt) {
  // measured wherever the surface is: a docked bubble must know where it would hang to come back
  if (shown < 0) {
    return;
  }
  const other = side === "left" ? "right" : "left";
  const cur = bubbleRect(side);
  const alt = bubbleRect(other);
  if (!cur || !alt) {
    return;
  }
  const score = (r) => overflow(r) + (rectHitsFace(r) ? 10000 : 0);
  if ((u === 0 || u === 1) && score(alt) + 0.06 * W < score(cur)) {
    side = other;
  }
  // slid back onto the screen, as in the app, the tail's tip staying at his head
  const r = side === other ? alt : cur;
  const pp = metrics.pxPerCanvas;
  const m = 8;
  let shift = 0;
  if (r.x1 - r.x0 > W - 2 * m) {
    shift = (W - r.x1 - r.x0) / 2;
  } else if (r.x0 < m) {
    shift = m - r.x0;
  } else if (r.x1 > W - m) {
    shift = W - m - r.x1;
  }
  const want = clamp(baseTipX(side) - shift / pp, SURF.tailTip, SURF.canvasW - SURF.tailTip);
  // snapped while nothing shows in the world, eased while the bubble does
  tipX = presence === 0 || u === 1 ? want : tipX + (want - tipX) * (1 - Math.exp(-dt * 14));
  if (Math.abs(want - tipX) < 2) {
    tipX = want;
  }
  const slid = { x0: r.x0 + (baseTipX(side) - tipX) * pp, x1: r.x1 + (baseTipX(side) - tipX) * pp, y0: r.y0, y1: r.y1 };
  faceCovered = presence > 0.5 && u === 0 && rectHitsFace(slid);
  if (faceCovered) {
    faceFrames++;
  }
}

function wantPlace() {
  if (shown < 0) {
    why = "no figure in the station";
    return "hidden";
  }
  const f = figs[shown];
  if (f.dist > RADIUS_M) {
    why = "outside the station circle";
    return "hidden";
  }
  const allowed = dockAllowed(f);
  const inWorld = place === "plate" && u === 0;
  const h = cfg.hyst / 100;
  if (effectiveView() === "box") {
    why = visitorPick ? "your pick for the tour: the box" : "the creator chose the box";
    return allowed ? "dock" : "hidden";
  }
  const lim = openM() * (inWorld ? 1 + h : 1);
  if (f.dist > lim) {
    why = `farther than ${cfg.open} m`;
    return allowed ? "dock" : "hidden";
  }
  const say = (text) => {
    why = allowed ? text : `${text} (stays: no voice started)`;
    return allowed ? "dock" : "plate";
  };
  if (!metrics.valid || metrics.onFrac < (inWorld ? 0.85 : 0.92)) {
    return say("the bubble is out of view");
  }
  if (metrics.letterPx < cfg.thr * (inWorld ? 1 - h : 1)) {
    return say(`letters ${metrics.letterPx.toFixed(1)} px, under ${cfg.thr}`);
  }
  if (cTarget() > 0 && metrics.btnPx < cfg.gate * (inWorld ? 1 - h : 1)) {
    return say(`buttons ${metrics.btnPx.toFixed(0)} px, under ${cfg.gate}`);
  }
  why = `letters ${metrics.letterPx.toFixed(1)} px${cTarget() > 0 ? `, buttons ${metrics.btnPx.toFixed(0)} px` : ""}`;
  return "plate";
}
const cTarget = () => {
  const f = figs[shown];
  return f && (awaitsChoice(f) || pressedIdx >= 0) ? 1 : 0;
};

function decide(dt) {
  // a new holder: the surface fades, then comes back with his words at his place
  const want = wantedHolder();
  if (want !== shown) {
    presence = reduceMotion ? 0 : Math.max(0, presence - dt / 0.15);
    if (presence === 0) {
      shown = want;
      place = "hidden";
      pending = "";
      havePlateClip = false;
      cAmt = shown >= 0 ? cTarget() : 0;
      if (shown >= 0) {
        bind(figs[shown]);
      }
    }
    return;
  }
  const wantP = wantPlace();
  if (wantP !== pending) {
    pending = wantP;
    pendingFor = 0;
  } else {
    pendingFor += dt;
  }
  // a finger on the surface, or one just lifted, holds it where it is; hiding needs no settling,
  // appearing only a held frame or two (the first frames measure the bubble before it slid onto the screen)
  const locked = dragging || (press && press.what !== "look") || clock - releasedAt < LOCK_S;
  const now =
    wantP === "hidden" || (place === "hidden" ? pendingFor >= 0.03 : pendingFor >= cfg.settle);
  if (wantP !== place && now && !locked) {
    const appearing = place === "hidden" || presence === 0;
    place = wantP;
    if (wantP !== "hidden") {
      uTarget = wantP === "dock" ? 1 : 0;
      if (appearing) {
        u = uTarget;
      }
    }
  }
  if (cfg.fly === 0 || reduceMotion) {
    u = uTarget;
  } else if (u !== uTarget) {
    const step = dt / cfg.fly;
    u = approach(u, uTarget, step);
  }
  const pTarget = place === "hidden" ? 0 : 1;
  presence = reduceMotion ? pTarget : approach(presence, pTarget, dt / 0.3);
  const ct = cTarget();
  cAmt = reduceMotion ? ct : approach(cAmt, ct, dt / 0.3);
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** How far the tail has shrunk into the edge (0 = full tail, 1 = gone), from the flight's ease. */
const tailGone = () => (u === 0 ? 0 : clamp(ease(u) / 0.7, 0, 1));

/** The dock's size: the box text at `fs`, and for a story the buttons at the touch gate. */
function dockScale() {
  const f = figs[shown];
  const story = f && f.spec.steps.some((st) => st.choices.length);
  const want = Math.max(cfg.fs / SURF.fontPx, story ? cfg.gate / SURF.btnH : 0);
  const maxH = (W > H ? 0.66 : 0.5) * H;
  return Math.min(want, (Math.min(0.92 * W, 720)) / SURF.canvasW, maxH / kind.bodyH(1, cN));
}
function dockRect() {
  const sc = dockScale();
  const w = SURF.canvasW * sc;
  const h = bodyNow() * sc;
  const bottom = W > H ? 10 : 18;
  return { x: (W - w) / 2, y: H - bottom - h, w, h, sc };
}

function layoutBox() {
  const showPlate = presence > 0 && u === 0 && shown >= 0;
  const showOverlay = presence > 0 && u > 0 && shown >= 0;
  part.plate.visible = showPlate;
  part.plate.material.opacity = presence;
  ovMesh.visible = showOverlay;
  if (!showOverlay) {
    return;
  }
  ovMat.uniforms.opacity.value = presence;
  const kTail = tailGone();
  const visK = visHAt(1 - kTail);
  ovMat.uniforms.crop.value = visK / SURF.canvasH;
  const r = dockRect();
  const nx = (x) => (x / W) * 2 - 1;
  const ny = (y) => 1 - (y / H) * 2;
  const dock = [nx(r.x), ny(r.y), nx(r.x + r.w), ny(r.y), nx(r.x), ny(r.y + r.h), nx(r.x + r.w), ny(r.y + r.h)];
  const live = metrics.valid && metrics.onFrac > 0.5;
  const src = live ? plateClip : havePlateClip ? lastPlateClip : null;
  const srcH = live ? visHAt(1) : lastPlateVisH;
  const e = src ? ease(u) : 1;
  let wRef = 1;
  if (src) {
    wRef = (src[3] + src[7] + src[11] + src[15]) / 4;
  }
  // the source's bottom edge at the current crop: as much of the tail as is left
  const f = clamp(visK / srcH, 0, 1.5);
  for (let i = 0; i < 4; i++) {
    const a = i * 4;
    const top = i < 2 ? a : a - 8;
    const dx = dock[i * 2] * wRef;
    const dy = dock[i * 2 + 1] * wRef;
    for (let c = 0; c < 4; c++) {
      let sv = 0;
      if (src) {
        sv = i < 2 ? src[a + c] : src[top + c] + (src[a + c] - src[top + c]) * f;
      }
      const dv = c === 0 ? dx : c === 1 ? dy : c === 2 ? 0 : wRef;
      clipArr[a + c] = src ? sv * (1 - e) + dv * e : c === 0 ? dock[i * 2] : c === 1 ? dock[i * 2 + 1] : c === 2 ? 0 : 1;
    }
  }
  clipAttr.needsUpdate = true;
}

/** The surface's current outline on the screen, in device px: TL, TR, BR, BL. */
function surfaceQuad() {
  const src = u > 0 ? clipArr : plateClip;
  const pt = (i) => ({ x: sx(src[i * 4], src[i * 4 + 3]), y: sy(src[i * 4 + 1], src[i * 4 + 3]) });
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
/** A canvas point of the surface on the screen (the bubble or the docked box), in device px. */
function canvasToScreen(cx, cy) {
  if (u === 1) {
    const r = dockRect();
    return { x: r.x + (cx / SURF.canvasW) * r.w, y: r.y + (cy / bodyNow()) * r.h };
  }
  const tmp = [0, 0, 0, 0];
  const w = project(cx / SURF.canvasW - 0.5, 0.5 - cy / visHAt(1), part.plate.matrixWorld, tmp, 0);
  return { x: sx(tmp[0], w), y: sy(tmp[1], w) };
}

// ---------- gestures: the same on the bubble and in the box ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let press = null;
let dragging = false;
let creditUntil = 0;
let clock = 0;

/** What a touch at canvas px (cx, cy) of the surface means. */
function onSurface(cx, cy) {
  const b = part.surface.badge;
  if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
    return { what: "badge" };
  }
  if (cAmt > 0.9) {
    const hit = part.surface.buttons.findIndex(
      (r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y - 6 && cy <= r.y + r.h + 6,
    );
    if (hit >= 0) {
      return { what: "choice", i: hit };
    }
  }
  return { what: "words" };
}
function hitTest(x, y) {
  if (presence > 0.5 && place !== "hidden" && shown >= 0) {
    if (u > 0) {
      const q = surfaceQuad();
      if (inQuad(x, y, q)) {
        const hgt =
          (Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)) / 2;
        const linePx = (hgt / visHAt(1 - tailGone())) * SURF.linePx;
        if (u === 1) {
          const r = dockRect();
          return { ...onSurface(((x - r.x) / r.w) * SURF.canvasW, ((y - r.y) / r.h) * bodyNow()), linePx };
        }
        return { what: "words", linePx };
      }
    } else if (metrics.valid) {
      ndc.set((x / W) * 2 - 1, 1 - (y / H) * 2);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(part.plate, false)[0];
      if (hit) {
        const cy = (1 - hit.uv.y) * visHAt(1);
        if (cy <= bodyNow()) {
          return { ...onSurface(hit.uv.x * SURF.canvasW, cy), linePx: metrics.pxPerCanvas * SURF.linePx };
        }
      }
    }
  }
  ndc.set((x / W) * 2 - 1, 1 - (y / H) * 2);
  raycaster.setFromCamera(ndc, camera);
  const targets = [];
  part.figures.forEach((pf) => {
    targets.push(pf.body);
    if (pf.tag.visible) {
      targets.push(pf.tag);
    }
  });
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (hit) {
    const i = part.figures.findIndex((pf) => pf.body === hit.object || pf.tag === hit.object);
    return { what: "figure", i };
  }
  return { what: "look" };
}

// The finger's screen motion is read from the press on: the bubble is never hit-tested again while
// it moves under the finger, and one line height of finger travel, as the line looked at the press,
// is one line of text and of the voice.
function pressStart(x, y, id) {
  const hit = hitTest(x, y);
  const f = figs[shown];
  press = { id, x, y, ...hit, line0: f ? lineFloatAt(f.t) : 0, s0: s, yaw0: userYaw };
}
function pressMove(x, y) {
  const dx = x - press.x;
  const dy = press.y - y; // finger up = words up = ahead
  const moved = Math.hypot(dx, dy) > TAP_SLOP;
  if ((press.what === "figure" || press.what === "badge") && moved) {
    press.what = "look";
  }
  if (press.what === "choice" && moved) {
    press.what = "words"; // a drag that starts on a button scrubs, it never chooses
  }
  if (press.what === "look") {
    userYaw = press.yaw0 + dx * 0.005;
    return;
  }
  if (press.what !== "words" || shown < 0) {
    return;
  }
  const f = figs[shown];
  if (!dragging && moved) {
    dragging = true;
    hush();
  }
  if (dragging) {
    const lines = dy / Math.max(4, press.linePx);
    f.t = timeAtLine(press.line0 + lines);
    f.finished = false;
    const raw = press.s0 + lines;
    const top = maxScroll();
    s = raw < 0 ? raw * 0.3 : raw > top ? top + (raw - top) * 0.3 : raw;
  }
}
function pressEnd(x, y, cancelled) {
  const pr = press;
  const was = dragging;
  press = null;
  dragging = false;
  if (pr.what !== "look") {
    releasedAt = clock;
  }
  if (cancelled) {
    return;
  }
  const f = figs[shown];
  if (pr.what === "words" && f) {
    if (was) {
      lastToneWord = -1;
      if (f.t >= f.total && !f.finished) {
        finish(f);
      }
      return;
    }
    tapWords(x, y);
  } else if (pr.what === "badge") {
    creditUntil = creditUntil > clock ? 0 : clock + 4;
  } else if (pr.what === "choice") {
    choose(pr.i, x, y);
  } else if (pr.what === "figure") {
    tapFigure(pr.i, x, y);
  }
}
canvas.addEventListener("pointerdown", (e) => {
  if (press || script) {
    return;
  }
  ensureAudio();
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

function tapWords(x, y) {
  const f = figs[shown];
  lastTapped = f.i;
  if (awaitsChoice(f)) {
    // heard to the end with the choices open: a tap on the words hears it again
    f.t = 0;
    f.finished = false;
  }
  setPlaying(f, !f.playing);
  tapFx(x, y, f.playing);
}
/** A tap on a figure (or his name tag): his voice starts or pauses; another figure's voice stops. */
function tapFigure(i, x, y) {
  const f = figs[i];
  lastTapped = i;
  f.lastActive = clock;
  if (f.playing) {
    setPlaying(f, false);
  } else {
    if (awaitsChoice(f)) {
      f.t = 0;
      f.finished = false;
    }
    setPlaying(f, true);
  }
  tapFx(x, y, f.playing);
}
function choose(i, x, y) {
  const f = figs[shown];
  if (!awaitsChoice(f) || !f.step.choices[i]) {
    return;
  }
  lastTapped = f.i;
  f.chosen = i;
  pressedIdx = i;
  pressedUntil = clock + 0.28;
  lastPaint.key = "";
  tapFx(x, y, true);
}
function applyChoice() {
  if (pressedIdx < 0 || clock < pressedUntil) {
    return;
  }
  const f = figs[shown];
  const next = f && f.step.choices[pressedIdx] ? f.step.choices[pressedIdx].next : null;
  pressedIdx = -1;
  if (next) {
    setStep(f, next);
    setPlaying(f, true); // the choice was a tap: the reply may sound
  }
}
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
function tapFx(x, y, nowPlaying) {
  const fx = document.createElement("div");
  fx.className = "tapfx";
  fx.style.left = `${x}px`;
  fx.style.top = `${y}px`;
  fx.innerHTML = nowPlaying ? ICON_PLAY : ICON_PAUSE;
  device.append(fx);
  fx.addEventListener("animationend", () => fx.remove());
  setTimeout(() => fx.remove(), 1500);
}

// ---------- painting the surface and the tags (only when something changed) ----------
const lastPaint = { key: "" };
const paintStats = { n: 0, sum: 0, max: 0 };
function hint(f) {
  if (dragging) {
    return "";
  }
  if (awaitsChoice(f)) {
    return "choose below";
  }
  if (f.finished) {
    return "the end - tap to hear again";
  }
  if (f.playing) {
    return "";
  }
  return f.started && f.t > 0 ? "paused - tap to play" : "tap the words to listen";
}
function paintSurface() {
  if (presence === 0 || shown < 0) {
    return;
  }
  const f = figs[shown];
  const tail = Math.round((1 - tailGone()) * 10) / 10;
  const view = {
    t: f.started ? f.t : -1,
    s,
    hint: hint(f),
    credit: clock < creditUntil,
    scrubbing: dragging,
    cAmt: Math.round(cAmt * 20) / 20,
    nChoices: cN,
    tail,
    side,
    tipX: Math.round(tipX / 4) * 4,
    pressed: pressedIdx,
  };
  const key = `${f.i}|${view.t.toFixed(3)}|${s.toFixed(3)}|${view.hint}|${view.credit}|${dragging}|${view.cAmt}|${tail}|${side}|${view.tipX}|${pressedIdx}`;
  if (key === lastPaint.key) {
    return;
  }
  lastPaint.key = key;
  const t0 = performance.now();
  part.surface.paint(view);
  const dt = performance.now() - t0;
  paintStats.n++;
  paintStats.sum += dt;
  paintStats.max = Math.max(paintStats.max, dt);
}
/** Name tags: every figure in the station not showing its bubble in the world shows its tag. */
const tagAlpha = [];
function updateTags(dt) {
  figs.forEach((f, i) => {
    const pf = part.figures[i];
    let target = f.dist <= RADIUS_M ? 1 : 0;
    if (i === shown && place !== "hidden") {
      target = Math.min(target, 1 - presence * (1 - Math.min(1, u * 2)));
    }
    const cur = tagAlpha[i] ?? 0;
    tagAlpha[i] = reduceMotion ? target : approach(cur, target, dt / 0.25);
    const state = f.playing
      ? "speaking"
      : awaitsChoice(f)
        ? "choose"
        : f.started && !f.finished && f.t > 0
          ? "paused"
          : f.finished
            ? "heard"
            : "tap to hear";
    if (pf.setTag(state)) {
      paintStats.n++;
    }
    // his mouth moves while his voice plays, inside a word
    const wi = f.playing ? wordAt(f, f.t) : -1;
    pf.setTalk(wi >= 0 && f.t < f.words[wi].end && Math.floor((f.t - f.words[wi].start) / 0.115) % 2 === 0);
  });
}

// ---------- the viewer: beats move them, a sideways drag turns them (in AR the phone does) ----------
const viewer = { pos: new THREE.Vector3(0, 1.6, 7), from: null, to: null, t0: 0, dur: 0 };
let userYaw = 0;
let turnCur = 0;
let turnTarget = 0;
let shakeAmp = 0;
const lookAt = new THREE.Vector2(0, 0);
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
  goTo(lookAt.x + Math.sin(a) * dist, lookAt.y + Math.cos(a) * dist, dur);
}
function updateViewer(dt) {
  if (viewer.to) {
    const f = clamp((clock - viewer.t0) / viewer.dur, 0, 1);
    viewer.pos.lerpVectors(viewer.from, viewer.to, f * f * (3 - 2 * f));
    if (f >= 1) {
      viewer.to = null;
    }
  }
  turnCur += (turnTarget - turnCur) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 2.6));
  const shaking = press && press.what !== "look" && cfg.shake === "on";
  shakeAmp += ((shaking ? 1 : 0) - shakeAmp) * (1 - Math.exp(-dt * 8));
  camera.position.copy(viewer.pos);
  const dx = viewer.pos.x - lookAt.x;
  const dz = viewer.pos.z - lookAt.y;
  const d = Math.max(0.5, Math.hypot(dx, dz));
  // look a little above his head, where the bubble hangs
  const lookH = 1.55 + (cfg.grow === "on" ? 0.07 * Math.max(0, d / 2.4 - 1) : 0);
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(lookH - viewer.pos.y, d);
  const sway = reduceMotion ? 0 : 1;
  const sh = shakeAmp * sway;
  const shakeY = sh * 0.009 * (Math.sin(clock * 5.3) + 0.6 * Math.sin(clock * 11.7));
  const shakeP = sh * 0.008 * (Math.sin(clock * 7.1 + 1) + 0.5 * Math.sin(clock * 13.3));
  camera.rotation.y = yaw + userYaw + turnCur + Math.sin(clock * 0.53) * 0.01 * sway + shakeY;
  camera.rotation.x = pitch + Math.sin(clock * 0.71) * 0.005 * sway + shakeP;
}
function setLook() {
  if (cfg.who === "two") {
    const a = part.figures[0].root.position;
    const b = part.figures[1].root.position;
    lookAt.set((a.x + b.x) / 2, (a.z + b.z) / 2);
  } else {
    lookAt.set(0, 0);
  }
}

// ---------- the beats ----------
let script = null;
function cancelScript() {
  if (script) {
    script.cancelled = true;
    script = null;
    fingerEl.hidden = true;
    if (press && press.id === "script") {
      pressEnd(press.x, press.y, true);
    }
  }
}
function setTurn(on) {
  turnTarget = on ? 2.4 : 0;
  $("turnBtn").setAttribute("aria-pressed", String(on));
  $("turnBtn").textContent = on ? "Turn back" : "Turn away";
}
const wait = (ms, run) =>
  new Promise((resolve, reject) => {
    setTimeout(() => (run.cancelled ? reject(new Error("cancelled")) : resolve()), ms);
  });
const until = async (test, ms, run) => {
  const t0 = performance.now();
  while (!test() && performance.now() - t0 < ms) {
    await wait(80, run);
  }
};
/** A simulated tap; `at` gives the point, read again just before the press. */
async function fingerTap(at, run) {
  let p = at();
  fingerEl.hidden = false;
  fingerEl.style.left = `${p.x}px`;
  fingerEl.style.top = `${p.y}px`;
  await wait(420, run);
  p = at();
  pressStart(p.x, p.y, "script");
  await wait(90, run);
  pressEnd(p.x, p.y, false);
  await wait(250, run);
  fingerEl.hidden = true;
}
const wordsPoint = () => canvasToScreen(SURF.canvasW * 0.45, SURF.padT + SURF.whoPx + SURF.linePx * 1.5);
function figurePoint(i) {
  return toScreen(part.chestPoint(i, new THREE.Vector3()));
}
function tagPoint(i) {
  return toScreen(part.figures[i].tag.position);
}
function resetVoices() {
  hush();
  figs.forEach((f) => {
    f.started = false;
    f.lastActive = -1;
    setStep(f, f.spec.steps[0].id);
  });
  lastTapped = -1;
}
async function runScript(body) {
  const run = { cancelled: false };
  script = run;
  try {
    await body(run);
  } catch {
    // cancelled by another beat
  }
  if (script === run) {
    script = null;
  }
  fingerEl.hidden = true;
}
async function scriptedScrub(run) {
  const f = figs[0];
  if (f.dist > openM() || f.dist > RADIUS_M) {
    standAt(5, 0, 0);
  }
  if (!f.playing) {
    const sIdx = Math.min(1, f.sentences.length - 1);
    f.t = f.words[f.sentences[sIdx].first].start;
    f.finished = false;
    setPlaying(f, true);
    await wait(2400, run);
  }
  await fingerTap(wordsPoint, run);
  await wait(700, run);
  const c2 = wordsPoint();
  fingerEl.hidden = false;
  fingerEl.style.left = `${c2.x}px`;
  fingerEl.style.top = `${c2.y}px`;
  await wait(300, run);
  pressStart(c2.x, c2.y, "script");
  const linePx = press.what === "words" ? press.linePx : 20;
  const t0 = performance.now();
  for (;;) {
    await new Promise((r) => requestAnimationFrame(r));
    if (run.cancelled) {
      throw new Error("cancelled");
    }
    const k2 = clamp((performance.now() - t0) / 1000, 0, 1);
    const y = c2.y + k2 * k2 * (3 - 2 * k2) * linePx * 2;
    fingerEl.style.top = `${y}px`;
    pressMove(c2.x, y);
    if (k2 >= 1) {
      break;
    }
  }
  pressEnd(c2.x, c2.y + linePx * 2, false);
  await wait(1100, run);
  await fingerTap(wordsPoint, run);
}
async function scriptedChoose(run) {
  const f = figs[0];
  if (cfg.who === "two") {
    figs.slice(1).forEach((o) => setPlaying(o, false));
  }
  setStep(f, f.spec.steps[0].id);
  standAt(4, 0, 0.8);
  await wait(900, run);
  lastTapped = 0;
  f.t = f.words[f.sentences[f.sentences.length - 1].first].start;
  setPlaying(f, true);
  await until(() => awaitsChoice(f), 8000, run);
  await until(() => u === 1 && cAmt === 1, 6000, run);
  await wait(900, run);
  if (!part.surface.buttons[0] || shown !== f.i) {
    return;
  }
  await fingerTap(() => {
    const b = part.surface.buttons[0];
    return canvasToScreen(b.x + b.w * 0.4, b.y + b.h / 2);
  }, run);
}
async function scriptedTwo(run) {
  if (cfg.who !== "two") {
    cfg.who = "two";
    applyCfg();
    saveCfg();
    mountRecord();
  }
  setLook();
  resetVoices();
  standAt(12, 10, 0);
  await wait(900, run);
  await fingerTap(() => figurePoint(0), run); // the baker speaks
  await wait(3200, run);
  await fingerTap(() => tagPoint(1), run); // a tap on the ferry keeper's tag: she takes the dock
}
function beat(name) {
  cancelScript();
  userYaw = 0;
  if (name !== "turn") {
    setTurn(false);
  }
  if (name === "walk") {
    standAt(28, 0, 0);
    standAt(4, 0, 13);
  } else if (name === "d3") {
    standAt(3, 0, 1.2);
  } else if (name === "d7") {
    standAt(7, 0, 1.2);
  } else if (name === "d14") {
    standAt(14, 0, 1.6);
  } else if (name === "edge") {
    standAt(6, 0, 1.2);
    userYaw = -0.3;
  } else if (name === "turn") {
    setTurn(turnTarget === 0);
  } else if (name === "scrub") {
    runScript(scriptedScrub);
  } else if (name === "choose") {
    runScript(scriptedChoose);
  } else if (name === "two") {
    runScript(scriptedTwo);
  } else if (name === "end") {
    const f = shown >= 0 ? figs[shown] : figs[0];
    if (f.dist > RADIUS_M) {
      standAt(7, 0, 0);
    }
    f.t = f.words[f.sentences[f.sentences.length - 1].first].start;
    f.finished = false;
    lastTapped = f.i;
    setPlaying(f, true);
  }
}
document.querySelectorAll("[data-beat]").forEach((b) => {
  b.addEventListener("click", () => {
    ensureAudio();
    beat(b.dataset.beat);
  });
});

// ---------- the tour-wide words pick and the settings ----------
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
function showPick() {
  $("pickLabel").textContent = effectiveView() === "speaker" ? "by the speaker" : "in the box";
  $("tourPick").dataset.mine = visitorPick ? "yes" : "no";
}
$("tourPick").addEventListener("click", () => {
  visitorPick = effectiveView() === "speaker" ? "box" : "speaker";
  savePick();
  showPick();
});
$("resetPick").addEventListener("click", () => {
  visitorPick = null;
  savePick();
  showPick();
});
function applyCfg() {
  document.querySelectorAll("[data-cfg]").forEach((b) => {
    b.classList.toggle("on", String(cfg[b.dataset.cfg]) === b.dataset.v);
  });
  if (cfg.sound !== "tone") {
    hush();
  }
  showPick();
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
    cfg[key] = NUM_KEYS.includes(key) ? Number(b.dataset.v) : b.dataset.v;
    applyCfg();
    saveCfg();
    if ((key === "text" || key === "who") && before !== cfg[key]) {
      mountRecord();
      setLook();
    }
  });
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
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    figs.forEach((f) => f.playing && setPlaying(f, false));
  }
});

// Where the bubble docks, head-on at the screen's middle, for this phone shape: the letter rule at
// each threshold, then the open distance. Approximate: the viewer's distance stands in for the
// distance to the bubble.
function showDockTable() {
  const el = $("dockTable");
  if (!el) {
    return;
  }
  const fpx = H / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const at = (d, px) => (px * SURF.metresPerPx * (cfg.grow === "on" ? Math.max(1, d / 2.4) : 1) * fpx) / d;
  const firstUnder = (px, need) => {
    for (let d = 0.5; d <= RADIUS_M; d += 0.05) {
      if (at(d, px) < need) {
        return d;
      }
    }
    return Infinity;
  };
  const fmt = (d) => (d === Infinity ? "never" : `${d.toFixed(1)} m`);
  const rows = [10, 12, 14, 16].map((thr) => {
    const dl = firstUnder(SURF.fontPx, thr);
    const opens = ["9", "15", "none"].map((o) => fmt(Math.min(dl, o === "none" ? Infinity : Number(o))));
    const letters = dl === Infinity ? "letters readable to the station edge" : `letters too small from ${fmt(dl)}`;
    return `<li${thr === cfg.thr ? ' class="cur"' : ""}><b>${thr} px</b>: ${letters}; docks from ${opens.join(" / ")}</li>`;
  });
  const gates = [40, 48, 56].map((gate) => {
    const db = firstUnder(SURF.btnH, gate);
    return `<li${gate === cfg.gate ? ' class="cur"' : ""}><b>buttons ${gate} px</b>: too small from ${fmt(db)}, so the choices dock beyond it</li>`;
  });
  el.innerHTML = `${rows.join("")}${gates.join("")}`;
  $("dockFar").textContent = `${(at(10, SURF.fontPx)).toFixed(1)} px`;
}

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
  if (ovMesh.visible) {
    draws++;
    tris += 2;
  }
  return { draws, tris };
}
function report(now) {
  if (now - statsAt < 250) {
    return;
  }
  const where = presence === 0 ? "hidden" : u === 0 ? "bubble" : u === 1 ? "box" : "flying";
  const f = shown >= 0 ? figs[shown] : null;
  const r = shown >= 0 ? dockRect() : null;
  readoutEl.textContent =
    clock < exitNote
      ? "Exit is not part of this prototype."
      : f
        ? `${f.dist.toFixed(1)} m - ${f.spec.name.toLowerCase()} owns it - letters ${metrics.letterPx.toFixed(1)} px (from ${cfg.thr})` +
          `${cTarget() > 0 ? `, buttons ${metrics.btnPx.toFixed(0)} px (from ${cfg.gate}), docked ${(SURF.btnH * r.sc).toFixed(0)} px` : ""}` +
          ` - ${where}: ${why} - face ${faceCovered ? "COVERED" : "clear"}`
        : `no figure in the station - ${why}`;
  if (costAt < 0 || now - costAt >= 1000) {
    costAt = now;
    const c = partCost();
    const info = renderer.info.render;
    costEl.textContent =
      `Frame work avg ${(frameStats.workSum / Math.max(1, frameStats.n)).toFixed(1)} ms, max ${frameStats.workMax.toFixed(1)} ms; ` +
      `longest gap ${Math.round(frameStats.gapMax)} ms; frames over 50 ms since load: ${frameStats.over50}. ` +
      `This item: ${c.draws} draws, ${c.tris} triangles (whole frame ${info.calls} draws). ` +
      `Texture repaints ${paintStats.n} per s, surface paint avg ${(paintStats.sum / Math.max(1, paintStats.n)).toFixed(2)} ms, max ${paintStats.max.toFixed(2)} ms. ` +
      `Box text ${r ? (SURF.fontPx * r.sc).toFixed(1) : "-"} px. Frames with a face covered since load: ${faceFrames}.`;
    frameStats.workMax = 0;
    frameStats.workSum = 0;
    frameStats.n = 0;
    frameStats.gapMax = 0;
    paintStats.n = 0;
    paintStats.sum = 0;
    paintStats.max = 0;
  }
  statsAt = now;
}

// ---------- the frame loop ----------
let lastNow = performance.now();
const camQuat = new THREE.Quaternion();
function frame(now) {
  const gap = now - lastNow;
  const dt = Math.min(0.1, gap / 1000);
  lastNow = now;
  clock += dt;
  const t0 = performance.now();
  renderer.info.reset();

  updateViewer(dt);
  camera.updateMatrixWorld();
  camera.getWorldQuaternion(camQuat);
  figs.forEach((f) => {
    const p = part.figures[f.i].root.position;
    f.dist = Math.hypot(camera.position.x - p.x, camera.position.z - p.z);
    // the voice plays only inside the circle; walking out pauses it, coming back carries on
    if (f.dist > RADIUS_M && f.playing) {
      setPlaying(f, false);
      f.resume = true;
    } else if (f.dist <= RADIUS_M && f.resume) {
      f.resume = false;
      setPlaying(f, true);
    }
  });
  applyChoice();
  advance(dt);
  decide(dt);
  part.update({
    viewer: camera.position,
    camQuat,
    grow: cfg.grow === "on",
    holder: shown,
    side,
    tipX: Math.round(tipX / 4) * 4,
    visH: visHAt(1),
    tagAlpha,
  });
  scene.updateMatrixWorld();
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  measurePlate();
  measureFaces();
  pickSide(dt);
  if (!dragging && shown >= 0) {
    const target = followTarget(figs[shown]);
    s = reduceMotion ? target : s + (target - s) * (1 - Math.exp(-dt * 9));
    if (Math.abs(target - s) < 0.002) {
      s = target;
    }
  }
  paintSurface();
  updateTags(dt);
  layoutBox();

  renderer.clear();
  renderer.render(scene, camera);
  if (ovMesh.visible) {
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

// ---------- start: 7 m in front of the baker, his words waiting in his bubble ----------
applyCfg();
try {
  const res = await fetch("sample.json");
  if (!res.ok) {
    throw new Error(`sample.json: HTTP ${res.status}`);
  }
  sample = await res.json();
  mountRecord();
  setLook();
  const at = params.get("at");
  const starts = { d3: 3, d7: 7, d14: 14, walk: 28, edge: 6 };
  const d = starts[at] ?? 7;
  viewer.pos.set(lookAt.x, 1.6, lookAt.y + d);
  if (at === "walk") {
    standAt(4, 0, 13);
  } else if (at === "edge") {
    userYaw = -0.3;
  }
  if (params.has("autostart")) {
    setPlaying(figs[0], true);
  }
  requestAnimationFrame(frame);
} catch (err) {
  readoutEl.textContent = `Could not load the sample (${err.message}).`;
}
