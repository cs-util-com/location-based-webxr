// Travelling surface, round 1, variant B - the screen comes with you. Throwaway prototype: not
// wired to the app, linked from nothing in it.
//
// A free video's player (picture, captions, control bar) is one object. While its picture is big
// enough on the screen, in view and not seen from too far to the side, it plays on its screen in
// the world (kind.js draws it). When it is not, and the video plays, the same texture flies to a
// small player in a corner of the phone's screen and keeps playing there; when the screen can be
// watched again it flies back. The bottom centre belongs to the narration box, so the player docks
// in its own corner beside it. Exactly one of the two places is drawn at any moment, and only one
// video holds the corner.
import * as THREE from "three";
import * as kind from "./kind.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const { SURFACE } = kind;

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
const NUM_KEYS = ["thr", "tap", "size", "fly", "settle", "hyst", "angle"];
const cfg = {
  thr: pickNum("thr", [80, 120, 160, 220], 120),
  ctl: pick("ctl", ["picture", "button"], "picture"),
  tap: pickNum("tap", [40, 48, 56], 48),
  mode: pick("mode", ["playing", "always"], "playing"),
  corner: pick("corner", ["br", "bl", "tr"], "br"),
  size: pickNum("size", [1.6, 2.5, 4], 1.6),
  aspect: pick("aspect", ["16:9", "4:3", "9:16"], "16:9"),
  fly: pickNum("fly", [0, 0.35, 0.6, 1.2], 0.6),
  settle: pickNum("settle", [0.15, 0.3, 0.6, 1], 0.3),
  hyst: pickNum("hyst", [5, 10, 15], 5),
  angle: pickNum("angle", [35, 50, 60], 60),
  sound: pick("sound", ["tone", "silent"], "tone"),
  text: pick("text", ["normal", "longest", "missing"], "normal"),
  stage: pick("stage", ["auto", "portrait", "landscape"], "auto"),
};
const ASPECTS = { "16:9": 16 / 9, "4:3": 4 / 3, "9:16": 9 / 16 };

const RADIUS_M = 20; // the station circle around the screen
const TAP_SLOP = 8; // px a finger may move and still count as a tap
const TOUCH_PAD = 12; // px of forgiveness around a small control in the world
const FADE_S = 0.3; // the corner fades instead of flying to a place that is not on screen
const MILL_POS = new THREE.Vector3(-2.3, 0, 0.9);
const MILL_YAW = 0.32;

