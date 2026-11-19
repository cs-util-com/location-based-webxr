// Quiz 5.1 - Warmer, in the world. Throwaway prototype: not wired to the app, linked from nothing in it.
// An Easter-egg hunt for a story quiz. The answers are hidden as eggs at the things they name and
// glitter faintly (the glitter of the find-first page). Walking close finds an egg: it opens and flies
// slowly into its chip in the narration box (the flight of quiz 4.1). The visitor may answer from the
// first found egg on; one slot in the box says how many are still hidden, and a tap on that slot asks
// the character for help. Only then does help work, and it works through the world itself: the egg
// the visitor turns towards glitters faster and brighter, its sparks climb higher, and facing it long
// enough fills it from below and brings it into the box. Nothing on a timer, nothing that follows the view.
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
  ["cone", "Look cone (half-angle): inside it the egg fills", 5, 30, 1, "deg", 12],
  ["warm", "Warmth starts at (half-angle)", 20, 90, 5, "deg", 50],
  ["gdwell", "Look dwell to collect", 1.5, 8, 0.5, "s", 3],
  ["drain", "Drain when looking away (full to empty)", 0.3, 3, 0.1, "s", 1],
  ["radius", "Find radius (walking)", 0.5, 5, 0.1, "m", 1.5],
  ["gslow", "Glint period, far and unfaced", 1.5, 8, 0.1, "s", 4.5],
  ["gfast", "Glint period, close or faced", 0.3, 2, 0.05, "s", 0.9],
  ["beam", "Hint pillar height inside the cone (0 = none)", 0, 6, 0.1, "m", 2.4],
  ["fade", "Pillar fade starts at (share of height)", 0.2, 0.95, 0.05, "", 0.55],
  ["flight", "Flight time into the box", 0.8, 4, 0.1, "s", 2],
  ["stagger", "Stagger between two flights", 0, 2, 0.1, "s", 0.6],
  ["grace", "Take back a choice within (grace)", 1, 6, 0.5, "s", 3],
];
const cfg = {};
for (const [key, , lo, hi, , , def] of SLIDERS) {
  cfg[key] = numParam(key, def, lo, hi);
}
const hueParam = (params.get("hue") || "").replace(/[^0-9a-f]/gi, "");
cfg.hue = hueParam.length === 6 ? `#${hueParam}` : "#fff4b0";

// the quiz item's settings, as the tour's creator sets them (page controls stand in for the editor)
const CREATOR = [
  {
    key: "attempts",
    label: "Attempts",
    options: [
      ["1", "1"],
      ["2", "2"],
      ["inf", "Unlimited"],
    ],
    def: "2",
  },
  {
    key: "cost",
    label: "Cost per answer (from the visitor's tour points)",
    options: [
      ["0", "Free"],
      ["5", "5 points"],
      ["10", "10 points"],
    ],
    def: "0",
  },
  {
    key: "key",
    label: "Prerequisite: the golden key",
    options: [
      ["off", "None"],
      ["need", "Needed, visitor lacks it"],
      ["have", "Needed, visitor has it"],
    ],
    def: "off",
  },
  {
    key: "warms",
    label: "Help warms",
    options: [
      ["nearest", "The nearest hidden egg"],
      ["any", "Any hidden egg faced"],
    ],
    def: "nearest",
  },
  {
    key: "buzz",
    label: "A short buzz on entering the cone (Android)",
    options: [
      ["off", "Off"],
      ["on", "On"],
    ],
    def: "off",
  },
];
for (const c of CREATOR) {
  const v = params.get(c.key);
  cfg[c.key] = c.options.some(([value]) => value === v) ? v : c.def;
}

const DWELL_FIND = 0.25; // seconds inside the find radius, so a jitter spike cannot find
const SEEN_EXTRA = 3; // metres past the find radius where the egg itself starts to show
const TEASE_FAR = 16; // metres: inside this the glitter warms with the distance
const GLINT_HINT = 0.6; // seconds between glints while the egg is inside the cone
const GLINT_LEN = 0.35; // seconds one glint lasts
const GLINT_SIZE = 0.5; // metres
const SPARKS = 10; // sparks per egg
const SPARK_SIZE = 0.17;
const EXIT_CONE = 1.5; // hysteresis: a faced egg lets go only past 1.5 times the cone
const SIZE_AT = 5; // metres: a faced egg farther than this keeps the on-screen size it would have here
const OPEN_S = 0.75; // seconds a found egg takes to open before it flies
const EYE = 1.6;
const WALK = 1.4;
const FAST = 3.5;
const START_SCORE = 40;
const POINTS = 10;
const STATION_HUE = "#f2971f";

const SPEAKER = { name: "Mara", color: "#4ade80" };
const TEXT = {
  lead: "Look around this square. Three old things stand here: the fountain, the plane tree and the bench. One of them was here long before the other two.",
  question: "Which of these stood on this square first? I hid the three answers at the things themselves. Find them, then tap the one you think is right.",
  help: "Stand where you are and turn slowly. When you face an egg I hid, it sparkles faster. Keep looking at it, and I will bring it to you.",
  helpOff: "All right. You look on your own again.",
  right: "The fountain. Its water ran here more than two hundred years before the tree was planted.",
  retry: "Not that one. You have one more try.",
  retryMore: "Not that one. Try another.",
  wrong: "It was the fountain, from 1652. The tree came in 1921, and the bench only this spring.",
  goesOn: "Now come with me to the gate at the south end. The first tram rolled through it, and it brought the tree.",
};
// each answer hides at its thing: on the fountain's near rim, at the tree's foot, under the bench
const ANSWERS = [
  { id: "fountain", label: "The fountain", hue: "#7dd3fc", dir: [0, -1], right: true, hideIn: 1.45, hideY: 0.55 },
  { id: "tree", label: "The plane tree", hue: "#c4b5fd", dir: [-0.866, -0.5], right: false, hideIn: 0.45, hideY: 0 },
  { id: "bench", label: "The bench", hue: "#fda4af", dir: [0.866, -0.5], right: false, hideIn: 0.05, hideY: 0.02 },
];
const SPACING = 10; // metres from the start to each thing

