// Sign speaks 6.1 - plate first, box as fallback. Throwaway prototype: not wired to the app, linked from nothing in it.
// The page is the host: a simulated camera view of a lane, the round-5 narration box, the beats and the
// knobs. The sign and its caption plate are the world view in kind.js. One timeline drives both places;
// the words show on the plate while it is legible and in view, else in the box, never in both.
import * as THREE from "three";
import {
  CAP_FONT_M,
  CAP_LINE_M,
  CAP_ROWS,
  captionLayout,
  read,
  world,
} from "./kind.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DEG = Math.PI / 180;

// ---------- settings: URL options and the knobs ----------
const params = new URLSearchParams(location.search);
const CHOICES = {
  th: ["10", "12", "14", "16"],
  fs: ["14", "16", "18"],
  grow: ["on", "off"],
  frame: ["portrait", "landscape"],
  creator: ["sign", "box"],
  turn: ["turns", "fixed"],
  shake: ["off", "calm", "one"],
  drag: ["finger", "hit"],
  tone: ["on", "off"],
  rec: ["normal", "longest", "missing"],
};
const DEFAULTS = {
  th: "12",
  fs: "16",
  grow: "on",
  frame: "portrait",
  creator: "sign",
  turn: "turns",
  shake: "calm",
  drag: "finger",
  tone: "on",
  rec: "normal",
};
const cfg = {};
for (const [k, options] of Object.entries(CHOICES)) {
  const v = params.get(k);
  cfg[k] = options.includes(v) ? v : DEFAULTS[k];
}
/** The visitor's own pick in the view menu; null follows the tour's choice. The visitor wins. */
let visitorPick = null;
const wordsWanted = () => visitorPick ?? cfg.creator;

const TAP_SLOP = 8; // px a finger may move and still be a tap (round 5)
const FOLLOW_ROW = 1; // the spoken line sits in the middle row
const RADIUS_M = 20; // the station: narration plays only inside it
const HYST = 0.05; // 5 % hysteresis on the legibility threshold
const DWELL_S = 0.25; // a new place must hold this long before the words move
const ANGLE_COS = 0.5; // a plate seen at more than 60 degrees cannot carry text
const BOX_SHARE = 0.8;
const BOX_CAP = 720;
const BOX_CHROME = 38;
const EYE_M = 1.6;
const LOOK_AT_Y = 1.85;

// ---------- the story: timed text on invented times, no recording ----------
const sample = await fetch("sample.json").then((r) => r.json());
let block = null;

function fakeTimes(texts) {
  let t = 0.3;
  return texts.map((w) => {
    const letters = w.replace(/[^\p{L}\p{N}]/gu, "").length;
    const d = clamp(0.11 + 0.052 * letters, 0.17, 0.64);
    const start = t;
    t += d;
    if (/[.!?:]["']?$/.test(w)) {
      t += 0.42;
    } else if (/[,;]$/.test(w)) {
      t += 0.22;
    }
    return { start, end: start + d };
  });
}

/** The one narration state both places read. */
const N = {
  words: [],
  total: 0,
  t: 0,
  playing: false,
  finished: false,
  started: false,
  missing: false,
  carryOn: false,
  noticeUntil: 0,
};
const NOTICE =
  "The voice cannot be played here.\nTap Read on the sign for the whole text.";

function wordAt(time) {
  let lo = 0;
  let hi = N.words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (N.words[m].start <= time) {
      found = m;
      lo = m + 1;
    } else {
      hi = m - 1;
    }
  }
  return found;
}

// ---------- lines: each place wraps the same words its own way ----------
function makeLayout(lineOf, nLines) {
  const lineStart = new Array(nLines + 1);
  lineStart[nLines] = N.total;
  N.words.forEach((w, i) => {
    if (lineStart[lineOf[i]] === undefined) {
      lineStart[lineOf[i]] = w.start;
    }
  });
  for (let k = nLines - 1; k >= 0; k--) {
    if (lineStart[k] === undefined) {
      lineStart[k] = lineStart[k + 1];
    }
  }
  return { lineOf, lineStart, nLines };
}
const rowsOf = (L) => Math.min(CAP_ROWS, L.nLines);
const maxScroll = (L) => Math.max(0, L.nLines - rowsOf(L));
function lineFloatAt(L, time) {
  if (time >= N.total) {
    return L.nLines;
  }
  let k = 0;
  while (k + 1 < L.nLines && L.lineStart[k + 1] <= time) {
    k++;
  }
  const span = L.lineStart[k + 1] - L.lineStart[k];
  return k + (span > 0 ? clamp((time - L.lineStart[k]) / span, 0, 1) : 0);
}
function timeAtLine(L, x) {
  const v = clamp(x, 0, L.nLines);
  const k = Math.floor(v);
  if (k >= L.nLines) {
    return N.total;
  }
  return L.lineStart[k] + (v - k) * (L.lineStart[k + 1] - L.lineStart[k]);
}
function followTarget(L) {
  const cur = Math.max(0, wordAt(N.t));
  return clamp((L.lineOf[cur] ?? 0) - FOLLOW_ROW, 0, maxScroll(L));
}

