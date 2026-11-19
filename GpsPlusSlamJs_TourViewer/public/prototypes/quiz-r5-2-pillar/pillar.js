// Quiz 5.2 - A pillar on request. Throwaway prototype: not wired to the app, linked from nothing in it.
// An Easter-egg hunt for a story question. Each answer is an egg hidden at the thing it names, glittering
// faintly. Walking close finds it: it opens and flies into its chip in the narration box, where it can be
// chosen at once (the shortcut). Stuck, the visitor tells the character so in the box; only then does
// help open: one short pale pillar rises at the nearest egg still hidden, a soft glow at the screen side
// points to it while it is out of view, and keeping it in view fills the egg from below until it comes
// to the box. The pillar sinks, and while help is on the next one rises.
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
// [key, label, min, max, step, unit, default]
const SLIDERS = [
  ["cone", "Look cone, half-angle (leaves at 1.5x)", 5, 30, 1, "deg", 12],
  ["dwell", "Look long enough to collect (dwell)", 1.5, 8, 0.5, "s", 3],
  ["drain", "Looking away empties a full egg in", 0.3, 3, 0.1, "s", 1],
  ["find", "Find radius (walk this close)", 0.8, 4, 0.1, "m", 1.5],
  ["gslow", "Glint period, far away", 1.5, 8, 0.1, "s", 4.5],
  ["gfast", "Glint period, at the egg", 0.3, 2, 0.1, "s", 0.9],
  ["beamh", "Pillar height", 2, 8, 0.5, "m", 4],
  ["fade", "Pillar fade starts at (share of its height)", 0.2, 0.9, 0.05, "", 0.55],
  ["rise", "Pillar rises and sinks in", 0.3, 2.5, 0.1, "s", 0.9],
  ["flight", "Flight time, egg to box", 0.8, 4, 0.1, "s", 2],
  ["stagger", "Stagger between eggs (fold and open)", 0, 2, 0.1, "s", 0.6],
  ["grace", "Take a choice back within (grace)", 1, 6, 0.5, "s", 3],
];
// the quiz item's settings, chosen by the tour's creator, and what the visitor brings
const CREATOR = [
  ["cost", "Cost per answer (0 = free)", 0, 20, 1, "coins", 0],
];
const VISITOR = [
  ["coins", "Coins the visitor has", 0, 50, 1, "coins", 20],
];
// freeze=1 holds a beat where it opened (the world still draws): for side-by-side screenshots
const FREEZE = params.get("freeze") === "1";
const cfg = { voice: params.get("voice") === "on", additive: params.get("add") === "1" };
for (const [key, , lo, hi, , , def] of [...SLIDERS, ...CREATOR, ...VISITOR]) {
  cfg[key] = numParam(key, def, lo, hi);
}
cfg.attempts = ["0", "1", "2"].includes(params.get("attempts")) ? Number(params.get("attempts")) : 2; // 0 = unlimited
const keyParam = (params.get("key") || "").split(",");
cfg.needKey = keyParam.includes("need");
cfg.hasKey = keyParam.includes("has");
cfg.beam = /^[0-9a-f]{6}$/i.test(params.get("beam") || "") ? `#${params.get("beam")}` : "#fff4b0";

const DWELL_FIND = 0.25; // seconds inside the find radius, so a jitter spike cannot find
const SEEN_EXTRA = 3; // metres past the find radius where a hidden egg itself starts to show
const TEASE_FAR = 16; // metres: inside this the glitter warms up
const GLINT_LEN = 0.35; // seconds one glint lasts
const SPARKS = 8; // glitter sparks per egg
const GLINT_SIZE = 0.5;
const SPARK_SIZE = 0.17;
const OPEN_S = 0.8; // seconds a found egg takes to open before it flies
const PILLAR_R = 0.75; // metres
const MOTES = 16; // rising light inside the pillar
const FAR_BOOST = 6; // beyond this distance the lit egg grows, so its fill reads from afar
const EYE = 1.6;
const WALK = 1.4;
const FAST = 3.5;
const BEACON_IN = 1.2; // metres an egg sits in front of its thing, towards the start
const POINTS = 10;

const SPEAKER = { name: "Mara", color: "#4ade80" };
const TEXT = {
  lead: "Look around this square. Three old things stand here: the fountain, the plane tree and the bench. One of them was here long before the other two, and I have hidden an egg at each.",
  question: "Which of these stood on this square first? Find the eggs, or go straight to the one you know.",
  help: "Turn slowly. Where a light rises, keep your eyes on it, and the egg comes to you.",
  helpDone: "That was the last one. Now, which was first?",
  right: "The fountain. Its water ran here more than two hundred years before the tree was planted.",
  wrong: "It was the fountain, from 1652. The tree came in 1921, and the bench only this spring.",
  goesOn: "Now come with me to the gate at the south end. The first tram rolled through it, and it brought the tree.",
};
const ANSWERS = [
  { id: "fountain", label: "The fountain", hue: "#7dd3fc", dir: [0, -1], right: true },
  { id: "tree", label: "The plane tree", hue: "#c4b5fd", dir: [-0.866, -0.5], right: false },
  { id: "bench", label: "The bench", hue: "#fda4af", dir: [0.866, -0.5], right: false },
];

/* ================= the state of the quiz ================= */
const S = {};
const A = ANSWERS.map((o, i) => ({ ...o, i }));
// where an egg is: hidden (at its thing, not found) | opening (just found) | in (flying to the box)
// | box | out (flying back to its place while the box is folded) | world (found, resting at its place)
function freshState() {
  Object.assign(S, {
    phase: "lead", // lead | ask | open | result | after
    fold: false,
    clock: 0,
    lastOut: -Infinity,
    lastIn: -Infinity,
    help: false,
    pillar: { state: "none", i: -1, t0: 0 }, // none | rising | up | sinking
    held: -1,
    heldAt: 0,
    tries: 0,
    chosen: -1,
    result: null,
    coins: cfg.coins,
    autoWalk: null,
  });
  for (const a of A) {
    Object.assign(a, { where: "hidden", flight: null, fill: 0, findT: 0, looking: false, crossed: false, openAt: -99, homeAt: -99, d: 99 });
  }
}

