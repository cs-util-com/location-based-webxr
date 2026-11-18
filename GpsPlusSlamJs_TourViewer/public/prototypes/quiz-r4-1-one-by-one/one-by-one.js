// Quiz 4.1 - One by one. Throwaway prototype: not wired to the app, linked from nothing in it.
// A character's question arrives in the narration box; the box folds to one line and the answers fly
// out one at a time, each to the thing it names. An answer whose place is out of view waits until
// the visitor turns that way. Walking to an answer charges it at eye level (wake, grow, come closer,
// fill from below, open); a short grace lets a step away take it back. Opening the box brings every
// answer back in, where a tap chooses one with the same grace and undo.
import * as THREE from "three";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ================= values the feel rests on (sliders in the menu, and URL options) ================= */
const params = new URLSearchParams(location.search);
function numParam(key, fallback, lo, hi) {
  if (!params.has(key)) {
    return fallback;
  }
  const v = Number(params.get(key));
  return Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}
const SLIDERS = [
  ["flight", "Flight time per answer", 0.8, 4, 0.1, "s", 2],
  ["stagger", "Stagger between answers (0 = all at once)", 0, 2, 0.1, "s", 0.6],
  ["ret", "Return speed (share of the flight time)", 0.5, 1, 0.05, "x", 1],
  ["dwell", "Stand to choose (dwell)", 2, 10, 0.5, "s", 4],
  ["grace", "Step away to take back within (grace)", 1, 6, 0.5, "s", 3],
  ["spacing", "Spacing between answers", 5, 10, 0.5, "m", 10],
];
const cfg = { voice: params.get("voice") === "on" };
for (const [key, , lo, hi, , , def] of SLIDERS) {
  cfg[key] = numParam(key, def, lo, hi);
}

const LET_GO = 1; // metres past the reach before a charging answer lets go (hysteresis)
// reach plus let-go is at most half the spacing: 3 m at 10 m spacing, 1.5 m at 5 m
const reach = () => clamp(cfg.spacing / 2 - LET_GO, 1.5, 3);
const NOTICE = 3; // metres past the reach where an answer wakes and notices the visitor
const ARM = 0.6; // seconds inside the reach before the charge starts
const DRAIN = 2; // a left charge empties this many times faster than it filled
const STEP_AWAY = 1.5; // metres from where the visitor stood when it opened: taken back
const SWITCH_MARGIN = 1.5;
const STILL_S = 20; // seconds without moving before the answers come back to the box
const STILL_SPEED = 0.3; // m/s: slower counts as standing
const STILL_MOVE = 2; // metres walked after that before they go out again
const RESULT_HOLD = 1.6; // seconds the result plays at the object before the answers come home
const EYE = 1.6;
const HOVER_Y = 1.1; // an answer rests at chest height above its place
const RISE_Y = 1.45; // and charges just under the eye
const COME = 1; // metres a charging answer comes towards the visitor
const KEEP = 2.1; // metres it keeps from the visitor, so it stays in view
const WALK = 1.4;
const FAST = 3.5;
const BEACON_IN = 1.2; // metres the beacon floats in front of its thing, towards the start

const SPEAKER = { name: "Mara", color: "#4ade80" };
const TEXT = {
  lead: "Look around this square. Three old things stand here: the fountain, the plane tree and the bench. One of them was here long before the other two.",
  question: "Which of these stood on this square first?",
  right: "The fountain. Its water ran here more than two hundred years before the tree was planted.",
  retry: "Not that one. You have one more try.",
  wrong: "It was the fountain, from 1652. The tree came in 1921, and the bench only this spring.",
  goesOn: "Now come with me to the gate at the south end. The first tram rolled through it, and it brought the tree.",
};
const POINTS = 10;
const RIGHT = "#2dd4bf";
const ANSWERS = [
  { id: "fountain", label: "The fountain", hue: "#7dd3fc", dir: [0, -1], right: true },
  { id: "tree", label: "The plane tree", hue: "#c4b5fd", dir: [-0.866, -0.5], right: false },
  { id: "bench", label: "The bench", hue: "#fda4af", dir: [0.866, -0.5], right: false },
];

/* ================= the state of the quiz ================= */
const S = {};
const A = ANSWERS.map((o, i) => ({ ...o, i }));
function freshState() {
  Object.assign(S, {
    phase: "lead", // lead | ask | open | result | after
    recall: null, // why the answers are in the box while answering: null | user | weak | still
    fold: false, // the visitor folded the box outside the answering phase
    weak: false,
    clock: 0,
    lastOut: -Infinity,
    lastIn: -Infinity,
    cue: null, // { i, side } the one answer waiting for the turn
    at: -1, // the answer the visitor stands by
    arm: 0,
    held: -1, // the answer that opened, counting down its grace
    heldAt: 0,
    heldX: 0,
    heldZ: 0,
    remote: false, // chosen in the box, not by standing
    tries: 0,
    chosen: -1,
    result: null,
    resultAt: 0,
    retryUntil: 0,
    stillT: 0,
    stillX: 0,
    stillZ: 0,
    bubble: null, // { i, text, until }
    autoWalk: null,
  });
  for (const a of A) {
    Object.assign(a, { where: "box", flight: null, charge: 0, crossed: false, blocked: false, landedAt: -99, homeAt: -99, d: 99 });
  }
}

/* ================= the visitor ================= */
const V = { x: 0, z: 0, yaw: 0, speed: 0, walkDir: 0, fast: false, keys: new Set() };
function placeAt(x, z, yaw) {
  V.x = x;
  V.z = z;
  V.yaw = yaw;
  S.stillT = 0;
}
const yawTo = (x, z) => Math.atan2(-(x - V.x), -(z - V.z));
function relAngle(a) {
  const dx = a.bx - V.x;
  const dz = a.bz - V.z;
  const side = dx * Math.cos(V.yaw) - dz * Math.sin(V.yaw);
  const ahead = -dx * Math.sin(V.yaw) - dz * Math.cos(V.yaw);
  return Math.atan2(side, ahead);
}

/* ================= three.js: the square standing in for the camera ================= */
const canvas = $("cam");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 500);
camera.rotation.order = "YXZ";
scene.fog = new THREE.Fog(0xd5dfe6, 50, 220);
scene.add(new THREE.HemisphereLight(0xdfe9f2, 0x6b5e50, 1.5));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
sun.position.set(40, 80, 20);
scene.add(sun);

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
scene.background = canvasTexture(4, 256, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#7fa6c9");
  grad.addColorStop(0.55, "#c4d6e3");
  grad.addColorStop(1, "#e3e9ec");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
});
const cobble = (() => {
  const rand = rng(7);
  const tex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = "#6f6a62";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      for (let x = (y / 16) % 2 ? -8 : 0; x < w; x += 16) {
        const v = 128 + Math.floor(rand() * 36);
        g.fillStyle = `rgb(${v} ${v - 6} ${v - 14})`;
        g.beginPath();
        g.roundRect(x + 1.5, y + 1.5, 13, 13, 4);
        g.fill();
      }
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(90, 90);
  tex.anisotropy = 4;
  return tex;
})();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: cobble }));
scene.add(ground);

// houses around the square, instanced
(function houses() {
  const rand = rng(11);
  const spots = [];
  for (let k = 0; k < 26; k++) {
    const ang = (k / 26) * Math.PI * 2;
    const r = 34 + rand() * 6;
    spots.push([Math.cos(ang) * r, Math.sin(ang) * r, -ang]);
  }
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
  const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(0.75, 1, 4), new THREE.MeshLambertMaterial({ color: 0xa04a30 }), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const colors = [0xf4efe6, 0xf0dcc0, 0xe6cfb0, 0xdfe3e0, 0xf3d9c6, 0xe9e0cf];
  const c = new THREE.Color();
  spots.forEach(([x, z, ang], i) => {
    const h = 9 + rand() * 7;
    q.setFromAxisAngle(up, ang);
    m.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(8, h, 8));
    walls.setMatrixAt(i, m);
    walls.setColorAt(i, c.setHex(colors[Math.floor(rand() * colors.length)]));
    q.setFromAxisAngle(up, ang + Math.PI / 4);
    m.compose(new THREE.Vector3(x, h + 1.6, z), q, new THREE.Vector3(8, 3.2, 8));
    roofs.setMatrixAt(i, m);
  });
  scene.add(walls, roofs);
})();