/** The two places of the words. `s` is the first visible line (float). */
const S = {
  plate: { L: makeLayout([], 1), s: 0, tokens: [], layout: null, off: 0 },
  box: { L: makeLayout([], 1), s: 0 },
};

// ---------- the scene: a lane with houses, the host's light and sky ----------
const device = $("device");
const canvas = $("cam");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
camera.rotation.order = "YXZ";

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
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function buildScene() {
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
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
  sun.position.set(30, 70, 40);
  scene.add(sun);
  const rand = rng(5);
  const cobble = paintedTexture(256, 256, (g, w, h) => {
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
  cobble.wrapS = THREE.RepeatWrapping;
  cobble.wrapT = THREE.RepeatWrapping;
  cobble.repeat.set(60, 60);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ map: cobble }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  buildHouses(rand);
}
function buildHouses(rand) {
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
  const spots = [];
  for (let z = -86; z < 40; z += 9) {
    spots.push([-12, z], [12, z]);
  }
  for (let x = -3; x <= 3; x += 6) {
    spots.push([x * 1.5, 44]);
  }
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
    const h = 8 + rand() * 6;
    m.compose(
      new THREE.Vector3(x, h / 2, z),
      new THREE.Quaternion(),
      new THREE.Vector3(8, h, 8.4),
    );
    walls.setMatrixAt(i, m);
    walls.setColorAt(i, c.setHex(colors[Math.floor(rand() * colors.length)]));
    m.compose(
      new THREE.Vector3(x, h + 1.5, z),
      turn,
      new THREE.Vector3(8, 3, 8.4),
    );
    roofs.setMatrixAt(i, m);
  });
  scene.add(walls, roofs);
}
buildScene();

// ---------- the world view: the reading sign and its caption plate ----------
const part = world(read(sample.records.normal).block, {
  canvasTexture,
  mode: "play",
});
scene.add(part.object);

// ---------- the viewer: a stand, an angle, a look; beats animate them ----------
const STANDS = {
  d3: { d: 3, ang: 0 },
  d7: { d: 7, ang: 0 },
  d16: { d: 16, ang: 0 },
  side: { d: 5, ang: 65 },
};
const startStand = STANDS[params.get("stand")] ?? STANDS.d7;
const V = {
  d: startStand.d,
  ang: startStand.ang,
  look: 0,
  userYaw: 0,
  userPitch: 0,
};
const anims = [];
function animate(key, to, dur) {
  for (let i = anims.length - 1; i >= 0; i--) {
    if (anims[i].key === key) {
      anims.splice(i, 1);
    }
  }
  anims.push({
    key,
    from: V[key],
    to,
    t0: performance.now(),
    dur: reduceMotion ? 1 : dur * 1000,
  });
}
function stepAnims(now) {
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i];
    const p = clamp((now - a.t0) / a.dur, 0, 1);
    const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    V[a.key] = a.from + (a.to - a.from) * e;
    if (p >= 1) {
      anims.splice(i, 1);
    }
  }
}