/* ================= the visitor ================= */
const V = { x: 0, z: 0, yaw: 0, speed: 0, walkDir: 0, fast: false, keys: new Set() };
function placeAt(x, z, yaw) {
  V.x = x;
  V.z = z;
  V.yaw = yaw;
}
const yawTo = (x, z) => Math.atan2(-(x - V.x), -(z - V.z));
// the angle between the view's heading and an egg: negative to the left
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

/* ---------- the light pillar: the light-pillar page's profile, without its pour and its falling motes ---------- */
// uv.y runs from the foot (0) to the top (1). The body fades in over the first 3 % and from uFade
// to exactly 0 at the top; a bright line marks where it meets the ground; it fades near the eye.
const PILLAR_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFace;
varying float vNear;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFace = abs(dot(n, normalize(-mv.xyz)));
  vNear = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const PILLAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
uniform float uFade;
varying vec2 vUv;
varying float vFace;
varying float vNear;
void main() {
  float y = vUv.y;
  float core = pow(vFace, 1.4);
  float body = smoothstep(0.0, 0.03, y) * (1.0 - smoothstep(uFade, 1.0, y));
  float rim = exp(-y * 90.0);
  float a = 0.36 * body * core + rim * 0.75;
  a *= uGlow * smoothstep(0.2, 2.6, vNear);
  vec3 c = mix(uColor, vec3(1.0), 0.35 * rim);
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;
function pillarMaterial(hue) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(hue) }, uGlow: { value: 0 }, uFade: { value: cfg.fade } },
    vertexShader: PILLAR_VERT,
    fragmentShader: PILLAR_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}
// a unit cylinder standing on its foot: scaled to radius and height
const pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0);

// the station pin: the station's orange, tall, with the same fade (it stays visible)
const STATION = new THREE.Vector3(-3, 0, -24);
const stationBeam = new THREE.Mesh(pillarGeo, pillarMaterial("#f2971f"));
stationBeam.material.uniforms.uGlow.value = 1;
stationBeam.scale.set(0.45, 26, 0.45);
stationBeam.position.copy(STATION);
scene.add(stationBeam);

/* ---------- a spark: a gold star on a faint dark halo, so it reads on bright and dark alike ---------- */
function drawSpark(g, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const halo = g.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
  halo.addColorStop(0, "rgb(40 26 4 / 45%)");
  halo.addColorStop(1, "rgb(40 26 4 / 0%)");
  g.fillStyle = halo;
  g.fillRect(0, 0, w, h);
  const core = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.22);
  core.addColorStop(0, "rgb(255 255 255 / 100%)");
  core.addColorStop(0.5, "rgb(255 226 150 / 95%)");
  core.addColorStop(1, "rgb(255 190 70 / 0%)");
  g.fillStyle = core;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "rgb(255 246 214 / 95%)";
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ]) {
    g.beginPath();
    g.moveTo(cx - dx * w * 0.48, cy - dy * h * 0.48);
    g.lineTo(cx + dy * w * 0.05, cy + dx * h * 0.05);
    g.lineTo(cx + dx * w * 0.48, cy + dy * h * 0.48);
    g.lineTo(cx - dy * w * 0.05, cy - dx * h * 0.05);
    g.closePath();
    g.fill();
  }
}
// a soft round dot for the pillar's rising light
function drawMote(g, w, h) {
  const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grad.addColorStop(0, "rgb(255 255 255 / 100%)");
  grad.addColorStop(0.4, "rgb(255 255 255 / 55%)");
  grad.addColorStop(1, "rgb(255 255 255 / 0%)");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}
const sparkTex = canvasTexture(64, 64, drawSpark);
sparkTex.premultiplyAlpha = true;
const moteTex = canvasTexture(32, 32, drawMote);
moteTex.premultiplyAlpha = true;
const pointMat = (size, map) =>
  new THREE.PointsMaterial({ size, map, vertexColors: true, transparent: true, premultipliedAlpha: true, depthWrite: false });
function pointCloud(count, size, map) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(count * 4), 4));
  const pts = new THREE.Points(geo, pointMat(size, map));
  pts.frustumCulled = false;
  scene.add(pts);
  return pts;
}
// the glitter of the first egg page, unchanged in feel: one glint per egg, eight sparks round it
const glints = pointCloud(A.length, GLINT_SIZE, sparkTex);
const sparks = pointCloud(A.length * SPARKS, SPARK_SIZE, sparkTex);

// the help pillar: one at a time, at the nearest egg still hidden
const pillar = new THREE.Mesh(pillarGeo, pillarMaterial(cfg.beam));
pillar.renderOrder = 2;
pillar.visible = false;
scene.add(pillar);
const motes = pointCloud(MOTES, 0.11, moteTex);
const moteSeed = Array.from({ length: MOTES }, (_, k) => {
  const r = rng(100 + k);
  return [r() * Math.PI * 2, 0.15 + r() * 0.55, r(), 0.35 + r() * 0.35];
});
function applyBeam() {
  const blend = cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  pillar.material.uniforms.uColor.value.set(cfg.beam);
  pillar.material.blending = blend;
  pillar.material.needsUpdate = true;
  motes.material.blending = cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  motes.material.needsUpdate = true;
  document.documentElement.style.setProperty("--beam", cfg.beam);
  edgeEl.style.setProperty("--beam", cfg.beam);
  askEl.style.setProperty("--beam", cfg.beam);
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

/* ---------- an egg: it fills from below (the one collection animation) and opens when found ---------- */
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
for (const a of A) {
  a.thing = thing(a.id);
  a.mat = new THREE.MeshLambertMaterial({ color: a.hue, emissive: a.hue, emissiveIntensity: 1, transparent: true });
  a.group = new THREE.Group();
  a.pivot = new THREE.Group();
  a.body = new THREE.Mesh(eggPart(0, CRACK), a.mat);
  a.lid = new THREE.Mesh(eggPart(CRACK, 1), a.mat);
  a.fillMat = fillMaterial(a.hue);
  a.shell = new THREE.Mesh(eggPart(0, 1, 1.07, 0.004), a.fillMat);
  a.shell.renderOrder = 3;
  a.pivot.add(a.body, a.lid, a.shell);
  a.group.add(a.pivot);
  a.pool = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: a.hue, transparent: true, opacity: 0.4, depthWrite: false }));
  a.pool.position.y = 0.03;
  scene.add(a.group, a.pool);
  a.view = { open: 0, shown: 0, pop: 0 };
}
const SPACING = 10;
for (const a of A) {
  a.tx = a.dir[0] * SPACING;
  a.tz = a.dir[1] * SPACING;
  a.bx = a.dir[0] * (SPACING - BEACON_IN);
  a.bz = a.dir[1] * (SPACING - BEACON_IN);
  a.thing.position.set(a.tx, 0, a.tz);
  a.thing.rotation.y = Math.atan2(-a.dir[0], -a.dir[1]);
  a.pool.position.x = a.bx;
  a.pool.position.z = a.bz;
}