// the station pin: an orange beam into the sky with sparks rising from the ground (it stays visible)
const STATION = new THREE.Vector3(-3, 0, -24);
const stationBeam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.32, 0.32, 90, 12, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xf2971f, transparent: true, opacity: 0.6, depthWrite: false, fog: false }),
);
stationBeam.position.set(STATION.x, 45, STATION.z);
scene.add(stationBeam);
const stationSparks = makeSparks(0xf2971f, 30, 0.16);
stationSparks.position.copy(STATION);
scene.add(stationSparks);

// another item of the station: a narration circle behind the start, quiet and dimmed while the question is open
const otherItem = new THREE.Mesh(
  new THREE.CircleGeometry(1.6, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.35, depthWrite: false }),
);
otherItem.position.set(4, 0.03, 7);
scene.add(otherItem);

function makeSparks(color, count, size) {
  const pos = new Float32Array(count * 3);
  const seeds = [];
  for (let k = 0; k < count; k++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.45;
    seeds.push([Math.cos(ang) * r, Math.sin(ang) * r, Math.random()]);
  }
  const pts = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3)),
    new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  pts.userData.seeds = seeds;
  pts.frustumCulled = false;
  return pts;
}
function animateSparks(pts, t, height, spread) {
  const seeds = pts.userData.seeds;
  const pos = pts.geometry.attributes.position.array;
  for (let k = 0; k < seeds.length; k++) {
    const [x, z, s] = seeds[k];
    const f = (t * 0.45 + s) % 1;
    pos[k * 3] = x * spread;
    pos[k * 3 + 1] = f * height;
    pos[k * 3 + 2] = z * spread;
  }
  pts.geometry.attributes.position.needsUpdate = true;
}

/* ---------- the named things: neutral shapes ---------- */
const stone = new THREE.MeshLambertMaterial({ color: 0xb9b2a4 });
const water = new THREE.MeshLambertMaterial({ color: 0x6fb2d6 });
const wood = new THREE.MeshLambertMaterial({ color: 0x8a6a4e });
const bark = new THREE.MeshLambertMaterial({ color: 0x7d6650 });
const leaves = new THREE.MeshLambertMaterial({ color: 0x6f9e62 });
function thing(id) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  if (id === "fountain") {
    add(new THREE.CylinderGeometry(1.5, 1.6, 0.55, 24), stone, 0, 0.27, 0);
    add(new THREE.CylinderGeometry(1.32, 1.32, 0.04, 24), water, 0, 0.56, 0);
    add(new THREE.CylinderGeometry(0.22, 0.32, 1.6, 10), stone, 0, 1.1, 0);
    add(new THREE.CylinderGeometry(0.7, 0.25, 0.22, 14), stone, 0, 1.95, 0);
  } else if (id === "tree") {
    add(new THREE.CylinderGeometry(0.18, 0.28, 3.2, 8), bark, 0, 1.6, 0);
    add(new THREE.IcosahedronGeometry(2.2, 1), leaves, 0, 4.2, 0);
    add(new THREE.IcosahedronGeometry(1.5, 1), leaves, 1.1, 3.5, 0.5);
  } else {
    add(new THREE.BoxGeometry(1.9, 0.08, 0.5), wood, 0, 0.46, 0);
    add(new THREE.BoxGeometry(1.9, 0.5, 0.07), wood, 0, 0.75, -0.24);
    add(new THREE.BoxGeometry(0.08, 0.46, 0.45), wood, -0.85, 0.23, 0);
    add(new THREE.BoxGeometry(0.08, 0.46, 0.45), wood, 0.85, 0.23, 0);
  }
  scene.add(g);
  return g;
}