let focal = 500;
/** A phone camera: upright 42 degrees across, sideways 50 degrees high (as in the earlier sign round). */
function fitCamera() {
  const w = device.clientWidth;
  const h = device.clientHeight;
  focal = h >= w ? w / 2 / Math.tan(21 * DEG) : h / 2 / Math.tan(25 * DEG);
  camera.fov = (2 * Math.atan(h / 2 / focal)) / DEG;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

const SHAKE = { off: 0, calm: 0.003, one: 0.009 };
function shakeAt(sec) {
  let amp = SHAKE[cfg.shake];
  if (cfg.shake === "one" && press?.surface === "plate") {
    amp *= 2.2; // a thumb swiping on a phone held in the same hand
  }
  if (reduceMotion || amp === 0) {
    return { yaw: 0, pitch: 0 };
  }
  return {
    yaw: amp * (Math.sin(sec * 4.3) * 0.6 + Math.sin(sec * 7.9 + 1.3) * 0.4),
    pitch: amp * (Math.sin(sec * 5.1 + 0.4) * 0.6 + Math.sin(sec * 9.7) * 0.4),
  };
}
function placeCamera(sec) {
  const a = V.ang * DEG;
  camera.position.set(Math.sin(a) * V.d, EYE_M, Math.cos(a) * V.d);
  const lx = -camera.position.x;
  const ly = LOOK_AT_Y * part.scale() - EYE_M;
  const lz = -camera.position.z;
  const sh = shakeAt(sec);
  camera.rotation.y = Math.atan2(-lx, -lz) + V.look * DEG + V.userYaw + sh.yaw;
  camera.rotation.x = clamp(
    Math.atan2(ly, Math.hypot(lx, lz)) + V.userPitch + sh.pitch,
    -1.2,
    1.2,
  );
}

// ---------- where the words can be: the plate's legibility and view ----------
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const nrm = new THREE.Vector3();
function measureSign() {
  const cap = part.caption.mesh;
  cap.getWorldPosition(tmpV);
  const d = camera.position.distanceTo(tmpV);
  cap.getWorldQuaternion(tmpQ);
  nrm.set(0, 0, 1).applyQuaternion(tmpQ);
  const cos = nrm.dot(camera.position.clone().sub(tmpV).normalize());
  const letterPx = (CAP_FONT_M * part.scale() * focal) / d;
  return {
    d,
    cos,
    letterPx,
    angleDeg: Math.round(Math.acos(clamp(cos, -1, 1)) / DEG),
    ...plateOnScreen(cap),
  };
}
/** The plate's text area on screen: wholly in front, inside the width, below the top bar. */
function plateOnScreen(cap) {
  const W = device.clientWidth;
  const H = device.clientHeight;
  const { width, height } = cap.geometry.parameters;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let behind = false;
  for (const [cx, cy] of [
    [-0.45, -0.5],
    [0.45, -0.5],
    [-0.45, 0.5],
    [0.45, 0.5],
  ]) {
    const p = cap.localToWorld(new THREE.Vector3(cx * width, cy * height, 0));
    behind ||= p.clone().applyMatrix4(camera.matrixWorldInverse).z > -0.05;
    p.project(camera);
    const x = ((p.x + 1) / 2) * W;
    const y = ((1 - p.y) / 2) * H;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const inView = !behind && minX > -4 && maxX < W + 4 && minY > 60 && maxY < H;
  const wide = !behind && maxX - minX > W;
  return { inView, behind, wide, rect: { minX, maxX, minY, maxY } };
}

let place = "none"; // "plate" | "box" | "none"
let placeWhy = "";
let pending = null;
function decide(m) {
  if (wordsWanted() === "box") {
    return {
      p: "box",
      why: visitorPick
        ? "the visitor picked the box"
        : "the tour puts the words in the box",
    };
  }
  if (!m.inView) {
    return { p: "box", why: outOfViewWhy(m) };
  }
  if (m.cos < ANGLE_COS) {
    return { p: "box", why: `the plate is seen at ${m.angleDeg} degrees` };
  }
  const th = Number(cfg.th) * (place === "plate" ? 1 - HYST : 1 + HYST);
  if (m.letterPx < th) {
    return {
      p: "box",
      why: `letters ${m.letterPx.toFixed(1)} px, under ${cfg.th}`,
    };
  }
  return { p: "plate", why: `letters ${m.letterPx.toFixed(1)} px` };
}
function outOfViewWhy(m) {
  if (m.behind) {
    return "the sign is behind you";
  }
  return m.wide
    ? "the plate is wider than the view"
    : "the sign is out of view";
}
/** The words move only after a new place has held for DWELL_S, and never while a finger is on them. */
function updatePlace(m, dt) {
  const want = decide(m);
  placeWhy = want.why;
  if (press || want.p === place) {
    pending = null;
    return;
  }
  if (place === "none") {
    switchPlace(want.p);
    return;
  }
  pending =
    pending?.p === want.p
      ? { p: want.p, for: pending.for + dt }
      : { p: want.p, for: 0 };
  if (pending.for >= DWELL_S) {
    switchPlace(want.p);
    pending = null;
  }
}
function switchPlace(p) {
  place = p;
  const surf = S[p];
  surf.s = followTarget(surf.L);
  plateKey = "";
}

// ---------- the record: words, the plate's tokens, the box's spans ----------
function loadRecord(name) {
  block = read(sample.records[name]).block;
  const texts = block.body.split(/\s+/).filter(Boolean);
  const times = fakeTimes(texts);
  N.words = texts.map((text, i) => ({
    text,
    start: times[i].start,
    end: times[i].end,
  }));
  N.total = N.words.length ? N.words[N.words.length - 1].end + 0.4 : 0;
  Object.assign(N, {
    t: 0,
    playing: false,
    finished: false,
    started: false,
    carryOn: false,
    noticeUntil: 0,
  });
  N.missing = !block.narration?.audio;
  litUpTo = -1;
  buildPlate();
  buildBox();
  layoutBox();
  signKey = "";
  plateKey = "";
  $("sheetTitle").textContent = block.title;
  $("sheetBody").textContent = block.body;
  $("hint").classList.remove("gone");
}

function speaker() {
  return {
    name: block.narration?.speaker ?? "Narrator",
    color: block.narration?.color ?? "#f9a8d4",
  };
}
function buildPlate() {
  const lead = [{ kind: "name", text: speaker().name }];
  if (block.narration?.synthetic) {
    lead.push({ kind: "badge", text: "" });
  }
  const tokens = [
    ...lead,
    ...N.words.map((w) => ({ kind: "word", text: w.text, on: false })),
  ];
  const layout = captionLayout(tokens);
  const off = lead.length;
  const lineOf = N.words.map((_, i) => layout.lineOfToken[i + off]);
  Object.assign(S.plate, {
    tokens,
    layout,
    off,
    L: makeLayout(lineOf, layout.lines.length),
    s: 0,
  });
}

// ---------- the box: the round-5 look, the fallback place ----------
const nbox = $("nbox");
const col = $("col");
const win = $("win");
const thumb = $("thumb");
const sbar = $("sbar");
let boxEls = [];
let lh = 22;
/** Each box line's measured top (px): the column moves by these, not by a nominal line height. */
let boxTops = [0];
const boxNotice = document.createElement("div");
boxNotice.className = "col notice";
boxNotice.hidden = true;
win.append(boxNotice);
const meas = document.createElement("span");
meas.style.cssText =
  "position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;font-size:var(--fs)";
win.append(meas);

function buildBox() {
  col.textContent = "";
  const who = document.createElement("b");
  who.className = "who";
  who.textContent = speaker().name;
  who.style.color = speaker().color;
  col.append(who, " ");
  if (block.narration?.synthetic) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "AI voice";
    col.append(badge, " ");
  }
  boxEls = N.words.map((w) => {
    const el = document.createElement("span");
    el.className = "w";
    el.textContent = w.text;
    col.append(el, " ");
    return el;
  });
  boxNotice.textContent = NOTICE.replace("\n", " ");
}
function layoutBox() {
  const boxMax = Math.min(device.clientWidth * BOX_SHARE, BOX_CAP);
  meas.textContent = col.textContent;
  const natural = meas.getBoundingClientRect().width;
  const textW = Math.floor(
    clamp(natural + 2, 90, Math.max(90, boxMax - BOX_CHROME)),
  );
  col.style.width = `${textW}px`;
  boxNotice.style.width = `${textW}px`;
  const tops = [col.firstChild.offsetTop];
  const lineOf = boxEls.map((el) => {
    let k = tops.findIndex((x) => Math.abs(x - el.offsetTop) < lh / 2);
    if (k < 0) {
      tops.push(el.offsetTop);
      k = tops.length - 1;
    }
    return k;
  });
  boxTops = tops.map((x) => x - tops[0]);
  S.box.L = makeLayout(lineOf, Math.max(1, tops.length));
  S.box.s = followTarget(S.box.L);
  nbox.style.setProperty("--rows", String(rowsOf(S.box.L)));
  sbar.classList.toggle("none", S.box.L.nLines <= CAP_ROWS);
}

// ---------- playback ----------
const now = () => performance.now();
const noticeOn = () => now() < N.noticeUntil;
function start() {
  N.started = true;
  N.playing = true;
  N.finished = false;
  $("hint").classList.add("gone");
  ensureAudio();
}
function togglePlay() {
  if (!N.started) {
    start();
  } else if (N.finished || N.t >= N.total) {
    N.t = 0;
    N.finished = false;
    N.playing = true;
  } else {
    N.playing = !N.playing;
  }
  N.carryOn = false;
}
function advance(dt) {
  if (!N.playing || press?.dragging || scrubAnim) {
    return;
  }
  N.t = Math.min(N.total, N.t + dt);
  if (N.t >= N.total) {
    N.playing = false;
    N.finished = true;
  }
}
/** Narration plays only inside the station; walking away pauses it, and it carries on at the return. */
function radiusRule() {
  const inside = V.d <= RADIUS_M;
  if (!inside && N.playing) {
    N.playing = false;
    N.carryOn = true;
  } else if (inside && N.carryOn) {
    N.playing = true;
    N.carryOn = false;
  }
}
function listenTap() {
  if (N.missing) {
    N.noticeUntil = now() + 6000;
    $("hint").classList.add("gone");
    return;
  }
  if (V.d > RADIUS_M) {
    toast("Step closer to the sign to listen.");
    return;
  }
  togglePlay();
}

// ---------- the tone: a generated stand-in for the voice, one soft blip per word ----------
let audio = null;
function ensureAudio() {
  if (!audio && "AudioContext" in window) {
    audio = new AudioContext();
  }
  audio?.resume?.();
}
function blip(i) {
  if (!audio || cfg.tone !== "on" || audio.state !== "running") {
    return;
  }
  const t0 = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = 196 + ((N.words[i].text.length * 37) % 90);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + 0.18);
}

