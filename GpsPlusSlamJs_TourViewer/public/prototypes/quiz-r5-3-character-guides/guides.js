// Quiz 5.3 - The character guides. Throwaway prototype: not wired to the app, linked from nothing in it.
// An Easter-egg hunt for a story quiz. The answers are hidden at the things they name and glitter faintly.
// Walking close finds an egg: it opens and flies into its slot in the narration box, where it can be
// chosen at once. Help is a conversation: the visitor taps the character's name in the box; only then
// does the character guide in words, the side of the box towards the egg glows in her colour, and
// looking that way long enough fills the egg and its empty slot together until it flies in.
import * as THREE from "three";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DEG = Math.PI / 180;

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
  ["cone", "Look cone, half-angle (exit at 1.5x)", 5, 30, 1, "deg", 12],
  ["dwell", "Look long enough to collect (dwell)", 1.5, 8, 0.5, "s", 3],
  ["drain", "Looking away empties it within", 0.3, 3, 0.1, "s", 1],
  ["find", "Find radius (walk this close)", 0.8, 3, 0.1, "m", 1.5],
  ["glintSlow", "Glint period, far away", 2, 8, 0.1, "s", 4.5],
  ["glintFast", "Glint period, at the egg", 0.3, 2, 0.1, "s", 0.9],
  ["beamH", "Hint light height", 2, 10, 0.5, "m", 4],
  ["fade", "Light fades out from (share of its height)", 0.2, 0.9, 0.05, "", 0.55],
  ["flight", "Flight time into the box", 0.8, 4, 0.1, "s", 2],
  ["stagger", "Stagger between two flights", 0, 2, 0.1, "s", 0.6],
  ["grace", "Take a choice back within (grace)", 1, 6, 0.5, "s", 3],
];
const cfg = { voice: params.get("voice") === "on", beamColor: /^#[0-9a-f]{6}$/i.test(params.get("color") || "") ? params.get("color") : "#fff4b0" };
for (const [key, , lo, hi, , , def] of SLIDERS) {
  cfg[key] = numParam(key, def, lo, hi);
}
// what the tour's creator sets on the quiz item
const CREATOR = [
  ["attempts", "Guesses", [["1", "One"], ["2", "Two"], ["unlimited", "As many as they like"]], "2"],
  ["key", "Prerequisite", [["none", "None"], ["need", "Golden key, visitor has none"], ["have", "Golden key, visitor has it"]], "none"],
  ["scope", "One ask helps with", [["one", "One egg"], ["until", "Every egg, until stopped"]], "one"],
];
const creator = {};
for (const [key, , options, def] of CREATOR) {
  const v = params.get(key);
  creator[key] = options.some(([value]) => value === v) ? v : def;
}
creator.cost = numParam("cost", 0, 0, 20); // points a guess costs
creator.purse = numParam("purse", 40, 0, 100); // points the visitor has when the question comes

const DWELL_FIND = 0.25; // seconds inside the find radius, so a jitter spike cannot find
const SEEN_EXTRA = 3; // metres past the find radius where the egg itself shows
const TEASE_FAR = 16; // metres: inside this the glitter warms
const GLINT_HINT = 0.6; // the egg the character is guiding to glints this often
const GLINT_LEN = 0.35;
const SPARKS = 8;
const GLINT_SIZE = 0.5;
const SPARK_SIZE = 0.17;
const OPEN_S = 0.7; // a found egg opens for this long before it flies
const LINE_HOLD = 0.5; // a guiding line must hold this long before the next replaces it
const BACK_HOLD = 1.6; // after the look slips off a nearly full egg, "back a little" stays this long
const EYE = 1.6;
const WALK = 1.4;
const FAST = 3.5;
const POINTS = 10;
const STILL = params.get("still") === "1"; // freezes the page after its beat, for screenshots

const SPEAKER = { name: "Mara", color: "#4ade80" };
const TEXT = {
  lead: "Look around this square. Three old things stand here: the fountain, the plane tree and the bench. One of them was here long before the other two.",
  question: "Which of these stood on this square first? I hid each answer at its thing, like an egg. Find one and you may answer. If you get stuck, just ask me.",
  keyed: "You brought the golden key, so here is my question. ",
  locked: "There is a question waiting here, but it is locked. Find the golden key at the old gate, then come back to me.",
  right: "The fountain. Its water ran here more than two hundred years before the tree was planted.",
  wrong: "It was the fountain, from 1652. The tree came in 1921, and the bench only this spring.",
  goesOn: "Now come with me to the gate at the south end. The first tram rolled through it, and it brought the tree.",
};
// what the character says when asked, and while she guides
const SAY = {
  ask: "Gladly. Turn slowly, I will tell you.",
  askAgain: "Here, I will light it up for you.",
  stop: "All right. I am here if you need me.",
  allFound: "You found them all. Which one is it?",
  wait: "Let me finish my question first.",
  got: "There it is.",
  gotNext: "That is one. Now the next...",
  last: "That was the last one.",
  fill: "There. Keep looking there...",
  back: "Back a little... you had it.",
  near: (s) => `A bit more to the ${s}...`,
  mid: (s) => `More to the ${s}.`,
  behind: (s) => `It is behind you. Turn to your ${s}.`,
  retry: "Not that one. You have one more guess.",
  again: "Not that one. Try another.",
  broke: "Not that one, and you have no points left for another guess.",
};
const ANSWERS = [
  // spot: where the egg hides relative to its thing (metres, in the thing's own frame: -z towards the start)
  { id: "fountain", label: "The fountain", hue: "#7dd3fc", dir: [0, -1], right: true, spot: [0.5, 0.55, 1.42] },
  { id: "tree", label: "The plane tree", hue: "#c4b5fd", dir: [-0.866, -0.5], right: false, spot: [-0.45, 0, 0.35] },
  { id: "bench", label: "The bench", hue: "#fda4af", dir: [0.866, -0.5], right: false, spot: [0.3, 0.02, 0.05] },
];
const SPACING = 10;

/* ================= the state of the quiz ================= */
const S = {};
const A = ANSWERS.map((o, i) => ({ ...o, i }));
function freshState() {
  Object.assign(S, {
    phase: "lead", // lead | locked | ask | open | result | after
    fold: false,
    clock: 0,
    lastLaunch: -Infinity,
    held: -1,
    heldAt: 0,
    tries: 0,
    points: creator.purse,
    paid: 0,
    chosen: -1,
    result: null,
    help: null, // { level, target, inCone, cat, pend, pendAt }
    say: null, // { text, until } a line the character says, ahead of any guiding
    pillar: { i: -1, up: 0 },
    autoWalk: null,
    autoTurn: null,
  });
  for (const a of A) {
    Object.assign(a, { found: false, state: "hidden", fill: 0, near: 0, crossed: false, foundAt: -99, readyAt: 0, flight: null, homeAt: -99, d: 99 });
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
// the signed angle from the view's heading to a point: negative to the left
function relAngle(x, z) {
  const dx = x - V.x;
  const dz = z - V.z;
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

/* ---------- the spark of page 6: a gold star on a faint dark halo, so it reads on bright and dark alike ---------- */
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
const sparkTex = canvasTexture(64, 64, drawSpark);
sparkTex.premultiplyAlpha = true;
const pointMat = (size) =>
  new THREE.PointsMaterial({ size, map: sparkTex, vertexColors: true, transparent: true, premultipliedAlpha: true, depthWrite: false });
function pointCloud(count, size) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(count * 4), 4));
  const pts = new THREE.Points(geo, pointMat(size));
  pts.frustumCulled = false;
  scene.add(pts);
  return pts;
}

/* ---------- page 11's light pillar: soft at the ground, a glowing rim where it meets it, exactly 0 at the top ---------- */
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
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;
const pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0);
function pillar(hue, radius, height) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(hue) }, uGlow: { value: 1 }, uFade: { value: cfg.fade } },
    vertexShader: PILLAR_VERT,
    fragmentShader: PILLAR_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(pillarGeo, mat);
  m.scale.set(radius, height, radius);
  m.renderOrder = 6;
  scene.add(m);
  return m;
}

