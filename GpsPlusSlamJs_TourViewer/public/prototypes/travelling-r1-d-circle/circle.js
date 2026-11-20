// Travelling surface, round 1, variant D - words over the circle. Throwaway prototype: not wired
// to the app, linked from nothing in it.
//
// A narration circle has no sign: the visitor stands inside its anchor. The words of the voice
// are one object, a plate over the circle (standing at the far rim, lying at the near rim, or
// floating over the centre; kind.js draws it) while it can be read, otherwise the same texture
// flies down and docks at the bottom edge of the screen. Inside the circle the viewing angle
// (looking down, turning round) decides more than the distance. Exactly one of the two places is
// drawn at any moment, and the words hide when the visitor leaves the circle.
// Tap the words to pause or play, drag them to scrub, on the plate and in the box alike.
import * as THREE from "three";
import * as kind from "./kind.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const { WORDS } = kind;
const DEG = Math.PI / 180;

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
const NUM_KEYS = ["ang", "hyst", "settle", "radius", "thr", "fs", "fly"];
const cfg = {
  pos: pick("pos", ["stand", "lie", "float"], "stand"),
  ang: pickNum("ang", [30, 45, 60], 45),
  hyst: pickNum("hyst", [5, 10, 15], 5),
  settle: pickNum("settle", [0.15, 0.3, 0.6], 0.3),
  radius: pickNum("radius", [4, 6, 10], 6),
  thr: pickNum("thr", [10, 12, 14, 16], 12),
  fs: pickNum("fs", [14, 16, 18], 16),
  fly: pickNum("fly", [0, 0.35, 0.6, 1.2], 0.6),
  turn: pick("turn", ["on", "off"], "on"),
  shake: pick("shake", ["on", "off"], "on"),
  sound: pick("sound", ["tone", "silent"], "tone"),
  text: pick("text", ["normal", "longest"], "normal"),
  stage: pick("stage", ["auto", "portrait", "landscape"], "auto"),
  creator: pick("creator", ["circle", "screen"], "circle"),
};

const MARGIN_M = 1.5; // a visitor inside stays inside up to this far past the rim (as the app)
const EYE_M = 1.6;
const LEVEL_PITCH = -10 * DEG; // a phone held up in front, tilted a little down
const DOWN_PITCH = -55 * DEG; // looking down at the phone, the camera at the ground
const EDGE = 0.88; // the plate's centre must be this far inside the screen (NDC)
const FIT = 0.96; // the plate must be narrower than this share of the screen
const TAP_SLOP = 8; // px a finger may move and still count as a tap
const FOLLOW_ROW = 1; // the spoken line sits in the middle row
// one pick for the whole tour, shared by every item whose words travel
const PICK_KEY = "tour-words-pick";

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
  tex.anisotropy = 8;
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

// ---------- the overlay: the same words texture, drawn in screen space while docked or flying ----------
// Each corner carries a clip-space position, so a corner flying from the plate's projected corner
// to the dock's keeps the texture mapped in perspective all the way down.
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
ovGeo.setAttribute(
  "uv",
  new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2),
);
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
ovScene.add(ovMesh);

// ---------- the stage: the window on a phone, a phone frame on a desktop ----------
let W = 390;
let H = 844;
let k = 1;
const bufSize = new THREE.Vector2();
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
  renderer.getDrawingBufferSize(bufSize);
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

// ---------- the item: a narration circle whose words plate is the narration box ----------
const env = { mode: "play", canvasTexture };
let sample = null;
let block = null;
let part = null;
const R = () => block.radiusM;

// ---------- the voice's clock: times invented from the letters, as in the round 5 box ----------
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
let words = []; // { text, start, end }
let sentences = []; // { first, last }
let lineOf = [];
let lineStart = [];
let nLines = 1;
let total = 0;
let t = 0;
let s = 0;
let playing = false;
let finished = false;
let started = false;
let resumeOnReturn = false;