// ---------- gestures: the same on the plate and in the box ----------
// A press that moves at most TAP_SLOP px is a tap: it pauses or plays. A larger move scrubs: one line
// height of finger is one line of text, up ahead, down back. On the plate the line height is the plate's
// on screen, taken once at the press; after that only the finger's screen motion counts (not the plate
// moving under it in a shaking hand). "Plate drag: Re-hit" swaps that for a per-frame hit, for comparison.
let press = null;
let scrubAnim = null;

function startPress(surface, e, extra) {
  const L = S[surface].L;
  press = {
    surface,
    id: e.pointerId,
    x0: e.clientX,
    y0: e.clientY,
    x: e.clientX,
    y: e.clientY,
    dragging: false,
    line0: lineFloatAt(L, N.t),
    s0: S[surface].s,
    ...extra,
  };
}
function movePress(e) {
  press.x = e.clientX;
  press.y = e.clientY;
  if (
    !press.dragging &&
    Math.hypot(press.x - press.x0, press.y - press.y0) > TAP_SLOP
  ) {
    press.dragging = true;
    col.classList.add("scrub");
    nbox.classList.toggle("dragging", press.surface === "box");
    plateKey = "";
  }
  if (press.dragging) {
    applyScrub(press.surface, press.line0, press.s0, dragLines());
  }
}
function dragLines() {
  if (press.surface === "plate" && cfg.drag === "hit") {
    const y = hitLocalY(press.x, press.y);
    return y === null ? (press.lastLines ?? 0) : (y - press.hitY0) / CAP_LINE_M;
  }
  return (press.y0 - press.y) / press.pxPerLine;
}
function applyScrub(surface, line0, s0, lines) {
  if (press) {
    press.lastLines = lines;
  }
  const surf = S[surface];
  const L = surf.L;
  N.t = timeAtLine(L, line0 + lines);
  N.finished = false;
  const top = maxScroll(L);
  const raw = s0 + lines;
  const s = raw < 0 ? raw * 0.3 : raw > top ? top + (raw - top) * 0.3 : raw;
  const readLine = L.lineOf[Math.max(0, wordAt(N.t))] ?? 0;
  surf.s = clamp(s, readLine - rowsOf(L) + 1, readLine);
}
function endPress(kind, e) {
  const p = press;
  press = null;
  col.classList.remove("scrub");
  nbox.classList.remove("dragging");
  plateKey = "";
  if (p.dragging) {
    if (N.t >= N.total) {
      N.playing = false;
      N.finished = true;
    }
    return;
  }
  if (kind !== "up") {
    return;
  }
  if (p.badge) {
    toast(`AI voice - ${block.narration?.voiceCredit || "a generated voice"}`);
    return;
  }
  togglePlay();
  tapSign(e.clientX, e.clientY, N.playing);
}