/* ================= the narration box: words, tap to pause, vertical drag to scrub ================= */
const nbox = $("nbox");
const col = $("col");
const thumb = $("thumb");
const sbar = $("sbar");
const chipsEl = $("chips");
const statusEl = $("status");
const eggsEl = $("eggs");
const countEl = $("count");
const askEl = $("ask");
const hintEl = $("hint");
const ptext = $("ptext");
const pdots = $("pdots");
const handle = $("handle");
const handleText = $("handleText");
const edgeEl = $("edge");
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
// Buttons inside the box (the handle, the answers, the ask) are not part of them.
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
const isResult = () => S.phase === "result" || S.phase === "after";
const boxOpen = () => !S.fold;
function setBoxOpen(open) {
  S.fold = !open;
}
const hiddenEggs = () => A.filter((a) => a.where === "hidden");
const triesLeft = () => (cfg.attempts === 0 ? Infinity : cfg.attempts - S.tries);
const locked = () => cfg.needKey && !cfg.hasKey;
const shortOfCoins = () => cfg.cost > 0 && S.coins < cfg.cost;

function enterLead() {
  S.phase = "lead";
  setNarration("lead", TEXT.lead, true);
}
function enterAsk() {
  S.phase = "ask";
  setNarration("question", TEXT.question, true);
}
function enterOpen() {
  S.phase = "open";
}
function enterAfter() {
  S.phase = "after";
  setNarration("goesOn", TEXT.goesOn, true);
}

// The visitor asks the character for help; asking again (the same line, now "stop") ends it.
function setHelp(on) {
  if (on && (S.phase !== "open" || !hiddenEggs().length)) {
    return;
  }
  if (on === S.help) {
    return;
  }
  S.help = on;
  if (on) {
    setNarration("help", TEXT.help, true);
  } else if (N.kind === "help") {
    setNarration("question", TEXT.question, false, true);
  }
}
askEl.addEventListener("click", () => setHelp(!S.help));

function found(a, by) {
  if (a.where !== "hidden") {
    return;
  }
  a.where = "opening";
  a.openAt = S.clock;
  a.fill = by === "look" ? 1 : 0;
  a.looking = false;
}
function hold(i) {
  if (S.phase !== "open" || S.held >= 0 || A[i].crossed) {
    return;
  }
  S.held = i;
  S.heldAt = S.clock;
}
function release() {
  S.held = -1;
}
function commit() {
  const i = S.held;
  if (i < 0) {
    return;
  }
  S.chosen = i;
  S.held = -1;
  S.coins -= cfg.cost;
  if (A[i].right) {
    finish("right");
    return;
  }
  S.tries += 1;
  A[i].crossed = true;
  const left = triesLeft();
  if (left > 0 && !shortOfCoins()) {
    const more = left === Infinity ? "Try another one." : left === 1 ? "You have one more try." : `You have ${left} more tries.`;
    setNarration("retry", `Not that one. ${more}`, true);
  } else {
    finish(left > 0 ? "broke" : "wrong");
  }
}
function finish(result) {
  S.result = result;
  S.phase = "result";
  S.fold = false; // the result opens the box; the handle folds it again
  S.help = false;
  S.held = -1;
  // the right answer is shown, found or not
  for (const a of A) {
    if (a.right && a.where === "hidden") {
      a.where = "box";
      a.homeAt = S.clock;
    }
  }
  const pts = result === "right" ? (S.tries ? POINTS / 2 : POINTS) : 0;
  const why = result === "broke" ? "Not that one, and you have no coins left for another try. " : "";
  setNarration("result", result === "right" ? `${TEXT.right} +${pts} points.` : `${why}${TEXT.wrong} No points this time.`, true);
}

function flow() {
  if (S.phase === "lead" && narrationDone() && S.clock - N.doneAt > 0.6) {
    enterAsk();
  } else if (S.phase === "ask" && narrationDone() && S.clock - N.doneAt > 0.8) {
    enterOpen();
  } else if (S.phase === "open" && (N.kind === "retry" || N.kind === "help" || N.kind === "helpDone") && narrationDone() && S.clock - N.doneAt > 2.5) {
    setNarration("question", TEXT.question, false, true);
  } else if (S.phase === "result" && narrationDone() && S.clock - N.doneAt > 1.5 && !A.some((a) => a.flight)) {
    enterAfter();
  }
}

// walking close finds an egg: inside the radius for a quarter second
function stepFind(dt) {
  const hunting = S.phase === "ask" || S.phase === "open";
  for (const a of A) {
    a.d = Math.hypot(a.bx - V.x, a.bz - V.z);
    if (a.where !== "hidden" || !hunting) {
      a.findT = 0;
      continue;
    }
    a.findT = a.d < cfg.find ? a.findT + dt : 0;
    if (a.findT >= DWELL_FIND) {
      found(a, "walk");
    }
  }
}