// the station: its orange beam with page 11's fade, and light rising from its foot
const STATION = new THREE.Vector3(-3, 0, -24);
const stationBeam = pillar(0xf2971f, 0.45, 34);
stationBeam.position.copy(STATION);
const stationMotes = pointCloud(16, 0.28);

// the hint light: a short pale-yellow pillar at the egg, only after a second ask
const hintBeam = pillar(cfg.beamColor, 0.55, cfg.beamH);
hintBeam.visible = false;
const HINT_MOTES = 14;
const hintMotes = pointCloud(HINT_MOTES, 0.2);

// another item of the station: a narration circle behind the start, dimmed while the question is open
const otherItem = new THREE.Mesh(
  new THREE.CircleGeometry(1.6, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.35, depthWrite: false }),
);
otherItem.position.set(4, 0.03, 7);
scene.add(otherItem);

/* ---------- the named things ---------- */
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

/* ---------- an egg: hidden at its thing; it fills from below while it is being collected, then opens ---------- */
const EGG_H = 0.4;
const EGG_R = 0.14;
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
  scene.add(a.group);
  a.view = { open: 0, aim: 0 };
}
(function placeThings() {
  for (const a of A) {
    const tx = a.dir[0] * SPACING;
    const tz = a.dir[1] * SPACING;
    const rot = Math.atan2(-a.dir[0], -a.dir[1]);
    a.thing.position.set(tx, 0, tz);
    a.thing.rotation.y = rot;
    // the spot in the thing's frame, turned with it (its -z faces the start)
    const [sx, sy, sz] = a.spot;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    a.ex = tx + sx * c + sz * s;
    a.ez = tz - sx * s + sz * c;
    a.ey = sy;
    a.group.position.set(a.ex, a.ey, a.ez);
  }
})();
// the glitter: one glint and eight rising sparks per egg (page 6), one draw each for all eggs
const glints = pointCloud(A.length, GLINT_SIZE);
const sparks = pointCloud(A.length * SPARKS, SPARK_SIZE);

/* ================= the narration box: words, tap to pause, vertical drag to scrub ================= */
const nbox = $("nbox");
const col = $("col");
const thumb = $("thumb");
const sbar = $("sbar");
const chipsEl = $("chips");
const hintEl = $("hint");
const sayEl = $("say");
const sayText = $("sayText");
const repliesEl = $("replies");
const ptext = $("ptext");
const pdots = $("pdots");
const handle = $("handle");
const handleText = $("handleText");
const glowL = $("glowL");
const glowR = $("glowR");
const flyLayer = $("flyLayer");
nbox.style.setProperty("--spk", SPEAKER.color);
const BUBBLE_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12v7.5H7.2L4 13.4v-2.9H2z"/></svg>';
const nameButton = () => `<button type="button" class="spk" aria-label="Ask ${SPEAKER.name} for help">${SPEAKER.name}${BUBBLE_SVG}</button>`;

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
  col.innerHTML = `${nameButton()} `;
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
function speak(text) {
  if (!cfg.voice || !synth) {
    return;
  }
  stopVoice();
  if (text) {
    synth.speak(Object.assign(new SpeechSynthesisUtterance(text), { lang: "en-GB" }));
    return;
  }
  if (!N.playing) {
    return;
  }
  const from = Math.max(0, wordAt(N.t));
  synth.speak(Object.assign(new SpeechSynthesisUtterance(N.words.slice(from).map((w) => w.text).join(" ")), { lang: "en-GB" }));
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
// Buttons inside the box (the name, the replies, the handle, the answers) are not part of them.
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
// a tap on the character's name, wherever it shows (the words or the folded line), asks her
nbox.addEventListener("click", (e) => {
  if (e.target.closest("button.spk")) {
    askHelp();
  }
});
$("replyMore").addEventListener("click", () => askHelp());
$("replyStop").addEventListener("click", () => stopHelp(true));

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
    S.fold = dy > 0;
  }
});
handle.addEventListener("pointerup", (e) => {
  if (handleDrag && e.pointerId === handleDrag.id && !handleDrag.done) {
    handleDrag.done = true;
    S.fold = !S.fold;
  }
});
handle.addEventListener("click", (e) => {
  if (handleDrag && handleDrag.done) {
    handleDrag = null;
    return;
  }
  e.preventDefault();
  S.fold = !S.fold;
});