/* ---------- an answer in the world: a small egg-shaped beacon that charges and opens ---------- */
const EGG_H = 0.5;
const EGG_R = 0.17;
const CRACK = 0.58;
const eggRadius = (f) => EGG_R * Math.pow(Math.sin(Math.PI * f), 0.75) * (1.08 - 0.22 * f);
function eggPart(a, b, grow = 1, pad = 0) {
  const pts = [];
  for (let k = 0; k <= 12; k++) {
    const f = a + ((b - a) * k) / 12;
    pts.push(new THREE.Vector2(Math.max(0.0005, eggRadius(f) * grow + pad), (f - a) * EGG_H));
  }
  return new THREE.LatheGeometry(pts, 20);
}
// everything below `level` (a share of the egg's height) glows in its colour, with a bright surface line
function fillMaterial(hue) {
  return new THREE.ShaderMaterial({
    uniforms: { level: { value: 0 }, tint: { value: new THREE.Color(hue) }, time: { value: 0 } },
    vertexShader: `
      varying float vY;
      varying vec3 vN;
      void main() {
        vY = position.y / ${EGG_H.toFixed(3)};
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float level;
      uniform vec3 tint;
      uniform float time;
      varying float vY;
      varying vec3 vN;
      void main() {
        float surface = level + 0.025 * sin(time * 6.0 + vN.x * 8.0);
        if (vY > surface) discard;
        float edge = smoothstep(0.09, 0.0, surface - vY);
        float rim = pow(1.0 - abs(vN.z), 2.0);
        vec3 c = mix(tint * 1.2, vec3(1.0), 0.05 + 0.85 * edge + 0.15 * rim);
        gl_FragColor = vec4(c, 0.92 + 0.08 * edge);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
const hitGeo = new THREE.SphereGeometry(0.9, 8, 6);
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
for (const a of A) {
  a.thing = thing(a.id);
  a.hueC = new THREE.Color(a.hue);
  a.mat = new THREE.MeshLambertMaterial({ color: a.hue, emissive: a.hue, emissiveIntensity: 1, transparent: true });
  a.group = new THREE.Group();
  a.pivot = new THREE.Group();
  a.body = new THREE.Mesh(eggPart(0, CRACK), a.mat);
  a.lid = new THREE.Mesh(eggPart(CRACK, 1), a.mat);
  a.fillMat = fillMaterial(a.hue);
  a.shell = new THREE.Mesh(eggPart(0, 1, 1.07, 0.004), a.fillMat);
  a.shell.renderOrder = 3;
  // the grace countdown: an arc round the opened answer that closes as the grace runs out
  a.graceRing = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.47, 48, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, transparent: true }));
  a.graceRing.renderOrder = 6;
  a.graceRing.position.y = EGG_H * 0.5;
  a.hit = new THREE.Mesh(hitGeo, hitMat);
  a.hit.position.y = EGG_H * 0.5;
  a.hit.userData.answer = a.i;
  a.pivot.add(a.body, a.lid, a.shell, a.graceRing);
  a.group.add(a.pivot, a.hit);
  // on the ground below it: its own light, the landing pulse, a short column of rising sparks
  a.pool = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: a.hue, transparent: true, opacity: 0.4, depthWrite: false }));
  a.pulse = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: a.hue, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  a.sparks = makeSparks(a.hue, 34, 0.13);
  for (const m of [a.pool, a.pulse]) {
    m.position.y = 0.03;
  }
  scene.add(a.group, a.pool, a.pulse, a.sparks);
  a.view = { wake: 0, open: 0, lean: 0, pop: 0 };
}
function applySpacing() {
  for (const a of A) {
    a.tx = a.dir[0] * cfg.spacing;
    a.tz = a.dir[1] * cfg.spacing;
    a.bx = a.dir[0] * (cfg.spacing - BEACON_IN);
    a.bz = a.dir[1] * (cfg.spacing - BEACON_IN);
    a.thing.position.set(a.tx, 0, a.tz);
    a.thing.rotation.y = Math.atan2(-a.dir[0], -a.dir[1]);
    for (const m of [a.pool, a.pulse, a.sparks]) {
      m.position.x = a.bx;
      m.position.z = a.bz;
    }
  }
}

/* ================= the narration box: words, tap to pause, vertical drag to scrub ================= */
const nbox = $("nbox");
const col = $("col");
const thumb = $("thumb");
const sbar = $("sbar");
const chipsEl = $("chips");
const hintEl = $("hint");
const ptext = $("ptext");
const pdots = $("pdots");
const pbar = $("pbar");
const pbarFill = $("pbarFill");
const handle = $("handle");
const handleText = $("handleText");
const cueEl = $("cue");
const cueText = $("cueText");
const bubbleEl = $("bubble");
const flyLayer = $("flyLayer");
nbox.style.setProperty("--spk", SPEAKER.color);

const N = { kind: "", text: "", words: [], total: 0, t: 0, playing: false, doneAt: -1, lineOf: [], lineStart: [], lines: 1, rows: 1, s: 0, lit: -1, lh: 22 };
let scrubbing = false;
function fakeTimes(texts) {
  let t = 0;
  return texts.map((w) => {
    const letters = w.replace(/[^\p{L}\p{N}]/gu, "").length;
    const d = clamp(0.1 + 0.048 * letters, 0.16, 0.6);
    const start = t;
    t += d;
    if (/[.!?]$/.test(w)) {
      t += 0.4;
    } else if (/[,;:]$/.test(w)) {
      t += 0.2;
    }
    return { start, end: start + d };
  });
}
function setNarration(kind, text, autoplay, lit = false) {
  N.kind = kind;
  N.text = text;
  col.textContent = "";
  const name = document.createElement("b");
  name.className = "spk";
  name.textContent = SPEAKER.name;
  col.append(name, " ");
  const texts = text.split(/\s+/).filter(Boolean);
  const times = fakeTimes(texts);
  N.words = texts.map((w, k) => {
    const el = document.createElement("span");
    el.className = "w";
    el.textContent = w;
    col.append(el, " ");
    return { text: w, start: times[k].start, end: times[k].end, el };
  });
  N.total = N.words.length ? N.words[N.words.length - 1].end + 0.3 : 0;
  N.t = lit ? N.total : 0;
  N.lit = -1;
  N.playing = autoplay;
  N.doneAt = lit ? S.clock - 99 : -1;
  layoutWords();
  speak();
}
function wordAt(time) {
  let found = -1;
  for (let k = 0; k < N.words.length; k++) {
    if (N.words[k].start <= time) {
      found = k;
    } else {
      break;
    }
  }
  return found;
}
function layoutWords() {
  if (nbox.classList.contains("collapsed") || !N.words.length) {
    return;
  }
  N.lh = parseFloat(getComputedStyle(col).lineHeight) || 22;
  const tops = [];
  N.lineOf = N.words.map((w) => {
    const top = w.el.offsetTop;
    let k = tops.findIndex((x) => Math.abs(x - top) < N.lh / 2);
    if (k < 0) {
      tops.push(top);
      k = tops.length - 1;
    }
    return k;
  });
  N.lines = Math.max(1, tops.length);
  const maxRows = matchMedia("(orientation: landscape) and (max-height: 540px)").matches ? 2 : 3;
  N.rows = Math.min(maxRows, N.lines);
  nbox.style.setProperty("--rows", String(N.rows));
  N.lineStart = [];
  N.words.forEach((w, k) => {
    if (N.lineStart[N.lineOf[k]] === undefined) {
      N.lineStart[N.lineOf[k]] = w.start;
    }
  });
  N.lineStart[N.lines] = N.total;
  sbar.classList.toggle("none", N.lines <= N.rows);
}
const maxScroll = () => Math.max(0, N.lines - N.rows);
function lineFloatAt(time) {
  if (time >= N.total) {
    return N.lines;
  }
  let k = 0;
  while (k + 1 < N.lines && N.lineStart[k + 1] <= time) {
    k++;
  }
  const span = N.lineStart[k + 1] - N.lineStart[k];
  return k + (span > 0 ? clamp((time - N.lineStart[k]) / span, 0, 1) : 0);
}
function timeAtLine(x) {
  const v = clamp(x, 0, N.lines);
  const k = Math.floor(v);
  if (k >= N.lines) {
    return N.total;
  }
  return N.lineStart[k] + (v - k) * (N.lineStart[k + 1] - N.lineStart[k]);
}
const followTarget = () => clamp((N.lineOf[Math.max(0, wordAt(N.t))] ?? 0) - 1, 0, maxScroll());
function advanceNarration(dt) {
  if (!N.playing || scrubbing) {
    return;
  }
  N.t = Math.min(N.t + dt, N.total);
  if (N.t >= N.total) {
    N.playing = false;
    N.doneAt = S.clock;
    stopVoice();
  }
}
const narrationDone = () => N.t >= N.total && !scrubbing;
function updateWords(dt) {
  const lit = wordAt(N.t - 1e-6);
  if (lit !== N.lit) {
    N.words.forEach((w, k) => w.el.classList.toggle("on", k <= lit));
    N.lit = lit;
  }
  if (!scrubbing) {
    const target = followTarget();
    N.s = reduceMotion ? target : N.s + (target - N.s) * (1 - Math.exp(-dt * 9));
  }
  col.style.transform = `translateY(${(-N.s * N.lh).toFixed(2)}px)`;
  const winH = N.rows * N.lh - 4;
  const thumbH = Math.max(14, (winH * N.rows) / N.lines);
  thumb.style.height = `${thumbH.toFixed(1)}px`;
  thumb.style.transform = `translateY(${(clamp(N.s / Math.max(1, maxScroll()), 0, 1) * (winH - thumbH)).toFixed(1)}px)`;
}

// the voice (optional): the browser's text-to-speech from the current word, no word sync
const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
function stopVoice() {
  if (synth && (synth.speaking || synth.pending)) {
    synth.cancel();
  }
}
function speak() {
  stopVoice();
  if (!cfg.voice || !synth || !N.playing) {
    return;
  }
  const from = Math.max(0, wordAt(N.t));
  const u = new SpeechSynthesisUtterance(N.words.slice(from).map((w) => w.text).join(" "));
  u.lang = "en-GB";
  synth.speak(u);
}
function togglePlay(x, y) {
  if (N.t >= N.total) {
    N.t = 0;
    N.playing = true;
  } else {
    N.playing = !N.playing;
  }
  if (N.playing) {
    speak();
  } else {
    stopVoice();
  }
  const fx = document.createElement("div");
  fx.className = "tapfx";
  fx.style.left = `${x}px`;
  fx.style.top = `${y}px`;
  fx.innerHTML = N.playing
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
  document.body.append(fx);
  setTimeout(() => fx.remove(), 900);
}

// The box's own gestures, unchanged: a tap on the words pauses or plays, a vertical drag scrubs.
// Buttons inside the box (the handle, the answers) are not part of them.
const TAP_SLOP = 8;
let press = null;
nbox.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button")) {
    return;
  }
  press = { id: e.pointerId, x: e.clientX, y: e.clientY, s0: N.s, line0: lineFloatAt(N.t) };
  nbox.setPointerCapture(e.pointerId);
});
nbox.addEventListener("pointermove", (e) => {
  if (!press || e.pointerId !== press.id) {
    return;
  }
  const dy = press.y - e.clientY;
  if (!scrubbing && Math.hypot(e.clientX - press.x, dy) > TAP_SLOP && !nbox.classList.contains("collapsed")) {
    scrubbing = true;
    stopVoice();
    col.classList.add("scrub");
  }
  if (scrubbing) {
    const lines = dy / N.lh;
    N.t = timeAtLine(press.line0 + lines);
    const raw = press.s0 + lines;
    const top = maxScroll();
    N.s = raw < 0 ? raw * 0.3 : raw > top ? top + (raw - top) * 0.3 : raw;
  }
});
function endPress(e) {
  if (!press || e.pointerId !== press.id) {
    return;
  }
  const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP;
  press = null;
  if (scrubbing) {
    scrubbing = false;
    col.classList.remove("scrub");
    if (N.t < N.total) {
      N.doneAt = -1;
    }
    speak();
    return;
  }
  if (e.type !== "pointercancel" && !moved) {
    togglePlay(e.clientX, e.clientY);
  }
}
nbox.addEventListener("pointerup", endPress);
nbox.addEventListener("pointercancel", endPress);
nbox.addEventListener("keydown", (e) => {
  if (e.target !== nbox) {
    return;
  }
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    const r = nbox.getBoundingClientRect();
    togglePlay(r.left + r.width / 2, r.top + r.height / 2);
  }
});

// The fold control: the handle on the box's top edge. A tap toggles; a drag down folds, a drag up opens.
let handleDrag = null;
handle.addEventListener("pointerdown", (e) => {
  handleDrag = { id: e.pointerId, y: e.clientY, done: false };
  handle.setPointerCapture(e.pointerId);
});
handle.addEventListener("pointermove", (e) => {
  if (!handleDrag || e.pointerId !== handleDrag.id || handleDrag.done) {
    return;
  }
  const dy = e.clientY - handleDrag.y;
  if (Math.abs(dy) > 22) {
    handleDrag.done = true;
    setBoxOpen(dy < 0);
  }
});
handle.addEventListener("pointerup", (e) => {
  if (handleDrag && e.pointerId === handleDrag.id && !handleDrag.done) {
    handleDrag.done = true;
    setBoxOpen(!boxOpen());
  }
});
handle.addEventListener("click", (e) => {
  // a pointer tap is handled on pointerup; a keyboard press arrives as a click with no pointer before it
  if (handleDrag && handleDrag.done) {
    handleDrag = null;
    return;
  }
  e.preventDefault();
  setBoxOpen(!boxOpen());
});

/* ================= the quiz flow ================= */
function boxOpen() {
  if (S.phase === "open") {
    return S.recall !== null;
  }
  if (S.phase === "result" && S.clock - S.resultAt < RESULT_HOLD) {
    return false;
  }
  return !S.fold;
}
function setBoxOpen(open) {
  if (S.phase === "open") {
    S.recall = open ? "user" : null;
  } else {
    S.fold = !open;
  }
}
const remoteHeld = () => S.held >= 0 && S.remote;
const wantOut = () => S.phase === "open" && S.recall === null && !S.weak && !remoteHeld();

function enterLead() {
  S.phase = "lead";
  setNarration("lead", TEXT.lead, true);
}
function enterAsk() {
  S.phase = "ask";
  S.fold = false;
  setNarration("question", TEXT.question, true);
}
function enterOpen() {
  S.phase = "open";
  S.recall = S.weak ? "weak" : null;
}
function enterAfter() {
  S.phase = "after";
  S.fold = false;
  setNarration("goesOn", TEXT.goesOn, true);
}

function hold(i, remote) {
  if (S.phase !== "open" || S.held >= 0 || A[i].crossed) {
    return;
  }
  S.held = i;
  S.heldAt = S.clock;
  S.heldX = V.x;
  S.heldZ = V.z;
  S.remote = remote;
  A[i].charge = 1;
  A[i].landedAt = S.clock; // the opening pulses like a landing
}
function release(byTap) {
  if (S.held < 0) {
    return;
  }
  const a = A[S.held];
  if (byTap) {
    a.charge = 0;
  }
  S.held = -1;
  S.remote = false;
}
function commit() {
  const i = S.held;
  if (i < 0) {
    return;
  }
  S.chosen = i;
  S.held = -1;
  S.remote = false;
  if (A[i].right) {
    finish("right");
    return;
  }
  S.tries += 1;
  A[i].crossed = true;
  A[i].charge = 0;
  if (S.at === i) {
    S.at = -1;
  }
  if (S.tries < 2) {
    // one retry: the wrong one greys out where it stands, the others stay where they are
    S.retryUntil = S.clock + 5;
    setNarration("retry", TEXT.retry, true);
  } else {
    finish("wrong");
  }
}
function finish(result) {
  S.result = result;
  S.phase = "result";
  S.resultAt = S.clock;
  S.at = -1;
  S.fold = false;
  const pts = result === "right" ? (S.tries ? POINTS / 2 : POINTS) : 0;
  setNarration("result", result === "right" ? `${TEXT.right} +${pts} points.` : `${TEXT.wrong} No points this time.`, true);
}

function flow() {
  if (S.phase === "lead" && narrationDone() && S.clock - N.doneAt > 0.6) {
    enterAsk();
  } else if (S.phase === "ask" && narrationDone() && S.clock - N.doneAt > 1.2) {
    enterOpen();
  } else if (S.phase === "open" && S.retryUntil && S.clock > S.retryUntil) {
    S.retryUntil = 0;
    setNarration("question", TEXT.question, false, true);
  } else if (S.phase === "result" && narrationDone() && S.clock - N.doneAt > 1.5 && A.every((a) => a.where === "box")) {
    enterAfter();
  }
}

// standing by an answer: in at the reach, out only past reach + let-go, the charge starts after ARM
function stepCharge(dt) {
  const r = reach();
  let near = -1;
  let nearD = Infinity;
  for (const a of A) {
    a.d = Math.hypot(a.bx - V.x, a.bz - V.z);
    if (a.where !== "world" || a.crossed || S.phase !== "open") {
      continue;
    }
    if (a.blocked) {
      a.blocked = a.d <= r + LET_GO;
      continue;
    }
    if (a.d < nearD) {
      near = a.i;
      nearD = a.d;
    }
  }
  if (S.at >= 0) {
    const a = A[S.at];
    if (a.where !== "world" || a.blocked || a.crossed || a.d > r + LET_GO) {
      S.at = -1;
    } else if (near !== S.at && nearD < r && nearD < a.d - SWITCH_MARGIN) {
      S.at = near;
      S.arm = 0;
    }
  } else if (near >= 0 && nearD < r) {
    S.at = near;
    S.arm = 0;
  }
  // an answer opened by standing is taken back by a step away from where the visitor stood
  if (S.held >= 0 && !S.remote) {
    const i = S.held;
    if (S.at !== i || Math.hypot(V.x - S.heldX, V.z - S.heldZ) > STEP_AWAY) {
      release(false);
      A[i].blocked = true;
      S.at = -1;
    }
  }
  for (const a of A) {
    if (S.held === a.i || a.where !== "world") {
      continue; // an answer in the box keeps its fill
    }
    if (a.i === S.at) {
      S.arm += dt;
      if (S.arm >= ARM) {
        a.charge = Math.min(1, a.charge + dt / cfg.dwell);
        if (a.charge >= 1) {
          hold(a.i, false);
        }
      }
    } else if (a.charge > 0) {
      a.charge = Math.max(0, a.charge - (DRAIN * dt) / cfg.dwell);
    }
  }
  if (S.held >= 0 && S.clock - S.heldAt >= cfg.grace) {
    commit();
  }
}

// a visitor who has not moved for 20 s gets the answers back in the box; walking on sends them out
function stepStill(dt) {
  if (S.phase !== "open") {
    S.stillT = 0;
    return;
  }
  if (S.recall === "still") {
    if (Math.hypot(V.x - S.stillX, V.z - S.stillZ) > STILL_MOVE) {
      S.recall = null;
      S.stillT = 0;
    }
    return;
  }
  const settled = S.recall === null && !S.weak && S.at < 0 && S.held < 0 && A.every((a) => a.where === "world");
  S.stillT = settled && V.speed < STILL_SPEED ? S.stillT + dt : 0;
  if (S.stillT >= STILL_S) {
    S.recall = "still";
    S.stillX = V.x;
    S.stillZ = V.z;
  }
}
function setWeak(on) {
  S.weak = on;
  $("weakBtn").setAttribute("aria-pressed", String(on));
  if (S.phase !== "open") {
    return;
  }
  if (on && S.recall === null) {
    S.recall = "weak";
  } else if (!on && S.recall === "weak") {
    S.recall = null;
  }
}

/* ================= the flights between the box and the places ================= */
const W = () => innerWidth;
const H = () => innerHeight;
const tmp = new THREE.Vector3();
function project(x, y, z) {
  tmp.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  const front = tmp.z < -0.3;
  tmp.set(x, y, z).project(camera);
  return { x: ((tmp.x + 1) / 2) * W(), y: ((1 - tmp.y) / 2) * H(), nx: tmp.x, ny: tmp.y, front };
}
function inView(a) {
  const p = project(a.bx, HOVER_Y, a.bz);
  return p.front && Math.abs(p.nx) < 0.82 && Math.abs(p.ny) < 0.9;
}
// where an answer is on the screen; one out of view is placed beyond the edge it lies towards
// (a flight to or from it leaves or enters the screen there; nothing is ever drawn clamped to the edge)
function beaconScreen(a) {
  const pos = a.group.visible ? a.group.position : tmp.set(a.bx, HOVER_Y, a.bz).clone();
  const p = project(pos.x, pos.y + EGG_H * 0.5, pos.z);
  if (p.front) {
    return p;
  }
  return { x: relAngle(a) < 0 ? -80 : W() + 80, y: H() * 0.42 };
}
function center(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function homeScreen(a) {
  return boxOpen() ? center(a.chip) : center(a.dot);
}
function launch(a, dir) {
  const from = dir === "out" ? homeScreen(a) : beaconScreen(a);
  a.where = dir;
  a.flight = { dir, t0: S.clock, dur: dir === "out" ? cfg.flight : cfg.flight * cfg.ret, from };
  a.flyEl.hidden = false;
  if (dir === "in") {
    if (S.at === a.i) {
      S.at = -1;
    }
    if (S.held === a.i) {
      S.remote = true; // a choice in its grace comes along, still chosen, with its undo in the box
    }
  }
}
function schedule() {
  S.cue = null;
  if (wantOut()) {
    for (const a of A) {
      if (a.where === "in") {
        reverse(a);
      }
    }
    const waiting = A.filter((a) => a.where === "box").sort((p, q) => Math.abs(relAngle(p)) - Math.abs(relAngle(q)));
    if (!waiting.length || S.clock < S.lastOut + cfg.stagger) {
      return;
    }
    let launched = false;
    for (const a of waiting) {
      if (inView(a)) {
        launch(a, "out");
        S.lastOut = S.clock;
        launched = true;
        if (cfg.stagger > 0) {
          break;
        }
      }
    }
    // one by one: the next answer whose place is out of view waits for the turn, and says so
    if (!launched && !A.some((a) => a.where === "out")) {
      S.cue = { i: waiting[0].i, side: relAngle(waiting[0]) < 0 ? "left" : "right" };
    }
    return;
  }
  const home = boxOpen() || S.phase === "result";
  if (!home) {
    return;
  }
  for (const a of A) {
    if (a.where === "out") {
      reverse(a);
    }
  }
  if (S.phase === "result" && S.clock - S.resultAt < RESULT_HOLD) {
    return;
  }
  const away = A.filter((a) => a.where === "world").sort((p, q) => Math.abs(relAngle(p)) - Math.abs(relAngle(q)));
  const gap = cfg.stagger * cfg.ret;
  if (!away.length || S.clock < S.lastIn + gap) {
    return;
  }
  for (const a of away) {
    launch(a, "in");
    S.lastIn = S.clock;
    if (gap > 0) {
      break;
    }
  }
}
// a flight turned round half-way goes back from where it is now
function reverse(a) {
  const f = a.flight;
  const p = clamp((S.clock - f.t0) / f.dur, 0, 1);
  const dir = f.dir === "out" ? "in" : "out";
  const dur = dir === "out" ? cfg.flight : cfg.flight * cfg.ret;
  a.where = dir;
  a.flight = { dir, t0: S.clock - (1 - p) * dur, dur, from: f.dir === "out" ? beaconScreen(a) : homeScreen(a), reversed: true };
}
function stepFlights() {
  for (const a of A) {
    const f = a.flight;
    if (!f) {
      a.flyEl.hidden = true;
      continue;
    }
    const p = clamp((S.clock - f.t0) / f.dur, 0, 1);
    if (p >= 1) {
      a.flight = null;
      a.flyEl.hidden = true;
      if (f.dir === "out") {
        a.where = "world";
        a.landedAt = S.clock;
      } else {
        a.where = "box";
        a.homeAt = S.clock;
      }
      continue;
    }
    const from = f.reversed ? (f.dir === "out" ? homeScreen(a) : beaconScreen(a)) : f.from;
    const to = f.dir === "out" ? beaconScreen(a) : homeScreen(a);
    const e = easeInOut(p);
    // a high arc: the control point sits well above both ends
    const cx = (from.x + to.x) / 2;
    const cy = Math.min(from.y, to.y) - H() * 0.3;
    const x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * cx + e * e * to.x;
    const y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * cy + e * e * to.y;
    const sc = f.dir === "out" ? 1 - 0.45 * e : 0.55 + 0.45 * e;
    a.flyEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${sc.toFixed(3)})`;
    a.flyEl.style.opacity = String(f.dir === "out" ? 1 - 0.3 * smooth(0.85, 1, p) : 0.7 + 0.3 * p);
  }
}

/* ================= the visitor's input ================= */
let viewDrag = null;
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
canvas.addEventListener("pointerdown", (e) => {
  viewDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: V.yaw, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!viewDrag || e.pointerId !== viewDrag.id) {
    return;
  }
  if (Math.hypot(e.clientX - viewDrag.x, e.clientY - viewDrag.y) > TAP_SLOP) {
    viewDrag.moved = true;
  }
  if (viewDrag.moved) {
    V.yaw = viewDrag.yaw + (e.clientX - viewDrag.x) * 0.006;
  }
});
canvas.addEventListener("pointerup", (e) => {
  if (!viewDrag || e.pointerId !== viewDrag.id) {
    return;
  }
  const tap = !viewDrag.moved;
  viewDrag = null;
  if (tap) {
    tapView(e.clientX, e.clientY);
  }
});
canvas.addEventListener("pointercancel", () => {
  viewDrag = null;
});
function tapView(x, y) {
  ndc.set((x / W()) * 2 - 1, -(y / H()) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(A.filter((a) => a.group.visible).map((a) => a.hit), false);
  if (hits.length) {
    tapAnswer(hits[0].object.userData.answer);
    return;
  }
  const p = new THREE.Vector3();
  if (ray.ray.intersectPlane(groundPlane, p)) {
    jumpTo(p.x, p.z);
  }
}
// a tap on an answer always does something visible: close by it starts listening, far away it says so
function tapAnswer(i) {
  const a = A[i];
  if (S.phase !== "open") {
    return;
  }
  if (a.crossed) {
    S.bubble = { i, text: "Already tried", until: S.clock + 2 };
  } else if (S.held === i) {
    S.bubble = { i, text: "Chosen. Step away to take it back", until: S.clock + 2 };
  } else if (a.d <= reach() + LET_GO * 0.5) {
    a.blocked = false;
    S.at = i;
    S.arm = ARM;
    S.bubble = { i, text: "Listening. Stay here", until: S.clock + 1.6 };
  } else {
    S.bubble = { i, text: "Walk closer", until: S.clock + 2 };
  }
}
// a tap on the ground jumps there; near an answer it lands just outside its reach, facing it
function jumpTo(px, pz) {
  let best = null;
  let bestD = Infinity;
  for (const a of A) {
    const d = Math.hypot(px - a.bx, pz - a.bz);
    if (a.where === "world" && !a.crossed && d < bestD) {
      best = a;
      bestD = d;
    }
  }
  const outside = reach() + LET_GO + 0.6;
  if (best && bestD < outside + 4) {
    let ux = px - best.bx;
    let uz = pz - best.bz;
    let len = Math.hypot(ux, uz);
    if (len < 0.3) {
      ux = V.x - best.bx;
      uz = V.z - best.bz;
      len = Math.hypot(ux, uz) || 1;
    }
    V.x = best.bx + (ux / len) * outside;
    V.z = best.bz + (uz / len) * outside;
    V.yaw = yawTo(best.bx, best.bz);
  } else {
    const r = Math.hypot(px, pz);
    const k = r > 30 ? 30 / r : 1;
    V.x = px * k;
    V.z = pz * k;
  }
  S.autoWalk = null;
  S.stillT = 0;
}
for (const b of document.querySelectorAll("[data-walk]")) {
  const on = (e) => {
    e.preventDefault();
    V.walkDir = Number(b.dataset.walk);
    b.classList.add("on");
  };
  const off = () => {
    V.walkDir = 0;
    b.classList.remove("on");
  };
  b.addEventListener("pointerdown", on);
  b.addEventListener("pointerup", off);
  b.addEventListener("pointercancel", off);
  b.addEventListener("pointerleave", off);
}
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
    return;
  }
  V.keys.add(e.key.toLowerCase());
});
addEventListener("keyup", (e) => V.keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => V.keys.clear());
function moveVisitor(dt) {
  const k = V.keys;
  const turn = (k.has("e") || k.has("arrowright") ? 1 : 0) - (k.has("q") || k.has("arrowleft") ? 1 : 0);
  V.yaw += turn * 1.4 * dt;
  let fwd = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0) + V.walkDir;
  const side = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0);
  const speed = V.fast || k.has("shift") ? FAST : WALK;
  const x0 = V.x;
  const z0 = V.z;
  if (S.autoWalk) {
    const w = S.autoWalk;
    const d = Math.hypot(w.x - V.x, w.z - V.z);
    if (d < 0.05) {
      S.autoWalk = null;
    } else {
      const step = Math.min(d, WALK * dt);
      V.x += ((w.x - V.x) / d) * step;
      V.z += ((w.z - V.z) / d) * step;
    }
    fwd = 0;
  }
  V.x += (-Math.sin(V.yaw) * fwd + Math.cos(V.yaw) * side) * speed * dt;
  V.z += (-Math.cos(V.yaw) * fwd - Math.sin(V.yaw) * side) * speed * dt;
  V.speed = dt > 0 ? Math.hypot(V.x - x0, V.z - z0) / dt : 0;
}