// help: one pillar at a time, at the nearest egg still hidden; looking at it fills that egg
function pillarLevel() {
  const P = S.pillar;
  const p = clamp((S.clock - P.t0) / cfg.rise, 0, 1);
  if (P.state === "rising") {
    return p;
  }
  if (P.state === "sinking") {
    return 1 - p;
  }
  return P.state === "up" ? 1 : 0;
}
function sinkPillar() {
  const P = S.pillar;
  if (P.state === "rising" || P.state === "up") {
    const level = pillarLevel();
    P.state = "sinking";
    P.t0 = S.clock - (1 - level) * cfg.rise;
  }
}
function stepHelp(dt) {
  const P = S.pillar;
  const target = P.i >= 0 ? A[P.i] : null;
  if (P.state === "rising" && S.clock - P.t0 >= cfg.rise) {
    P.state = "up";
  }
  if (P.state === "sinking" && S.clock - P.t0 >= cfg.rise) {
    P.state = "none";
    P.i = -1;
  }
  if (P.state !== "none" && P.state !== "sinking" && (!S.help || !target || target.where !== "hidden")) {
    sinkPillar();
  }
  if (S.help && P.state === "none" && S.phase === "open") {
    const left = hiddenEggs().sort((p, q) => p.d - q.d);
    if (left.length) {
      P.state = "rising";
      P.i = left[0].i;
      P.t0 = S.clock;
    } else {
      S.help = false;
      setNarration("helpDone", TEXT.helpDone, true);
    }
  }
  const cone = THREE.MathUtils.degToRad(cfg.cone);
  for (const a of A) {
    if (a.where !== "hidden") {
      continue;
    }
    const lit = S.help && P.i === a.i && (P.state === "rising" || P.state === "up");
    if (!lit) {
      a.looking = false;
      a.fill = Math.max(0, a.fill - dt / cfg.drain);
      continue;
    }
    const off = Math.abs(relAngle(a));
    a.looking = a.looking ? off < cone * 1.5 : off < cone;
    a.fill = a.looking ? Math.min(1, a.fill + dt / cfg.dwell) : Math.max(0, a.fill - dt / cfg.drain);
    if (a.fill >= 1) {
      found(a, "look");
    }
  }
}

function stepChoice() {
  if (S.held >= 0 && S.clock - S.heldAt >= cfg.grace) {
    commit();
  }
}