/* ================= the quiz flow ================= */
const boxOpen = () => !S.fold;
const unfound = () => A.filter((a) => !a.found);
const quizLive = () => S.phase === "open";

function enterLead() {
  S.phase = "lead";
  setNarration("lead", TEXT.lead, true);
}
function enterAsk() {
  if (creator.key === "need") {
    S.phase = "locked";
    setNarration("locked", TEXT.locked, true);
    return;
  }
  S.phase = "ask";
  S.fold = false;
  setNarration("question", (creator.key === "have" ? TEXT.keyed : "") + TEXT.question, true);
}
function enterOpen() {
  S.phase = "open";
}
function enterAfter() {
  S.phase = "after";
  S.fold = false;
  stopHelp(false);
  setNarration("goesOn", TEXT.goesOn, true);
}
function flow() {
  if (S.phase === "lead" && narrationDone() && S.clock - N.doneAt > 0.6) {
    enterAsk();
  } else if (S.phase === "ask" && narrationDone() && S.clock - N.doneAt > 0.8) {
    enterOpen();
  } else if (S.phase === "result" && narrationDone() && S.clock - N.doneAt > 1.5) {
    enterAfter();
  }
}

/* ---------- asking the character: one tap on her name; a second ask (or "Show me") lights the egg ---------- */
function say(text, hold = 2.4) {
  S.say = { text, until: S.clock + hold };
  speak(text);
}
function nearestUnfound() {
  let best = null;
  for (const a of unfound()) {
    const d = Math.hypot(a.ex - V.x, a.ez - V.z);
    if (!best || d < best.d) {
      best = { a, d };
    }
  }
  return best ? best.a.i : -1;
}
function askHelp() {
  if (S.phase === "locked") {
    say(TEXT.locked, 4);
    return;
  }
  if (S.phase === "lead" || S.phase === "ask") {
    say(SAY.wait, 1.8);
    return;
  }
  if (S.phase !== "open" || S.held >= 0) {
    return;
  }
  if (!unfound().length) {
    say(SAY.allFound);
    return;
  }
  if (!S.help) {
    S.help = { level: 1, target: nearestUnfound(), inCone: false, cat: "", pend: "", pendAt: 0 };
    say(SAY.ask, 1.8);
  } else if (S.help.level === 1) {
    S.help.level = 2;
    say(SAY.askAgain, 1.8);
  } else {
    S.help.cat = ""; // asked a third time: she says where it is again, nothing stronger
    S.say = null;
  }
}
function stopHelp(byVisitor) {
  if (!S.help) {
    return;
  }
  const t = A[S.help.target];
  if (t && !t.found) {
    t.fill = 0;
  }
  S.help = null;
  if (byVisitor) {
    say(SAY.stop);
  }
}

/* ---------- finding: walk close; or, while she helps, look the right way long enough ---------- */
function collect(i) {
  const a = A[i];
  if (a.found) {
    return;
  }
  a.found = true;
  a.state = "opening";
  a.foundAt = S.clock;
  if (S.help && S.help.target === i) {
    const next = nearestUnfound();
    if (next < 0) {
      S.help = null;
      say(SAY.last);
    } else if (creator.scope === "until") {
      Object.assign(S.help, { target: next, inCone: false, cat: "", pend: "" });
      say(SAY.gotNext);
    } else {
      S.help = null;
      say(SAY.got);
    }
  }
}
function stepFinding(dt) {
  for (const a of A) {
    a.d = Math.hypot(a.ex - V.x, a.ez - V.z);
    if (!quizLive() || a.found) {
      continue;
    }
    a.near = a.d < cfg.find ? a.near + dt : 0;
    if (a.near >= DWELL_FIND) {
      collect(a.i);
    }
  }
  if (!S.help || !quizLive()) {
    return;
  }
  const a = A[S.help.target];
  const ang = Math.abs(relAngle(a.ex, a.ez)) / DEG;
  if (S.help.inCone ? ang > cfg.cone * 1.5 : ang < cfg.cone) {
    S.help.inCone = !S.help.inCone;
    if (!S.help.inCone && a.fill > 0.15) {
      S.help.lostAt = S.clock; // she notices at once that it was nearly there
    }
  }
  a.fill = S.help.inCone ? Math.min(1, a.fill + dt / cfg.dwell) : Math.max(0, a.fill - dt / cfg.drain);
  if (a.fill >= 1) {
    collect(a.i);
  }
}
// the guiding line: which way, in her words; a new line must hold a moment, so it never flickers
function guideCategory() {
  const a = A[S.help.target];
  if (S.help.inCone) {
    return "fill";
  }
  if (S.clock - (S.help.lostAt ?? -99) < BACK_HOLD) {
    return "back";
  }
  const r = relAngle(a.ex, a.ez) / DEG;
  const side = r < 0 ? "left" : "right";
  const abs = Math.abs(r);
  return abs < 35 ? `near-${side}` : abs < 120 ? `mid-${side}` : `behind-${side}`;
}
function guideText(cat) {
  if (cat === "fill" || cat === "back") {
    return SAY[cat];
  }
  const [kind, side] = cat.split("-");
  return SAY[kind](side);
}
function stepGuide() {
  if (!S.help) {
    return;
  }
  const raw = guideCategory();
  if (raw === S.help.cat) {
    S.help.pend = "";
    return;
  }
  if (raw === "fill" || raw === "back" || !S.help.cat) {
    S.help.cat = raw;
    S.help.pend = "";
    return;
  }
  if (raw !== S.help.pend) {
    S.help.pend = raw;
    S.help.pendAt = S.clock;
  } else if (S.clock - S.help.pendAt >= LINE_HOLD) {
    S.help.cat = raw;
    S.help.pend = "";
  }
}