/* ================= the HUD, every frame (writes only what changed) ================= */
for (const a of A) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.style.setProperty("--hue", a.hue);
  b.innerHTML = `<i class="dot"></i><span class="tx"><b></b><small></small></span><span class="bar"><i></i></span>`;
  b.querySelector("b").textContent = a.label;
  b.addEventListener("click", () => tapChip(a.i));
  chipsEl.append(b);
  a.chip = b;
  a.chipSmall = b.querySelector("small");
  a.chipBar = b.querySelector(".bar i");
  const dot = document.createElement("i");
  dot.style.setProperty("--hue", a.hue);
  pdots.append(dot);
  a.dot = dot;
  const fly = document.createElement("div");
  fly.className = "fly";
  fly.hidden = true;
  fly.style.setProperty("--hue", a.hue);
  fly.innerHTML = "<i></i><span></span>";
  fly.querySelector("span").textContent = a.label;
  flyLayer.append(fly);
  a.flyEl = fly;
}
// the tap fallback: always offered on the answers while the box is open; tap again to take it back
function tapChip(i) {
  const a = A[i];
  if (S.phase !== "open" || a.where !== "box" || a.crossed) {
    return;
  }
  if (S.held === i) {
    release(true);
  } else if (S.held < 0) {
    hold(i, true);
  }
}
const cache = new Map();
function put(key, value, write) {
  if (cache.get(key) !== value) {
    cache.set(key, value);
    write(value);
  }
}
function chipState(a) {
  if (a.where !== "box") {
    return ["away", ""];
  }
  if (S.phase === "result" || S.phase === "after") {
    if (a.right) {
      return ["right", S.result === "right" ? "Right" : "The answer"];
    }
    return [a.i === S.chosen ? "wrong" : "other", a.i === S.chosen ? "Not this one" : ""];
  }
  if (a.crossed) {
    return ["crossed", "Tried"];
  }
  if (S.held === a.i) {
    const left = Math.max(0, cfg.grace - (S.clock - S.heldAt));
    return ["held", `Chosen - tap to take back (${Math.ceil(left)} s)`];
  }
  if (a.charge > 0.01) {
    return ["home", `Filled ${Math.round(a.charge * 100)} % - tap to choose`];
  }
  return ["home", S.phase === "open" ? "Tap to choose" : ""];
}
function hintText() {
  if (S.phase !== "open" || !boxOpen()) {
    return "";
  }
  if (S.held >= 0) {
    return "Chosen. It counts when the time runs out; tap it again to take it back.";
  }
  if (S.recall === "weak") {
    return "Your position is unsure here, so the answers came back. Tap one to choose it.";
  }
  if (S.recall === "still") {
    return "Tap one to choose it here, or walk on and the answers go back to their places.";
  }
  return "Tap one to choose it here, or fold the box and walk to one.";
}
function pillText() {
  if (S.cue) {
    const a = A[S.cue.i];
    return `<b>Turn ${S.cue.side}</b> - ${escapeHtml(a.label.toLowerCase())} lands there`;
  }
  if (S.phase === "open") {
    if (S.held >= 0) {
      const left = Math.max(0, cfg.grace - (S.clock - S.heldAt));
      return S.remote
        ? `<b>${escapeHtml(A[S.held].label)}</b> chosen - open to take it back (${Math.ceil(left)} s)`
        : `<b>${escapeHtml(A[S.held].label)}</b> chosen - step away to take it back (${Math.ceil(left)} s)`;
    }
    if (S.at >= 0 && A[S.at].charge > 0) {
      return `<b>${escapeHtml(A[S.at].label)}</b> is listening - stay`;
    }
    if (S.weak) {
      return "Position unsure - open the box to answer by tap";
    }
  }
  return `<b class="spk">${SPEAKER.name}</b> ${escapeHtml(N.text)}`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
let wasOpen = null;
function renderHud(dt) {
  const open = boxOpen();
  if (open !== wasOpen) {
    nbox.classList.toggle("collapsed", !open);
    nbox.classList.remove("flash");
    void nbox.offsetWidth;
    nbox.classList.add("flash");
    handle.setAttribute("aria-label", open ? "Fold the box" : "Open the box");
    wasOpen = open;
    if (open) {
      layoutWords();
    }
  }
  put("handle", open ? "Hide" : S.phase === "open" ? "Show answers" : "Show", (v) => (handleText.textContent = v));
  updateWords(dt);
  const showChips = S.phase === "ask" || S.phase === "open" || S.phase === "result";
  put("chipsShown", showChips, (v) => (chipsEl.hidden = !v));
  for (const a of A) {
    const [state, small] = chipState(a);
    put(`cs${a.i}`, state, (v) => {
      a.chip.dataset.state = v;
      if (v !== "away" && a.homeAt > S.clock - 0.1) {
        a.chip.classList.remove("pop");
        void a.chip.offsetWidth;
        a.chip.classList.add("pop");
      }
    });
    put(`cm${a.i}`, small, (v) => (a.chipSmall.textContent = v));
    a.chip.disabled = !(S.phase === "open" && a.where === "box" && !a.crossed);
    const bar = S.held === a.i ? 1 - clamp((S.clock - S.heldAt) / cfg.grace, 0, 1) : a.charge;
    put(`cb${a.i}`, Math.round(bar * 200), (v) => (a.chipBar.style.width = `${v / 2}%`));
    // the folded box shows the answers still waiting in it as dots; the next to fly pulses
    const dotState = showChips && (a.where === "box" || a.where === "in") ? (a.where === "in" ? "in" : S.cue && S.cue.i === a.i ? "wait" : "home") : "none";
    put(`d${a.i}`, dotState, (v) => {
      a.dot.style.display = v === "none" ? "none" : "";
      a.dot.style.visibility = v === "in" ? "hidden" : "";
      a.dot.className = v === "wait" ? "wait" : "";
    });
  }
  const hint = hintText();
  put("hint", hint, (v) => {
    hintEl.hidden = !v;
    hintEl.textContent = v;
  });
  put("ptext", pillText(), (v) => (ptext.innerHTML = v));
  // the charge mirrored in the folded box
  const charging = S.held >= 0 ? A[S.held] : S.at >= 0 && A[S.at].charge > 0 ? A[S.at] : null;
  const pv = charging ? (S.held >= 0 ? 1 - clamp((S.clock - S.heldAt) / cfg.grace, 0, 1) : charging.charge) : -1;
  put("pbar", pv < 0 ? "off" : `${charging.hue}:${Math.round(pv * 200)}`, () => {
    pbar.hidden = pv < 0;
    if (pv >= 0) {
      pbar.style.setProperty("--hue", charging.hue);
      pbarFill.style.width = `${(pv * 100).toFixed(1)}%`;
    }
  });
  // the one off-screen cue
  put("cue", S.cue ? `${S.cue.i}:${S.cue.side}` : "", (v) => {
    cueEl.hidden = !v;
    if (v) {
      cueEl.className = `cue ${S.cue.side}`;
      cueEl.style.setProperty("--hue", A[S.cue.i].hue);
      cueText.textContent = `Turn ${S.cue.side}`;
    }
  });
  // a word at an object, placed above it on the screen
  const b = S.bubble && S.bubble.until > S.clock ? S.bubble : null;
  bubbleEl.hidden = !b;
  if (b) {
    const a = A[b.i];
    const p = project(a.group.position.x, a.group.position.y + EGG_H * 1.6, a.group.position.z);
    put("bubble", b.text, (v) => (bubbleEl.textContent = v));
    bubbleEl.style.setProperty("--hue", a.hue);
    bubbleEl.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -100%)`;
  }
}

/* ================= the answers in the world, every frame ================= */
function updateWorld(t, dt) {
  const k = 1 - Math.exp(-dt / 0.18);
  const r = reach();
  const quizOpen = S.phase === "ask" || S.phase === "open" || S.phase === "result";
  otherItem.material.opacity += ((quizOpen ? 0.08 : 0.35) - otherItem.material.opacity) * k;
  animateSparks(stationSparks, t, 6, 1);
  for (const a of A) {
    const inWorld = a.where === "world";
    const isRight = S.phase === "result" && a.right;
    const held = S.held === a.i && inWorld;
    a.group.visible = inWorld;
    a.pool.visible = inWorld;
    a.sparks.visible = inWorld;
    const c0 = a.charge;
    const c = c0 * c0 * (3 - 2 * c0);
    // asleep, awake (it noticed the visitor), filling, open, answered
    const wakeT = inWorld && !a.crossed && (a.d < r + NOTICE || held || isRight) ? 1 : 0;
    a.view.wake += (wakeT - a.view.wake) * k;
    a.view.open += ((held || isRight ? 1 : 0) - a.view.open) * k;
    const base = a.crossed ? 0.35 : HOVER_Y + a.view.wake * 0.12 + 0.05 * Math.sin(t * 1.5 + a.i * 1.7);
    const lift = held || isRight ? 1 : c;
    let gx = a.bx;
    let gz = a.bz;
    const reachOut = Math.max(lift, a.d < KEEP ? a.view.wake : 0);
    if (reachOut > 0 && !S.remote && !a.crossed) {
      const d = a.d;
      const ux = d > 0.2 ? (gx - V.x) / d : -Math.sin(V.yaw);
      const uz = d > 0.2 ? (gz - V.z) / d : -Math.cos(V.yaw);
      const want = clamp(d - COME * lift, KEEP, Math.max(d, KEEP));
      const at = d + (want - d) * reachOut;
      gx = V.x + ux * at;
      gz = V.z + uz * at;
    }
    a.group.position.set(gx, base + (RISE_Y - base) * lift, gz);
    const toViewer = Math.atan2(V.x - gx, V.z - gz);
    const scale = 1 + 0.3 * a.view.wake + 0.15 * lift;
    a.pivot.scale.setScalar(scale);
    a.view.lean += (0.3 * a.view.wake + 0.15 * c - a.view.lean) * k;
    a.pivot.rotation.set(a.view.lean, toViewer, held ? 0 : Math.sin(t * 41) * 0.05 * c);
    a.lid.position.set(0, CRACK * EGG_H + a.view.open * 0.14, -a.view.open * 0.06);
    a.lid.rotation.x = -a.view.open * 0.8;
    a.mat.color.set(a.crossed ? "#8a8f98" : isRight ? RIGHT : a.hue).multiplyScalar(held ? 1 : 1 - 0.6 * c);
    let glow = 0.18 + 0.2 * a.view.wake + 0.5 * c;
    if (held) {
      glow = 0.6 + 0.2 * Math.sin(t * 8);
    }
    if (isRight) {
      glow = 0.8 + 0.15 * Math.sin(t * 4);
    }
    a.mat.emissive.set(isRight ? RIGHT : a.hue).multiplyScalar(a.crossed ? 0.05 : glow);
    a.mat.opacity = a.crossed ? 0.7 : 1;
    a.shell.visible = c0 > 0.01 && a.view.open < 0.3 && !a.crossed;
    a.fillMat.uniforms.level.value = c0;
    a.fillMat.uniforms.time.value = t;
    // the grace countdown arc
    a.graceRing.visible = held;
    if (held) {
      const w = clamp((S.clock - S.heldAt) / cfg.grace, 0, 1);
      a.graceRing.geometry.setDrawRange(0, 6 * Math.max(1, Math.round(48 * (1 - w))));
      a.graceRing.rotation.set(0, 0, Math.PI / 2);
    }
    a.pool.material.opacity = a.crossed ? 0.12 : 0.3 + 0.3 * a.view.wake + 0.3 * c;
    a.pool.material.color.set(isRight ? RIGHT : a.hue);
    a.pool.scale.setScalar(0.8 + 0.8 * lift);
    // landing: a ring pulse and sparks rising a few metres; settled: a low, quiet column
    const since = S.clock - a.landedAt;
    const landing = since >= 0 && since < 2.6;
    const pulseP = clamp(since / (isRight ? 1.6 : 1.2), 0, 1);
    a.pulse.visible = inWorld && pulseP < 1;
    a.pulse.scale.setScalar(0.4 + (isRight ? 4.5 : 2.6) * pulseP);
    a.pulse.material.opacity = (1 - pulseP) * 0.95;
    a.pulse.material.color.set(isRight ? RIGHT : a.hue);
    a.sparks.material.color.set(isRight ? RIGHT : a.hue);
    a.sparks.material.opacity = a.crossed ? 0.15 : landing ? 0.95 * (1 - smooth(1.6, 2.6, since)) + 0.5 * smooth(1.6, 2.6, since) : 0.5;
    animateSparks(a.sparks, t + a.i, isRight ? 5 : landing ? 4 - 2.6 * smooth(1.2, 2.6, since) : 1.4, landing || isRight ? 1.4 : 1);
  }
}

/* ================= the frame ================= */
function update(dt) {
  S.clock += dt;
  moveVisitor(dt);
  updateCamera();
  advanceNarration(dt);
  flow();
  stepStill(dt);
  stepCharge(dt);
  schedule();
  stepFlights();
}
function updateCamera() {
  camera.position.set(V.x, EYE, V.z);
  camera.rotation.set(-0.06, V.yaw, 0);
  camera.updateMatrixWorld();
}
function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // a phone camera sees about 76 degrees along its long side: about 40 degrees across in portrait
  const longHalf = Math.tan(THREE.MathUtils.degToRad(38));
  camera.fov = h >= w ? 76 : THREE.MathUtils.radToDeg(2 * Math.atan((longHalf * h) / w));
  camera.updateProjectionMatrix();
  layoutWords();
}
addEventListener("resize", resize);

const meter = $("meter");
let frameMs = 16;
let meterAt = 0;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  frameMs += ((now - last) - frameMs) * 0.1;
  last = now;
  update(dt);
  updateWorld(now / 1000, dt);
  renderHud(dt);
  renderer.render(scene, camera);
  if (now - meterAt > 400) {
    meterAt = now;
    const info = renderer.info.render;
    meter.textContent = `${frameMs.toFixed(1)} ms\n${info.calls} calls  ${(info.triangles / 1000).toFixed(1)}k tris`;
    meter.classList.toggle("bad", frameMs > 33);
  }
  requestAnimationFrame(frame);
}
// runs the logic forward without drawing, so a beat can open part-way through
function simulate(seconds) {
  const step = 1 / 30;
  for (let s = 0; s < seconds; s += step) {
    update(step);
    updateWorld(S.clock, step);
    renderHud(step);
  }
}

/* ================= the beats (?beat=<name>) ================= */
function landAll() {
  for (const a of A) {
    a.where = "world";
    a.flight = null;
    a.landedAt = -99;
  }
  S.phase = "open";
  S.recall = null;
  setNarration("question", TEXT.question, false, true);
}
function standBy(i, dist) {
  const a = A[i];
  const len = Math.hypot(a.bx, a.bz);
  placeAt(a.bx - (a.bx / len) * dist, a.bz - (a.bz / len) * dist, 0);
  V.yaw = yawTo(a.bx, a.bz);
  a.d = dist;
}
const BEATS = {
  "lead-in": () => {},
  ask: () => enterAsk(),
  "fly-out": () => {
    enterAsk();
    N.t = N.total;
    N.playing = false;
    N.doneAt = -99;
    enterOpen();
    simulate(cfg.flight * 0.55);
  },
  "off-screen": () => {
    enterAsk();
    N.t = N.total;
    N.doneAt = -99;
    enterOpen();
    simulate(cfg.flight + 0.6);
  },
  toggle: () => {
    landAll();
    simulate(0.3);
    S.recall = "user";
    simulate(cfg.flight * cfg.ret * 0.5);
  },
  approach: () => {
    landAll();
    standBy(0, 7);
    S.autoWalk = { x: A[0].bx * 0.0, z: A[0].bz + 2.4 };
  },
  charge: () => {
    landAll();
    standBy(0, 2.4);
    S.at = 0;
    S.arm = ARM;
    A[0].charge = 0.55;
    simulate(0.5);
  },
  undo: () => {
    landAll();
    standBy(0, 2.4);
    S.at = 0;
    A[0].charge = 1;
    hold(0, false);
    simulate(0.6);
    S.autoWalk = { x: V.x - (A[0].bx - V.x) * 1.4, z: V.z - (A[0].bz - V.z) * 1.4 };
  },
  grace: () => {
    landAll();
    standBy(0, 2.4);
    S.at = 0;
    hold(0, false);
    simulate(0.4);
  },
  "result-right": () => {
    landAll();
    standBy(0, 2.4);
    S.at = 0;
    hold(0, false);
    commit();
    simulate(0.8);
  },
  "result-wrong": () => {
    landAll();
    S.tries = 1;
    A[2].crossed = true;
    standBy(1, 2.4);
    S.at = 1;
    hold(1, false);
    commit();
    simulate(0.8);
  },
  "goes-on": () => {
    landAll();
    for (const a of A) {
      a.where = "box";
    }
    S.result = "right";
    S.chosen = 0;
    enterAfter();
  },
  tap: () => {
    landAll();
    S.recall = "user";
    simulate(cfg.flight * cfg.ret + cfg.stagger * 3 + 0.4);
    hold(1, true);
    simulate(0.5);
  },
  weak: () => {
    landAll();
    simulate(0.3);
    setWeak(true);
    simulate(cfg.flight * cfg.ret + cfg.stagger * 3 + 0.4);
  },
  still: () => {
    landAll();
    S.stillT = STILL_S - 1.5;
  },
  "open-during-charge": () => {
    landAll();
    standBy(0, 2.4);
    S.at = 0;
    S.arm = ARM;
    A[0].charge = 0.6;
    simulate(0.2);
    S.recall = "user";
    simulate(cfg.flight * cfg.ret * 0.6);
  },
};
function runBeat(name) {
  freshState();
  stopVoice();
  for (const a of A) {
    a.view.wake = 0;
    a.view.open = 0;
  }
  setWeak(false);
  placeAt(0, 0, 0);
  const at = (params.get("at") || "").split(",").map(Number);
  if (at.length >= 2 && at.every(Number.isFinite)) {
    placeAt(at[0], at[1], THREE.MathUtils.degToRad(at[2] || 0));
  }
  updateCamera();
  enterLead();
  wasOpen = null;
  cache.clear();
  renderHud(0);
  (BEATS[name] || BEATS["lead-in"])();
  S.beat = name in BEATS ? name : "lead-in";
  $("beat").value = S.beat;
}

/* ================= demo controls ================= */
const beatSel = $("beat");
for (const name of Object.keys(BEATS)) {
  const o = document.createElement("option");
  o.value = name;
  o.textContent = `Beat: ${name}`;
  beatSel.append(o);
}
function saveUrl() {
  const q = new URLSearchParams(location.search);
  q.set("beat", S.beat);
  for (const [key] of SLIDERS) {
    q.set(key, String(cfg[key]));
  }
  history.replaceState(null, "", `?${q}`);
}
beatSel.addEventListener("change", () => {
  runBeat(beatSel.value);
  saveUrl();
});
$("resetBtn").addEventListener("click", () => {
  runBeat("lead-in");
  saveUrl();
});
$("weakBtn").addEventListener("click", () => setWeak(!S.weak));
$("fastBtn").addEventListener("click", () => {
  V.fast = !V.fast;
  $("fastBtn").setAttribute("aria-pressed", String(V.fast));
});
$("menuBtn").addEventListener("click", () => ($("panel").hidden = !$("panel").hidden));
$("panelClose").addEventListener("click", () => ($("panel").hidden = true));
$("voiceBtn").addEventListener("click", () => {
  cfg.voice = !cfg.voice;
  $("voiceBtn").setAttribute("aria-pressed", String(cfg.voice));
  $("voiceBtn").textContent = cfg.voice ? "on" : "off";
  speak();
});
const slidersEl = $("sliders");
for (const [key, label, lo, hi, step, unit] of SLIDERS) {
  const l = document.createElement("label");
  l.innerHTML = `<span></span><output></output><input type="range" />`;
  l.querySelector("span").textContent = label;
  const input = l.querySelector("input");
  const out = l.querySelector("output");
  Object.assign(input, { min: lo, max: hi, step, value: cfg[key] });
  input.dataset.key = key;
  const show = () => (out.textContent = `${cfg[key]} ${unit}${key === "spacing" ? ` (reach ${reach().toFixed(1)} m + let-go ${LET_GO} m)` : ""}`);
  input.addEventListener("input", () => {
    cfg[key] = Number(input.value);
    if (key === "spacing") {
      applySpacing();
    }
    show();
    saveUrl();
  });
  show();
  slidersEl.append(l);
}

applySpacing();
resize();
runBeat(params.get("beat") || "lead-in");
requestAnimationFrame(frame);
// a hook for the page's checks: read-only state, nothing drives the page through it
window.__quiz = { S, A, V, N, cfg, boxOpen, reach, runBeat, setWeak, tapChip, tapAnswer };