/* ================= the state of the quiz ================= */
const S = {};
const A = ANSWERS.map((o, i) => ({ ...o, i }));
function freshState() {
  Object.assign(S, {
    phase: "lead", // lead | ask | open | result | after
    fold: false,
    clock: 0,
    held: -1, // the answer chosen in the box, counting down its grace
    heldAt: 0,
    tries: 0,
    chosen: -1,
    result: null,
    help: false, // the visitor asked for help: looking collects
    score: START_SCORE,
    gained: 0,
    foundCount: 0,
    lastIn: -Infinity,
    lastOut: -Infinity,
    note: null, // { text, until } a short line in the box after a tap that cannot act
    bubble: null, // { i, text, until } a word at an egg in the world
    autoWalk: null,
  });
  for (const a of A) {
    Object.assign(a, {
      where: "hidden", // hidden | opening | in | box | out | world
      flight: null,
      openAt: -99,
      order: 0,
      findT: 0,
      gaze: 0,
      inCone: false,
      aw: 0,
      cone: 0,
      crossed: false,
      d: 99,
      ang: 180,
      homeAt: -99,
    });
  }
}
const isHidden = (a) => a.where === "hidden";
const hiddenCount = () => A.filter(isHidden).length;

/* ================= the visitor ================= */
const V = { x: 0, z: 0, yaw: 0, speed: 0, walkDir: 0, fast: false, keys: new Set() };
function placeAt(x, z, yaw) {
  V.x = x;
  V.z = z;
  V.yaw = yaw;
}
const yawTo = (x, z) => Math.atan2(-(x - V.x), -(z - V.z));
// the egg's bearing from the view direction, signed (negative: to the left)
function relAngle(a) {
  const dx = a.ex - V.x;
  const dz = a.ez - V.z;
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
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: cobble })));

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

/* ---------- the light pillar: the light-pillars page's profile ----------
   Soft at the ground, a glowing rim where it meets it, fading from `uFade` of its height to exactly 0
   at the top (no floor term), and fading near the eye. The rim keeps the pillars page's width in metres. */
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
uniform float uRimK;
varying vec2 vUv;
varying float vFace;
varying float vNear;
void main() {
  float y = vUv.y;
  float core = pow(vFace, 1.4);
  float body = smoothstep(0.0, 0.03, y) * (1.0 - smoothstep(uFade, 1.0, y));
  float rim = exp(-y * uRimK);
  float a = 0.36 * body * core + rim * 0.75;
  a *= uGlow * smoothstep(0.2, 2.6, vNear);
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;
const PILLAR_REF_H = 10.5; // the pillars page's pillar: 7 m scaled by 1.5, with its rim at exp(-y*90)
const pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0);
function pillar(hue, radius, height) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(hue) },
      uGlow: { value: 0 },
      uFade: { value: cfg.fade },
      uRimK: { value: 90 },
    },
    vertexShader: PILLAR_VERT,
    fragmentShader: PILLAR_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(pillarGeo, mat);
  mesh.userData.radius = radius;
  setPillarHeight(mesh, height);
  mesh.renderOrder = 2;
  scene.add(mesh);
  return mesh;
}
function setPillarHeight(mesh, h) {
  const r = mesh.userData.radius;
  mesh.scale.set(r, Math.max(0.001, h), r);
  mesh.material.uniforms.uRimK.value = (90 * Math.max(0.1, h)) / PILLAR_REF_H;
}