const stageEl = $("stage");
const device = $("device");
const canvas = $("cam");
const readoutEl = $("readout");
const costEl = $("cost");
const distEl = $("dist");
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
const ring = new THREE.Mesh(
  new THREE.RingGeometry(RADIUS_M - 0.15, RADIUS_M, 96),
  new THREE.MeshBasicMaterial({
    color: 0xf2971f,
    transparent: true,
    opacity: 0.35,
  }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.01;
scene.add(ring);

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

// ---------- the overlays: each video's own player texture, drawn in screen space while docked or flying ----------
// Each corner carries a clip-space position, so a corner flying from the world surface's projected
// corner to the dock's keeps the texture mapped in perspective all the way. A porthole's disc opens
// into the full player on the way (its uv crop and round mask ease out with the flight).
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
    uniforms: {
      map: { value: null },
      opacity: { value: 1 },
      uvRect: { value: [0, 0, 1, 1] },
      roundness: { value: 0 },
    },
    vertexShader:
      "attribute vec4 clipPos;\nvarying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = clipPos;\n}",
    fragmentShader: kind.SURF_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  ovScene.add(mesh);
  return { mesh, mat, geo, clipArr, clipAttr };
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
  placeNarr();
  showDistances();
}
addEventListener("resize", sizeStage);
desktopMq.addEventListener("change", sizeStage);
function toDevice(e) {
  const r = device.getBoundingClientRect();
  return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
}

// ---------- the videos ----------
const env = { mode: "play", canvasTexture };
let sample = null;
const videos = []; // the screen, and the mill's porthole while "2 videos" is on
let cornerHolder = null; // the id of the one video that may hold the corner: the last one tapped
let soundPref = true; // the visitor's sound switch, for every video
let ccPref = true; // the visitor's captions switch, for every video
let heard = null; // the one video whose sound plays
let two = params.get("two") === "on";

function makeVideo(id, record, pos, yaw) {
  const r = kind.read(record);
  const part = kind.world(r.block, env);
  part.object.position.copy(pos);
  part.object.rotation.y = yaw;
  scene.add(part.object);
  const ov = makeOverlay();
  ov.mat.uniforms.map.value = part.player.texture;
  return {
    id,
    block: r.block,
    part,
    ov,
    t: 0,
    playing: false,
    started: false,
    finished: false,
    leftPaused: false,
    place: "world",
    pending: "world",
    pendingFor: 0,
    why: "",
    u: 0,
    uTarget: 0,
    fade: 1,
    returning: false,
    plateClip: new Float32Array(16),
    lastPlateClip: new Float32Array(16),
    havePlateClip: false,
    m: {
      valid: false,
      onScreen: false,
      ndcX: 0,
      ndcY: 0,
      surfPx: 0,
      picPx: 0,
      ctlPx: 0,
      angle: 0,
      dist: 0,
    },
    paintKey: "",
    toneIdx: -1,
    tones: [],
  };
}
function dropVideo(v) {
  hush(v);
  v.part.dispose();
  v.ov.geo.dispose();
  v.ov.mat.dispose();
  v.ov.mesh.removeFromParent();
}
function mainRecord() {
  const rec = structuredClone(sample.records[cfg.text]);
  rec.widthM = cfg.size;
  rec.clip.aspect = ASPECTS[cfg.aspect];
  return rec;
}
function mountMain() {
  const old = videos.findIndex((v) => v.id === "screen");
  if (old >= 0) {
    dropVideo(videos[old]);
    videos.splice(old, 1);
  }
  videos.unshift(makeVideo("screen", mainRecord(), new THREE.Vector3(), 0));
  if (cornerHolder === "screen") {
    cornerHolder = null;
  }
  if (heard === "screen") {
    heard = null;
  }
  showDistances();
}
function mountMill(on) {
  two = on;
  $("twoBtn").setAttribute("aria-pressed", String(on));
  const at = videos.findIndex((v) => v.id === "mill");
  if (at >= 0) {
    dropVideo(videos[at]);
    videos.splice(at, 1);
    if (cornerHolder === "mill") {
      cornerHolder = null;
    }
    if (heard === "mill") {
      heard = null;
    }
  }
  if (on) {
    videos.push(makeVideo("mill", sample.records.second, MILL_POS, MILL_YAW));
  }
}
const byId = (id) => videos.find((v) => v.id === id);

// ---------- the sound: a soft generated tone per video, only after a tap ----------
let actx = null;
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
const SCALES = {
  screen: [196, 220, 247, 294, 330, 392],
  mill: [392, 440, 494, 587, 659],
};
const audible = (v) =>
  cfg.sound === "tone" &&
  soundPref &&
  heard === v.id &&
  v.playing &&
  actx &&
  actx.state === "running";
function note(v, idx) {
  const scale = SCALES[v.id] || SCALES.screen;
  const now = actx.currentTime;
  const dur = 0.5;
  const osc = actx.createOscillator();
  osc.type = v.id === "mill" ? "sine" : "triangle";
  osc.frequency.setValueAtTime(
    scale[(idx * 7 + Math.floor(idx / 4)) % scale.length],
    now,
  );
  const lp = actx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1200;
  const g = actx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.035, now + 0.03);
  g.gain.linearRampToValueAtTime(0, now + dur);
  osc.connect(lp).connect(g).connect(actx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
  const rec = { osc, g };
  v.tones.push(rec);
  osc.onended = () => {
    const at = v.tones.indexOf(rec);
    if (at >= 0) {
      v.tones.splice(at, 1);
    }
  };
}
function hush(v) {
  if (!actx) {
    return;
  }
  const now = actx.currentTime;
  for (const r of v.tones) {
    r.g.gain.cancelScheduledValues(now);
    r.g.gain.setValueAtTime(0, now);
    try {
      r.osc.stop(now + 0.02);
    } catch {
      // already stopped
    }
  }
}

// ---------- playback: only a tap starts a video; docking never changes it ----------
function setPlaying(v, on) {
  v.playing = on;
  v.toneIdx = -1;
  if (on) {
    v.started = true;
    v.leftPaused = false;
    if (soundPref) {
      // the newest start with sound takes the sound; the video heard before plays on, silent
      for (const o of videos) {
        if (o !== v) {
          hush(o);
        }
      }
      heard = v.id;
    }
  } else {
    hush(v);
  }
}
function advance(v, dt) {
  if (!v.playing) {
    return;
  }
  v.t = Math.min(v.t + dt, v.block.clip.duration);
  const idx = Math.floor(v.t / 0.55);
  if (idx !== v.toneIdx) {
    v.toneIdx = idx;
    if (audible(v)) {
      note(v, idx);
    }
  }
  if (v.t >= v.block.clip.duration) {
    v.playing = false;
    v.finished = true;
    hush(v);
  }
}

// ---------- where each player is: in the world, or in the corner ----------
const pv = new THREE.Matrix4();
const v4 = new THREE.Vector4();
const nrm = new THREE.Vector3();
const toCam = new THREE.Vector3();
const surfPos = new THREE.Vector3();
let stationDist = 0;

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

function measure(v) {
  const s = v.part.surface;
  const mtx = s.mesh.matrixWorld;
  const hw = s.wM / 2;
  const hh = s.hM / 2;
  const L = v.part.player.layout;
  const m = v.m;
  let ok = true;
  [
    [-hw, hh],
    [hw, hh],
    [-hw, -hh],
    [hw, -hh],
  ].forEach(([x, y], i) => {
    if (project(x, y, mtx, v.plateClip, i * 4) < 0.05) {
      ok = false;
    }
  });
  const tmp = [0, 0, 0, 0];
  const wc = project(0, 0, mtx, tmp, 0);
  m.ndcX = tmp[0] / Math.max(1e-4, wc);
  m.ndcY = tmp[1] / Math.max(1e-4, wc);
  const wt = project(0, hh, mtx, tmp, 0);
  const yt = tmp[1];
  const wb = project(0, -hh, mtx, tmp, 0);
  m.valid = ok && wc > 0.05;
  m.surfPx = m.valid ? Math.abs(sy(yt, wt) - sy(tmp[1], wb)) : 0;
  if (s.round) {
    // a porthole: the disc is the picture and, in the world, its play control
    m.picPx = m.surfPx;
    m.ctlPx = m.surfPx;
  } else {
    m.picPx = (m.surfPx * L.clip.h) / L.H;
    m.ctlPx = cfg.ctl === "button" ? (m.surfPx * SURFACE.bar) / L.H : m.picPx;
  }
  surfPos.setFromMatrixPosition(mtx);
  nrm.set(0, 0, 1).transformDirection(mtx);
  nrm.y = 0;
  toCam.subVectors(camera.position, surfPos);
  toCam.y = 0;
  m.angle = THREE.MathUtils.radToDeg(nrm.angleTo(toCam));
  // the flight starts from where the surface was last seen on screen
  m.onScreen = m.valid && Math.abs(m.ndcX) < 1 && Math.abs(m.ndcY) < 1;
  if (m.onScreen) {
    v.lastPlateClip.set(v.plateClip);
    v.havePlateClip = true;
  }
  m.dist = Math.hypot(
    camera.position.x - v.part.object.position.x,
    camera.position.z - v.part.object.position.z,
  );
}

/** [place, why, now]: `now` skips the hold (leaving the station, the corner given to another). */
function wantPlace(v) {
  const m = v.m;
  if (!v.block.clip.ok) {
    return ["world", "the clip cannot be played: it never docks", true];
  }
  if (stationDist > RADIUS_M) {
    return ["world", "outside the station: the corner is empty", true];
  }
  if (!v.started) {
    return ["world", "not started: it stays off until tapped", true];
  }
  if (cornerHolder !== v.id) {
    return ["world", "the other video holds the corner", true];
  }
  if (cfg.mode === "playing" && v.finished) {
    return ["world", "watched to the end", false];
  }
  if (cfg.mode === "playing" && !v.playing && v.place !== "dock") {
    return ["world", "paused: a paused video does not dock", false];
  }
  const keep = v.place === "world" && v.u === 0;
  const f = keep ? 1 - cfg.hyst / 100 : 1;
  const edge = keep ? 0.95 : 0.88;
  if (!m.valid || Math.abs(m.ndcX) > edge || Math.abs(m.ndcY) > edge) {
    return ["dock", "the screen is out of view", false];
  }
  if (m.angle > cfg.angle / f) {
    return ["dock", `the screen is ${Math.round(m.angle)} deg to the side`, false];
  }
  if (m.picPx < cfg.thr * f) {
    return [
      "dock",
      `picture ${Math.round(m.picPx)} px, under ${cfg.thr} px`,
      false,
    ];
  }
  if (cfg.ctl === "button" && !v.part.surface.round && m.ctlPx < cfg.tap * f) {
    return [
      "dock",
      `play button ${Math.round(m.ctlPx)} px, under ${cfg.tap} px`,
      false,
    ];
  }
  return ["world", `picture ${Math.round(m.picPx)} px`, false];
}

function decide(v, dt) {
  const [want, why, now] = wantPlace(v);
  v.why = why;
  if (want !== v.pending) {
    v.pending = want;
    v.pendingFor = 0;
  } else {
    v.pendingFor += dt;
  }
  // a finger on this player holds it where it is
  const holding = press && press.vid === v.id && press.what !== "look";
  if (want !== v.place && (now || v.pendingFor >= cfg.settle) && !holding) {
    if (want === "dock" && videos.some((o) => o !== v && o.u > 0)) {
      v.why += " (waits for the corner to empty)";
    } else {
      v.place = want;
      v.uTarget = want === "dock" ? 1 : 0;
      if (want === "dock" && !v.m.onScreen && !v.havePlateClip) {
        v.u = 1;
        v.fade = 0;
      }
      if (want === "world" && v.u > 0 && !v.m.onScreen) {
        v.returning = true;
      }
    }
  }
  const instant = cfg.fly === 0 || reduceMotion;
  if (v.returning) {
    // its place in the world is not on screen: the corner fades rather than flying off the edge
    v.fade -= instant ? 1 : dt / FADE_S;
    if (v.fade <= 0 || v.uTarget === 1) {
      v.fade = 1;
      if (v.uTarget === 0) {
        v.u = 0;
      }
      v.returning = false;
    }
    return;
  }
  if (instant) {
    v.u = v.uTarget;
  } else if (v.u !== v.uTarget) {
    const step = dt / cfg.fly;
    v.u =
      v.u < v.uTarget
        ? Math.min(v.uTarget, v.u + step)
        : Math.max(v.uTarget, v.u - step);
  }
  if (v.fade < 1) {
    v.fade = instant ? 1 : Math.min(1, v.fade + dt / FADE_S);
  }
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Round 5's narration box at the bottom centre (6.2's dock): the voice owns that place. */
function narrRect() {
  const w = Math.min(17 * 16, 0.8 * W, 720);
  const h = (w * 249) / 680;
  const bottom = W > H ? 10 : 18;
  return { x: (W - w) / 2, y: H - bottom - h, w, h };
}
/**
 * The video's own corner: a fixed screen place, never one that follows the gaze. A bottom corner
 * that would touch the narration band sits just above it, whether a narration shows or not, so the
 * corner never moves when a voice starts.
 */
function dockRect(v) {
  const L = v.part.player.layout;
  const w = Math.round(clamp(0.56 * Math.min(W, H), 190, 260));
  const h = (w * L.H) / L.W;
  const margin = 12;
  const x = cfg.corner === "bl" ? margin : W - margin - w;
  if (cfg.corner === "tr") {
    return { x, y: W > H ? 92 : 96, w, h };
  }
  const n = narrRect();
  let y = H - (W > H ? 10 : 18) - h;
  const gap = 10;
  if (x < n.x + n.w + gap && x + w > n.x - gap && y + h > n.y - gap) {
    y = n.y - gap - h;
  }
  return { x, y, w, h };
}

function layout(v) {
  const ov = v.ov;
  v.part.surface.mesh.visible = v.u === 0;
  v.part.away.visible = v.u > 0;
  ov.mesh.visible = v.u > 0;
  if (!ov.mesh.visible) {
    return;
  }
  ov.mat.uniforms.opacity.value = v.fade;
  const r = dockRect(v);
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
  const src = v.m.onScreen
    ? v.plateClip
    : v.havePlateClip
      ? v.lastPlateClip
      : null;
  const e = src ? ease(v.u) : 1;
  const s = v.part.surface;
  const uv = ov.mat.uniforms.uvRect.value;
  for (let i = 0; i < 4; i++) {
    uv[i] = s.uvRect[i] * (1 - e) + (i < 2 ? 0 : 1) * e;
  }
  ov.mat.uniforms.roundness.value = s.round * (1 - e);
  let wRef = 1;
  if (src) {
    wRef = (src[3] + src[7] + src[11] + src[15]) / 4;
  }
  const a = ov.clipArr;
  for (let i = 0; i < 4; i++) {
    const j = i * 4;
    const dx = dock[i * 2] * wRef;
    const dy = dock[i * 2 + 1] * wRef;
    a[j] = src ? src[j] * (1 - e) + dx * e : dock[i * 2];
    a[j + 1] = src ? src[j + 1] * (1 - e) + dy * e : dock[i * 2 + 1];
    a[j + 2] = src ? src[j + 2] * (1 - e) : 0;
    a[j + 3] = src ? src[j + 3] * (1 - e) + wRef * e : 1;
  }
  ov.clipAttr.needsUpdate = true;
}

// ---------- hit testing: the same controls in the world and in the corner ----------
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
/** A point of the player canvas on the screen, in device px, wherever the player is now. */
function canvasToScreen(v, cx, cy) {
  const L = v.part.player.layout;
  if (v.u === 1) {
    const r = dockRect(v);
    return { x: r.x + (cx / L.W) * r.w, y: r.y + (cy / L.H) * r.h };
  }
  const s = v.part.surface;
  let lx;
  let ly;
  if (s.round) {
    const c = L.crop;
    lx = ((cx - c.x) / c.w - 0.5) * s.wM;
    ly = (0.5 - (cy - c.y) / c.h) * s.hM;
  } else {
    lx = (cx / L.W - 0.5) * s.wM;
    ly = (0.5 - cy / L.H) * s.hM;
  }
  const out = [0, 0, 0, 0];
  const w = project(lx, ly, s.mesh.matrixWorld, out, 0);
  return { x: sx(out[0], w), y: sy(out[1], w) };
}
function controlQuad(v, r) {
  return [
    canvasToScreen(v, r.x, r.y),
    canvasToScreen(v, r.x + r.w, r.y),
    canvasToScreen(v, r.x + r.w, r.y + r.h),
    canvasToScreen(v, r.x, r.y + r.h),
  ];
}
/** The controls a tap may hit, by where the player is: a porthole in the world has only its disc. */
function controlsOf(v) {
  const L = v.part.player.layout;
  if (v.u === 0 && v.part.surface.round) {
    return [["picture", L.crop]];
  }
  const list = [
    ["sound", L.controls.sound],
    ["cc", L.controls.cc],
    ["play", L.controls.play],
  ];
  if (cfg.ctl === "picture") {
    list.push(["picture", L.controls.picture]);
  }
  return list;
}
function controlCentre(v, name) {
  const L = v.part.player.layout;
  const r =
    name === "picture"
      ? v.u === 0 && v.part.surface.round
        ? L.crop
        : L.clip
      : L.controls[name];
  const q = controlQuad(v, r);
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  };
}
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function hitTest(x, y) {
  // the corner first: it is drawn over the world
  const order = [...videos].sort((a, b) => b.u - a.u);
  for (const v of order) {
    if (v.u === 1 || (v.u === 0 && v.m.valid)) {
      for (const [name, r] of controlsOf(v)) {
        const q = controlQuad(v, r);
        if (name === "picture") {
          if (v.u === 0 && v.part.surface.round) {
            const c = controlCentre(v, "picture");
            const rad = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) / 2;
            if (Math.hypot(x - c.x, y - c.y) <= rad + TOUCH_PAD) {
              return { what: "control", vid: v.id, ctl: name };
            }
          } else if (inQuad(x, y, q)) {
            return { what: "control", vid: v.id, ctl: name };
          }
          continue;
        }
        const pad = v.u === 1 ? 2 : TOUCH_PAD;
        const xs = q.map((p) => p.x);
        const ys = q.map((p) => p.y);
        if (
          x >= Math.min(...xs) - pad &&
          x <= Math.max(...xs) + pad &&
          y >= Math.min(...ys) - pad &&
          y <= Math.max(...ys) + pad
        ) {
          return { what: "control", vid: v.id, ctl: name };
        }
      }
      if (v.u === 1) {
        const r = dockRect(v);
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          return { what: "player", vid: v.id };
        }
      }
    }
  }
  ndc.set((x / W) * 2 - 1, 1 - (y / H) * 2);
  raycaster.setFromCamera(ndc, camera);
  for (const v of videos) {
    if (v.u > 0 && raycaster.intersectObject(v.part.away, false).length) {
      return { what: "away", vid: v.id };
    }
  }
  return { what: "look" };
}