function wordAt(time) {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (words[m].start <= time) {
      found = m;
      lo = m + 1;
    } else {
      hi = m - 1;
    }
  }
  return found;
}
function lineFloatAt(time) {
  if (time >= total) {
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
  const v = clamp(x, 0, nLines);
  const i = Math.floor(v);
  return i >= nLines
    ? total
    : lineStart[i] + (v - i) * (lineStart[i + 1] - lineStart[i]);
}
const maxScroll = () => Math.max(0, nLines - WORDS.rows);
function followTarget() {
  const cur = Math.max(0, wordAt(t));
  return clamp((lineOf[cur] ?? 0) - FOLLOW_ROW, 0, maxScroll());
}

function setText(body) {
  const texts = body.split(/\s+/).filter(Boolean);
  const times = fakeTimes(texts);
  words = texts.map((text, i) => ({
    text,
    start: times[i].start,
    end: times[i].end,
  }));
  const lay = part.words.setText(words);
  lineOf = lay.lineOf;
  nLines = lay.nLines;
  total = words.length ? words[words.length - 1].end + 0.3 : 0;
  sentences = [];
  let first = 0;
  words.forEach((w, i) => {
    if (/[.!?]["']?$/.test(w.text) || i === words.length - 1) {
      sentences.push({ first, last: i });
      first = i + 1;
    }
  });
  lineStart = [];
  words.forEach((w, i) => {
    if (lineStart[lineOf[i]] === undefined) {
      lineStart[lineOf[i]] = w.start;
    }
  });
  lineStart[nLines] = total;
  t = 0;
  s = 0;
  playing = false;
  finished = false;
  started = false;
  resumeOnReturn = false;
  lastPaint.key = "";
}

function mountRecord() {
  hush();
  if (part) {
    part.dispose();
  }
  const rec = {
    ...sample.records[cfg.text],
    radiusM: cfg.radius,
    wordsAt: cfg.pos,
    words: cfg.creator,
  };
  block = kind.read(rec).block;
  part = kind.world(block, env);
  scene.add(part.object);
  ovMat.uniforms.map.value = part.words.texture;
  setText(block.transcript);
  place = "hidden";
  pending = "";
  presence = 0;
  havePlateClip = false;
  inside = false;
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
function tone(i) {
  if (cfg.sound !== "tone" || !actx || actx.state !== "running") {
    return;
  }
  const w = words[i];
  const now = actx.currentTime;
  const dur = Math.max(0.08, (w.end - w.start) * 0.85);
  const letters = w.text.replace(/[^\p{L}]/gu, "").length;
  const osc = actx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(
    165 + (letters % 6) * 15 - (/[.!?]$/.test(w.text) ? 25 : 0),
    now,
  );
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

// ---------- playback ----------
function setPlaying(on) {
  playing = on;
  lastToneWord = -1;
  if (on) {
    started = true;
  } else {
    hush();
  }
}
function finish() {
  playing = false;
  finished = true;
  hush();
}
function advance(dt) {
  if (!playing || dragging || !words.length) {
    return;
  }
  t = Math.min(t + dt, total);
  const cur = wordAt(t);
  if (cur !== lastToneWord) {
    lastToneWord = cur;
    if (cur >= 0 && t < words[cur].end) {
      tone(cur);
    }
  }
  if (t >= total) {
    finish();
  }
}

// ---------- where the words are: the plate, the dock, or nowhere ----------
let inside = false;
let place = "hidden"; // hidden | plate | dock
let pending = "";
let pendingFor = 0;
let why = "";
let u = 1; // 0 = on the plate, 1 = docked; in between it is flying
let uTarget = 1;
let presence = 0; // fades the words in and out
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
  visitorPick ?? (cfg.creator === "circle" ? "world" : "box");

const pv = new THREE.Matrix4();
const v4 = new THREE.Vector4();
const plateClip = new Float32Array(16);
const lastPlateClip = new Float32Array(16);
let havePlateClip = false;
const metrics = {
  valid: false,
  onScreen: false,
  ndcX: 0,
  ndcY: 0,
  letterH: 0,
  letterW: 0,
  letterPx: 0,
  pxPerCanvas: 0,
  spanW: 0,
  angle: 0,
  dist: 0,
};
const nrm = new THREE.Vector3();
const toCam = new THREE.Vector3();
const platePos = new THREE.Vector3();
const tmp = [0, 0, 0, 0];

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
function screenOf(x, y, m) {
  const w = project(x, y, m, tmp, 0);
  return { x: sx(tmp[0], w), y: sy(tmp[1], w) };
}

/**
 * How the plate looks from here. The letter size is the smaller of the projected letter height and
 * width, so a plate seen flat (lying, or from the side) is judged by its squashed side; the angle
 * is the full angle between the plate's face and the line to the camera, so looking down at a
 * lying plate and looking up at a standing one count alike.
 */
function measurePlate() {
  const m = part.plate.matrixWorld;
  const hw = WORDS.canvasW / 2;
  const hh = WORDS.canvasH / 2;
  let ok = true;
  [
    [-hw, hh],
    [hw, hh],
    [-hw, -hh],
    [hw, -hh],
  ].forEach(([x, y], i) => {
    if (project(x, y, m, plateClip, i * 4) < 0.05) {
      ok = false;
    }
  });
  const wc = project(0, 0, m, tmp, 0);
  metrics.ndcX = tmp[0] / Math.max(1e-4, wc);
  metrics.ndcY = tmp[1] / Math.max(1e-4, wc);
  metrics.valid = ok && wc > 0.05;
  if (metrics.valid) {
    const top = screenOf(0, hh, m);
    const bottom = screenOf(0, -hh, m);
    const left = screenOf(-hw, 0, m);
    const right = screenOf(hw, 0, m);
    const hPx = Math.hypot(top.x - bottom.x, top.y - bottom.y);
    const wPx = Math.hypot(right.x - left.x, right.y - left.y);
    metrics.pxPerCanvas = hPx / WORDS.canvasH;
    metrics.letterH = metrics.pxPerCanvas * WORDS.fontPx;
    metrics.letterW = (wPx / WORDS.canvasW) * WORDS.fontPx;
    metrics.letterPx = Math.min(metrics.letterH, metrics.letterW);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 4; i++) {
      const x = sx(plateClip[i * 4], plateClip[i * 4 + 3]);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    metrics.spanW = hi - lo;
  } else {
    metrics.letterH = 0;
    metrics.letterW = 0;
    metrics.letterPx = 0;
    metrics.spanW = 0;
  }
  platePos.setFromMatrixPosition(m);
  nrm.set(0, 0, 1).transformDirection(m);
  toCam.subVectors(camera.position, platePos);
  metrics.angle = THREE.MathUtils.radToDeg(nrm.angleTo(toCam));
  // the flight starts from where the plate was last seen on screen, frozen there once it leaves,
  // so words leaving with a turned-away view do not chase the plate off the edge
  metrics.onScreen =
    metrics.valid && Math.abs(metrics.ndcX) < 1 && Math.abs(metrics.ndcY) < 1;
  if (metrics.onScreen) {
    lastPlateClip.set(plateClip);
    havePlateClip = true;
  }
  metrics.dist = Math.hypot(
    camera.position.x - part.object.position.x,
    camera.position.z - part.object.position.z,
  );
}

function wantPlace() {
  if (!inside) {
    why = "outside the circle";
    return "hidden";
  }
  if (effectiveView() === "box") {
    why = visitorPick
      ? "your tour-wide pick: the box"
      : "the creator chose the screen";
    return "dock";
  }
  const keep = place === "plate" && u === 0;
  const h = cfg.hyst / 100;
  if (!metrics.valid) {
    why = "the plate is behind you or around you";
    return "dock";
  }
  const edge = keep ? Math.min(0.98, EDGE * (1 + h)) : EDGE;
  if (Math.abs(metrics.ndcX) > edge || Math.abs(metrics.ndcY) > edge) {
    why = "the plate is out of view";
    return "dock";
  }
  if (metrics.spanW > W * FIT * (keep ? 1 + h : 1)) {
    why = "too close: wider than the screen";
    return "dock";
  }
  const lim = cfg.ang * (keep ? 1 + h : 1);
  if (metrics.angle > lim) {
    why = `seen ${Math.round(metrics.angle)} deg off its face (limit ${cfg.ang})`;
    return "dock";
  }
  const need = cfg.thr * (keep ? 1 - h : 1);
  if (metrics.letterPx < need) {
    why = `letters ${metrics.letterPx.toFixed(1)} px, under ${cfg.thr} px`;
    return "dock";
  }
  why = `letters ${metrics.letterPx.toFixed(1)} px, ${Math.round(metrics.angle)} deg`;
  return "plate";
}

function decide(dt) {
  const want = wantPlace();
  if (want !== pending) {
    pending = want;
    pendingFor = 0;
  } else {
    pendingFor += dt;
  }
  // a finger on the words holds them where they are; appearing and hiding need no settling
  const now =
    want === "hidden" || place === "hidden" || pendingFor >= cfg.settle;
  if (want !== place && now && !dragging) {
    const appearing = place === "hidden" || presence === 0;
    place = want;
    if (want !== "hidden") {
      uTarget = want === "dock" ? 1 : 0;
      if (appearing) {
        u = uTarget;
      }
    }
  }
  const instant = cfg.fly === 0 || reduceMotion;
  if (instant) {
    u = uTarget;
  } else if (u !== uTarget) {
    const step = dt / cfg.fly;
    u = u < uTarget ? Math.min(uTarget, u + step) : Math.max(uTarget, u - step);
  }
  const pTarget = place === "hidden" ? 0 : 1;
  presence = reduceMotion
    ? pTarget
    : clamp(presence + (pTarget > presence ? dt : -dt) / 0.3, 0, 1);
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function dockRect() {
  const w = Math.min(WORDS.measureEm * cfg.fs, 0.8 * W, 720);
  const h = (w * WORDS.canvasH) / WORDS.canvasW;
  const bottom = W > H ? 10 : 18;
  return { x: (W - w) / 2, y: H - bottom - h, w, h };
}

function layoutBox() {
  const showPlate = presence > 0 && u === 0;
  const showOverlay = presence > 0 && u > 0;
  part.plate.visible = showPlate;
  part.plate.material.opacity = presence;
  ovMesh.visible = showOverlay;
  if (!showOverlay) {
    return;
  }
  ovMat.uniforms.opacity.value = presence;
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
  const src = metrics.onScreen
    ? plateClip
    : havePlateClip
      ? lastPlateClip
      : null;
  const e = src ? ease(u) : 1;
  let wRef = 1;
  if (src) {
    wRef = (src[3] + src[7] + src[11] + src[15]) / 4;
  }
  for (let i = 0; i < 4; i++) {
    const a = i * 4;
    const dx = dock[i * 2] * wRef;
    const dy = dock[i * 2 + 1] * wRef;
    clipArr[a] = src ? src[a] * (1 - e) + dx * e : dock[i * 2];
    clipArr[a + 1] = src ? src[a + 1] * (1 - e) + dy * e : dock[i * 2 + 1];
    clipArr[a + 2] = src ? src[a + 2] * (1 - e) : 0;
    clipArr[a + 3] = src ? src[a + 3] * (1 - e) + wRef * e : 1;
  }
  clipAttr.needsUpdate = true;
}

/** The words' current outline on the screen, in device px: TL, TR, BR, BL. */
function wordsQuad() {
  const src = u > 0 ? clipArr : plateClip;
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

// ---------- gestures: the same on the plate and in the box ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let press = null;
let dragging = false;
let creditUntil = 0;
let clock = 0;
let note = { text: "", until: 0 };

function hitTest(x, y) {
  if (presence > 0.5 && place !== "hidden") {
    if (u > 0) {
      const q = wordsQuad();
      if (inQuad(x, y, q)) {
        const hgt =
          (Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) +
            Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)) /
          2;
        const r = dockRect();
        const uv =
          u === 1 ? { x: (x - r.x) / r.w, y: 1 - (y - r.y) / r.h } : null;
        return {
          what: "words",
          linePx: (hgt / WORDS.canvasH) * WORDS.linePx,
          uv,
        };
      }
    } else if (metrics.valid) {
      ndc.set((x / W) * 2 - 1, 1 - (y / H) * 2);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(part.plate, false)[0];
      if (hit) {
        return {
          what: "words",
          linePx: metrics.pxPerCanvas * WORDS.linePx,
          uv: hit.uv,
        };
      }
    }
  }
  ndc.set((x / W) * 2 - 1, 1 - (y / H) * 2);
  raycaster.setFromCamera(ndc, camera);
  if (raycaster.intersectObject(part.tapTarget, false).length) {
    return { what: "column" };
  }
  return { what: "look" };
}

// The finger's screen motion is read from the press on: the plate is never hit-tested again while
// it moves under the finger (hand shake, tracking), and one line height of finger travel, as the
// line looked at the press, is one line of text and of the voice.
function pressStart(x, y, id) {
  const hit = hitTest(x, y);
  press = {
    id,
    x,
    y,
    ...hit,
    line0: lineFloatAt(t),
    s0: s,
    yaw0: userYaw,
    pitch0: userPitch,
  };
}
function pressMove(x, y) {
  const dx = x - press.x;
  const dy = press.y - y; // finger up = words up = ahead
  if (press.what === "column" && Math.hypot(dx, dy) > TAP_SLOP) {
    press.what = "look";
  }
  if (press.what === "look") {
    userYaw = press.yaw0 + dx * 0.005;
    userPitch = clamp(press.pitch0 - dy * 0.005, -1.2, 1.0);
    return;
  }
  if (press.what !== "words") {
    return;
  }
  if (!dragging && Math.hypot(dx, dy) > TAP_SLOP) {
    dragging = true;
    hush();
  }
  if (dragging) {
    const lines = dy / Math.max(4, press.linePx);
    t = timeAtLine(press.line0 + lines);
    finished = false;
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
  if (cancelled) {
    return;
  }
  if (pr.what === "words") {
    if (was) {
      lastToneWord = -1;
      if (t >= total && !finished) {
        finish();
      }
      return;
    }
    tapWords(x, y, pr.uv);
    return;
  }
  if (pr.what === "column") {
    // the circle's own tap rule: inside, a tap on its column plays or pauses; outside, nothing
    if (inside) {
      tapWords(x, y, null);
    } else {
      note = { text: "Walk into the circle to listen.", until: clock + 2.5 };
    }
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

function onBadge(uv) {
  if (!uv) {
    return false;
  }
  const b = part.words.badge;
  const cx = uv.x * WORDS.canvasW;
  const cy = (1 - uv.y) * WORDS.canvasH;
  return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
}
function tapWords(x, y, uv) {
  if (onBadge(uv)) {
    creditUntil = creditUntil > clock ? 0 : clock + 4;
    return;
  }
  if (finished || t >= total) {
    t = 0;
    finished = false;
    setPlaying(true);
  } else {
    setPlaying(!playing);
  }
  resumeOnReturn = false;
  tapSign(x, y, playing);
}
const ICON_PLAY =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
function tapSign(x, y, nowPlaying) {
  const fx = document.createElement("div");
  fx.className = "tapfx";
  fx.style.left = `${x}px`;
  fx.style.top = `${y}px`;
  fx.innerHTML = nowPlaying ? ICON_PLAY : ICON_PAUSE;
  device.append(fx);
  fx.addEventListener("animationend", () => fx.remove());
  setTimeout(() => fx.remove(), 1500);
}

// ---------- painting the words (only when something changed) ----------
const lastPaint = { key: "" };
const paintStats = { n: 0, sum: 0, max: 0 };
function hint() {
  if (dragging) {
    return "";
  }
  if (finished) {
    return "the end - tap to hear it again";
  }
  if (playing) {
    return "";
  }
  return started ? "paused - tap to play" : "tap the words to listen";
}
function paintWords() {
  if (presence === 0) {
    return;
  }
  const view = {
    t: started ? t : -1,
    s,
    hint: hint(),
    credit: clock < creditUntil,
    scrubbing: dragging,
  };
  // a word is still fading for 0.67 s after it starts; past that nothing moves while paused
  const key = `${view.t.toFixed(3)}|${s.toFixed(3)}|${view.hint}|${view.credit}|${dragging}`;
  if (key === lastPaint.key) {
    return;
  }
  lastPaint.key = key;
  const t0 = performance.now();
  part.words.paint(view);
  const dt = performance.now() - t0;
  paintStats.n++;
  paintStats.sum += dt;
  paintStats.max = Math.max(paintStats.max, dt);
}
function voiceState() {
  if (!inside && resumeOnReturn) {
    return "away";
  }
  if (playing) {
    return "playing";
  }
  if (finished) {
    return "ended";
  }
  return started ? "paused" : "idle";
}

// ---------- the viewer: beats move and turn them, a drag on the view turns them too ----------
// (in AR the phone does the turning; the drag stands in for it here)
const viewer = { pos: new THREE.Vector3(0, EYE_M, 0), heading: 0, pitch: 0 };
const tweens = { pos: null, heading: null, pitch: null };
let userYaw = 0;
let userPitch = 0;
let lookDown = false;
let shakeAmp = 0;
const smooth = (f) => f * f * (3 - 2 * f);
function tweenTo(key, to, dur, linear = false) {
  if (dur <= 0 || reduceMotion) {
    if (key === "pos") {
      viewer.pos.copy(to);
    } else {
      viewer[key] = to;
    }
    tweens[key] = null;
    return;
  }
  const from = key === "pos" ? viewer.pos.clone() : viewer[key];
  tweens[key] = { from, to, t0: clock, dur, linear };
}
/** Turn to a heading the short way round. */
function headTo(h, dur) {
  const d = Math.atan2(Math.sin(h - viewer.heading), Math.cos(h - viewer.heading));
  tweenTo("heading", viewer.heading + d, dur);
}
const facing = (x, z, px, pz) => Math.atan2(x - px, z - pz);
function stand(x, z, heading, dur) {
  tweenTo("pos", new THREE.Vector3(x, EYE_M, z), dur);
  headTo(heading, dur);
}
function setLookDown(on) {
  lookDown = on;
  tweenTo("pitch", on ? DOWN_PITCH : LEVEL_PITCH, 0.9);
  $("downBtn").setAttribute("aria-pressed", String(on));
  $("downBtn").textContent = on ? "Look up" : "Look down";
}
function updateViewer(dt) {
  for (const key of ["pos", "heading", "pitch"]) {
    const tw = tweens[key];
    if (!tw) {
      continue;
    }
    const f = clamp((clock - tw.t0) / tw.dur, 0, 1);
    const e = tw.linear ? f : smooth(f);
    if (key === "pos") {
      viewer.pos.lerpVectors(tw.from, tw.to, e);
    } else {
      viewer[key] = tw.from + (tw.to - tw.from) * e;
    }
    if (f >= 1) {
      tweens[key] = null;
    }
  }
  const shaking = press && press.what === "words" && cfg.shake === "on";
  shakeAmp += ((shaking ? 1 : 0) - shakeAmp) * (1 - Math.exp(-dt * 8));
  camera.position.copy(viewer.pos);
  const sway = reduceMotion ? 0 : 1;
  // a thumb swipe on a phone held in one hand shakes it by about half a degree
  const sh = shakeAmp * sway;
  const shakeY =
    sh * 0.009 * (Math.sin(clock * 5.3) + 0.6 * Math.sin(clock * 11.7));
  const shakeP =
    sh * 0.008 * (Math.sin(clock * 7.1 + 1) + 0.5 * Math.sin(clock * 13.3));
  camera.rotation.y =
    viewer.heading + userYaw + Math.sin(clock * 0.53) * 0.01 * sway + shakeY;
  camera.rotation.x = clamp(
    viewer.pitch + userPitch + Math.sin(clock * 0.71) * 0.005 * sway + shakeP,
    -1.4,
    1.2,
  );
}

// ---------- the beats ----------
// The beats are body poses, the same for every place of the words, so the three places compare.
// The route arrives from +z; the far rim is at -z.
let script = null; // the scripted scrub, while it runs
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
const wait = (ms, run) =>
  new Promise((resolve, reject) => {
    setTimeout(
      () => (run.cancelled ? reject(new Error("cancelled")) : resolve()),
      ms,
    );
  });
function wordsCentre() {
  const q = wordsQuad();
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 + 6,
  };
}
function goInside() {
  if (!inside) {
    stand(0, 0, 0, 0);
    inside = true;
  }
}
async function scriptedScrub() {
  const run = { cancelled: false };
  script = run;
  try {
    goInside();
    if (!playing) {
      const sIdx = Math.min(2, sentences.length - 1);
      t = words[sentences[sIdx].first].start;
      finished = false;
      setPlaying(true);
      await wait(2600, run);
    }
    const c = wordsCentre();
    fingerEl.hidden = false;
    fingerEl.style.left = `${c.x}px`;
    fingerEl.style.top = `${c.y}px`;
    await wait(350, run);
    pressStart(c.x, c.y, "script");
    await wait(90, run);
    pressEnd(c.x, c.y, false);
    await wait(700, run);
    const c2 = wordsCentre();
    pressStart(c2.x, c2.y, "script");
    const linePx = press.what === "words" ? press.linePx : 20;
    const t0 = performance.now();
    for (;;) {
      await new Promise((r) => requestAnimationFrame(r));
      if (run.cancelled) {
        throw new Error("cancelled");
      }
      const f = clamp((performance.now() - t0) / 1000, 0, 1);
      const y = c2.y + smooth(f) * linePx * 2;
      fingerEl.style.top = `${y}px`;
      pressMove(c2.x, y);
      if (f >= 1) {
        break;
      }
    }
    pressEnd(c2.x, c2.y + linePx * 2, false);
    await wait(1100, run);
    const c3 = wordsCentre();
    fingerEl.style.left = `${c3.x}px`;
    fingerEl.style.top = `${c3.y}px`;
    await wait(300, run);
    pressStart(c3.x, c3.y, "script");
    pressEnd(c3.x, c3.y, false);
    await wait(500, run);
  } catch {
    // cancelled by another beat
  }
  if (script === run) {
    script = null;
  }
  fingerEl.hidden = true;
}
const WALK_MS = 1.25; // m/s
function beat(name, dur = 1) {
  cancelScript();
  if (name !== "turn" && name !== "down") {
    userYaw = 0;
    userPitch = 0;
  }
  const r = R();
  if (name === "walk") {
    stand(0, r + 8, 0, 0);
    tweenTo("pos", new THREE.Vector3(0, EYE_M, 0), dur * ((r + 8) / WALK_MS));
  } else if (name === "edge") {
    stand(0, r - 0.3, 0, 1.2 * dur);
  } else if (name === "centre") {
    stand(0, 0, 0, 1.2 * dur);
  } else if (name === "side") {
    stand(0.7 * r, 0, facing(0.7 * r, 0, 0, -r), 1.4 * dur);
  } else if (name === "far") {
    stand(0, -r + 1.2, Math.PI, 1.6 * dur);
  } else if (name === "turn") {
    // a slow full turn on the spot: away from the words and back to them
    tweenTo("heading", viewer.heading + Math.PI * 2, 10 * dur, true);
  } else if (name === "down") {
    setLookDown(!lookDown);
  } else if (name === "scrub") {
    scriptedScrub();
  } else if (name === "leave") {
    const d = r + 6 - viewer.pos.z;
    headTo(Math.PI, 0.8 * dur);
    tweenTo(
      "pos",
      new THREE.Vector3(0, EYE_M, r + 6),
      dur * (Math.hypot(d, viewer.pos.x) / WALK_MS + 0.5),
    );
  } else if (name === "end") {
    goInside();
    t = words[sentences[sentences.length - 1].first].start;
    finished = false;
    setPlaying(true);
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
function applyCfg() {
  document.querySelectorAll("[data-cfg]").forEach((b) => {
    b.classList.toggle("on", String(cfg[b.dataset.cfg]) === b.dataset.v);
  });
  if (cfg.sound !== "tone") {
    hush();
  }
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
    cfg[key] = NUM_KEYS.includes(key) ? Number(b.dataset.v) : b.dataset.v;
    applyCfg();
    saveCfg();
    if (before === cfg[key] || !part) {
      return;
    }
    if (key === "text" || key === "radius") {
      mountRecord();
    } else if (key === "pos") {
      part.setPlace(cfg.pos);
      havePlateClip = false;
    }
  });
});
$("menuBtn").addEventListener("click", () => {
  $("demo").hidden = !$("demo").hidden;
});
$("demoClose").addEventListener("click", () => {
  $("demo").hidden = true;
});
$("exitBtn").addEventListener("click", () => {
  note = { text: "Exit is not part of this prototype.", until: clock + 2.5 };
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing) {
    setPlaying(false);
  }
});

// ---------- readout and cost ----------
const frameStats = { workMax: 0, workSum: 0, n: 0, over50: 0, gapMax: 0 };
let statsAt = 0;
let costAt = -1;
function partCost() {
  let draws = 0;
  let tris = 0;
  let points = 0;
  part.object.traverse((o) => {
    if (!o.visible || (o.material && o.material.visible === false)) {
      return;
    }
    if (o.isPoints) {
      draws++;
      points += o.geometry.attributes.position.count;
    } else if (o.isMesh) {
      draws++;
      const gm = o.geometry;
      tris += (gm.index ? gm.index.count : gm.attributes.position.count) / 3;
    }
  });
  if (ovMesh.visible) {
    draws++;
    tris += 2;
  }
  return { draws, tris, points };
}
function where() {
  if (presence === 0) {
    return "hidden";
  }
  if (u === 0) {
    return "over the circle";
  }
  return u === 1 ? "in the box" : "flying";
}
function report(now) {
  if (now - statsAt < 250) {
    return;
  }
  const deg = (r) => Math.round(THREE.MathUtils.radToDeg(r));
  const heading = (((deg(camera.rotation.y) % 360) + 540) % 360) - 180;
  readoutEl.textContent =
    clock < note.until
      ? note.text
      : `${metrics.dist.toFixed(1)} m from centre, ${inside ? "inside" : "outside"} the ${R()} m circle; heading ${heading}, pitch ${deg(camera.rotation.x)} deg
` +
        `letters ${metrics.letterH.toFixed(1)} tall, ${metrics.letterW.toFixed(1)} wide (from ${cfg.thr} px); ${Math.round(metrics.angle)} deg off face (limit ${cfg.ang})
` +
        `${where()}: ${why}`;
  if (costAt < 0 || now - costAt >= 1000) {
    costAt = now;
    const c = partCost();
    const info = renderer.info.render;
    const dockFont = (dockRect().w / WORDS.canvasW) * WORDS.fontPx;
    costEl.textContent =
      `Frame work avg ${(frameStats.workSum / Math.max(1, frameStats.n)).toFixed(1)} ms, max ${frameStats.workMax.toFixed(1)} ms; ` +
      `longest gap ${Math.round(frameStats.gapMax)} ms; frames over 50 ms since load: ${frameStats.over50}. ` +
      `This item: ${c.draws} draws, ${c.tris} triangles, ${c.points} motes (whole frame ${info.calls} draws). ` +
      `Words repaint avg ${(paintStats.sum / Math.max(1, paintStats.n)).toFixed(2)} ms, max ${paintStats.max.toFixed(2)} ms, ${paintStats.n} per s. ` +
      `Box text ${dockFont.toFixed(1)} px.`;
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
function frame(now) {
  const gap = now - lastNow;
  const dt = Math.min(0.1, gap / 1000);
  lastNow = now;
  clock += dt;
  const t0 = performance.now();
  renderer.info.reset();

  updateViewer(dt);
  part.update({
    viewer: camera.position,
    turns: cfg.turn === "on",
    dt,
    halfH: bufSize.y / 2,
  });
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  measurePlate();

  // inside opens at the rim and holds to the rim plus the margin, as the app's circle does;
  // the voice plays only inside: walking out holds it, walking back in carries it on
  inside =
    metrics.dist <= R() ? true : metrics.dist > R() + MARGIN_M ? false : inside;
  if (!inside && playing) {
    setPlaying(false);
    resumeOnReturn = true;
  } else if (inside && resumeOnReturn) {
    resumeOnReturn = false;
    setPlaying(true);
  }
  advance(dt);
  decide(dt);
  if (!dragging) {
    const target = followTarget();
    s = reduceMotion ? target : s + (target - s) * (1 - Math.exp(-dt * 9));
    if (Math.abs(target - s) < 0.002) {
      s = target;
    }
  }
  paintWords();
  part.show(voiceState(), inside);
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

// ---------- start: standing in the centre, facing the far rim ----------
applyCfg();
viewer.pitch = LEVEL_PITCH;
try {
  const res = await fetch("sample.json");
  if (!res.ok) {
    throw new Error(`sample.json: HTTP ${res.status}`);
  }
  sample = await res.json();
  mountRecord();
  const at = params.get("at");
  const opening = ["walk", "edge", "centre", "side", "far"].includes(at)
    ? at
    : "centre";
  beat(opening, opening === "walk" ? 1 : 0);
  if (params.get("look") === "down") {
    setLookDown(true);
    tweens.pitch = null;
    viewer.pitch = DOWN_PITCH;
  }
  if (params.has("autostart")) {
    setPlaying(true);
  }
  requestAnimationFrame(frame);
} catch (err) {
  readoutEl.textContent = `Could not load the sample text (${err.message}).`;
}