const ICON_PLAY =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
function tapSign(x, y, nowPlaying) {
  const r = device.getBoundingClientRect();
  const fx = document.createElement("div");
  fx.className = "tapfx";
  fx.style.left = `${x - r.left}px`;
  fx.style.top = `${y - r.top}px`;
  fx.innerHTML = nowPlaying ? ICON_PLAY : ICON_PAUSE;
  device.append(fx);
  fx.addEventListener("animationend", () => fx.remove());
  setTimeout(() => fx.remove(), 1500);
}

// the box
nbox.addEventListener("pointerdown", (e) => {
  if (press || place !== "box") {
    return;
  }
  startPress("box", e, { pxPerLine: lh, badge: !!e.target.closest(".badge") });
  nbox.setPointerCapture?.(e.pointerId);
});
nbox.addEventListener("pointermove", (e) => {
  if (press?.surface === "box" && e.pointerId === press.id) {
    movePress(e);
  }
});
for (const [type, kind] of [
  ["pointerup", "up"],
  ["pointercancel", "cancel"],
  ["lostpointercapture", "cancel"],
]) {
  nbox.addEventListener(type, (e) => {
    if (press?.surface === "box" && e.pointerId === press.id) {
      endPress(kind, e);
    }
  });
}
nbox.addEventListener("keydown", (e) => {
  const L = S.box.L;
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    togglePlay();
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    N.t = timeAtLine(L, lineFloatAt(L, N.t) + (e.key === "ArrowDown" ? 1 : -1));
    N.finished = false;
  }
});