// the station: its pillar in the station colour with page 11's fade, and sparks rising from the ground
const STATION = new THREE.Vector3(-3, 0, -24);
const stationPillar = pillar(STATION_HUE, 0.45, 26);
stationPillar.position.copy(STATION);
stationPillar.material.uniforms.uGlow.value = 0.9;
const stationSparks = makeRisingSparks(STATION_HUE, 30, 0.16);
stationSparks.position.copy(STATION);
scene.add(stationSparks);
function makeRisingSparks(color, count, size) {
  const pos = new Float32Array(count * 3);
  const seeds = [];
  for (let k = 0; k < count; k++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.4;
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
function animateRisingSparks(pts, t, height) {
  const seeds = pts.userData.seeds;
  const pos = pts.geometry.attributes.position.array;
  for (let k = 0; k < seeds.length; k++) {
    const [x, z, s] = seeds[k];
    pos[k * 3] = x;
    pos[k * 3 + 1] = ((t * 0.3 + s) % 1) * height; // always upwards, never falling
    pos[k * 3 + 2] = z;
  }
  pts.geometry.attributes.position.needsUpdate = true;
}

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

/* ---------- the glitter: the find-first page's spark, a gold star on a faint dark halo ---------- */
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

/* ---------- an egg: opens at the crack, fills from below (the object-charge page's fill) ---------- */
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
const hitGeo = new THREE.SphereGeometry(0.7, 8, 6);
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
for (const a of A) {
  a.thing = thing(a.id);
  a.tx = a.dir[0] * SPACING;
  a.tz = a.dir[1] * SPACING;
  a.thing.position.set(a.tx, 0, a.tz);
  a.thing.rotation.y = Math.atan2(-a.dir[0], -a.dir[1]);
  a.ex = a.dir[0] * (SPACING - a.hideIn);
  a.ez = a.dir[1] * (SPACING - a.hideIn);
  a.ey = a.hideY;
  a.mat = new THREE.MeshLambertMaterial({ color: a.hue, emissive: a.hue, emissiveIntensity: 1, transparent: true });
  a.group = new THREE.Group();
  a.pivot = new THREE.Group();
  a.body = new THREE.Mesh(eggPart(0, CRACK), a.mat);
  a.lid = new THREE.Mesh(eggPart(CRACK, 1), a.mat);
  a.fillMat = fillMaterial(a.hue);
  a.shell = new THREE.Mesh(eggPart(0, 1, 1.07, 0.004), a.fillMat);
  a.shell.renderOrder = 3;
  a.hit = new THREE.Mesh(hitGeo, hitMat);
  a.hit.position.y = EGG_H * 0.5;
  a.hit.userData.answer = a.i;
  a.pivot.add(a.body, a.lid, a.shell);
  a.group.add(a.pivot, a.hit);
  a.group.position.set(a.ex, a.ey, a.ez);
  // the glint above the egg, and its sparks (one draw each)
  a.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, transparent: true, premultipliedAlpha: true, depthWrite: false, opacity: 0 }));
  a.glint.renderOrder = 5;
  a.sparkPos = new Float32Array(SPARKS * 3);
  a.sparkCol = new Float32Array(SPARKS * 4);
  const sg = new THREE.BufferGeometry();
  // BufferAttribute shares the arrays the frame loop writes; Float32BufferAttribute would copy them
  sg.setAttribute("position", new THREE.BufferAttribute(a.sparkPos, 3));
  sg.setAttribute("color", new THREE.BufferAttribute(a.sparkCol, 4));
  a.sparks = new THREE.Points(
    sg,
    new THREE.PointsMaterial({ size: SPARK_SIZE, map: sparkTex, vertexColors: true, transparent: true, premultipliedAlpha: true, depthWrite: false }),
  );
  a.sparks.frustumCulled = false;
  a.sparks.renderOrder = 5;
  // the short pale pillar, only while help is on and the egg is inside the cone
  a.pillar = pillar(cfg.hue, 0.55, cfg.beam);
  a.pillar.position.set(a.ex, a.ey, a.ez);
  // a soft light on the ground where a found egg rests while the box is folded
  a.pool = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: a.hue, transparent: true, opacity: 0, depthWrite: false }));
  a.pool.position.set(a.ex, a.ey + 0.02, a.ez);
  scene.add(a.group, a.glint, a.sparks, a.pool);
  a.view = { open: 0, pop: 0, vis: 0 };
}

/* ================= the narration box: words, tap to pause, vertical drag to scrub (quiz 4.1's box) ================= */
const nbox = $("nbox");
const col = $("col");
const thumb = $("thumb");
const sbar = $("sbar");
const chipsEl = $("chips");
const slotEl = $("slot");
const hintEl = $("hint");
const ptext = $("ptext");
const pdots = $("pdots");
const handle = $("handle");
const handleText = $("handleText");
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
  N.playing = autoplay && !lit;
  N.doneAt = lit ? S.clock - 99 : -1;
  N.s = 0;
  layoutWords();
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
function togglePlay(x, y) {
  if (N.t >= N.total) {
    N.t = 0;
    N.playing = true;
  } else {
    N.playing = !N.playing;
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
// Buttons inside the box (the handle, the chips, the hidden slot) are not part of them.
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
  // a pointer tap is handled on pointerup; a keyboard press arrives as a click with no pointer before it
  if (handleDrag && handleDrag.done) {
    handleDrag = null;
    return;
  }
  e.preventDefault();
  S.fold = !S.fold;
});
const boxOpen = () => !S.fold;

/* ================= the quiz flow ================= */
const maxTries = () => (cfg.attempts === "inf" ? Infinity : Number(cfg.attempts));
const triesLeft = () => maxTries() - S.tries;
const cost = () => Number(cfg.cost);
const locked = () => cfg.key === "need";
const canAfford = () => S.score >= cost();

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
}
function enterAfter() {
  S.phase = "after";
  S.fold = false;
  setNarration("goesOn", TEXT.goesOn, true);
}
// a short line from the character that then gives the box back to the question
function sayThenQuestion(kind, text) {
  setNarration(kind, text, true);
}

// found by walking or by looking: it opens where it is, then flies into the box
function found(a) {
  if (!isHidden(a)) {
    return;
  }
  a.where = "opening";
  a.openAt = S.clock;
  a.order = S.foundCount++;
  a.gaze = 0; // the fill belongs to a hidden egg: a found one keeps its full hue
  a.inCone = false;
  if (S.help && hiddenCount() === 0) {
    S.help = false; // nothing left to help with: the mode ends quietly
  }
}

// help: asked for by a tap on the hidden slot, switched off by another tap there
function tapSlot() {
  if (S.phase !== "open" || hiddenCount() === 0) {
    return;
  }
  S.help = !S.help;
  sayThenQuestion(S.help ? "help" : "helpOff", S.help ? TEXT.help : TEXT.helpOff);
}
slotEl.addEventListener("click", tapSlot);