const hintMoteColor = new THREE.Color();

/* ---------- choosing in the box: from the first found egg on, with grace and undo ---------- */
function canAfford() {
  return S.points >= creator.cost;
}
function tapChip(i) {
  const a = A[i];
  if (S.phase !== "open" || a.state !== "box" || a.crossed || !boxOpen()) {
    return;
  }
  if (S.held === i) {
    S.held = -1;
  } else if (S.held < 0 && canAfford()) {
    S.held = i;
    S.heldAt = S.clock;
  } else if (S.held < 0) {
    say(`A guess costs ${creator.cost} points, and you have ${S.points}.`, 2.4);
  }
}
function commit() {
  const i = S.held;
  if (i < 0) {
    return;
  }
  S.held = -1;
  S.chosen = i;
  S.tries += 1;
  S.points -= creator.cost;
  S.paid += creator.cost;
  if (A[i].right) {
    S.points += POINTS;
    finish("right");
    return;
  }
  A[i].crossed = true;
  const left = creator.attempts === "unlimited" ? Infinity : Number(creator.attempts) - S.tries;
  if (left <= 0) {
    finish("wrong");
  } else if (!canAfford()) {
    finish("broke");
  } else {
    say(creator.attempts === "unlimited" ? SAY.again : SAY.retry, 3.2);
  }
}
function finish(result) {
  S.result = result;
  S.phase = "result";
  S.fold = false;
  stopHelp(false);
  S.say = null;
  const line = result === "right" ? `${TEXT.right} +${POINTS} points.` : `${result === "broke" ? `${SAY.broke} ` : ""}${TEXT.wrong} No points this time.`;
  setNarration("result", line, true);
}