// the world: the plate, the sign's halves, or a look-around drag
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane();
function setRay(x, y) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function pick(x, y) {
  setRay(x, y);
  const targets = [part.sign.mesh];
  if (part.caption.mesh.visible) {
    targets.push(part.caption.mesh);
  }
  const hit = ray.intersectObjects(targets, false)[0];
  return hit ? { mesh: hit.object, uv: hit.uv, point: hit.point } : null;
}
/** Where a screen point meets the caption plate's plane, in the plate's own metres (y up). */
function hitLocalY(x, y) {
  setRay(x, y);
  const cap = part.caption.mesh;
  cap.updateMatrixWorld();
  cap.getWorldQuaternion(tmpQ);
  cap.getWorldPosition(tmpV);
  plane.setFromNormalAndCoplanarPoint(
    nrm.set(0, 0, 1).applyQuaternion(tmpQ),
    tmpV,
  );
  const p = ray.ray.intersectPlane(plane, new THREE.Vector3());
  return p ? cap.worldToLocal(p).y : null;
}
let signPress = null;
let look = null;
canvas.addEventListener("pointerdown", (e) => {
  if (press || signPress || look) {
    return;
  }
  canvas.setPointerCapture?.(e.pointerId);
  pressWorld(e, pick(e.clientX, e.clientY));
});
/** A press on the plate scrubs or taps, on the sign picks a half, elsewhere turns the view. */
function pressWorld(e, hit) {
  if (hit?.mesh === part.caption.mesh && place === "plate") {
    const pxPerLine =
      (CAP_LINE_M * part.scale() * focal) /
      camera.position.distanceTo(hit.point);
    startPress("plate", e, {
      pxPerLine,
      hitY0: hitLocalY(e.clientX, e.clientY) ?? 0,
      badge: part.caption.onBadge(hit.uv),
    });
  } else if (hit?.mesh === part.sign.mesh) {
    signPress = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      half: part.sign.half(hit.uv),
    };
  } else {
    look = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      yaw: V.userYaw,
      pitch: V.userPitch,
    };
  }
}
canvas.addEventListener("pointermove", (e) => {
  if (press?.surface === "plate" && e.pointerId === press.id) {
    movePress(e);
  } else if (look && e.pointerId === look.id) {
    V.userYaw = look.yaw + (e.clientX - look.x) * 0.0045;
    V.userPitch = clamp(look.pitch + (e.clientY - look.y) * 0.0045, -0.9, 0.9);
  }
});
function canvasEnd(kind, e) {
  if (press?.surface === "plate" && e.pointerId === press.id) {
    endPress(kind, e);
  } else if (signPress && e.pointerId === signPress.id) {
    const sp = signPress;
    signPress = null;
    if (
      kind === "up" &&
      Math.hypot(e.clientX - sp.x, e.clientY - sp.y) <= TAP_SLOP
    ) {
      onSignHalf(sp.half);
    }
  } else if (look && e.pointerId === look.id) {
    look = null;
  }
}
canvas.addEventListener("pointerup", (e) => canvasEnd("up", e));
canvas.addEventListener("pointercancel", (e) => canvasEnd("cancel", e));
canvas.addEventListener("lostpointercapture", (e) => canvasEnd("cancel", e));

function onSignHalf(half) {
  if (half === "listen") {
    listenTap();
  } else {
    openSheet();
  }
}

// ---------- the whole text ----------
let sheetOpen = false;
function openSheet() {
  sheetOpen = true;
  $("sheet").hidden = false;
}
$("sheetClose").addEventListener("click", () => {
  sheetOpen = false;
  $("sheet").hidden = true;
});

// ---------- each frame: the plate ----------
let litUpTo = -1;
let plateKey = "";
let plateRepaints = 0;
function updateLit() {
  const lit = wordAt(N.t - 1e-6);
  if (lit === litUpTo) {
    return;
  }
  const lo = Math.max(0, Math.min(lit, litUpTo) + 1);
  const hi = Math.max(lit, litUpTo);
  for (let i = lo; i <= hi; i++) {
    const on = i <= lit;
    S.plate.tokens[i + S.plate.off].on = on;
    boxEls[i]?.classList.toggle("on", on);
  }
  if (lit > litUpTo && lit >= 0 && N.playing && !press?.dragging) {
    blip(lit);
  }
  litUpTo = lit;
}
function easeScroll(surf, dt) {
  if (press?.surface && S[press.surface] === surf && press.dragging) {
    return;
  }
  if (scrubAnim) {
    return;
  }
  const target = followTarget(surf.L);
  surf.s = reduceMotion
    ? target
    : surf.s + (target - surf.s) * (1 - Math.exp(-dt * 9));
  if (Math.abs(target - surf.s) < 0.002) {
    surf.s = target;
  }
}
function updatePlate(dt) {
  const show =
    place === "plate" && (N.started || noticeOn() || wordsWanted() === "sign");
  part.caption.show(show);
  if (!show) {
    return;
  }
  easeScroll(S.plate, dt);
  const dragging = press?.surface === "plate" && press.dragging;
  const key = `${litUpTo}|${S.plate.s.toFixed(3)}|${dragging}|${noticeOn()}`;
  if (key === plateKey) {
    return;
  }
  plateKey = key;
  plateRepaints++;
  part.caption.paint({
    tokens: S.plate.tokens,
    layout: S.plate.layout,
    scroll: S.plate.s,
    nLines: S.plate.L.nLines,
    speakerColor: speaker().color,
    grey: 0.55,
    dragging,
    notice: noticeOn() ? NOTICE : null,
  });
}