// choosing: a tap on a found answer's chip, with a grace in which another tap takes it back
function tapChip(i) {
  const a = A[i];
  if (S.phase !== "open" || a.where !== "box" || a.crossed) {
    return;
  }
  if (S.held === i) {
    S.held = -1;
    return;
  }
  if (S.held >= 0) {
    return;
  }
  if (locked()) {
    S.note = { text: "Answering needs the golden key. You can still find the eggs.", until: S.clock + 3.5 };
    return;
  }
  if (!canAfford()) {
    S.note = { text: `An answer costs ${cost()} points, and you have ${S.score}.`, until: S.clock + 3.5 };
    return;
  }
  S.held = i;
  S.heldAt = S.clock;
}
function commit() {
  const i = S.held;
  if (i < 0) {
    return;
  }
  S.held = -1;
  S.chosen = i;
  S.tries += 1;
  S.score -= cost();
  if (A[i].right) {
    finish("right");
    return;
  }
  A[i].crossed = true;
  if (triesLeft() > 0) {
    sayThenQuestion("retry", triesLeft() === Infinity ? TEXT.retryMore : TEXT.retry);
  } else {
    finish("wrong");
  }
}
function finish(result) {
  S.result = result;
  S.phase = "result";
  S.fold = false;
  S.help = false;
  // the eggs nobody found come to the box too, so the whole set is visible with the result
  for (const a of A) {
    if (isHidden(a)) {
      a.where = "box";
      a.order = S.foundCount++;
      a.homeAt = S.clock;
    }
  }
  S.gained = result === "right" ? (S.tries > 1 ? POINTS / 2 : POINTS) : 0;
  S.score += S.gained;
  const paid = cost() > 0 ? ` You paid ${cost() * S.tries}.` : "";
  setNarration(
    "result",
    result === "right" ? `${TEXT.right} +${S.gained} points.${paid} You have ${S.score} now.` : `${TEXT.wrong} No points this time.${paid}`,
    true,
  );
}

function flow() {
  if (S.phase === "lead" && narrationDone() && S.clock - N.doneAt > 0.6) {
    enterAsk();
  } else if (S.phase === "ask" && narrationDone() && S.clock - N.doneAt > 1.2) {
    enterOpen();
  } else if (S.phase === "open" && (N.kind === "help" || N.kind === "helpOff" || N.kind === "retry") && narrationDone() && S.clock - N.doneAt > 3) {
    setNarration("question", TEXT.question, false, true);
  } else if (S.phase === "result" && narrationDone() && S.clock - N.doneAt > 1.5 && A.every((a) => a.where === "box")) {
    enterAfter();
  }
  if (S.held >= 0 && S.clock - S.heldAt >= cfg.grace) {
    commit();
  }
}

// walking close finds an egg: inside the radius for a short dwell
function stepFind(dt) {
  for (const a of A) {
    a.d = Math.hypot(a.ex - V.x, a.ez - V.z);
    a.ang = Math.abs(relAngle(a)) / DEG;
    if (!isHidden(a) || S.phase !== "open") {
      a.findT = 0;
      continue;
    }
    a.findT = a.d < cfg.radius ? a.findT + dt : 0;
    if (a.findT >= DWELL_FIND) {
      found(a);
    }
  }
}

// help on: the egg the visitor turns towards warms by angle; inside the cone it fills and is collected
function helpTargets() {
  const hidden = A.filter(isHidden);
  if (!S.help || S.phase !== "open" || !hidden.length) {
    return [];
  }
  if (cfg.warms === "any") {
    return hidden;
  }
  return [hidden.reduce((p, q) => (q.d < p.d ? q : p))];
}
let buzzCooldown = 0;
function stepHelp(dt) {
  const targets = helpTargets();
  const k = 1 - Math.exp(-dt / 0.2);
  // only one egg fills at a time: the faced one nearest the screen's middle
  let filling = null;
  for (const a of targets) {
    const was = a.inCone;
    a.inCone = a.ang <= (a.inCone ? cfg.cone * EXIT_CONE : cfg.cone);
    if (a.inCone && !was && cfg.buzz === "on" && buzzCooldown <= 0 && navigator.vibrate) {
      navigator.vibrate(25);
      buzzCooldown = 1.5;
    }
    if (a.inCone && (!filling || a.ang < filling.ang)) {
      filling = a;
    }
  }
  buzzCooldown -= dt;
  for (const a of A) {
    const isTarget = targets.includes(a);
    if (!isTarget) {
      a.inCone = false;
    }
    a.aw += ((isTarget ? smooth(cfg.warm, cfg.cone, a.ang) : 0) - a.aw) * k;
    a.cone += ((isTarget ? smooth(cfg.cone * EXIT_CONE, cfg.cone, a.ang) : 0) - a.cone) * k;
    if (!isHidden(a)) {
      continue;
    }
    if (a === filling) {
      a.gaze = Math.min(1, a.gaze + dt / cfg.gdwell);
      if (a.gaze >= 1) {
        found(a);
      }
    } else if (a.gaze > 0) {
      a.gaze = Math.max(0, a.gaze - dt / cfg.drain);
    }
  }
}