/* ================= the flights between the eggs' places and the box ================= */
const W = () => innerWidth;
const H = () => innerHeight;
const tmp = new THREE.Vector3();
function project(x, y, z) {
  tmp.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  const front = tmp.z < -0.3;
  tmp.set(x, y, z).project(camera);
  return { x: ((tmp.x + 1) / 2) * W(), y: ((1 - tmp.y) / 2) * H(), front };
}
function eggScreen(a) {
  const p = project(a.ex, a.ey + EGG_H * 0.5, a.ez);
  return p.front ? p : { x: relAngle(a.ex, a.ez) < 0 ? -80 : W() + 80, y: H() * 0.42 };
}
function center(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
const homeScreen = (a) => center(boxOpen() ? a.chip : nbox);
function launch(a, dir) {
  a.flight = { dir, t0: S.clock, dur: cfg.flight, from: dir === "in" ? eggScreen(a) : homeScreen(a) };
  a.state = dir === "in" ? "flyIn" : "flyOut";
  a.flyEl.hidden = false;
  S.lastLaunch = S.clock;
}
// found eggs live in the box while it is open; folding it sends them back to their places
function schedule() {
  for (const a of A) {
    if (a.state === "opening" && S.clock - a.foundAt >= OPEN_S) {
      a.state = "ready";
      a.readyAt = S.clock;
    }
  }
  const open = boxOpen();
  for (const a of A) {
    if (!open && a.state === "box") {
      launch(a, "out");
    } else if (!open && a.state === "ready") {
      a.state = "out";
    }
  }
  if (!open) {
    return;
  }
  const waiting = A.filter((a) => a.state === "ready" || a.state === "out").sort((p, q) => p.readyAt - q.readyAt);
  for (const a of waiting) {
    if (S.clock < S.lastLaunch + cfg.stagger) {
      break;
    }
    launch(a, "in");
    if (cfg.stagger > 0) {
      break;
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
      a.state = f.dir === "in" ? "box" : "out";
      if (f.dir === "in") {
        a.homeAt = S.clock;
        a.fill = 0;
      }
      continue;
    }
    const from = f.from;
    const to = f.dir === "in" ? homeScreen(a) : eggScreen(a);
    const e = easeInOut(p);
    const cx = (from.x + to.x) / 2;
    const cy = Math.min(from.y, to.y) - H() * 0.22;
    const x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * cx + e * e * to.x;
    const y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * cy + e * e * to.y;
    const sc = f.dir === "in" ? 0.55 + 0.45 * e : 1 - 0.45 * e;
    a.flyEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${sc.toFixed(3)})`;
    a.flyEl.style.opacity = String(f.dir === "in" ? 0.7 + 0.3 * p : 1 - 0.3 * smooth(0.85, 1, p));
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
    S.autoTurn = null;
  }
});
canvas.addEventListener("pointerup", (e) => {
  if (!viewDrag || e.pointerId !== viewDrag.id) {
    return;
  }
  const tap = !viewDrag.moved;
  viewDrag = null;
  if (tap) {
    ndc.set((e.clientX / W()) * 2 - 1, -(e.clientY / H()) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    if (ray.ray.intersectPlane(groundPlane, p)) {
      jumpTo(p.x, p.z);
    }
  }
});
canvas.addEventListener("pointercancel", () => {
  viewDrag = null;
});
// a tap on the ground jumps there; near a hidden egg it lands just outside the find radius, facing it
function jumpTo(px, pz) {
  let best = null;
  let bestD = Infinity;
  for (const a of unfound()) {
    const d = Math.hypot(px - a.ex, pz - a.ez);
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  if (best && bestD < 3) {
    let ux = V.x - best.ex;
    let uz = V.z - best.ez;
    const len = Math.hypot(ux, uz) || 1;
    ux /= len;
    uz /= len;
    V.x = best.ex + ux * (cfg.find + 0.8);
    V.z = best.ez + uz * (cfg.find + 0.8);
    V.yaw = yawTo(best.ex, best.ez);
  } else {
    const r = Math.hypot(px, pz);
    const k = r > 30 ? 30 / r : 1;
    V.x = px * k;
    V.z = pz * k;
  }
  S.autoWalk = null;
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
  if (e.key.toLowerCase() === "h") {
    askHelp();
  }
});
addEventListener("keyup", (e) => V.keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => V.keys.clear());
function moveVisitor(dt) {
  const k = V.keys;
  const turn = (k.has("e") || k.has("arrowright") ? 1 : 0) - (k.has("q") || k.has("arrowleft") ? 1 : 0);
  V.yaw -= turn * 1.4 * dt;
  if (S.autoTurn) {
    const d = Math.atan2(Math.sin(S.autoTurn.yaw - V.yaw), Math.cos(S.autoTurn.yaw - V.yaw));
    const step = Math.sign(d) * Math.min(Math.abs(d), S.autoTurn.speed * dt);
    V.yaw += step;
    if (Math.abs(d) < 0.002) {
      S.autoTurn = null;
    }
  }
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
  b.innerHTML = `<span class="fill"></span><i class="dot"></i><span class="tx"><b></b><small></small></span><span class="bar"><i></i></span>`;
  b.addEventListener("click", () => tapChip(a.i));
  chipsEl.append(b);
  a.chip = b;
  a.chipName = b.querySelector("b");
  a.chipSmall = b.querySelector("small");
  a.chipBar = b.querySelector(".bar i");
  a.chipFill = b.querySelector(".fill");
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
const cache = new Map();
function put(key, value, write) {
  if (cache.get(key) !== value) {
    cache.set(key, value);
    write(value);
  }
}
const costText = () => (creator.cost > 0 ? ` - ${creator.cost} points` : "");
function chipState(a) {
  if (S.phase === "result" || S.phase === "after") {
    if (a.right) {
      return ["right", a.label, S.result === "right" ? "Right" : "The answer"];
    }
    return [a.i === S.chosen ? "wrong" : "other", a.label, a.i === S.chosen ? "Not this one" : a.found ? "" : "Not found"];
  }
  if (a.state !== "box") {
    const coming = a.found;
    return ["hidden", coming ? a.label : "Hidden", coming ? "Found" : S.help && S.help.target === a.i ? "Look for it" : ""];
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
  if (!canAfford()) {
    return ["poor", a.label, `Needs ${creator.cost} points`];
  }
  return ["home", a.label, `Tap to choose${costText()}`];
}
function hintHtml() {
  if (S.phase === "locked") {
    return "The question opens with the <span class=\"count\">golden key</span>.";
  }
  if (S.phase === "result" || S.phase === "after") {
    const net = (S.result === "right" ? POINTS : 0) - S.paid;
    return S.phase === "result" ? `<span class="count">${net >= 0 ? "+" : ""}${net} points</span> (you have ${S.points})` : "";
  }
  if (S.phase !== "open") {
    return "";
  }
  if (S.held >= 0) {
    return "Chosen. It counts when the time runs out; tap it again to take it back.";
  }
  const hidden = unfound().length;
  const found = A.length - hidden;
  let first;
  if (!found) {
    first = `<span class="count">${hidden} eggs</span> are hidden here. Find one to answer.`;
  } else if (hidden) {
    first = `<span class="count">${hidden} ${hidden === 1 ? "egg" : "eggs"} still hidden.</span> Choose now, or keep looking.`;
  } else {
    first = "<span class=\"count\">All found.</span> Tap the one you think is right.";
  }
  const rules = [];
  if (creator.key === "have") {
    rules.push("Opened with your golden key.");
  }
  const left = creator.attempts === "unlimited" ? Infinity : Number(creator.attempts) - S.tries;
  if (left === Infinity) {
    rules.push("Guess as often as you like.");
  } else {
    rules.push(left === 1 ? (S.tries ? "Last guess." : "One guess.") : "Two guesses.");
  }
  if (creator.cost > 0) {
    rules.push(`A guess costs ${creator.cost} of your ${S.points} points.`);
  }
  return `${first} ${rules.join(" ")}`;
}
function sayLine() {
  if (S.say && S.say.until > S.clock) {
    return S.say.text;
  }
  if (S.help && S.help.cat) {
    return guideText(S.help.cat);
  }
  return "";
}
function pillHtml() {
  const line = sayLine();
  const hidden = unfound().length;
  const count = S.phase === "open" && hidden ? `<span class="count">${hidden} hidden</span> ` : "";
  return `${count}${nameButton()} ${escapeHtml(line || N.text)}`;
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
  put("ask", S.help ? "helping" : S.phase === "open" && unfound().length ? "yes" : "no", (v) => (nbox.dataset.ask = v));
  updateWords(dt);
  const showChips = S.phase === "ask" || S.phase === "open" || S.phase === "result" || S.phase === "after";
  put("chipsShown", showChips, (v) => (chipsEl.hidden = !v));
  for (const a of A) {
    const [state, name, small] = chipState(a);
    put(`cs${a.i}`, state, (v) => {
      a.chip.dataset.state = v;
      if (v !== "hidden" && a.homeAt > S.clock - 0.1) {
        a.chip.classList.remove("pop");
        void a.chip.offsetWidth;
        a.chip.classList.add("pop");
      }
    });
    put(`cn${a.i}`, name, (v) => (a.chipName.textContent = v));
    put(`cm${a.i}`, small, (v) => (a.chipSmall.textContent = v));
    a.chip.disabled = !(S.phase === "open" && a.state === "box" && !a.crossed);
    const bar = S.held === a.i ? 1 - clamp((S.clock - S.heldAt) / cfg.grace, 0, 1) : 0;
    put(`cb${a.i}`, Math.round(bar * 200), (v) => (a.chipBar.style.width = `${v / 2}%`));
    // the slot fills together with the egg while it is being collected by looking
    const fill = a.state === "box" || S.phase !== "open" ? 0 : a.found && a.fill > 0 ? 1 : a.fill;
    put(`cf${a.i}`, Math.round(fill * 200), (v) => (a.chipFill.style.height = `${v / 2}%`));
    put(`d${a.i}`, a.state === "box" ? "on" : "off", (v) => (a.dot.style.display = v === "on" ? "" : "none"));
  }
  put("hint", hintHtml(), (v) => {
    hintEl.hidden = !v;
    hintEl.innerHTML = v;
  });
  // what the character says: a line under the words; while she helps, the visitor's replies under it
  const line = open ? sayLine() : "";
  put("say", line, (v) => {
    sayEl.hidden = !v;
    if (v) {
      sayText.classList.add("swap");
      requestAnimationFrame(() => {
        sayText.textContent = v;
        sayText.classList.remove("swap");
      });
    }
  });
  put("replies", S.help ? `on${S.help.level}` : "off", (v) => {
    repliesEl.hidden = v === "off";
    $("replyMore").hidden = v !== "on1";
  });
  put("ptext", open ? "" : pillHtml(), (v) => (ptext.innerHTML = v));
  // the side of the box towards the egg glows; looking the right way, it rests
  let gl = 0;
  let gr = 0;
  if (S.help && S.phase === "open") {
    const a = A[S.help.target];
    const r = relAngle(a.ex, a.ez) / DEG;
    if (!S.help.inCone) {
      const k = (0.45 + 0.55 * smooth(cfg.cone * 1.5, 90, Math.abs(r))) * (reduceMotion ? 1 : 0.85 + 0.15 * Math.sin(t * 2.4));
      if (r < 0) {
        gl = k;
      } else {
        gr = k;
      }
    }
  }
  put("gl", Math.round(gl * 50), (v) => (glowL.style.opacity = String(v / 50)));
  put("gr", Math.round(gr * 50), (v) => (glowR.style.opacity = String(v / 50)));
}

/* ================= the world, every frame ================= */
function updateWorld(t, dt) {
  const k = 1 - Math.exp(-dt / 0.18);
  const quizOpen = S.phase === "ask" || S.phase === "open" || S.phase === "result";
  otherItem.material.opacity += ((quizOpen ? 0.08 : 0.35) - otherItem.material.opacity) * k;
  stationBeam.material.uniforms.uFade.value = cfg.fade;
  // the station's motes: light rising from its foot, never falling
  {
    const pos = stationMotes.geometry.attributes.position.array;
    const colr = stationMotes.geometry.attributes.color.array;
    for (let j = 0; j < 16; j++) {
      const rise = (j * 0.618 + t * 0.12) % 1;
      const ang = j * 2.4 + t * 0.3;
      pos[j * 3] = STATION.x + Math.cos(ang) * 0.3;
      pos[j * 3 + 1] = rise * 9;
      pos[j * 3 + 2] = STATION.z + Math.sin(ang) * 0.3;
      const al = 0.8 * (1 - rise) * (0.4 + 0.6 * Math.max(0, Math.sin(t * 3 + j)));
      colr[j * 4] = 0.95 * al;
      colr[j * 4 + 1] = 0.6 * al;
      colr[j * 4 + 2] = 0.15 * al;
      colr[j * 4 + 3] = al;
    }
    stationMotes.geometry.attributes.position.needsUpdate = true;
    stationMotes.geometry.attributes.color.needsUpdate = true;
  }
  const helpT = S.help && S.phase === "open" ? S.help.target : -1;
  const gp = glints.geometry.attributes.position.array;
  const gc = glints.geometry.attributes.color.array;
  const sp = sparks.geometry.attributes.position.array;
  const sc = sparks.geometry.attributes.color.array;
  for (const a of A) {
    const targeted = a.i === helpT;
    const atPlace = a.state === "hidden" || a.state === "opening" || a.state === "ready" || a.state === "out";
    const seen = a.found || a.d < cfg.find + SEEN_EXTRA || targeted || (S.phase === "result" && a.right);
    a.group.visible = atPlace && seen && S.phase !== "locked";
    a.view.open += ((a.found ? 1 : 0) - a.view.open) * k;
    a.view.aim += ((targeted ? 1 : 0) - a.view.aim) * k;
    if (!targeted && !a.found) {
      a.fill = Math.max(0, a.fill - dt / cfg.drain);
    }
    const sinceFound = S.clock - a.foundAt;
    const hop = a.found && sinceFound < OPEN_S ? Math.sin((Math.PI * sinceFound) / OPEN_S) * 0.25 : 0;
    a.group.position.y = a.ey + hop + (a.found ? 0.15 : 0);
    a.pivot.scale.setScalar(1 + 0.6 * a.view.aim + 0.25 * a.view.open);
    a.pivot.rotation.set(0, a.found ? Math.atan2(V.x - a.ex, V.z - a.ez) : Math.sin(t * 1.3 + a.i) * 0.25, 0);
    a.lid.position.set(0, CRACK * EGG_H + a.view.open * 0.12, -a.view.open * 0.05);
    a.lid.rotation.x = -a.view.open * 0.8;
    const c0 = a.fill;
    const c = c0 * c0 * (3 - 2 * c0);
    a.mat.color.set(a.hue).multiplyScalar(1 - 0.6 * c);
    a.mat.emissive.set(a.hue).multiplyScalar(a.found ? 0.55 + 0.15 * Math.sin(t * 4) : 0.14 + 0.4 * c);
    a.shell.visible = c0 > 0.01 && a.view.open < 0.3;
    a.fillMat.uniforms.level.value = c0;
    a.fillMat.uniforms.time.value = t;

    // the glitter of page 6, for an egg not yet found; the egg she guides to glints faster
    const tease = quizLive() && !a.found;
    const warm = tease ? smooth(TEASE_FAR, cfg.find, a.d) : 0;
    const period = targeted ? GLINT_HINT : cfg.glintSlow + (cfg.glintFast - cfg.glintSlow) * warm;
    const at = (t + a.i * 1.37) % period;
    const glint = tease && at < GLINT_LEN ? Math.sin((Math.PI * at) / GLINT_LEN) : 0;
    gp[a.i * 3] = a.ex;
    gp[a.i * 3 + 1] = a.ey + EGG_H + 0.12;
    gp[a.i * 3 + 2] = a.ez;
    const ga = glint * (targeted ? 1 : 0.55 + 0.45 * warm);
    gc[a.i * 4] = gc[a.i * 4 + 1] = gc[a.i * 4 + 2] = gc[a.i * 4 + 3] = ga;
    const burst = a.found && sinceFound < 0.9 ? sinceFound / 0.9 : -1;
    for (let j = 0; j < SPARKS; j++) {
      const ang = t * 0.9 + (j * Math.PI * 2) / SPARKS + a.i;
      const b = (a.i * SPARKS + j) * 3;
      const q = (a.i * SPARKS + j) * 4;
      let alpha;
      if (burst >= 0) {
        // the find: the sparks spring out and up once, then are gone
        const r = 0.2 + burst * 0.9;
        sp[b] = a.ex + Math.cos(ang) * r;
        sp[b + 1] = a.ey + 0.2 + burst * 1.1;
        sp[b + 2] = a.ez + Math.sin(ang) * r;
        alpha = 1 - burst;
      } else {
        const r = 0.26 + 0.08 * Math.sin(t * 1.3 + j);
        const rise = (j * 0.37 + t * 0.22) % 1;
        sp[b] = a.ex + Math.cos(ang) * r;
        sp[b + 1] = a.ey + 0.05 + rise * 0.7;
        sp[b + 2] = a.ez + Math.sin(ang) * r;
        const twinkle = 0.3 + 0.7 * Math.max(0, Math.sin(t * 5 + j * 1.9));
        const w = targeted ? Math.max(warm, 0.7) : warm;
        alpha = tease ? w * w * twinkle * (1 - rise * 0.6) : 0;
      }
      sc[q] = sc[q + 1] = sc[q + 2] = sc[q + 3] = alpha;
    }
  }
  for (const p of [glints, sparks]) {
    p.geometry.attributes.position.needsUpdate = true;
    p.geometry.attributes.color.needsUpdate = true;
  }

  // the hint light after a second ask: rises at the egg, sinks once it is collected or help ends
  const wantI = S.help && S.help.level === 2 && S.phase === "open" ? S.help.target : -1;
  if (wantI >= 0) {
    S.pillar.i = wantI;
  }
  S.pillar.up += ((wantI >= 0 ? 1 : 0) - S.pillar.up) * (1 - Math.exp(-dt / 0.3));
  const pa = S.pillar.i >= 0 ? A[S.pillar.i] : null;
  hintBeam.visible = !!pa && S.pillar.up > 0.01;
  hintMotes.visible = hintBeam.visible;
  if (pa) {
    hintBeam.position.set(pa.ex, 0, pa.ez);
    hintBeam.scale.set(0.55, Math.max(0.01, cfg.beamH * S.pillar.up), 0.55);
    hintBeam.material.uniforms.uFade.value = cfg.fade;
    hintBeam.material.uniforms.uGlow.value = S.pillar.up;
    hintBeam.material.uniforms.uColor.value.set(cfg.beamColor);
    const col3 = hintMoteColor.set(cfg.beamColor);
    const pos = hintMotes.geometry.attributes.position.array;
    const colr = hintMotes.geometry.attributes.color.array;
    for (let j = 0; j < HINT_MOTES; j++) {
      const rise = (j * 0.618 + t * 0.18) % 1;
      const ang = j * 2.4 + t * 0.4;
      pos[j * 3] = pa.ex + Math.cos(ang) * 0.35;
      pos[j * 3 + 1] = rise * cfg.beamH * 0.75 * S.pillar.up;
      pos[j * 3 + 2] = pa.ez + Math.sin(ang) * 0.35;
      const al = S.pillar.up * 0.9 * (1 - rise) * (0.4 + 0.6 * Math.max(0, Math.sin(t * 4 + j)));
      colr[j * 4] = col3.r * al;
      colr[j * 4 + 1] = col3.g * al;
      colr[j * 4 + 2] = col3.b * al;
      colr[j * 4 + 3] = al;
    }
    hintMotes.geometry.attributes.position.needsUpdate = true;
    hintMotes.geometry.attributes.color.needsUpdate = true;
  }
}

/* ================= the frame ================= */
function update(dt) {
  S.clock += dt;
  moveVisitor(dt);
  updateCamera();
  advanceNarration(dt);
  flow();
  stepFinding(dt);
  stepGuide();
  if (S.held >= 0 && S.clock - S.heldAt >= cfg.grace) {
    commit();
  }
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
  const step = STILL ? 0 : dt;
  if (!STILL) {
    update(dt);
  }
  updateWorld(STILL ? S.clock : now / 1000, step);
  renderHud(step, STILL ? S.clock : now / 1000);
  renderer.render(scene, camera);
  if (now - meterAt > 400) {
    meterAt = now;
    const info = renderer.info.render;
    const mem = performance.memory ? `  ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : "";
    meter.textContent = `${frameMs.toFixed(1)} ms\n${info.calls} calls  ${(info.triangles / 1000).toFixed(1)}k tris${mem}`;
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
  setNarration("question", (creator.key === "have" ? TEXT.keyed : "") + TEXT.question, false, true);
}
function inBox(...ids) {
  for (const i of ids) {
    Object.assign(A[i], { found: true, state: "box", foundAt: -99, homeAt: -99 });
  }
}
function standBy(i, dist) {
  const a = A[i];
  const len = Math.hypot(a.ex, a.ez);
  placeAt(a.ex - (a.ex / len) * dist, a.ez - (a.ez / len) * dist, 0);
  V.yaw = yawTo(a.ex, a.ez);
}
// the help beats stand a little to the right of the start, so the bench is the nearest hidden egg
function helpStart() {
  openQuiz();
  inBox(0);
  placeAt(1.5, 0, 0);
}
const BEATS = {
  "lead-in": () => {},
  hunt: () => openQuiz(),
  "found-walk": () => {
    openQuiz();
    standBy(0, 4.5);
    S.autoWalk = { x: A[0].ex * 0.9, z: A[0].ez * 0.84 };
  },
  "shortcut-choose": () => {
    openQuiz();
    inBox(0);
    standBy(0, cfg.find + 0.4);
    tapChip(0);
    simulate(0.6);
  },
  "help-ask": () => {
    helpStart();
    askHelp();
    simulate(0.4);
  },
  "help-on": () => {
    helpStart();
    askHelp();
    simulate(2);
    S.autoTurn = { yaw: V.yaw - 30 * DEG, speed: 0.35 };
    simulate(1.5);
  },
  "help-stronger": () => {
    helpStart();
    askHelp();
    simulate(1);
    V.yaw = yawTo(A[2].ex, A[2].ez) + 45 * DEG;
    askHelp();
    simulate(1.4);
  },
  "gaze-collect": () => {
    helpStart();
    askHelp();
    V.yaw = yawTo(A[2].ex, A[2].ez) + 4 * DEG;
    simulate(cfg.dwell * 0.35);
  },
  "gaze-away": () => {
    helpStart();
    askHelp();
    V.yaw = yawTo(A[2].ex, A[2].ez);
    simulate(cfg.dwell * 0.7);
    V.yaw += 28 * DEG;
    simulate(0.3);
  },
  "all-found": () => {
    openQuiz();
    inBox(0, 1, 2);
  },
  choose: () => {
    openQuiz();
    inBox(0, 1, 2);
    tapChip(1);
    simulate(0.5);
  },
  wrong: () => {
    openQuiz();
    inBox(0, 1, 2);
    tapChip(2);
    simulate(cfg.grace + 0.5);
  },
  right: () => {
    openQuiz();
    inBox(0, 1, 2);
    tapChip(0);
    simulate(cfg.grace + 0.8);
  },
  locked: () => {
    setCreator("key", "need");
    enterAsk();
    simulate(1.5);
  },
  fold: () => {
    openQuiz();
    inBox(0);
    simulate(0.2);
    S.fold = true;
    simulate(cfg.flight * 0.5);
  },
};
function runBeat(name) {
  freshState();
  stopVoice();
  for (const a of A) {
    a.view.open = 0;
    a.view.aim = 0;
    a.flyEl.hidden = true;
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
  for (const [key] of CREATOR) {
    q.set(key, creator[key]);
  }
  q.set("cost", String(creator.cost));
  q.set("purse", String(creator.purse));
  q.set("color", cfg.beamColor);
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
$("voiceBtn").addEventListener("click", () => {
  cfg.voice = !cfg.voice;
  $("voiceBtn").setAttribute("aria-pressed", String(cfg.voice));
  $("voiceBtn").textContent = cfg.voice ? "on" : "off";
  speak();
});
$("beamColor").value = cfg.beamColor;
$("beamColor").addEventListener("input", (e) => {
  cfg.beamColor = e.target.value;
  saveUrl();
});
function slider(parent, label, lo, hi, step, unit, get, set) {
  const l = document.createElement("label");
  l.innerHTML = `<span></span><output></output><input type="range" />`;
  l.querySelector("span").textContent = label;
  const input = l.querySelector("input");
  const out = l.querySelector("output");
  Object.assign(input, { min: lo, max: hi, step, value: get() });
  const show = () => (out.textContent = `${get()} ${unit}`);
  input.addEventListener("input", () => {
    set(Number(input.value));
    show();
    saveUrl();
  });
  show();
  parent.append(l);
}
const slidersEl = $("sliders");
for (const [key, label, lo, hi, step, unit] of SLIDERS) {
  slider(slidersEl, label, lo, hi, step, unit, () => cfg[key], (v) => (cfg[key] = v));
}
// the creator's settings: a change restarts the current beat so it shows what the visitor then sees
const creatorEl = $("creator");
const creatorInputs = {};
function setCreator(key, value) {
  creator[key] = value;
  if (creatorInputs[key]) {
    creatorInputs[key].value = value;
  }
}
for (const [key, label, options] of CREATOR) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<span></span><select></select>`;
  row.querySelector("span").textContent = label;
  const sel = row.querySelector("select");
  for (const [value, text] of options) {
    sel.append(new Option(text, value));
  }
  sel.value = creator[key];
  sel.addEventListener("change", () => {
    creator[key] = sel.value;
    runBeat(S.beat === "locked" && key === "key" ? "lead-in" : S.beat);
    saveUrl();
  });
  creatorInputs[key] = sel;
  creatorEl.append(row);
}
slider(creatorEl, "A guess costs", 0, 20, 1, "points", () => creator.cost, (v) => {
  creator.cost = v;
  runBeat(S.beat);
});
slider(creatorEl, "The visitor has, when the question comes", 0, 100, 5, "points", () => creator.purse, (v) => {
  creator.purse = v;
  runBeat(S.beat);
});

resize();
runBeat(params.get("beat") || "lead-in");
requestAnimationFrame(frame);
// a hook for the page's checks: read-only state, nothing drives the page through it
window.__quiz = { S, A, V, N, cfg, creator, boxOpen, runBeat, askHelp, stopHelp, tapChip };