// ---------- each frame: the box ----------
function boxOffset(s) {
  const last = boxTops.length - 1;
  const k = clamp(Math.floor(s), 0, last);
  const next = k < last ? boxTops[k + 1] : boxTops[k] + lh;
  return boxTops[k] + (s - k) * (next - boxTops[k]);
}
let boxShown = false;
function updateBox(dt) {
  const show = place === "box" && !sheetOpen && (N.started || noticeOn());
  if (show !== boxShown) {
    nbox.classList.toggle("off", !show);
    boxShown = show;
  }
  if (!show) {
    return;
  }
  boxNotice.hidden = !noticeOn();
  col.hidden = noticeOn();
  easeScroll(S.box, dt);
  const L = S.box.L;
  const rows = rowsOf(L);
  col.style.transform = `translateY(${(-boxOffset(S.box.s)).toFixed(2)}px)`;
  const winH = rows * lh - 4;
  const thumbH = Math.max(14, (winH * rows) / L.nLines);
  const pos =
    clamp(S.box.s / Math.max(1, maxScroll(L)), 0, 1) * (winH - thumbH);
  thumb.style.height = `${thumbH.toFixed(1)}px`;
  thumb.style.transform = `translateY(${pos.toFixed(1)}px)`;
}

// ---------- each frame: the sign's face says only whether it speaks ----------
let signKey = "";
function listenFace() {
  if (N.missing) {
    return {
      label: "No voice",
      sub: "read the text instead",
      state: "missing",
    };
  }
  if (V.d > RADIUS_M) {
    return { label: "Listen", sub: "step closer", state: "far" };
  }
  if (N.finished) {
    return { label: "Again", sub: "you heard it all", state: "ended" };
  }
  if (N.playing || N.carryOn) {
    return { label: "Speaking", sub: "tap to pause", state: "speaking" };
  }
  if (N.started) {
    return { label: "Paused", sub: "tap to go on", state: "paused" };
  }
  const voice = block.narration?.synthetic ? "an AI voice" : "a voice";
  return {
    label: "Listen",
    sub: `${Math.max(1, Math.round(N.total / 60))} min, ${voice}`,
    state: "idle",
  };
}
function updateSign() {
  const listen = listenFace();
  const key = `${block.title}|${listen.label}|${listen.sub}`;
  if (key === signKey) {
    return;
  }
  signKey = key;
  part.sign.paint({
    title: block.title,
    minutes: Math.max(1, Math.round(N.words.length / 160)),
    listen,
  });
}

// ---------- beats ----------
function beat(name) {
  const stand = STANDS[name];
  if (stand) {
    animate("d", stand.d, 0.9);
    animate("ang", stand.ang, 0.9);
    return;
  }
  const actions = {
    walk() {
      V.d = 32;
      V.ang = 0;
      animate("d", 7, 5);
    },
    turn() {
      const away =
        V.look === 0 && !anims.some((a) => a.key === "look" && a.to === 0);
      animate("look", away ? 118 : 0, 0.9);
      $("turnBtn").textContent = away ? "Turn back" : "Turn away";
      $("turnBtn").setAttribute("aria-pressed", String(away));
    },
    pause() {
      beatTap();
    },
    back() {
      beatScrubBack();
    },
    end() {
      if (!N.started) {
        start();
      }
      N.t = N.words.length > 12 ? N.words[N.words.length - 12].start : 0;
      N.playing = true;
      N.finished = false;
    },
    missing() {
      setCfg("rec", cfg.rec === "missing" ? "normal" : "missing");
    },
  };
  actions[name]?.();
}
/** "Pause": a tap in the middle of wherever the words are now. */
function beatTap() {
  if (!N.started) {
    listenTap();
    return;
  }
  togglePlay();
  const r = place === "box" ? nbox.getBoundingClientRect() : plateRect();
  tapSign(r.left + r.width / 2, r.top + r.height / 2, N.playing);
}
function plateRect() {
  const c = canvas.getBoundingClientRect();
  const m = lastMeasure?.rect ?? {
    minX: 0,
    maxX: c.width,
    minY: 0,
    maxY: c.height,
  };
  return {
    left: c.left + m.minX,
    top: c.top + m.minY,
    width: m.maxX - m.minX,
    height: m.maxY - m.minY,
  };
}
/** "Back 2 lines": the same scrub a finger makes, two lines down over 0.6 s, on the current place. */
function beatScrubBack() {
  if (!N.started || press || place === "none") {
    return;
  }
  const surf = S[place];
  scrubAnim = {
    surface: place,
    t0: now(),
    line0: lineFloatAt(surf.L, N.t),
    s0: surf.s,
  };
}
function stepScrubAnim() {
  if (!scrubAnim) {
    return;
  }
  const p = clamp((now() - scrubAnim.t0) / 600, 0, 1);
  applyScrub(
    scrubAnim.surface,
    scrubAnim.line0,
    scrubAnim.s0,
    -2 * (1 - (1 - p) ** 2),
  );
  if (p >= 1) {
    scrubAnim = null;
  }
}
document.querySelectorAll("[data-beat]").forEach((b) => {
  b.addEventListener("click", () => beat(b.dataset.beat));
});