/* ================= the flights between the place and the box (quiz 4.1's flight) ================= */
const W = () => innerWidth;
const H = () => innerHeight;
const tmp = new THREE.Vector3();
function project(x, y, z) {
  tmp.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  const front = tmp.z < -0.3;
  tmp.set(x, y, z).project(camera);
  return { x: ((tmp.x + 1) / 2) * W(), y: ((1 - tmp.y) / 2) * H(), nx: tmp.x, ny: tmp.y, front };
}
// where an egg is on the screen; one out of view is placed beyond the edge it lies towards
function eggScreen(a) {
  const p = project(a.ex, a.ey + EGG_H * 0.6, a.ez);
  if (p.front) {
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
  const from = dir === "out" ? homeScreen(a) : eggScreen(a);
  a.where = dir;
  a.flight = { dir, t0: S.clock, dur: cfg.flight, from };
  a.flyEl.hidden = false;
  if (dir === "out" && S.held === a.i) {
    S.held = -1; // folding the box takes a choice in its grace back
  }
}
// a flight turned round half-way goes back from where it is now
function reverse(a) {
  const f = a.flight;
  const p = clamp((S.clock - f.t0) / f.dur, 0, 1);
  const dir = f.dir === "out" ? "in" : "out";
  a.where = dir;
  a.flight = { dir, t0: S.clock - (1 - p) * cfg.flight, dur: cfg.flight, from: null, reversed: true };
}
// open box: found eggs come home (newly found ones after opening); folded: they go back to their places
function schedule() {
  const open = boxOpen();
  for (const a of A) {
    if (a.flight && ((open && a.where === "out") || (!open && a.where === "in" && S.phase === "open"))) {
      reverse(a);
    }
  }
  for (const a of A) {
    if (a.where === "opening" && S.clock - a.openAt >= OPEN_S) {
      if (!open && S.phase === "open") {
        a.where = "world"; // folded: it stays open at its place, its dot fills in the folded box
      } else if (S.clock >= S.lastIn + cfg.stagger) {
        launch(a, "in");
        S.lastIn = S.clock;
      }
    }
  }
  if (open) {
    const away = A.filter((a) => a.where === "world").sort((p, q) => p.ang - q.ang);
    if (away.length && S.clock >= S.lastIn + cfg.stagger) {
      launch(away[0], "in");
      S.lastIn = S.clock;
    }
  } else if (S.phase === "open") {
    const home = A.filter((a) => a.where === "box").sort((p, q) => p.order - q.order);
    if (home.length && S.clock >= S.lastOut + cfg.stagger) {
      launch(home[0], "out");
      S.lastOut = S.clock;
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
      a.where = f.dir === "out" ? "world" : "box";
      if (f.dir === "in") {
        a.homeAt = S.clock;
      }
      continue;
    }
    const from = f.from || (f.dir === "out" ? homeScreen(a) : eggScreen(a));
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
    const a = A[hits[0].object.userData.answer];
    S.bubble = { i: a.i, text: isHidden(a) ? "Walk closer" : "Open the box to choose", until: S.clock + 2 };
    return;
  }
  const p = new THREE.Vector3();
  if (ray.ray.intersectPlane(groundPlane, p)) {
    jumpTo(p.x, p.z);
  }
}
// a tap on the ground jumps there; near a hidden egg it lands just outside the find radius, facing it
function jumpTo(px, pz) {
  let best = null;
  let bestD = Infinity;
  for (const a of A) {
    const d = Math.hypot(px - a.ex, pz - a.ez);
    if (isHidden(a) && d < bestD) {
      best = a;
      bestD = d;
    }
  }
  const outside = cfg.radius + 1.2;
  if (best && bestD < outside + 3) {
    let ux = px - best.ex;
    let uz = pz - best.ez;
    let len = Math.hypot(ux, uz);
    if (len < 0.3) {
      ux = V.x - best.ex;
      uz = V.z - best.ez;
      len = Math.hypot(ux, uz) || 1;
    }
    V.x = best.ex + (ux / len) * outside;
    V.z = best.ez + (uz / len) * outside;
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
});
addEventListener("keyup", (e) => V.keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => V.keys.clear());
function moveVisitor(dt) {
  const k = V.keys;
  const turn = (k.has("e") || k.has("arrowright") ? 1 : 0) - (k.has("q") || k.has("arrowleft") ? 1 : 0);
  V.yaw -= turn * 1.1 * dt;
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
  if (S.autoTurn) {
    const t = S.autoTurn;
    const diff = Math.atan2(Math.sin(t.yaw - V.yaw), Math.cos(t.yaw - V.yaw));
    const step = Math.min(Math.abs(diff), t.rate * dt);
    V.yaw += Math.sign(diff) * step;
    if (Math.abs(diff) < 1e-3) {
      S.autoTurn = null;
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
const cache = new Map();
function put(key, value, write) {
  if (cache.get(key) !== value) {
    cache.set(key, value);
    write(value);
  }
}
function chipState(a) {
  if (isHidden(a)) {
    return ["none", ""];
  }
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
  if (locked()) {
    return ["locked", "Needs the golden key"];
  }
  if (S.phase !== "open") {
    return ["home", ""];
  }
  return ["home", cost() > 0 ? `Tap to answer - ${cost()} points` : "Tap to answer"];
}
const KEY = '<i class="key" aria-hidden="true"></i>';
function hintHtml() {
  if (S.phase !== "open") {
    return "";
  }
  if (S.note && S.note.until > S.clock) {
    return escapeHtml(S.note.text);
  }
  if (S.held >= 0) {
    return "Chosen. It counts when the bar runs out; tap it again to take it back.";
  }
  const parts = [];
  if (hiddenCount() === 0) {
    parts.push("All found. Tap the one you think is right.");
  }
  // the creator's rules, said once and quietly, only where they apply
  if (cfg.key === "need") {
    parts.push(`${KEY}Answering needs the golden key. Finding the eggs still works.`);
  } else if (cfg.key === "have") {
    parts.push(`${KEY}Your golden key opens this question.`);
  }
  const left = triesLeft();
  if (left !== Infinity && (maxTries() > 1 || S.tries > 0)) {
    parts.push(left === 1 ? "One try left." : `${left} tries.`);
  } else if (left !== Infinity) {
    parts.push("One try.");
  }
  if (cost() > 0) {
    parts.push(`Each answer costs ${cost()} of your ${S.score} points.`);
  }
  return parts.join(" ");
}
function pillHtml() {
  if (S.phase === "open" && S.held >= 0) {
    const left = Math.max(0, cfg.grace - (S.clock - S.heldAt));
    return `<b>${escapeHtml(A[S.held].label)}</b> chosen (${Math.ceil(left)} s)`;
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
  put("handle", open ? "Hide" : "Show", (v) => (handleText.textContent = v));
  updateWords(dt);
  const showChips = S.phase === "open" || S.phase === "result";
  put("chipsShown", showChips, (v) => (chipsEl.hidden = !v));
  // the one slot for the eggs still hidden: it says how many, and a tap on it asks for help
  const n = hiddenCount();
  const slotKey = showChips && S.phase === "open" && n > 0 ? `${n}:${S.help}` : "";
  put("slot", slotKey, () => {
    slotEl.hidden = !slotKey;
    if (!slotKey) {
      return;
    }
    slotEl.classList.toggle("on", S.help);
    slotEl.style.flexGrow = String(Math.max(1, n));
    $("slotCount").textContent = n === 3 ? "3 hidden here" : `${n} still hidden`;
    $("slotAsk").textContent = S.help ? `${SPEAKER.name} helps - tap to stop` : `Stuck? Ask ${SPEAKER.name}`;
    $("slotIcon").setAttribute(
      "d",
      S.help ? "M12 3.5l1.9 6.6 6.6 1.9-6.6 1.9-1.9 6.6-1.9-6.6-6.6-1.9 6.6-1.9z" : "M9.2 9.2a2.9 2.9 0 1 1 4.1 2.6c-.8.4-1.3 1-1.3 1.9v.6M12 17.6v.2",
    );
    slotEl.setAttribute("aria-label", S.help ? `${n} still hidden. ${SPEAKER.name} is helping; tap to stop.` : `${n} still hidden. Tap to ask ${SPEAKER.name} for help.`);
  });
  for (const a of A) {
    const [state, small] = chipState(a);
    put(`cs${a.i}`, state, (v) => {
      a.chip.dataset.state = v;
      if (v !== "away" && v !== "none" && a.homeAt > S.clock - 0.1) {
        a.chip.classList.remove("pop");
        void a.chip.offsetWidth;
        a.chip.classList.add("pop");
      }
    });
    put(`co${a.i}`, a.order, (v) => (a.chip.style.order = String(1 + v)));
    put(`cm${a.i}`, small, (v) => (a.chipSmall.textContent = v));
    a.chip.disabled = !(S.phase === "open" && a.where === "box" && !a.crossed);
    const bar = S.held === a.i ? 1 - clamp((S.clock - S.heldAt) / cfg.grace, 0, 1) : 0;
    put(`cb${a.i}`, Math.round(bar * 200), (v) => (a.chipBar.style.width = `${v / 2}%`));
    // the folded box: a filled dot per found answer, a hollow ring per hidden one
    const dotState = S.phase === "open" || S.phase === "result" ? (isHidden(a) ? "hid" : "found") : "none";
    put(`d${a.i}`, `${dotState}:${a.order}`, () => {
      a.dot.style.display = dotState === "none" ? "none" : "";
      a.dot.className = dotState === "hid" ? "hid" : "";
      a.dot.style.order = String(isHidden(a) ? 9 : a.order);
    });
  }
  const hint = hintHtml();
  put("hint", hint, (v) => {
    hintEl.hidden = !v;
    hintEl.innerHTML = v;
  });
  put("ptext", pillHtml(), (v) => (ptext.innerHTML = v));
  // a word at an egg, placed above it on the screen
  const b = S.bubble && S.bubble.until > S.clock ? S.bubble : null;
  bubbleEl.hidden = !b;
  if (b) {
    const a = A[b.i];
    const p = project(a.ex, a.ey + EGG_H * 1.8, a.ez);
    put("bubble", b.text, (v) => (bubbleEl.textContent = v));
    bubbleEl.style.setProperty("--hue", a.hue);
    bubbleEl.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -100%)`;
  }
}

/* ================= the eggs in the world, every frame ================= */
function updateWorld(t, dt) {
  const k = 1 - Math.exp(-dt / 0.18);
  const hunting = S.phase === "ask" || S.phase === "open";
  animateRisingSparks(stationSparks, t, 6);
  for (const a of A) {
    const hidden = isHidden(a);
    const opening = a.where === "opening";
    const resting = a.where === "world";
    // the egg itself: shown close by, or, with help on, faintly inside the cone and fuller as it fills
    const seen = hidden ? smooth(cfg.radius + SEEN_EXTRA, cfg.radius + 0.3, a.d) : 1;
    const faced = hidden ? a.cone * (0.35 + 0.65 * a.gaze) : 0;
    const visT = hidden ? (hunting ? Math.max(seen, faced) : 0) : opening || resting ? 1 : 0;
    a.view.vis += (visT - a.view.vis) * k;
    a.group.visible = a.view.vis > 0.01;
    a.mat.opacity = a.view.vis;
    a.view.open += ((opening || resting ? 1 : 0) - a.view.open) * (1 - Math.exp(-dt / 0.12));
    const openP = opening ? clamp((S.clock - a.openAt) / OPEN_S, 0, 1) : 0;
    a.view.pop = opening ? Math.sin(Math.PI * Math.min(1, openP * 1.4)) : 0;
    // a faced egg far away keeps the on-screen size it would have at SIZE_AT metres
    const keepSize = 1 + (Math.max(1, a.d / SIZE_AT) - 1) * (hidden ? a.cone : 0);
    a.pivot.scale.setScalar(keepSize * (1 + 0.35 * a.view.pop + (resting ? 0.3 : 0)));
    a.group.position.set(a.ex, a.ey + (resting ? 0.25 + 0.04 * Math.sin(t * 1.5 + a.i) : 0), a.ez);
    a.pivot.rotation.set(0, Math.atan2(V.x - a.ex, V.z - a.ez) + (hidden ? Math.sin(t * 1.3 + a.i) * 0.25 : 0), 0);
    a.lid.position.set(0, CRACK * EGG_H + a.view.open * 0.14, -a.view.open * 0.06);
    a.lid.rotation.x = -a.view.open * 0.8;
    a.mat.color.set(a.hue).multiplyScalar(1 - 0.5 * a.gaze);
    a.mat.emissive.set(a.hue).multiplyScalar(0.22 + 0.3 * a.aw + 0.5 * a.view.pop);
    a.shell.visible = hidden && a.gaze > 0.01;
    a.fillMat.uniforms.level.value = a.gaze;
    a.fillMat.uniforms.time.value = t;
    a.pool.material.opacity += ((resting ? 0.4 : 0) - a.pool.material.opacity) * k;

    // the glitter: distance-warm always (the find-first page); with help on, angle-warm as well
    const tease = hunting && hidden;
    const distWarm = tease ? smooth(TEASE_FAR, cfg.radius, a.d) : 0;
    const warm = Math.max(distWarm, tease ? a.aw : 0);
    let period = cfg.gslow + (cfg.gfast - cfg.gslow) * warm;
    if (a.inCone) {
      period = Math.min(period, GLINT_HINT);
    }
    const at = (t + a.i * 1.37) % period;
    const glint = tease && at < GLINT_LEN ? Math.sin((Math.PI * at) / GLINT_LEN) : 0;
    const top = a.ey + (EGG_H + 0.12) * keepSize;
    a.glint.position.set(a.ex, top, a.ez);
    a.glint.scale.setScalar(GLINT_SIZE * (1 + 0.6 * a.aw) * Math.max(1, keepSize * 0.8));
    a.glint.material.opacity = glint * (0.55 + 0.45 * warm);
    a.glint.visible = a.glint.material.opacity > 0.003;
    // sparks orbit and rise; facing the egg they climb higher and show brighter; a find bursts upwards
    const burst = opening ? 1 - openP : 0;
    const riseH = 0.7 + 2.3 * a.aw + 1.6 * burst;
    const ringR = 0.26 * Math.max(1, keepSize * 0.8);
    for (let j = 0; j < SPARKS; j++) {
      const ang = t * 0.9 + (j * Math.PI * 2) / SPARKS + a.i;
      const r = ringR + 0.08 * Math.sin(t * 1.3 + j);
      const rise = (j * 0.37 + t * (0.22 + 0.2 * a.aw)) % 1;
      a.sparkPos[j * 3] = a.ex + Math.cos(ang) * r;
      a.sparkPos[j * 3 + 1] = a.ey + 0.05 + rise * riseH;
      a.sparkPos[j * 3 + 2] = a.ez + Math.sin(ang) * r;
      const twinkle = 0.3 + 0.7 * Math.max(0, Math.sin(t * 5 + j * 1.9));
      const glow = tease ? Math.max(distWarm * distWarm, a.aw * (0.45 + 0.55 * a.aw)) : burst;
      a.sparkCol[j * 4] = a.sparkCol[j * 4 + 1] = a.sparkCol[j * 4 + 2] = 1;
      a.sparkCol[j * 4 + 3] = glow * twinkle * (1 - rise * 0.6);
    }
    a.sparks.geometry.attributes.position.needsUpdate = true;
    a.sparks.geometry.attributes.color.needsUpdate = true;
    a.sparks.visible = tease || opening;
    a.sparks.material.size = SPARK_SIZE * Math.max(1, keepSize * 0.7);
    // the short pale pillar, inside the cone only; it never stays once the egg is collected
    const u = a.pillar.material.uniforms;
    u.uGlow.value = hidden && cfg.beam > 0 ? a.cone * (0.55 + 0.45 * a.gaze) : 0;
    a.pillar.visible = u.uGlow.value > 0.004;
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
  update(dt);
  updateWorld(S.clock, dt);
  renderHud(dt);
  renderer.render(scene, camera);
  if (now - meterAt > 400) {
    meterAt = now;
    const info = renderer.info.render;
    const tgt = helpTargets()[0];
    const help = S.help && tgt ? `\n${tgt.label.replace("The ", "")} ${tgt.ang.toFixed(0)} deg  fill ${(tgt.gaze * 100).toFixed(0)} %` : "";
    meter.textContent = `${frameMs.toFixed(1)} ms\n${info.calls} calls  ${(info.triangles / 1000).toFixed(1)}k tris${help}`;
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
function openHunt() {
  S.phase = "open";
  setNarration("question", TEXT.question, false, true);
}
function inBox(i) {
  const a = A[i];
  a.where = "box";
  a.order = S.foundCount++;
  a.homeAt = -99;
}
// stand `dist` metres short of an egg, on the line from the start, facing it turned by `offDeg`
function standBy(i, dist, offDeg = 0) {
  const a = A[i];
  const len = Math.hypot(a.ex, a.ez);
  placeAt(a.ex - (a.ex / len) * dist, a.ez - (a.ez / len) * dist, 0);
  V.yaw = yawTo(a.ex, a.ez) + offDeg * DEG;
}
const HELP_SPOT = [0, -5.5]; // between the fountain and the other two: the tree is the nearest hidden egg
function helpOn(offDeg) {
  openHunt();
  inBox(0);
  placeAt(HELP_SPOT[0], HELP_SPOT[1], 0);
  V.yaw = yawTo(A[1].ex, A[1].ez) + offDeg * DEG;
  S.help = true;
}
const BEATS = {
  "lead-in": () => {},
  hunt: () => {
    openHunt();
    simulate(0.6);
  },
  "found-walk": () => {
    openHunt();
    standBy(0, 4.2);
    S.autoWalk = { x: V.x + (A[0].ex - V.x) * 0.8, z: V.z + (A[0].ez - V.z) * 0.8 };
  },
  "shortcut-choose": () => {
    openHunt();
    inBox(0);
    standBy(0, 2.6);
    simulate(0.2);
    tapChip(0);
    simulate(0.6);
  },
  "help-ask": () => {
    openHunt();
    inBox(0);
    placeAt(HELP_SPOT[0], HELP_SPOT[1], 0);
    simulate(0.2);
    tapSlot();
    simulate(1.6);
  },
  "help-on": () => {
    helpOn(-34);
    simulate(1);
    S.autoTurn = { yaw: yawTo(A[1].ex, A[1].ez) - 14 * DEG, rate: 0.35 };
  },
  "gaze-collect": () => {
    helpOn(-3);
    A[1].gaze = 0.55;
    simulate(0.5);
  },
  "gaze-away": () => {
    helpOn(-3);
    // part-filled, then turned away past the exit cone before it is full: it drains again
    A[1].gaze = 0.6;
    simulate(0.2);
    S.autoTurn = { yaw: yawTo(A[1].ex, A[1].ez) - 32 * DEG, rate: 1.4 };
  },
  "all-found": () => {
    openHunt();
    inBox(0);
    inBox(2);
    inBox(1);
    simulate(0.3);
  },
  choose: () => {
    BEATS["all-found"]();
    tapChip(0);
    simulate(0.7);
  },
  wrong: () => {
    BEATS["all-found"]();
    tapChip(1);
    simulate(0.2);
    commit();
    simulate(1.2);
  },
  right: () => {
    BEATS["all-found"]();
    tapChip(0);
    simulate(0.2);
    commit();
    simulate(1.4);
  },
};
function runBeat(name) {
  freshState();
  for (const a of A) {
    a.view.open = 0;
    a.view.vis = 0;
    a.view.pop = 0;
    a.flyEl.hidden = true;
  }
  S.autoTurn = null;
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
  for (const c of CREATOR) {
    q.set(c.key, cfg[c.key]);
  }
  q.set("hue", cfg.hue.slice(1));
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
$("creatorBtn").addEventListener("click", () => {
  $("panel").hidden = false;
  $("creatorHead").scrollIntoView({ block: "start" });
});
$("panelClose").addEventListener("click", () => ($("panel").hidden = true));

// what the visitor sees under each creator setting, said next to the control
function sees(key) {
  const v = cfg[key];
  if (key === "attempts") {
    return v === "1"
      ? "The box says \"One try.\" A wrong answer ends the question: Mara gives the right one, no points."
      : v === "2"
        ? "The box says \"2 tries.\", then \"One try left.\" A wrong answer is struck through and Mara says so; the right one after a retry gives half the points."
        : "No count in the box. A wrong answer is struck through, \"Try another\"; the right one after a retry gives half the points.";
  }
  if (key === "cost") {
    return v === "0"
      ? "Nothing about points until the result."
      : `Each found answer reads "Tap to answer - ${v} points"; the box says "Each answer costs ${v} of your ${S.score} points." The result line says what was paid.`;
  }
  if (key === "key") {
    return v === "off"
      ? "Nothing about a key."
      : v === "need"
        ? "The hunt works as always, but found answers read \"Needs the golden key\" with a small gold key, and a tap says why. The box says so once, quietly."
        : "The box says \"Your golden key opens this question.\" with a small gold key; otherwise as with no prerequisite.";
  }
  if (key === "warms") {
    return v === "nearest"
      ? "With help on, only the nearest hidden egg answers to the turn: one clear target, like the brief's \"you are looking the right way\"."
      : "With help on, every hidden egg answers to the turn; the one nearest the middle of the view fills. A slow turn on the spot finds them all.";
  }
  return v === "on" ? "One short buzz when a helped egg enters the cone (Android Chrome only, at most every 1.5 s). Nothing on screen." : "No buzz.";
}
const creatorEl = $("creator");
for (const c of CREATOR) {
  const seg = document.createElement("div");
  seg.className = "seg";
  seg.setAttribute("role", "group");
  const title = document.createElement("span");
  title.textContent = c.label;
  seg.append(title);
  const note = document.createElement("p");
  note.className = "sees";
  for (const [value, text] of c.options) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.setAttribute("aria-pressed", String(cfg[c.key] === value));
    b.addEventListener("click", () => {
      cfg[c.key] = value;
      for (const other of seg.querySelectorAll("button")) {
        other.setAttribute("aria-pressed", String(other === b));
      }
      note.textContent = sees(c.key);
      saveUrl();
    });
    seg.append(b);
  }
  note.textContent = sees(c.key);
  creatorEl.append(seg, note);
}

const slidersEl = $("sliders");
for (const [key, label, lo, hi, step, unit] of SLIDERS) {
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
    if (key === "beam") {
      for (const a of A) {
        setPillarHeight(a.pillar, cfg.beam);
      }
    }
    if (key === "fade") {
      for (const m of [stationPillar, ...A.map((a) => a.pillar)]) {
        m.material.uniforms.uFade.value = cfg.fade;
      }
    }
    show();
    saveUrl();
  });
  show();
  slidersEl.append(l);
}
{
  const l = document.createElement("label");
  l.innerHTML = `<span>Hint colour (the pillar)</span><output></output><input type="color" />`;
  const input = l.querySelector("input");
  const out = l.querySelector("output");
  input.value = cfg.hue;
  out.textContent = cfg.hue;
  input.addEventListener("input", () => {
    cfg.hue = input.value;
    out.textContent = cfg.hue;
    document.documentElement.style.setProperty("--help", cfg.hue);
    for (const a of A) {
      a.pillar.material.uniforms.uColor.value.set(cfg.hue);
    }
    saveUrl();
  });
  slidersEl.append(l);
}
document.documentElement.style.setProperty("--help", cfg.hue);

resize();
runBeat(params.get("beat") || "lead-in");
requestAnimationFrame(frame);
// a hook for the page's checks: read-only state, nothing drives the page through it
window.__quiz = { S, A, V, N, cfg, runBeat, tapChip, tapSlot, hiddenCount };