// ---------- gestures: tap only, no scrub ----------
let press = null;
function pressStart(x, y, id) {
  press = { id, x, y, ...hitTest(x, y), yaw0: userYaw };
}
function pressMove(x, y) {
  const dx = x - press.x;
  const dy = y - press.y;
  if (press.what !== "look" && Math.hypot(dx, dy) > TAP_SLOP) {
    press.what = "look";
  }
  if (press.what === "look") {
    userYaw = press.yaw0 + dx * 0.005;
  }
}
function pressEnd(x, y, cancelled) {
  const pr = press;
  press = null;
  if (cancelled) {
    return;
  }
  if (pr.what === "control") {
    runControl(byId(pr.vid), pr.ctl, x, y);
  } else if (pr.what === "away") {
    // its empty place in the world: say where the clip is now
    pulseDock(byId(pr.vid));
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

function runControl(v, ctl, x, y) {
  if (!v) {
    return;
  }
  ensureAudio();
  if (ctl === "play" || ctl === "picture") {
    if (!v.block.clip.ok) {
      return;
    }
    cornerHolder = v.id;
    if (v.finished) {
      v.t = 0;
      v.finished = false;
      setPlaying(v, true);
    } else {
      setPlaying(v, !v.playing);
    }
    tapFx(x, y, v.playing ? ICON_PLAY : ICON_PAUSE);
  } else if (ctl === "sound") {
    soundPref = !soundPref;
    if (soundPref) {
      for (const o of videos) {
        if (o !== v) {
          hush(o);
        }
      }
      heard = v.id;
    } else {
      for (const o of videos) {
        hush(o);
      }
    }
    if (v.started) {
      cornerHolder = v.id;
    }
    tapFx(x, y, soundPref ? ICON_SOUND : ICON_MUTED);
  } else if (ctl === "cc") {
    ccPref = !ccPref;
    if (v.started) {
      cornerHolder = v.id;
    }
    tapFx(x, y, ccPref ? ICON_CC_ON : ICON_CC_OFF);
  }
}
const ICON_PLAY =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
const ICON_SOUND =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7"/></svg>';
const ICON_MUTED =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6" stroke="#fff" stroke-width="2"/></svg>';
const ICON_CC_ON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/></svg>';
const ICON_CC_OFF =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="#fff" stroke-width="2"/></svg>';
function tapFx(x, y, icon) {
  const fx = document.createElement("div");
  fx.className = "tapfx";
  fx.style.left = `${x}px`;
  fx.style.top = `${y}px`;
  fx.innerHTML = icon;
  device.append(fx);
  fx.addEventListener("animationend", () => fx.remove());
  setTimeout(() => fx.remove(), 1500);
}
function pulseDock(v) {
  if (!v || v.u !== 1) {
    return;
  }
  const r = dockRect(v);
  const el = $("dockRing");
  el.hidden = true;
  void el.offsetWidth;
  Object.assign(el.style, {
    left: `${r.x - 3}px`,
    top: `${r.y - 3}px`,
    width: `${r.w + 6}px`,
    height: `${r.h + 6}px`,
  });
  el.hidden = false;
}

// ---------- painting each player (only when something it shows changed) ----------
const paintStats = { n: 0, sum: 0, max: 0 };
function hint(v) {
  if (!v.block.clip.ok || v.playing) {
    return "";
  }
  if (v.finished) {
    return "watched - tap to play again";
  }
  if (!v.started) {
    return cfg.ctl === "button" && !v.part.surface.round
      ? "tap play to watch"
      : "tap to watch";
  }
  return v.leftPaused ? "paused when you left" : "paused";
}
function paint(v) {
  const visible =
    v.u > 0 ||
    (v.m.valid && Math.abs(v.m.ndcX) < 1.6 && Math.abs(v.m.ndcY) < 1.6);
  if (!visible) {
    return;
  }
  const view = {
    t: v.t,
    playing: v.playing,
    started: v.started,
    finished: v.finished,
    sound: soundPref && (heard === null || heard === v.id),
    cc: ccPref,
    hint: hint(v),
    docked: v.u > 0.5,
  };
  // the clip moves at 30 frames a second; nothing moves while it is paused
  const key = `${Math.floor(v.t * 30)}|${view.playing}|${view.started}|${view.finished}|${view.sound}|${view.cc}|${view.hint}|${view.docked}`;
  if (key === v.paintKey) {
    return;
  }
  v.paintKey = key;
  const t0 = performance.now();
  v.part.player.paint(view);
  const dt = performance.now() - t0;
  paintStats.n++;
  paintStats.sum += dt;
  paintStats.max = Math.max(paintStats.max, dt);
}

// ---------- another item's narration box: a silent stand-in at the bottom centre ----------
const NARR_TEXT =
  "This square was the fish market for three hundred years. The stone tables along the wall were scrubbed with sea water every evening, and the gutters still lean toward the harbour. Look for the iron rings where the carts were tied.";
const narr = $("narr");
const narrText = $("narrText");
const narrWords = NARR_TEXT.split(/\s+/).map((w, i) => {
  const el = document.createElement("span");
  el.textContent = w;
  narrText.append(el, " ");
  return { el, start: i * 0.34 };
});
let narrOn = params.get("narr") === "on";
let narrSpeaking = false;
let narrT = 0;
let narrLit = -1;
let narrLine = -1;
function placeNarr() {
  const r = narrRect();
  Object.assign(narr.style, {
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.w}px`,
    height: `${r.h}px`,
  });
}
function showNarr(on) {
  narrOn = on;
  narr.hidden = !on;
  $("narrBtn").setAttribute("aria-pressed", String(on));
  if (!on) {
    narrSpeaking = false;
  }
}
function toggleNarr() {
  if (narrT >= narrWords.at(-1).start + 0.6) {
    narrT = 0;
  }
  narrSpeaking = !narrSpeaking;
}
narr.addEventListener("click", toggleNarr);
function updateNarr(dt) {
  if (!narrOn) {
    return;
  }
  if (narrSpeaking) {
    narrT += dt;
    if (narrT >= narrWords.at(-1).start + 0.6) {
      narrSpeaking = false;
    }
  }
  $("narrHint").textContent = narrSpeaking
    ? ""
    : narrT > 0
      ? "paused - tap to play"
      : "tap the words to listen";
  let lit = -1;
  narrWords.forEach((w, i) => {
    if (w.start <= narrT && narrT > 0) {
      lit = i;
    }
  });
  if (lit !== narrLit) {
    narrWords.forEach((w, i) => w.el.classList.toggle("on", i <= lit));
    narrLit = lit;
    const el = narrWords[Math.max(0, lit)].el;
    const lh = 21; // the window's line height in the stylesheet
    const line = Math.round(el.offsetTop / lh);
    if (line !== narrLine) {
      narrLine = line;
      narrText.style.transform = `translateY(${-Math.max(0, line - 1) * lh}px)`;
    }
  }
}

// ---------- the viewer: beats move them, a sideways drag turns them (in AR the phone does) ----------
const viewer = {
  pos: new THREE.Vector3(0, 1.6, 7),
  look: new THREE.Vector3(0, 0, 0),
  from: null,
  to: null,
  lookFrom: null,
  lookTo: null,
  t0: 0,
  dur: 0,
};
let userYaw = 0;
let turnCur = 0;
let turnTarget = 0;
let clock = 0;
function goTo(pos, look, dur) {
  if (dur <= 0 || reduceMotion) {
    viewer.pos.copy(pos);
    viewer.look.copy(look);
    viewer.to = null;
    return;
  }
  viewer.from = viewer.pos.clone();
  viewer.to = pos.clone();
  viewer.lookFrom = viewer.look.clone();
  viewer.lookTo = look.clone();
  viewer.t0 = clock;
  viewer.dur = dur;
}
/** Stand `dist` metres from `target`, `deg` degrees round from its front, looking at it. */
function standAt(dist, deg, dur, target = new THREE.Vector3(), yaw = 0) {
  const a = THREE.MathUtils.degToRad(deg) + yaw;
  goTo(
    new THREE.Vector3(
      target.x + Math.sin(a) * dist,
      1.6,
      target.z + Math.cos(a) * dist,
    ),
    target,
    dur,
  );
}
function lookHeight() {
  const v = videos[0];
  if (!v) {
    return 1.6;
  }
  return new THREE.Vector3().setFromMatrixPosition(
    v.part.surface.mesh.matrixWorld,
  ).y;
}
function updateViewer(dt) {
  if (viewer.to) {
    const f = clamp((clock - viewer.t0) / viewer.dur, 0, 1);
    const s = f * f * (3 - 2 * f);
    viewer.pos.lerpVectors(viewer.from, viewer.to, s);
    viewer.look.lerpVectors(viewer.lookFrom, viewer.lookTo, s);
    if (f >= 1) {
      viewer.to = null;
    }
  }
  turnCur +=
    (turnTarget - turnCur) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 2.6));
  camera.position.copy(viewer.pos);
  const dx = viewer.pos.x - viewer.look.x;
  const dz = viewer.pos.z - viewer.look.z;
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(
    lookHeight() - viewer.pos.y,
    Math.max(0.5, Math.hypot(dx, dz)),
  );
  const sway = reduceMotion ? 0 : 1;
  camera.rotation.y = yaw + userYaw + turnCur + Math.sin(clock * 0.53) * 0.01 * sway;
  camera.rotation.x = pitch + Math.sin(clock * 0.71) * 0.005 * sway;
}

// ---------- the beats ----------
let script = null; // the scripted finger, while it runs
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
}
const wait = (ms, run) =>
  new Promise((resolve, reject) => {
    setTimeout(
      () => (run.cancelled ? reject(new Error("cancelled")) : resolve()),
      ms,
    );
  });
async function arrive(run) {
  while (viewer.to) {
    await wait(100, run);
  }
}
/** The demo's finger taps a control of a video where that control is now. */
async function tap(run, v, ctl) {
  let c = controlCentre(v, ctl);
  fingerEl.hidden = false;
  fingerEl.style.left = `${c.x}px`;
  fingerEl.style.top = `${c.y}px`;
  await wait(380, run);
  c = controlCentre(v, ctl);
  fingerEl.style.left = `${c.x}px`;
  fingerEl.style.top = `${c.y}px`;
  pressStart(c.x, c.y, "script");
  await wait(90, run);
  pressEnd(c.x, c.y, false);
  await wait(250, run);
  fingerEl.hidden = true;
}
async function tapNarr(run) {
  const r = narrRect();
  fingerEl.hidden = false;
  fingerEl.style.left = `${r.x + r.w / 2}px`;
  fingerEl.style.top = `${r.y + r.h / 2 + 10}px`;
  await wait(420, run);
  toggleNarr();
  await wait(250, run);
  fingerEl.hidden = true;
}
function runScript(fn) {
  const run = { cancelled: false };
  script = run;
  fn(run)
    .catch(() => {
      // cancelled by another beat
    })
    .finally(() => {
      if (script === run) {
        script = null;
      }
      fingerEl.hidden = true;
    });
}
const playCtl = (v) =>
  cfg.ctl === "button" && !(v.u === 0 && v.part.surface.round)
    ? "play"
    : "picture";
async function startMain(run) {
  const v = byId("screen");
  if (!v.playing) {
    if (v.m.picPx < 60 || stationDist > RADIUS_M) {
      standAt(3, 0, 1.4);
      await arrive(run);
      await wait(500, run);
    }
    if (v.u === 0 || v.u === 1) {
      await tap(run, v, playCtl(v));
    }
  }
}
function leaveOn(on) {
  $("leaveBtn").setAttribute("aria-pressed", String(on));
}
function beat(name) {
  cancelScript();
  userYaw = 0;
  if (name !== "turn") {
    setTurn(false);
  }
  if (name !== "leave") {
    leaveOn(false);
  }
  const main = byId("screen");
  if (name === "walk") {
    standAt(28, 0, 0);
    standAt(3, 0, 12);
    runScript(async (run) => {
      await arrive(run);
      await wait(600, run);
      if (!main.playing) {
        await tap(run, main, playCtl(main));
      }
    });
  } else if (name === "d3") {
    standAt(3, 0, 1.2);
  } else if (name === "d7") {
    standAt(7, 0, 1.2);
  } else if (name === "d15") {
    standAt(15, 0, 1.6);
  } else if (name === "side") {
    standAt(5, 65, 1.6);
  } else if (name === "turn") {
    setTurn(turnTarget === 0);
  } else if (name === "taps") {
    runScript(async (run) => {
      await startMain(run);
      await wait(1500, run);
      for (const [ctl, ms] of [
        ["sound", 1300],
        ["cc", 1400],
        ["cc", 1300],
        ["sound", 1300],
      ]) {
        await tap(run, main, ctl);
        await wait(ms, run);
      }
      await tap(run, main, playCtl(main));
      await wait(1300, run);
      await tap(run, main, playCtl(main));
    });
  } else if (name === "narr") {
    const on = !narrOn;
    showNarr(on);
    if (on) {
      runScript(async (run) => {
        await startMain(run);
        await wait(800, run);
        standAt(15, 0, 2.4);
        await arrive(run);
        await wait(900, run);
        await tapNarr(run);
      });
    }
  } else if (name === "two") {
    const on = !two;
    mountMill(on);
    if (on) {
      runScript(async (run) => {
        await startMain(run);
        await wait(1200, run);
        // turn to the mill: the screen leaves the view and its player docks
        standAt(3, 0, 2.2, MILL_POS, MILL_YAW);
        await arrive(run);
        await wait(1400, run);
        // tap the mill: it takes the corner and the sound; the screen's player goes home, still playing
        await tap(run, byId("mill"), "picture");
        await wait(1600, run);
        standAt(12, 0, 2.6, MILL_POS, MILL_YAW);
        await arrive(run);
      });
    } else {
      standAt(7, 0, 1.2);
    }
  } else if (name === "leave") {
    const out = stationDist <= RADIUS_M;
    leaveOn(out);
    if (out) {
      standAt(26, 0, 4);
    } else {
      standAt(7, 0, 3);
    }
  } else if (name === "end") {
    if (!main.block.clip.ok) {
      return;
    }
    if (stationDist > RADIUS_M) {
      standAt(7, 0, 0);
    }
    cornerHolder = main.id;
    main.t = main.block.clip.duration - 4;
    main.finished = false;
    setPlaying(main, true);
  }
}
document.querySelectorAll("[data-beat]").forEach((b) => {
  b.addEventListener("click", () => {
    ensureAudio();
    beat(b.dataset.beat);
  });
});

// ---------- the settings ----------
function applyCfg() {
  document.querySelectorAll("[data-cfg]").forEach((b) => {
    b.classList.toggle("on", String(cfg[b.dataset.cfg]) === b.dataset.v);
  });
  if (cfg.sound !== "tone") {
    for (const v of videos) {
      hush(v);
    }
  }
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
    if (["text", "size", "aspect"].includes(key) && before !== cfg[key]) {
      mountMain();
    }
    showDistances();
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
    for (const v of videos) {
      if (v.playing) {
        setPlaying(v, false);
      }
    }
  }
});

// ---------- where it docks: the picture's size on screen against distance ----------
function showDistances() {
  const v = byId("screen");
  if (!v || !distEl) {
    return;
  }
  const L = v.part.player.layout;
  const s = v.part.surface;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const pxPerM1 = H / (2 * Math.tan(vfov / 2)); // px per metre seen 1 m away, straight in front
  const picM = (s.hM * L.clip.h) / L.H;
  const btnM = (s.hM * SURFACE.bar) / L.H;
  const at = [3, 7, 15]
    .map((d) => `${Math.round((picM * pxPerM1) / d)}`)
    .join(" / ");
  const dock = [80, 120, 160, 220]
    .map((thr) => `${((picM * pxPerM1) / thr).toFixed(1)} m at ${thr} px`)
    .join(", ");
  const dr = dockRect(v);
  const dockPic = (dr.w * L.clip.h) / L.W;
  distEl.textContent =
    `${W > H ? "Sideways" : "Upright"} phone, straight in front, screen ${cfg.size} m wide (picture ${picM.toFixed(2)} m tall). ` +
    `Picture on screen at 3 / 7 / 15 m: ${at} px. It docks beyond ${dock}. ` +
    `The bar's play button (${btnM.toFixed(2)} m) stays ${cfg.tap} px tall out to ${((btnM * pxPerM1) / cfg.tap).toFixed(1)} m. ` +
    `The corner player is ${Math.round(dr.w)} x ${Math.round(dr.h)} px, its picture ${Math.round(dockPic)} px tall, its buttons ${Math.round((dr.w * SURFACE.btn) / L.W)} px.`;
}

// ---------- readout and cost ----------
const frameStats = { workMax: 0, workSum: 0, n: 0, over50: 0, gapMax: 0 };
let statsAt = 0;
let costAt = -1;
function itemCost() {
  let draws = 0;
  let tris = 0;
  for (const v of videos) {
    v.part.object.traverse((o) => {
      if (o.isMesh && o.visible) {
        draws++;
        const gm = o.geometry;
        tris += (gm.index ? gm.index.count : gm.attributes.position.count) / 3;
      }
    });
    if (v.ov.mesh.visible) {
      draws++;
      tris += 2;
    }
  }
  return { draws, tris };
}
function whereOf(v) {
  return v.u === 0 ? "in the world" : v.u === 1 ? "in the corner" : "flying";
}
function report(now) {
  if (now - statsAt < 250) {
    return;
  }
  const v = byId("screen");
  const mill = byId("mill");
  const ctl =
    cfg.ctl === "button"
      ? ` - button ${Math.round(v.m.ctlPx)} px (from ${cfg.tap})`
      : "";
  readoutEl.textContent =
    clock < exitNote
      ? "Exit is not part of this prototype."
      : `${stationDist.toFixed(1)} m - ${Math.round(v.m.angle)} deg - picture ${Math.round(v.m.picPx)} px (from ${cfg.thr})${ctl} - ${whereOf(v)}: ${v.why}` +
        (mill ? ` | mill ${whereOf(mill)}: ${mill.why}` : "");
  if (costAt < 0 || now - costAt >= 1000) {
    costAt = now;
    const c = itemCost();
    const info = renderer.info.render;
    costEl.textContent =
      `Frame work avg ${(frameStats.workSum / Math.max(1, frameStats.n)).toFixed(1)} ms, max ${frameStats.workMax.toFixed(1)} ms; ` +
      `longest gap ${Math.round(frameStats.gapMax)} ms; frames over 50 ms since load: ${frameStats.over50}. ` +
      `Videos: ${c.draws} draws, ${c.tris} triangles (whole frame ${info.calls} draws). ` +
      `Player repaints ${paintStats.n} per s, avg ${(paintStats.sum / Math.max(1, paintStats.n)).toFixed(2)} ms, max ${paintStats.max.toFixed(2)} ms.`;
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
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  stationDist = Math.hypot(camera.position.x, camera.position.z);
  for (const v of videos) {
    measure(v);
  }
  // leaving the station pauses every video; coming back does not start it again (no sound by nearness)
  if (stationDist > RADIUS_M) {
    for (const v of videos) {
      if (v.playing) {
        setPlaying(v, false);
        v.leftPaused = true;
      }
    }
  }
  for (const v of videos) {
    advance(v, dt);
  }
  for (const v of videos) {
    decide(v, dt);
  }
  for (const v of videos) {
    paint(v);
    layout(v);
  }
  updateNarr(dt);

  renderer.clear();
  renderer.render(scene, camera);
  if (videos.some((v) => v.ov.mesh.visible)) {
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

// ---------- start: 7 m in front of the screen, the video stopped until it is tapped ----------
try {
  const res = await fetch("sample.json");
  if (!res.ok) {
    throw new Error(`sample.json: HTTP ${res.status}`);
  }
  sample = await res.json();
  mountMain();
  mountMill(two);
  applyCfg();
  showNarr(narrOn);
  const at = params.get("at");
  const spots = {
    d3: [3, 0],
    d7: [7, 0],
    d15: [15, 0],
    side: [5, 65],
  };
  if (at === "walk") {
    beat("walk");
  } else {
    const [d, deg] = spots[at] ?? spots.d7;
    standAt(d, deg, 0);
  }
  if (params.has("autostart")) {
    const v = byId("screen");
    if (v.block.clip.ok) {
      cornerHolder = v.id;
      setPlaying(v, true);
    }
  }
  requestAnimationFrame(frame);
} catch (err) {
  readoutEl.textContent = `Could not load the sample (${err.message}).`;
}