// ---------- knobs ----------
function setCfg(k, v) {
  cfg[k] = v;
  if (k === "rec") {
    loadRecord(v);
  }
  if (k === "creator") {
    visitorPick = null;
  }
  applyCfg();
  const q = new URLSearchParams(location.search);
  q.set(k, v);
  history.replaceState(null, "", `?${q}`);
}
function applyCfg() {
  lh = Math.round(Number(cfg.fs) * 1.375);
  const root = document.documentElement.style;
  root.setProperty("--fs", `${cfg.fs}px`);
  root.setProperty("--lh", `${lh}px`);
  document.body.classList.toggle("landscape", cfg.frame === "landscape");
  document.querySelectorAll("[data-cfg]").forEach((b) => {
    b.classList.toggle("on", cfg[b.dataset.cfg] === b.dataset.v);
  });
  $("missingBtn").setAttribute("aria-pressed", String(cfg.rec === "missing"));
  updatePill();
  if (block) {
    layoutBox();
  }
  plateKey = "";
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
$("exitBtn").addEventListener("click", () =>
  toast("Exit is not part of this prototype."),
);

// the visitor's view pick
const vpill = $("vpill");
const vmenu = $("vmenu");
function updatePill() {
  const w = wordsWanted();
  vpill.innerHTML = `${w === "sign" ? "Words on the sign" : "Words in the box"}<small>${visitorPick ? "your pick" : "tour"}</small>`;
  vmenu
    .querySelectorAll("[data-words]")
    .forEach((b) =>
      b.setAttribute("aria-checked", String(b.dataset.words === w)),
    );
}
vpill.addEventListener("click", () => {
  vmenu.hidden = !vmenu.hidden;
  vpill.setAttribute("aria-expanded", String(!vmenu.hidden));
});
vmenu.querySelectorAll("[data-words]").forEach((b) => {
  b.addEventListener("click", () => {
    visitorPick = b.dataset.words;
    vmenu.hidden = true;
    vpill.setAttribute("aria-expanded", "false");
    updatePill();
  });
});

let toastTimer = 0;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- the cost readout ----------
const stats = {
  work: [],
  over50: 0,
  lastShow: 0,
  repaintsAt: now(),
  repaintRate: 0,
};
let lastMeasure = null;
function fmt(sec) {
  const v = Math.max(0, Math.floor(sec));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}
function narrationState() {
  if (!N.started) {
    return "not started";
  }
  if (press?.dragging || scrubAnim) {
    return "scrubbing";
  }
  if (N.finished) {
    return "ended";
  }
  return N.playing ? "playing" : "paused";
}
function showReadout(t) {
  if (t - stats.lastShow < 250) {
    return;
  }
  const span = (t - stats.repaintsAt) / 1000;
  stats.repaintRate = plateRepaints / span;
  plateRepaints = 0;
  stats.repaintsAt = t;
  stats.lastShow = t;
  const m = lastMeasure;
  const work = stats.work.length
    ? stats.work.reduce((a, b) => a + b, 0) / stats.work.length
    : 0;
  const worst = Math.max(0, ...stats.work);
  const info = renderer.info.render;
  const where =
    place === "plate" ? "on the sign" : place === "box" ? "in the box" : "-";
  $("readout").innerHTML =
    `${m.d.toFixed(1)} m · ${m.angleDeg}° · x${part.scale().toFixed(2)} · letters <b>${m.letterPx.toFixed(1)} px</b> (from ${cfg.th})
` +
    `<b>${where}</b>: ${placeWhy} · ${narrationState()} ${fmt(N.t)}/${fmt(N.total)}
` +
    `work ${work.toFixed(1)}/${worst.toFixed(0)} ms · <span class="${stats.over50 ? "warn" : ""}">&gt;50 ms: ${stats.over50}</span> · ${info.calls} calls ${info.triangles} tris · redraws ${stats.repaintRate.toFixed(1)}/s`;
  if (stats.work.length > 120) {
    stats.work.splice(0, stats.work.length - 120);
  }
}

// ---------- the frame loop ----------
let lastT = now();
function frame(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  const gap = t - lastT;
  lastT = t;
  if (gap > 50 && gap < 400 && !document.hidden) {
    stats.over50++;
  }
  stepAnims(t);
  advance(dt);
  radiusRule();
  placeCamera(t / 1000);
  part.update({
    viewer: camera.position,
    turn: cfg.turn === "turns",
    grow: cfg.grow === "on",
  });
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  lastMeasure = measureSign();
  updatePlace(lastMeasure, dt);
  if (press?.dragging && press.surface === "plate" && cfg.drag === "hit") {
    applyScrub("plate", press.line0, press.s0, dragLines());
  }
  stepScrubAnim();
  updateLit();
  updatePlate(dt);
  updateBox(dt);
  updateSign();
  renderer.render(scene, camera);
  stats.work.push(now() - t);
  showReadout(t);
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && N.playing) {
    N.playing = false;
    N.carryOn = true;
  }
});

function resize() {
  fitCamera();
  if (block) {
    layoutBox();
  }
}
new ResizeObserver(resize).observe(device);

applyCfg();
loadRecord(cfg.rec);
resize();
if (params.has("autostart")) {
  start();
  N.t = clamp(Number(params.get("at")) || 0, 0, N.total);
}
requestAnimationFrame(frame);