/* ================= the flights between the places and the box ================= */
const W = () => innerWidth;
const H = () => innerHeight;
const tmp = new THREE.Vector3();
function project(x, y, z) {
  tmp.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  const front = tmp.z < -0.3;
  tmp.set(x, y, z).project(camera);
  return { x: ((tmp.x + 1) / 2) * W(), y: ((1 - tmp.y) / 2) * H(), nx: tmp.x, ny: tmp.y, front };
}
function inView(a, y = EGG_H) {
  const p = project(a.bx, y, a.bz);
  return p.front && Math.abs(p.nx) < 0.9 && Math.abs(p.ny) < 0.95;
}
// an egg out of view is placed beyond the edge it lies towards (nothing is ever drawn clamped to an edge)
function eggScreen(a) {
  const p = project(a.bx, EGG_H * 0.8, a.bz);
  if (p.front && Math.abs(p.nx) < 1.1) {
    return p;
  }
  return { x: relAngle(a) < 0 ? -80 : W() + 80, y: H() * 0.42 };
}
function center(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
const homeScreen = (a) => (boxOpen() ? center(a.chip) : center(a.dot));
function launch(a, dir) {
  a.flight = { dir, t0: S.clock, dur: cfg.flight, from: dir === "out" ? homeScreen(a) : eggScreen(a) };
  a.where = dir;
  a.flyEl.hidden = false;
}
// a flight turned round half-way goes back from where it is now
function reverse(a) {
  const f = a.flight;
  const p = clamp((S.clock - f.t0) / f.dur, 0, 1);
  const dir = f.dir === "out" ? "in" : "out";
  a.where = dir;
  a.flight = { dir, t0: S.clock - (1 - p) * cfg.flight, dur: cfg.flight, reversed: true };
}
const byView = (p, q) => Math.abs(relAngle(p)) - Math.abs(relAngle(q));
function schedule() {
  // a found egg opens where it was found, then flies to the box (or rests at its place while the box is folded)
  for (const a of A) {
    if (a.where === "opening" && S.clock - a.openAt >= OPEN_S) {
      if (boxOpen()) {
        launch(a, "in");
      } else {
        a.where = "world";
      }
    }
  }
  if (S.phase === "lead") {
    return;
  }
  if (boxOpen()) {
    for (const a of A) {
      if (a.where === "out") {
        reverse(a);
      }
    }
    const away = A.filter((a) => a.where === "world").sort(byView);
    if (away.length && S.clock >= S.lastIn + cfg.stagger) {
      for (const a of away) {
        launch(a, "in");
        S.lastIn = S.clock;
        if (cfg.stagger > 0) {
          break;
        }
      }
    }
    return;
  }
  for (const a of A) {
    if (a.where === "in") {
      reverse(a);
    }
  }
  const home = A.filter((a) => a.where === "box").sort(byView);
  if (home.length && S.clock >= S.lastOut + cfg.stagger) {
    for (const a of home) {
      launch(a, "out");
      S.lastOut = S.clock;
      if (cfg.stagger > 0) {
        break;
      }
    }
  }
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
      } else {
        a.where = "box";
        a.homeAt = S.clock;
      }
      continue;
    }
    const from = f.reversed ? (f.dir === "out" ? homeScreen(a) : eggScreen(a)) : f.from;
    const to = f.dir === "out" ? eggScreen(a) : homeScreen(a);
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
    walkTo(e.clientX, e.clientY);
  }
});
canvas.addEventListener("pointercancel", () => {
  viewDrag = null;
});
// a tap on the ground walks there at the fast pace, keeping the view's heading
function walkTo(x, y) {
  ndc.set((x / W()) * 2 - 1, -(y / H()) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  if (ray.ray.intersectPlane(groundPlane, p)) {
    const r = Math.hypot(p.x, p.z);
    const k = r > 30 ? 30 / r : 1;
    S.autoWalk = { x: p.x * k, z: p.z * k, speed: FAST };
  }
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
  V.yaw -= turn * 1.4 * dt;
  const fwd = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0) + V.walkDir;
  const side = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0);
  const speed = V.fast || k.has("shift") ? FAST : WALK;
  const x0 = V.x;
  const z0 = V.z;
  if (fwd || side) {
    S.autoWalk = null;
  }
  if (S.autoWalk) {
    const w = S.autoWalk;
    const d = Math.hypot(w.x - V.x, w.z - V.z);
    if (d < 0.05) {
      S.autoWalk = null;
    } else {
      const step = Math.min(d, (w.speed || WALK) * dt);
      V.x += ((w.x - V.x) / d) * step;
      V.z += ((w.z - V.z) / d) * step;
    }
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
  b.addEventListener("click", () => tapChip(a.i));
  chipsEl.append(b);
  a.chip = b;
  a.chipName = b.querySelector("b");
  a.chipSmall = b.querySelector("small");
  a.chipBar = b.querySelector(".bar i");
  const dot = document.createElement("i");
  dot.style.setProperty("--hue", a.hue);
  pdots.append(dot);
  a.dot = dot;
  const egg = document.createElement("i");
  egg.className = "egg";
  egg.style.setProperty("--hue", a.hue);
  eggsEl.append(egg);
  a.eggIcon = egg;
  const fly = document.createElement("div");
  fly.className = "fly";
  fly.hidden = true;
  fly.style.setProperty("--hue", a.hue);
  fly.innerHTML = "<i></i><span></span>";
  fly.querySelector("span").textContent = a.label;
  flyLayer.append(fly);
  a.flyEl = fly;
}
// a tap on a found answer chooses it, from the first one found on; a second tap within the grace takes it back
function tapChip(i) {
  const a = A[i];
  if (S.phase !== "open" || a.where !== "box" || a.crossed) {
    return;
  }
  if (S.held === i) {
    release();
    return;
  }
  if (locked() || shortOfCoins()) {
    // the rules line says why, once more
    hintEl.classList.remove("flash");
    void hintEl.offsetWidth;
    hintEl.classList.add("flash");
    return;
  }
  if (S.held < 0) {
    hold(i);
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
  if (isResult() && a.where === "box") {
    if (a.right) {
      return ["right", a.label, S.result === "right" ? "Right" : "The answer"];
    }
    return [a.i === S.chosen ? "wrong" : "other", a.label, a.i === S.chosen ? "Not this one" : ""];
  }
  if (a.where !== "box") {
    return ["slot", "?", ""];
  }
  if (a.crossed) {
    return ["crossed", a.label, "Tried"];
  }
  if (S.held === a.i) {
    const left = Math.max(0, cfg.grace - (S.clock - S.heldAt));
    return ["held", a.label, `Chosen - tap to take back (${Math.ceil(left)} s)`];
  }
  if (S.phase !== "open") {
    return ["home", a.label, ""];
  }
  if (locked()) {
    return ["locked", a.label, "Needs the golden key"];
  }
  if (shortOfCoins()) {
    return ["locked", a.label, `Needs ${cfg.cost} coins`];
  }
  return ["home", a.label, cfg.cost > 0 ? `Tap to choose - ${cfg.cost} coins` : "Tap to choose"];
}
function countText() {
  const hidden = hiddenEggs().length;
  if (isResult()) {
    return "";
  }
  if (S.help && S.pillar.i >= 0) {
    return hidden === 1 ? "1 still hidden - look for the light" : `${hidden} still hidden - look for the light`;
  }
  if (!hidden) {
    return "All found";
  }
  return hidden === A.length ? `${hidden} eggs hidden here` : `${hidden} still hidden`;
}
function rulesText() {
  const parts = [];
  if (cfg.needKey) {
    parts.push(cfg.hasKey ? "Your golden key opens this question." : "Answering needs the golden key from the old gate. You can still look for the eggs.");
  }
  const left = triesLeft();
  if (cfg.attempts === 0) {
    parts.push("As many tries as you like.");
  } else if (left === cfg.attempts) {
    parts.push(left === 1 ? "You have one try." : `You have ${left} tries.`);
  } else {
    parts.push(left === 1 ? "One try left." : `${left} tries left.`);
  }
  if (cfg.cost > 0) {
    parts.push(`Each answer costs ${cfg.cost} coins; you have ${S.coins}.`);
  }
  return parts.join(" ");
}
function hintText() {
  if (S.phase !== "open") {
    return "";
  }
  if (S.held >= 0) {
    return "Chosen. It counts when the time runs out; tap it again to take it back.";
  }
  const found = A.filter((a) => a.where === "box" && !a.crossed).length;
  const hidden = hiddenEggs().length;
  let lead = "";
  if (found && hidden) {
    lead = "Choose now, or keep looking.";
  } else if (found) {
    lead = "Which was first?";
  }
  return `${lead} ${rulesText()}`.trim();
}
function askState() {
  if (S.phase !== "open" || isResult()) {
    return "none";
  }
  if (S.help) {
    return "on";
  }
  return hiddenEggs().length ? "off" : "none";
}
function pillText() {
  if (S.held >= 0) {
    const left = Math.max(0, cfg.grace - (S.clock - S.heldAt));
    return `<b>${escapeHtml(A[S.held].label)}</b> chosen - open the box to take it back (${Math.ceil(left)} s)`;
  }
  if (S.phase === "open" && S.help && S.pillar.i >= 0) {
    return `<b class="spk">${SPEAKER.name}</b> is helping - look for the light`;
  }
  if (S.phase === "open" && N.kind === "question") {
    return escapeHtml(countText());
  }
  return `<b class="spk">${SPEAKER.name}</b> ${escapeHtml(N.text)}`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
let wasOpen = null;
function renderHud(dt, t) {
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
  put("handle", open ? "Hide" : "Show", (v) => (handleText.textContent = v));
  updateWords(dt);
  const quiz = S.phase !== "lead" && S.phase !== "after";
  put("chipsShown", quiz, (v) => (chipsEl.hidden = !v));
  put("statusShown", quiz && !isResult(), (v) => (statusEl.hidden = !v));
  for (const a of A) {
    const [state, name, small] = chipState(a);
    put(`cs${a.i}`, state, (v) => {
      a.chip.dataset.state = v;
      if (v !== "slot" && a.homeAt > S.clock - 0.1) {
        a.chip.classList.remove("pop");
        void a.chip.offsetWidth;
        a.chip.classList.add("pop");
      }
    });
    put(`cn${a.i}`, name, (v) => (a.chipName.textContent = v));
    put(`cm${a.i}`, small, (v) => (a.chipSmall.textContent = v));
    a.chip.disabled = !(S.phase === "open" && a.where === "box" && !a.crossed);
    a.chip.setAttribute("aria-label", state === "slot" ? "An answer not found yet" : `${name}. ${small}`);
    const bar = S.held === a.i ? 1 - clamp((S.clock - S.heldAt) / cfg.grace, 0, 1) : 0;
    put(`cb${a.i}`, Math.round(bar * 200), (v) => (a.chipBar.style.width = `${v / 2}%`));
    const isFound = a.where !== "hidden";
    put(`e${a.i}`, isFound, (v) => a.eggIcon.classList.toggle("found", v));
    // the folded box: a dot per egg, hollow while it is hidden, gone while it is out at its place
    const dotState = !quiz ? "none" : a.where === "hidden" ? "hollow" : a.where === "box" ? "home" : "away";
    put(`d${a.i}`, dotState, (v) => {
      a.dot.style.display = v === "none" ? "none" : "";
      a.dot.style.visibility = v === "away" ? "hidden" : "";
      a.dot.className = v === "hollow" ? "hollow" : "";
    });
  }
  put("count", countText(), (v) => (countEl.textContent = v));
  const ask = askState();
  put("ask", ask, (v) => {
    askEl.hidden = v === "none";
    askEl.setAttribute("aria-pressed", String(v === "on"));
    askEl.innerHTML = v === "on" ? "Stop helping" : `<span><b>${SPEAKER.name}</b>, help me find them</span>`;
  });
  const hint = hintText();
  put("hint", hint, (v) => {
    hintEl.hidden = !v;
    hintEl.textContent = v;
  });
  put("ptext", pillText(), (v) => (ptext.innerHTML = v));
  // the one off-screen cue: a soft glow at the side towards the lit egg, only while it is out of view
  const P = S.pillar;
  let side = "";
  if (S.help && P.i >= 0 && (P.state === "rising" || P.state === "up") && !inView(A[P.i], 0.4)) {
    side = relAngle(A[P.i]) < 0 ? "left" : "right";
  }
  put("edge", side, (v) => {
    if (v) {
      edgeEl.className = `edge ${v}`;
      void edgeEl.offsetWidth;
      edgeEl.classList.add("on");
    } else {
      edgeEl.classList.remove("on");
    }
  });
  if (side && !reduceMotion) {
    edgeEl.style.filter = `opacity(${(0.75 + 0.25 * Math.sin(t * 1.6)).toFixed(3)})`;
  }
}

/* ================= the eggs, the glitter and the pillar, every frame ================= */
function updateWorld(t, dt) {
  const k = 1 - Math.exp(-dt / 0.18);
  const gp = glints.geometry.attributes.position.array;
  const gc = glints.geometry.attributes.color.array;
  const sp = sparks.geometry.attributes.position.array;
  const sc = sparks.geometry.attributes.color.array;
  const P = S.pillar;
  const hunting = S.phase === "ask" || S.phase === "open";
  for (const a of A) {
    const hidden = a.where === "hidden";
    const lit = hidden && S.help && P.i === a.i && P.state !== "none";
    const atPlace = (hidden && hunting) || a.where === "opening" || a.where === "world";
    // a hidden egg shows only close by, or while its pillar stands; a found one shows where it was found
    const showT = atPlace && (!hidden || a.d < cfg.find + SEEN_EXTRA || (lit && P.state !== "sinking")) ? 1 : 0;
    a.view.shown += (showT - a.view.shown) * k;
    a.group.visible = a.view.shown > 0.02 && atPlace;
    a.pool.visible = a.where === "opening" || a.where === "world";
    const openT = a.where === "opening" || a.where === "world" ? 1 : 0;
    a.view.open += (openT - a.view.open) * (1 - Math.exp(-dt / 0.12));
    const sinceOpen = S.clock - a.openAt;
    const pop = a.where === "opening" ? Math.sin(Math.PI * clamp(sinceOpen / OPEN_S, 0, 1)) * 0.25 : 0;
    // far away, the lit egg grows so its fill can be read
    const boost = lit ? Math.max(1, a.d / FAR_BOOST) : 1;
    const scale = a.view.shown * (1 + pop) * boost;
    a.pivot.scale.setScalar(Math.max(0.001, scale));
    a.group.position.set(a.bx, 0.02, a.bz);
    a.pivot.rotation.set(0, Math.atan2(V.x - a.bx, V.z - a.bz), hidden ? Math.sin(t * 1.3 + a.i) * 0.08 : 0);
    a.lid.position.set(0, CRACK * EGG_H + a.view.open * 0.14, -a.view.open * 0.06);
    a.lid.rotation.x = -a.view.open * 0.8;
    // a lit egg dims its shell, so the fill rising inside it reads from afar
    a.mat.color.set(a.crossed ? "#8a8f98" : a.hue).multiplyScalar(lit ? 0.45 : 1);
    a.mat.emissive.set(a.hue).multiplyScalar(a.crossed ? 0.05 : lit ? 0.05 : hidden ? 0.15 : 0.6 + 0.15 * Math.sin(t * 4));
    a.shell.visible = hidden && a.fill > 0.01;
    a.fillMat.uniforms.level.value = a.fill;
    a.fillMat.uniforms.time.value = t;
    a.pool.material.opacity = a.crossed ? 0.12 : 0.35;

    // the glitter, for an egg not yet found: slow and faint far away, quicker and warmer close by
    const tease = hunting && hidden;
    const warm = tease ? smooth(TEASE_FAR, cfg.find, a.d) : 0;
    const period = cfg.gslow + (cfg.gfast - cfg.gslow) * warm;
    const at = (t + a.i * 1.37) % period;
    const glint = tease && at < GLINT_LEN ? Math.sin((Math.PI * at) / GLINT_LEN) : 0;
    const top = EGG_H * boost + 0.12;
    gp[a.i * 3] = a.bx;
    gp[a.i * 3 + 1] = top;
    gp[a.i * 3 + 2] = a.bz;
    gc[a.i * 4] = gc[a.i * 4 + 1] = gc[a.i * 4 + 2] = 1;
    gc[a.i * 4 + 3] = glint * (0.55 + 0.45 * warm);
    for (let j = 0; j < SPARKS; j++) {
      const ang = t * 0.9 + (j * Math.PI * 2) / SPARKS + a.i;
      const r = 0.26 + 0.08 * Math.sin(t * 1.3 + j);
      const rise = (j * 0.37 + t * 0.22) % 1;
      const b = (a.i * SPARKS + j) * 3;
      sp[b] = a.bx + Math.cos(ang) * r;
      sp[b + 1] = 0.05 + rise * 0.7;
      sp[b + 2] = a.bz + Math.sin(ang) * r;
      const q = (a.i * SPARKS + j) * 4;
      sc[q] = sc[q + 1] = sc[q + 2] = 1;
      const twinkle = 0.3 + 0.7 * Math.max(0, Math.sin(t * 5 + j * 1.9));
      sc[q + 3] = warm * warm * twinkle * (1 - rise * 0.6);
    }
  }
  glints.geometry.attributes.position.needsUpdate = true;
  glints.geometry.attributes.color.needsUpdate = true;
  sparks.geometry.attributes.position.needsUpdate = true;
  sparks.geometry.attributes.color.needsUpdate = true;

  // the pillar: rises from the ground (eased), stands, sinks back into it
  const level = pillarLevel();
  const e = easeInOut(level);
  const target = P.i >= 0 ? A[P.i] : null;
  pillar.visible = !!target && e > 0.001;
  motes.visible = pillar.visible;
  if (target) {
    pillar.position.set(target.bx, 0, target.bz);
    pillar.scale.set(PILLAR_R, Math.max(0.01, cfg.beamh * e), PILLAR_R);
    pillar.material.uniforms.uGlow.value = e;
    pillar.material.uniforms.uFade.value = cfg.fade;
    // the light inside rises, never falls, and fades out before the top
    const mp = motes.geometry.attributes.position.array;
    const mc = motes.geometry.attributes.color.array;
    const col3 = pillar.material.uniforms.uColor.value;
    const h = cfg.beamh * e;
    for (let j = 0; j < MOTES; j++) {
      const [ang, r, phase, speed] = moteSeed[j];
      const f = (t * speed * 0.35 + phase) % 1;
      const a2 = ang + t * 0.25;
      mp[j * 3] = target.bx + Math.cos(a2) * r * PILLAR_R;
      mp[j * 3 + 1] = f * h * 0.85;
      mp[j * 3 + 2] = target.bz + Math.sin(a2) * r * PILLAR_R;
      const alpha = e * Math.sin(Math.PI * f) * (1 - f) * 0.9;
      mc[j * 4] = col3.r * alpha;
      mc[j * 4 + 1] = col3.g * alpha;
      mc[j * 4 + 2] = col3.b * alpha;
      mc[j * 4 + 3] = alpha;
    }
    motes.geometry.attributes.position.needsUpdate = true;
    motes.geometry.attributes.color.needsUpdate = true;
  }
}

/* ================= the frame ================= */
function update(dt) {
  S.clock += dt;
  moveVisitor(dt);
  updateCamera();
  advanceNarration(dt);
  flow();
  stepFind(dt);
  stepHelp(dt);
  stepChoice();
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
  frameMs += (now - last - frameMs) * 0.1;
  last = now;
  if (!FREEZE) {
    update(dt);
  }
  updateWorld(S.clock, dt);
  renderHud(dt, S.clock);
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
    renderHud(step, S.clock);
  }
}

/* ================= the beats (?beat=<name>) ================= */
function openQuiz() {
  S.phase = "open";
  setNarration("question", TEXT.question, false, true);
}
function inBox(...ids) {
  for (const i of ids) {
    A[i].where = "box";
  }
}
function standBy(i, dist) {
  const a = A[i];
  const len = Math.hypot(a.bx, a.bz);
  placeAt(a.bx - (a.bx / len) * dist, a.bz - (a.bz / len) * dist, 0);
  V.yaw = yawTo(a.bx, a.bz);
}
// face an egg, then turn the view away from it by `deg`
function face(i, deg = 0) {
  V.yaw = yawTo(A[i].bx, A[i].bz) + THREE.MathUtils.degToRad(deg);
}
function helpOn() {
  S.help = true;
  setNarration("help", TEXT.help, true);
}
const BEATS = {
  "lead-in": () => {},
  hunt: () => openQuiz(),
  "found-walk": () => {
    openQuiz();
    standBy(0, 4);
    S.autoWalk = { x: A[0].bx, z: A[0].bz + 0.6, speed: WALK };
  },
  "shortcut-choose": () => {
    openQuiz();
    inBox(0);
    standBy(0, 2.4);
    simulate(0.2);
    tapChip(0);
    simulate(0.4);
  },
  "help-ask": () => {
    openQuiz();
    inBox(0);
    simulate(0.1);
    helpOn();
    simulate(cfg.rise * 0.6);
  },
  "help-on": () => {
    openQuiz();
    inBox(0);
    helpOn();
    N.t = N.total;
    simulate(cfg.rise + 0.4);
    face(S.pillar.i, 14);
    simulate(0.1);
  },
  "gaze-collect": () => {
    openQuiz();
    inBox(0);
    helpOn();
    simulate(cfg.rise + 0.2);
    face(S.pillar.i, 0);
    A[S.pillar.i].fill = 0.55;
    simulate(0.3);
  },
  "gaze-away": () => {
    openQuiz();
    inBox(0);
    helpOn();
    simulate(cfg.rise + 0.2);
    face(S.pillar.i, 0);
    A[S.pillar.i].fill = 0.85;
    simulate(0.1);
    face(S.pillar.i, cfg.cone * 1.5 + 8);
    simulate(Math.min(0.3, cfg.drain * 0.3));
  },
  "all-found": () => {
    openQuiz();
    inBox(0, 1);
    helpOn();
    N.t = N.total;
    simulate(cfg.rise + 0.2);
    face(S.pillar.i, 0);
    A[S.pillar.i].fill = 0.98;
    simulate(0.3 + OPEN_S + cfg.flight + cfg.rise + 0.4);
  },
  choose: () => {
    openQuiz();
    inBox(0, 1, 2);
    simulate(0.1);
    tapChip(0);
    simulate(0.5);
  },
  wrong: () => {
    openQuiz();
    inBox(0, 1, 2);
    simulate(0.1);
    tapChip(2);
    commit();
    simulate(0.6);
  },
  right: () => {
    openQuiz();
    inBox(0, 1, 2);
    simulate(0.1);
    tapChip(0);
    commit();
    simulate(0.6);
  },
};
function runBeat(name) {
  freshState();
  stopVoice();
  for (const a of A) {
    a.view.open = 0;
    a.view.shown = 0;
  }
  placeAt(0, 0, 0);
  const at = (params.get("at") || "").split(",").map(Number);
  if (at.length >= 2 && at.every(Number.isFinite)) {
    placeAt(at[0], at[1], THREE.MathUtils.degToRad(at[2] || 0));
  }
  updateCamera();
  enterLead();
  wasOpen = null;
  cache.clear();
  renderHud(0, 0);
  S.beat = name in BEATS ? name : "lead-in";
  BEATS[S.beat]();
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
  for (const [key] of [...SLIDERS, ...CREATOR, ...VISITOR]) {
    q.set(key, String(cfg[key]));
  }
  q.set("attempts", String(cfg.attempts));
  const keys = [cfg.needKey && "need", cfg.hasKey && "has"].filter(Boolean).join(",");
  if (keys) {
    q.set("key", keys);
  } else {
    q.delete("key");
  }
  q.set("beam", cfg.beam.slice(1));
  if (cfg.additive) {
    q.set("add", "1");
  } else {
    q.delete("add");
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
$("fastBtn").addEventListener("click", () => {
  V.fast = !V.fast;
  $("fastBtn").setAttribute("aria-pressed", String(V.fast));
});
$("menuBtn").addEventListener("click", () => ($("panel").hidden = !$("panel").hidden));
$("panelClose").addEventListener("click", () => ($("panel").hidden = true));
function toggle(id, get, set, onText, offText, restart) {
  const b = $(id);
  const show = () => {
    b.setAttribute("aria-pressed", String(get()));
    b.textContent = get() ? onText : offText;
  };
  b.addEventListener("click", () => {
    set(!get());
    show();
    if (restart) {
      runBeat(S.beat);
    }
    saveUrl();
  });
  show();
}
toggle("voiceBtn", () => cfg.voice, (v) => { cfg.voice = v; speak(); }, "on", "off", false);
toggle("addBtn", () => cfg.additive, (v) => { cfg.additive = v; applyBeam(); }, "on", "off", false);
toggle("keyNeedBtn", () => cfg.needKey, (v) => (cfg.needKey = v), "on", "off", true);
toggle("keyHasBtn", () => cfg.hasKey, (v) => (cfg.hasKey = v), "yes", "no", true);
const attemptsSel = $("attempts");
attemptsSel.value = String(cfg.attempts);
attemptsSel.addEventListener("change", () => {
  cfg.attempts = Number(attemptsSel.value);
  runBeat(S.beat);
  saveUrl();
});
const beamColor = $("beamColor");
beamColor.value = cfg.beam;
$("beamOut").textContent = cfg.beam;
beamColor.addEventListener("input", () => {
  cfg.beam = beamColor.value;
  $("beamOut").textContent = cfg.beam;
  applyBeam();
  saveUrl();
});
function addSliders(el, list, restart) {
  for (const [key, label, lo, hi, step, unit] of list) {
    const l = document.createElement("label");
    l.innerHTML = `<span></span><output></output><input type="range" />`;
    l.querySelector("span").textContent = label;
    const input = l.querySelector("input");
    const out = l.querySelector("output");
    Object.assign(input, { min: lo, max: hi, step, value: cfg[key] });
    input.dataset.key = key;
    const show = () => (out.textContent = `${cfg[key]} ${unit}`.trim());
    input.addEventListener("input", () => {
      cfg[key] = Number(input.value);
      show();
      if (restart) {
        runBeat(S.beat);
      }
      saveUrl();
    });
    show();
    el.append(l);
  }
}
addSliders($("sliders"), SLIDERS, false);
addSliders($("creator"), CREATOR, true);
addSliders($("visitor"), VISITOR, true);

applyBeam();
resize();
runBeat(params.get("beat") || "lead-in");
requestAnimationFrame(frame);
// a hook for the page's checks: read-only state, nothing drives the page through it
window.__quiz = { S, A, V, N, cfg, boxOpen, runBeat, setHelp, tapChip, relAngle };
