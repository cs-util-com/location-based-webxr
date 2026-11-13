// Stand in the light: the answers are hidden around the station as in "find them, then go back",
// and once all are found the question rises as a sign in the middle of the station while each
// found answer becomes a tall soft pillar of light, seen from across the square. The visitor
// answers by standing in the pillar of the one they think is right: the light pours down from the
// top until the pillar is full, and then the answer locks in. Stepping out before it is full
// drains it again. The card keeps only a tiny glyph; the sign and the pillars carry the rest.
// Throwaway; not wired to the app.
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  ShaderMaterial,
  Vector2,
} from "three";

const NAME = "light-pillars";
const FONT = 'Corbel, "Noto Sans", system-ui, sans-serif';

/* ---------- what the feel rests on: tune here, or with the sliders on the card ---------- */
const RADIUS_DEFAULT = 1.5; // metres: found when the measured position comes this close
const RADIUS_MIN = 0.5;
const RADIUS_MAX = 5;
const HINT_DEFAULT = 25; // seconds without a find before the arrow comes
const HINT_MIN = 5;
const HINT_MAX = 90;
const ZONE_DEFAULT = 1.5; // metres: a pillar's radius, the place to stand in
const ZONE_MIN = 1;
const ZONE_MAX = 2.5;
// The edge has a band, so jitter there neither starts nor cancels: the light starts to pour only
// once the measured position is this far inside the visible edge ...
const ZONE_IN = 0.25;
// ... and lets go only once it is this far outside it.
const ZONE_OUT = 0.5;
const SWITCH_MARGIN = 1; // metres closer another pillar must be to take over
// Seconds of standing in the light before the answer locks in. Walking straight through a 1.5 m
// pillar at 1.4 m/s takes about 2 s, so passing through one on the way to another drains away
// unlocked; a tracking wander (time constant about 1.2 s) would have to hold the measured position
// inside for more than three of its time constants; and 4 s still reads as a decision, not a wait.
const DWELL_DEFAULT = 4;
const DWELL_MIN = 2;
const DWELL_MAX = 8;
const DRAIN_S = 1.5; // seconds a full pillar takes to drain after stepping out
// Seconds a locked answer waits before it counts: stepping out of the light (or Undo on the card)
// in this time takes it back quietly.
const GRACE_DEFAULT = 3;
const GRACE_MAX = 8;
const LIST_FILL_S = 1.2; // seconds the light pours for an answer chosen on the card
const RETRY_SHOW = 4; // seconds the sign says "not that one"
const FLARE_S = 0.9; // seconds the lock-in flash lasts
const RISE_TAU = 0.45; // seconds: the sign and the pillars rise when the choice opens
const PILLAR_H = 7; // metres
const MOTES = 10; // falling motes per pillar, all in one draw
const MOTE_SIZE = 0.16;
const SIGN_Y = 3.1; // metres: the middle of the sign, over the heads
const SIGN_W = 3.2;
const SIGN_H = 1.6;
const SIGN_PX_W = 640;
const SIGN_PX_H = 320;
const SIGN_TRACK = 22; // pixels from the bottom: the middle of the sign's bar
const SIGN_MARGIN = 30; // pixels: the bar's left and right inset
const BAR_H = 0.06;
const SIGN_TURN_TAU = 0.35;
const APART_MIN = 5; // metres: pillars closer than this turn red in edit
const DWELL = 0.25; // seconds inside the found radius, so a jitter spike cannot find
const SEEN_EXTRA = 3; // metres past the found radius where the egg itself starts to show
const TEASE_FAR = 16; // metres: inside this the shimmer grows
const GLINT_SLOW = 4.5; // seconds between glints, far away
const GLINT_FAST = 0.9; // seconds between glints, at the egg
const GLINT_HINT = 0.6; // the hinted egg glints this often
const GLINT_LEN = 0.35; // seconds one glint lasts
const SPARKS = 8; // shimmer sparks per egg
const GLINT_SIZE = 0.5; // metres, a point sprite
const SPARK_SIZE = 0.17;
const EGG_H = 0.32;
const EGG_R = 0.11;
const CRACK = 0.56; // where it opens, as a share of its height
const LABEL_W = 0.96;
const LABEL_H = 0.63;
const LABEL_GAP = 0.42; // metres between the egg's top and the label's foot
const LABEL_FULL = 2.5; // metres: closer than this the label shrinks with the distance
const LABEL_MIN = 0.45;
// metres above the ground: the middle of the label of the pillar the visitor stands in, its foot
// at the eye, so the story card, which takes the lower part of the view, never covers it
const LABEL_EYE = 1.95;
const ARROW_AHEAD = 2.6; // metres ahead of the eye
const ARROW_Y = 1.72; // metres: at the eye, above where the story card covers a portrait view
const ARROW_SCALE = 0.45;
const ARROW_NEAR = 3; // metres: closer than this to the egg, the arrow gives way to the egg itself
const JITTER_TAU = 1.2; // seconds: tracking wander is slow, not white
const JITTER_DEFAULT = 0.1; // metres, 9 in 10 within
const P90 = 2.146; // a 2D normal's 90th-percentile radius in units of its per-axis sigma
const RING_ROOM = 11; // the station's ring is 12 m: a hiding place keeps a metre to spare
const LIFT_MAX = 2.5;
const EASE_TAU = 0.18;

const HUES = ["#fbbf24", "#7dd3fc", "#fda4af", "#c4b5fd"];
const RIGHT = "#2dd4bf";
const WRONG = "#f87171";
const PICK = "#fb923c";
const INK = "#1c2128";
const PAPER = "#fbf8f0";
const COUNT = ["", "One", "Two", "Three", "Four"];

const SAYS = {
  right: "Yes, that is the one.",
  retry: "Not that one. Have another think, and stand in another light.",
  wrong: "No, that was not it.",
};

const WHY = {
  for: "Finding walks the visitor to each thing once; choosing asks them to go back and stand at one of them, so the answer is given at the thing it names rather than on a list. The pillars are the way back: seen from anywhere on the square, they need no list or arrow on the screen, and the light pouring down while they stand is the confirmation, in the place rather than in a dialog.",
  against:
    "Standing still for seconds is slow, and in a crowd or a narrow street a visitor may not be able to hold a spot. Light pillars are a strong look that may clash with the place, and in bright daylight on a camera image they may wash out. A choice by position needs the answers well apart, at least 5 m, which a small station may not have, and the sign and the light give no help to someone who cannot see them, so the card must still carry the whole question.",
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const rgba = (hex, a) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/* ---------- what lasts beyond one open ---------- */
// "Ten rounds" closes and opens the world within one visit, back to back in the same task; a
// Restart, a sample or an edit opens it later or with another record. So a world opened right after
// a dispose, for the same record, continues the visit, and anything else starts the search again.
const memory = {
  key: "",
  found: [], // indices, in the order found
  shown: new Set(), // found by "Show me the rest", not by walking
  crossed: new Set(), // chosen and wrong
  tries: 0,
  result: null, // null | "right" | "wrong"
  chosen: -1,
  earned: 0,
  wait: 0, // seconds since the last find
  hinted: false, // the first hint has come, so the way out is offered
};
let reopening = false;

// The sliders on the card: a page-long test aid, not part of the record. Radius, hint, pillar
// radius and dwell start from the record whenever it changes.
const tune = {
  key: "",
  radius: RADIUS_DEFAULT,
  hintAfter: HINT_DEFAULT,
  zone: ZONE_DEFAULT,
  dwell: DWELL_DEFAULT,
  grace: GRACE_DEFAULT,
  jitter: JITTER_DEFAULT,
  offset: 0, // metres the whole station is placed off, as an AR alignment error
  angle: 0.9,
  overlay: false,
};

function startVisit(key) {
  memory.key = key;
  memory.found = [];
  memory.shown = new Set();
  memory.crossed = new Set();
  memory.tries = 0;
  memory.result = null;
  memory.chosen = -1;
  memory.earned = 0;
  memory.wait = 0;
  memory.hinted = false;
}

/* ---------- geometry ---------- */
function soup(pos, col) {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 4));
  return g;
}

function pushTri(pos, col, tint, ax, az, bx, bz, cx, cz) {
  pos.push(ax, 0, az, bx, 0, bz, cx, 0, cz);
  for (let i = 0; i < 3; i++) col.push(tint[0], tint[1], tint[2], tint[3]);
}

// A flat bar from (ax, az) to (bx, bz), w metres wide, on the ground.
function pushBar(pos, col, tint, ax, az, bx, bz, w) {
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const sx = (-(bz - az) / len) * w;
  const sz = ((bx - ax) / len) * w;
  pushTri(pos, col, tint, ax + sx, az + sz, bx - sx, bz - sz, bx + sx, bz + sz);
  pushTri(pos, col, tint, ax + sx, az + sz, ax - sx, az - sz, bx - sx, bz - sz);
}

// Three chevrons pointing up (+y), facing +z: a dark edge under a light face, so they read on a
// pale sky, on paving and on a camera image.
function arrowGeometry() {
  const pos = [];
  const col = [];
  const dark = [0.07, 0.09, 0.11, 0.6];
  const light = [1, 0.83, 0.57, 0.95];
  for (const [tint, w] of [
    [dark, 0.075],
    [light, 0.045],
  ]) {
    for (let k = 0; k < 3; k++) {
      const z = k * 0.42;
      pushBar(pos, col, tint, -0.3, z - 0.22, 0, z + 0.1, w);
      pushBar(pos, col, tint, 0.3, z - 0.22, 0, z + 0.1, w);
    }
  }
  return soup(pos, col).rotateX(-Math.PI / 2);
}

// Flat rings on the ground, radius 1 and scaled: each band is [inner, outer, tint].
function bandsGeometry(bands, segments) {
  const pos = [];
  const col = [];
  for (const [a, b, tint] of bands) {
    const g = new RingGeometry(a, b, segments)
      .rotateX(-Math.PI / 2)
      .toNonIndexed();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), 0, p.getZ(i));
      col.push(tint[0], tint[1], tint[2], tint[3]);
    }
    g.dispose();
  }
  return soup(pos, col);
}

// The found radius: a faint fill and a bright rim.
const discGeometry = () =>
  bandsGeometry(
    [
      [0, 0.93, [1, 1, 1, 0.2]],
      [0.93, 1, [1, 1, 1, 0.95]],
    ],
    56,
  );

// Small crosses where the creator meant the eggs to be, for the "what the phone measures" view.
function marksGeometry(spots) {
  const pos = [];
  const col = [];
  const dark = [0.07, 0.09, 0.11, 0.75];
  const light = [1, 1, 1, 0.95];
  for (const s of spots) {
    for (const [tint, w] of [
      [dark, 0.06],
      [light, 0.03],
    ]) {
      pushBar(
        pos,
        col,
        tint,
        s.x - 0.25,
        s.z - 0.25,
        s.x + 0.25,
        s.z + 0.25,
        w,
      );
      pushBar(
        pos,
        col,
        tint,
        s.x - 0.25,
        s.z + 0.25,
        s.x + 0.25,
        s.z - 0.25,
        w,
      );
    }
  }
  return soup(pos, col);
}

// The egg's outline at height share f: round at both ends, fuller below the middle.
const eggRadius = (f) =>
  EGG_R * Math.pow(Math.sin(Math.PI * f), 0.75) * (1.08 - 0.22 * f);

// One half of a painted egg, from height share a to b, its foot at y = 0.
function eggHalf(hue, a, b) {
  const steps = 10;
  const points = [];
  for (let k = 0; k <= steps; k++) {
    const f = a + ((b - a) * k) / steps;
    points.push(new Vector2(Math.max(0.0005, eggRadius(f)), (f - a) * EGG_H));
  }
  const g = new LatheGeometry(points, 16);
  const p = g.attributes.position;
  const tint = rgba(hue, 1);
  const col = [];
  for (let i = 0; i < p.count; i++) {
    const f = a + p.getY(i) / EGG_H;
    // two white bands, one of them just under the crack
    const band = (f > 0.3 && f < 0.37) || (f > 0.66 && f < 0.72);
    if (band) col.push(1, 1, 1);
    else col.push(tint[0], tint[1], tint[2]);
  }
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  return g;
}

/* ---------- the pillar: one open cylinder and one small shader per answer ---------- */
// uv.y runs from the foot (0) to the top (1). The light is denser where the view meets the shell
// face on, so the column looks full in the middle and soft at its sides; the poured part reaches
// down from the top to 1 - fill, with a bright front where it is pouring; a bright line marks where
// the pillar stands on the ground, the edge to step over. Close to the eye it fades, so standing
// inside never fills the view with light, while looking up shows it pouring down from above.
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
uniform float uFill;
uniform float uGlow;
uniform float uFlare;
uniform float uTime;
varying vec2 vUv;
varying float vFace;
varying float vNear;
void main() {
  float y = vUv.y;
  float core = pow(vFace, 1.4);
  float body = smoothstep(0.0, 0.03, y) * (1.0 - smoothstep(0.55, 1.0, y));
  float front = 1.0 - uFill;
  float pouring = step(0.002, uFill);
  float poured = pouring * smoothstep(front - 0.012, front + 0.012, y) * (1.0 - smoothstep(0.93, 1.0, y));
  float streak = 0.7 + 0.3 * sin(vUv.x * 62.8319 + y * 14.0 + uTime * 5.0);
  float band = pouring * (1.0 - step(0.999, uFill)) * exp(-pow((y - front) * 34.0, 2.0));
  float rim = exp(-y * 90.0);
  float a = 0.36 * body * core
    + poured * 0.42 * core * streak
    + band * 0.85
    + rim * 0.75
    + uFlare * 0.55 * core * (1.0 - smoothstep(0.6, 1.0, y));
  a *= uGlow * smoothstep(0.2, 2.6, vNear);
  vec3 c = mix(uColor, vec3(1.0), 0.35 * poured + 0.6 * band + 0.5 * uFlare);
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
}`;

function pillarMaterial(hue) {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(hue) },
      uFill: { value: 0 },
      uGlow: { value: 0 },
      uFlare: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: PILLAR_VERT,
    fragmentShader: PILLAR_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/* ---------- the labels: one atlas, a cell per answer ---------- */
const ATLAS = 512;
const CELL_W = 256;
const CELL_H = 168;

function labelGeometry(index) {
  const g = new PlaneGeometry(LABEL_W, LABEL_H);
  const uv = g.attributes.uv;
  const col = index % 2;
  const row = index >> 1;
  const inset = 2;
  for (let i = 0; i < uv.count; i++) {
    const px = col * CELL_W + inset + uv.getX(i) * (CELL_W - inset * 2);
    const py = row * CELL_H + inset + (1 - uv.getY(i)) * (CELL_H - inset * 2);
    uv.setXY(i, px / ATLAS, 1 - py / ATLAS);
  }
  return g;
}

function wrapLines(g, text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function fitText(g, text, width, height, sizes, weight) {
  for (const size of sizes) {
    g.font = `${weight} ${size}px ${FONT}`;
    const lines = wrapLines(g, text, width);
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (lines.length * size * 1.15 <= height && widest <= width)
      return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  g.font = `${weight} ${size}px ${FONT}`;
  const room = Math.max(1, Math.floor(height / (size * 1.15)));
  return { size, lines: wrapLines(g, text, width).slice(0, room) };
}

const PLATE = {
  found: { band: null, paper: PAPER, ink: INK, word: "Found", edge: null },
  shown: { band: "#9aa3ab", paper: PAPER, ink: INK, word: "Shown", edge: null },
  near: {
    band: null,
    paper: PAPER,
    ink: INK,
    word: "Stay to choose",
    edge: "#ffffff",
  },
  away: {
    band: "#9aa3ab",
    paper: PAPER,
    ink: INK,
    word: "Step out, then in",
    edge: null,
  },
  locked: {
    band: PICK,
    paper: PAPER,
    ink: INK,
    word: "Your answer",
    edge: PICK,
  },
  edit: { band: null, paper: PAPER, ink: INK, word: "Hidden here", edge: null },
  right: {
    band: RIGHT,
    paper: "#d7fbf4",
    ink: "#04201c",
    word: "Right",
    edge: null,
  },
  wrong: {
    band: WRONG,
    paper: "#d9dcdf",
    ink: "#4d545b",
    word: "Not this",
    edge: null,
  },
  other: {
    band: "#aab1b8",
    paper: "#d9dcdf",
    ink: "#4d545b",
    word: "",
    edge: null,
  },
};

function drawTick(g, x, y, s) {
  g.strokeStyle = INK;
  g.lineWidth = s * 0.22;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(x - s * 0.5, y + s * 0.05);
  g.lineTo(x - s * 0.12, y + s * 0.42);
  g.lineTo(x + s * 0.5, y - s * 0.4);
  g.stroke();
}

function drawCell(g, option, hue, look, tick) {
  const plate = PLATE[look];
  const band = 36;
  g.fillStyle = plate.paper;
  g.beginPath();
  g.roundRect(0, 0, CELL_W, CELL_H, 16);
  g.fill();
  g.save();
  g.beginPath();
  g.roundRect(0, 0, CELL_W, CELL_H, 16);
  g.clip();
  g.fillStyle = plate.band ?? hue;
  g.fillRect(0, 0, CELL_W, band);
  g.restore();
  g.fillStyle = INK;
  g.font = `700 20px ${FONT}`;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(plate.word, 14, band / 2 + 1, CELL_W - 70);
  if (tick) drawTick(g, CELL_W - 26, band / 2, 22);

  const width = CELL_W - 24;
  const head = fitText(
    g,
    option.label,
    width,
    option.clue ? 64 : 112,
    [32, 28, 24, 20, 17],
    700,
  );
  g.fillStyle = plate.ink;
  g.textAlign = "center";
  g.font = `700 ${head.size}px ${FONT}`;
  let y = band + 10 + (head.size * 1.15) / 2;
  for (const l of head.lines) {
    g.fillText(l, CELL_W / 2, y, width);
    y += head.size * 1.15;
  }
  if (option.clue) {
    const room = CELL_H - (y - (head.size * 1.15) / 2) - 8;
    const clue = fitText(g, option.clue, width, room, [19, 17, 15, 13], 500);
    g.globalAlpha = 0.78;
    g.font = `500 ${clue.size}px ${FONT}`;
    y += 2 - (head.size * 1.15) / 2 + (clue.size * 1.15) / 2;
    for (const l of clue.lines) {
      g.fillText(l, CELL_W / 2, y, width);
      y += clue.size * 1.15;
    }
    g.globalAlpha = 1;
  }
  if (plate.edge) {
    g.strokeStyle = plate.edge;
    g.lineWidth = 8;
    g.beginPath();
    g.roundRect(4, 4, CELL_W - 8, CELL_H - 8, 13);
    g.stroke();
  }
}

/* ---------- the sign: the question, then what is happening, then the result ---------- */
// One opaque plate, painted again only when its words change; the moving bar is a mesh over it.
function drawSign(g, w, h, view) {
  const band = 50;
  g.clearRect(0, 0, w, h);
  g.fillStyle = view.paper;
  g.beginPath();
  g.roundRect(0, 0, w, h, 26);
  g.fill();
  g.save();
  g.beginPath();
  g.roundRect(0, 0, w, h, 26);
  g.clip();
  g.fillStyle = view.band;
  g.fillRect(0, 0, w, band);
  g.restore();
  g.fillStyle = view.bandInk;
  g.font = `700 25px ${FONT}`;
  g.textAlign = "left";
  g.textBaseline = "middle";
  const word = fitText(g, view.word, w - 48, band, [25, 22, 19], 700);
  g.font = `700 ${word.size}px ${FONT}`;
  g.fillText(word.lines[0] ?? "", 24, band / 2 + 1, w - 48);

  const width = w - 56;
  const footH = view.foot ? 34 : 0;
  const track = view.track ? 30 : 0;
  const room = h - band - 16 - footH - track - 10;
  const main = fitText(
    g,
    view.main,
    width,
    room,
    view.big ? [60, 52, 44, 38, 32, 28] : [42, 38, 34, 30, 27, 24, 21, 19],
    700,
  );
  g.fillStyle = view.ink;
  g.textAlign = "center";
  g.font = `700 ${main.size}px ${FONT}`;
  const lineH = main.size * 1.15;
  let y = band + 8 + (room - main.lines.length * lineH) / 2 + lineH / 2;
  for (const l of main.lines) {
    g.fillText(l, w / 2, y, width);
    y += lineH;
  }
  if (view.foot) {
    g.globalAlpha = 0.75;
    const foot = fitText(g, view.foot, width, 30, [23, 20, 18, 16], 600);
    g.font = `600 ${foot.size}px ${FONT}`;
    g.fillText(foot.lines[0] ?? "", w / 2, h - track - footH / 2 - 6, width);
    g.globalAlpha = 1;
  }
  if (view.track) {
    g.fillStyle = "rgb(28 33 40 / 16%)";
    g.beginPath();
    g.roundRect(SIGN_MARGIN, h - SIGN_TRACK - 6, w - SIGN_MARGIN * 2, 12, 6);
    g.fill();
  }
}

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

/* ---------- where an answer without a hiding place goes: beside the place's nearest things ---------- */
const FALLBACK_ANCHORS = [
  "bench",
  "fountain",
  "statue",
  "tree",
  "gate",
  "hall",
];

function insideRing(x, z) {
  const d = Math.hypot(x, z);
  if (d <= RING_ROOM) return { x, z };
  return { x: (x / d) * RING_ROOM, z: (z / d) * RING_ROOM };
}

function fallbackSpot(i, anchors) {
  const a = anchors[FALLBACK_ANCHORS[i % FALLBACK_ANCHORS.length]];
  if (!a) return insideRing(Math.sin(i * 1.7) * 6, Math.cos(i * 1.7) * 6);
  const d = Math.hypot(a.x, a.z) || 1;
  const step = Math.min(1.5, d); // a step towards the station, so it sits beside the thing
  return insideRing(a.x - (a.x / d) * step, a.z - (a.z / d) * step);
}

// Pairs of answers closer than APART_MIN: a visitor standing at one could be read at the other.
function crowdedPairs(spots, labels) {
  const pairs = [];
  for (let i = 0; i < spots.length; i++)
    for (let j = i + 1; j < spots.length; j++) {
      const d = Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z);
      if (d < APART_MIN) pairs.push({ a: labels[i], b: labels[j], d });
    }
  return pairs;
}

/* ---------- the visit: what the world part and the card share, per open ---------- */
const sessions = new WeakMap();

function makeSession(block, env, spots) {
  const n = block.options.length;
  const s = {
    n,
    spots,
    outside: false,
    skipped: false,
    closed: false,
    hinting: false, // the search arrow is up now
    target: -1, // the nearest egg not yet found
    at: -1, // the pillar the visitor stands in, by the measured position, with hysteresis
    armed: new Uint8Array(n), // 0 while the visitor still stands where the choice found them
    choosing: false, // the choice has opened in this world
    fill: new Float64Array(n), // 0..1, the light poured into each pillar
    fall: new Float64Array(n), // the motes' phase per pillar
    locked: -1, // full: waiting out the grace before it counts
    lockAt: 0,
    byList: -1, // chosen on the card, without walking: pours by itself
    lockedByList: -1, // the lock came from the card, so only Undo takes it back
    flare: -1,
    flareAt: 0,
    retryUntil: 0,
    listOpen: false,
    dist: new Float64Array(n), // true horizontal metres, viewer to egg
    measured: new Float64Array(n), // the same from the measured position
    dwell: new Float64Array(n),
    vx: 0, // the viewer in the station's own metres
    vz: 0,
    burst: -1,
    burstAt: 0,
    time: 0,
    render() {},
    paint() {},
  };
  s.isFound = (i) => memory.found.includes(i);
  s.isOpen = (i) => s.isFound(i) && !memory.crossed.has(i);
  s.phase = () =>
    memory.result ? "done" : memory.found.length >= n ? "choose" : "search";
  s.zone = () => (env.mode === "play" ? tune.zone : block.choose.radius);
  s.label = (i) => block.options[i].label;
  // The answer pouring now, if any: the list's pick first, else the armed pillar stood in.
  s.pouring = () => {
    if (s.locked >= 0) return -1;
    if (s.byList >= 0) return s.byList;
    return s.at >= 0 && s.armed[s.at] ? s.at : -1;
  };

  s.look = (i) => {
    if (env.mode !== "play") return "edit";
    if (memory.result) {
      if (i === block.correct) return "right";
      return memory.crossed.has(i) ? "wrong" : "other";
    }
    if (memory.crossed.has(i)) return "wrong";
    if (s.phase() === "choose") {
      if (s.locked === i) return "locked";
      if (s.pouring() === i) return "near";
      if (s.at === i) return "away";
    }
    return memory.shown.has(i) ? "shown" : "found";
  };

  s.signView = () => {
    const q = block.question;
    const view = {
      band: "#2b3440",
      bandInk: "#fbf8f0",
      paper: PAPER,
      ink: INK,
      word: "The question",
      main: q,
      big: false,
      foot: "Stand in the light of your answer",
      track: false,
    };
    if (env.mode !== "play") {
      view.word = "The question, risen once all are found";
      return view;
    }
    if (memory.result === "right") {
      Object.assign(view, {
        band: RIGHT,
        bandInk: "#04201c",
        paper: "#e9fdf9",
        word: "Right",
        main: s.label(block.correct),
        big: true,
        foot: memory.earned ? `+${memory.earned} points` : "",
      });
      return view;
    }
    if (memory.result === "wrong") {
      Object.assign(view, {
        band: WRONG,
        bandInk: INK,
        word: "Not quite. It was",
        main: s.label(block.correct),
        big: true,
        foot: "",
      });
      return view;
    }
    if (s.locked >= 0) {
      Object.assign(view, {
        band: PICK,
        bandInk: INK,
        word: "Your answer",
        main: s.label(s.locked),
        big: true,
        foot:
          s.lockedByList >= 0
            ? "It counts in a moment. Undo on the card to change it."
            : "It counts in a moment. Step out to change it.",
        track: true,
      });
      return view;
    }
    if (s.time < s.retryUntil) {
      view.band = WRONG;
      view.bandInk = INK;
      view.word = `Not "${s.label(memory.chosen)}"`;
      view.foot = "Stand in another light";
      return view;
    }
    if (memory.tries) view.word = "One more try";
    const p = s.pouring();
    if (p >= 0) {
      view.band = HUES[p];
      view.bandInk = INK;
      view.word = `Choosing "${s.label(p)}"`;
      view.foot = "Stay in the light until it fills";
      view.track = true;
    } else if (s.at >= 0) {
      view.foot = `Step out of "${s.label(s.at)}", then back in to choose it`;
    }
    return view;
  };

  const changed = () => {
    s.paint();
    s.render();
  };

  s.ask = () => {
    env.say("Stand in the light of your answer until it fills.", {
      eyebrow: memory.tries ? "One more try" : `All ${n} found`,
    });
  };

  s.find = (i) => {
    if (s.isFound(i) || memory.result) return;
    memory.found.push(i);
    memory.wait = 0;
    s.hinting = false;
    s.burst = i;
    s.burstAt = s.time;
    const o = block.options[i];
    if (memory.found.length >= n) {
      env.sound("done").play();
      s.ask();
    } else {
      env.sound("tap").play();
      env.say(o.clue ? `"${o.label}". ${o.clue}` : `"${o.label}".`, {
        mood: "happy",
        eyebrow: `${memory.found.length} of ${n} found`,
      });
    }
    changed();
  };

  s.showRest = () => {
    if (s.phase() !== "search") return;
    for (let i = 0; i < n; i++) {
      if (s.isFound(i)) continue;
      memory.found.push(i);
      memory.shown.add(i);
    }
    s.hinting = false;
    env.sound("tap").play();
    s.ask();
    changed();
  };

  s.hint = () => {
    s.hinting = true;
    const first = !memory.hinted;
    memory.hinted = true;
    env.say("Still looking? Follow the arrow, it points to the nearest one.", {
      eyebrow: "A hint",
    });
    if (first) s.render();
  };

  /* choosing: stand in the light until it fills; it locks, then counts after a grace */
  const lock = (i) => {
    s.locked = i;
    s.lockAt = s.time;
    s.lockedByList = s.byList;
    s.byList = -1;
    s.fill[i] = 1;
    s.flare = i;
    s.flareAt = s.time;
    env.sound("tap").play();
    changed();
  };

  // Quiet: no sound, no line in the card; the sign goes back to the question and the light drains.
  s.undo = () => {
    if (s.locked < 0 && s.byList < 0) return;
    s.locked = -1;
    s.lockedByList = -1;
    s.byList = -1;
    changed();
  };

  s.chooseFromList = (i) => {
    if (s.phase() !== "choose" || !s.isOpen(i) || s.skipped) return;
    s.locked = -1;
    s.lockedByList = -1;
    s.byList = i;
    changed();
  };

  const finish = (result) => {
    memory.result = result;
    s.locked = -1;
    s.byList = -1;
    s.listOpen = false;
    if (result === "right") {
      memory.earned = memory.tries
        ? Math.floor(block.points / 2)
        : block.points;
      s.burst = block.correct;
      s.burstAt = s.time;
      s.flare = block.correct;
      s.flareAt = s.time;
      env.sound("right").play();
      env.say(block.says.right, { mood: "happy" });
    } else {
      env.sound("wrong").play();
      env.say(block.says.wrong, { mood: "doubt" });
    }
    changed();
    env.done();
  };

  const count = (i) => {
    memory.chosen = i;
    if (i === block.correct) {
      finish("right");
      return;
    }
    memory.crossed.add(i);
    memory.tries += 1;
    s.locked = -1;
    s.lockedByList = -1;
    s.fill[i] = 0;
    if (s.at === i) s.at = -1;
    if (block.choose.retry && memory.tries < 2) {
      s.retryUntil = s.time + RETRY_SHOW;
      env.sound("wrong").play();
      env.say(block.says.retry, { mood: "doubt", eyebrow: "One more try" });
      changed();
    } else finish("wrong");
  };

  const setAt = (i) => {
    if (s.at === i) return;
    s.at = i;
    changed();
  };

  // Every frame while choosing. No allocation: reads and rare state changes only.
  s.stepChoose = (dt, active) => {
    const r = s.zone();
    if (!s.choosing) {
      s.choosing = true;
      // Whoever stands in a pillar as the choice opens found that answer last; standing on would
      // choose it without meaning to, so that pillar waits until they step out once.
      for (let i = 0; i < n; i++)
        s.armed[i] = s.measured[i] > r + ZONE_OUT ? 1 : 0;
    }
    let near = -1;
    let nearD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!s.isOpen(i)) continue;
      if (!s.armed[i] && s.measured[i] > r + ZONE_OUT) {
        s.armed[i] = 1;
        if (s.at === i) changed();
      }
      if (s.measured[i] < nearD) {
        nearD = s.measured[i];
        near = i;
      }
    }
    if (!active) setAt(-1);
    else if (s.at >= 0) {
      const held = s.measured[s.at];
      if (!s.isOpen(s.at) || held > r + ZONE_OUT) setAt(-1);
      else if (
        near !== s.at &&
        nearD < r - ZONE_IN &&
        nearD < held - SWITCH_MARGIN
      )
        setAt(near);
    } else if (near >= 0 && nearD < r - ZONE_IN) setAt(near);

    // a lock taken by standing lets go when the visitor steps out, or into another pillar
    if (s.locked >= 0 && s.lockedByList < 0 && s.at !== s.locked) s.undo();
    if (!active && s.byList >= 0) s.undo();

    const p = s.pouring();
    for (let i = 0; i < n; i++) {
      if (i === s.locked) continue;
      if (i === p) {
        s.fill[i] += dt / (i === s.byList ? LIST_FILL_S : tune.dwell);
        if (s.fill[i] >= 1) lock(i);
      } else if (s.fill[i] > 0)
        s.fill[i] = Math.max(0, s.fill[i] - dt / DRAIN_S);
    }
    if (s.locked >= 0 && s.time - s.lockAt >= tune.grace) count(s.locked);
    if (s.retryUntil && s.time >= s.retryUntil) {
      s.retryUntil = 0;
      s.paint();
    }
  };

  s.leave = () => {
    s.outside = true;
    s.hinting = false;
    s.render();
  };
  s.back = () => {
    s.outside = false;
    s.render();
  };

  s.close = () => {
    s.closed = true;
    s.render = () => {};
    s.paint = () => {};
  };
  return s;
}

/* ---------- the world part: play and edit from the same parts ---------- */
function world(block, env) {
  const play = env.mode === "play";
  const key = JSON.stringify(block);
  if (play && (!reopening || memory.key !== key)) startVisit(key);
  if (tune.key !== key) {
    tune.key = key;
    tune.radius = block.find.radius;
    tune.hintAfter = block.find.hintAfterS;
    tune.zone = block.choose.radius;
    tune.dwell = block.choose.dwellS;
  }
  const { options } = block;
  const n = options.length;
  const spots = options.map(
    (o, i) => o.hide ?? fallbackSpot(i, env.place.anchors),
  );
  const s = makeSession(block, env, spots);
  sessions.set(block, s);

  const object = new Group();
  const content = new Group(); // moved as one by the placement error, the way an AR alignment is
  object.add(content);

  const atlas = env.paintText({
    width: ATLAS,
    height: ATLAS,
    draw(g) {
      g.clearRect(0, 0, ATLAS, ATLAS);
      options.forEach((o, i) => {
        g.save();
        g.translate((i % 2) * CELL_W, (i >> 1) * CELL_H);
        const look = s.look(i);
        drawCell(g, o, HUES[i], look, look === "edit" && i === block.correct);
        g.restore();
      });
    },
  });
  const signTex = env.paintText({
    width: SIGN_PX_W,
    height: SIGN_PX_H,
    draw: (g, w, h) => drawSign(g, w, h, s.signView()),
  });
  let signShows = null; // the bar's mode, so the frame loop knows when to show it
  s.paint = () => {
    atlas.repaint();
    const view = s.signView();
    signShows = view.track;
    signTex.repaint((g, w, h) => drawSign(g, w, h, view));
  };
  const spark = env.paintText({ width: 64, height: 64, draw: drawSpark });
  spark.premultiplyAlpha = true;

  const geos = [];
  const mats = [];
  const labelMat = new MeshBasicMaterial({ map: atlas, alphaTest: 0.5 });
  const discGeo = discGeometry();
  const pillarGeo = new CylinderGeometry(1, 1, PILLAR_H, 40, 1, true);
  pillarGeo.translate(0, PILLAR_H / 2, 0);
  const burstGeo = new RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
  const burstMat = new MeshBasicMaterial({
    color: RIGHT,
    transparent: true,
    depthWrite: false,
  });
  geos.push(discGeo, pillarGeo, burstGeo);
  mats.push(labelMat, burstMat);
  const flat = () => {}; // paint and light take no tap, so a tap there walks the visitor

  // Edit only: two answers closer than APART_MIN cannot be told apart by where the visitor stands.
  const crowded = spots.map((p, i) =>
    spots.some(
      (q, j) => j !== i && Math.hypot(q.x - p.x, q.z - p.z) < APART_MIN,
    ),
  );
  const labelMid = EGG_H + LABEL_GAP + LABEL_H / 2;

  const eggs = options.map((o, i) => {
    const group = new Group();
    group.position.set(spots[i].x, o.lift, spots[i].z);
    const lowGeo = eggHalf(HUES[i], 0, CRACK);
    const topGeo = eggHalf(HUES[i], CRACK, 1);
    const mat = new MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      side: DoubleSide,
    });
    const low = new Mesh(lowGeo, mat);
    const lid = new Group();
    lid.position.y = CRACK * EGG_H;
    lid.add(new Mesh(topGeo, mat));
    // The label hangs from a holder, which rises to the eye while the visitor stands in the light.
    const hold = new Group();
    const labelGeo = labelGeometry(i);
    const label = new Mesh(labelGeo, labelMat);
    label.position.y = labelMid;
    hold.add(label);
    group.add(low, lid, hold);
    content.add(group);

    // The pillar: in play the place to stand to choose this answer; in edit the same, red when a
    // neighbour is too close to tell apart.
    const pillarMat = pillarMaterial(!play && crowded[i] ? WRONG : HUES[i]);
    const pillar = new Mesh(pillarGeo, pillarMat);
    pillar.position.set(spots[i].x, 0, spots[i].z);
    pillar.scale.set(block.choose.radius, 1, block.choose.radius);
    pillar.renderOrder = 6;
    pillar.raycast = flat;
    pillar.visible = !play;
    content.add(pillar);

    // Edit only: how close a visitor must come to find it.
    if (!play) {
      const discMat = new MeshBasicMaterial({
        color: HUES[i],
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      });
      const disc = new Mesh(discGeo, discMat);
      disc.position.set(spots[i].x, 0.03, spots[i].z);
      disc.scale.setScalar(block.find.radius);
      disc.renderOrder = 2;
      content.add(disc);
      mats.push(discMat);
    }
    geos.push(lowGeo, topGeo, labelGeo);
    mats.push(mat, pillarMat);
    const found = s.isFound(i);
    return {
      group,
      mat,
      lid,
      label,
      hold,
      pillar,
      u: pillarMat.uniforms,
      open: found || !play ? 1 : 0,
      pop: found || !play ? 1 : 0,
      glow: play ? 0 : 1,
      right: false, // turned to the colour of a right answer
      raise: 0,
      // metres the holder rises in the light: the label's middle comes to the eye
      raiseTo: Math.max(0, LABEL_EYE - o.lift - labelMid),
    };
  });

  // The sign: risen over the middle of the station once all are found, turned to the visitor.
  const sign = new Group();
  const board = new Group();
  board.position.y = SIGN_Y;
  sign.add(board);
  const signGeo = new PlaneGeometry(SIGN_W, SIGN_H);
  const signMat = new MeshBasicMaterial({ map: signTex, alphaTest: 0.5 });
  const plate = new Mesh(signGeo, signMat);
  plate.raycast = flat;
  // The bar: grows from the left edge of the track painted on the plate.
  const barW = (SIGN_W * (SIGN_PX_W - SIGN_MARGIN * 2)) / SIGN_PX_W;
  const barGeo = new PlaneGeometry(1, BAR_H);
  barGeo.translate(0.5, 0, 0);
  const barMat = new MeshBasicMaterial({ color: PICK });
  const bar = new Mesh(barGeo, barMat);
  bar.position.set(
    -barW / 2,
    SIGN_H / 2 - ((SIGN_PX_H - SIGN_TRACK) / SIGN_PX_H) * SIGN_H,
    0.006,
  );
  bar.visible = false;
  bar.raycast = flat;
  board.add(plate, bar);
  sign.visible = !play;
  content.add(sign);
  geos.push(signGeo, barGeo);
  mats.push(signMat, barMat);
  let rise = play ? 0 : 1;
  let signYaw = 0;

  // The tease: a glint per egg, and a small shimmer around each that grows with nearness.
  const glintGeo = new BufferGeometry();
  glintGeo.setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array(n * 3), 3),
  );
  glintGeo.setAttribute(
    "color",
    new Float32BufferAttribute(new Float32Array(n * 4), 4),
  );
  const sparkGeo = new BufferGeometry();
  sparkGeo.setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array(n * SPARKS * 3), 3),
  );
  sparkGeo.setAttribute(
    "color",
    new Float32BufferAttribute(new Float32Array(n * SPARKS * 4), 4),
  );
  // The motes: light falling inside each pillar, faster while it pours. One draw for all.
  const moteGeo = new BufferGeometry();
  moteGeo.setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array(n * MOTES * 3), 3),
  );
  moteGeo.setAttribute(
    "color",
    new Float32BufferAttribute(new Float32Array(n * MOTES * 4), 4),
  );
  const pointMat = (size) =>
    new PointsMaterial({
      size,
      map: spark,
      vertexColors: true,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    });
  const glintMat = pointMat(GLINT_SIZE);
  const sparkMat = pointMat(SPARK_SIZE);
  const moteMat = pointMat(MOTE_SIZE);
  const glints = new Points(glintGeo, glintMat);
  const sparks = new Points(sparkGeo, sparkMat);
  const motes = new Points(moteGeo, moteMat);
  for (const p of [glints, sparks, motes]) {
    p.frustumCulled = false; // the positions move every frame
    p.renderOrder = 7;
    p.raycast = flat;
    p.visible = false;
  }
  content.add(glints, sparks, motes);
  geos.push(glintGeo, sparkGeo, moteGeo);
  mats.push(glintMat, sparkMat, moteMat);
  // The buffers live in the attributes; keep the attributes' own arrays to write into.
  const gp = glintGeo.attributes.position.array;
  const gc = glintGeo.attributes.color.array;
  const sp = sparkGeo.attributes.position.array;
  const sc = sparkGeo.attributes.color.array;
  const mp = moteGeo.attributes.position.array;
  const mc = moteGeo.attributes.color.array;

  const burst = new Mesh(burstGeo, burstMat);
  burst.position.y = 0.05;
  burst.renderOrder = 3;
  burst.visible = false;
  burst.raycast = flat;
  content.add(burst);

  // The search arrow: held a little ahead of the eye and turned, in its own plane, towards the
  // nearest egg still hidden, the way a compass needle would be. Object metres, not moved with
  // the station. While choosing the pillars show the way, so it stays down.
  const arrowGeo = arrowGeometry();
  const arrowMat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  });
  const arrow = new Mesh(arrowGeo, arrowMat);
  arrow.rotation.order = "YXZ";
  arrow.position.y = ARROW_Y;
  arrow.scale.setScalar(ARROW_SCALE);
  arrow.renderOrder = 4;
  arrow.visible = false;
  arrow.raycast = flat;
  object.add(arrow);
  geos.push(arrowGeo);
  mats.push(arrowMat);

  // What the phone measures: the found radius or the pillar's radius around the measured
  // position, and where the creator meant the eggs to be. Off unless the card's switch is on.
  const reachMat = new MeshBasicMaterial({
    color: "#ffffff",
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  const reach = new Mesh(discGeo, reachMat);
  reach.position.y = 0.035;
  reach.renderOrder = 4;
  reach.visible = false;
  reach.raycast = flat;
  const marksGeo = marksGeometry(spots);
  const marksMat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  const marks = new Mesh(marksGeo, marksMat);
  marks.position.y = 0.035;
  marks.renderOrder = 4;
  marks.visible = false;
  marks.raycast = flat;
  object.add(reach, marks);
  geos.push(marksGeo);
  mats.push(reachMat, marksMat);

  // Tracking jitter: a slow two-axis wander, seeded so a run can be repeated.
  let seed = 20261113;
  const rnd = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const gauss = () =>
    Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  let jx = 0;
  let jz = 0;

  s.paint();

  const update = (frame) => {
    const t = frame.time;
    const dt = frame.dt;
    const v = frame.viewer;
    s.time = t;
    const k = play ? 1 - Math.exp(-dt / EASE_TAU) : 1;
    const kRise = play ? 1 - Math.exp(-dt / RISE_TAU) : 1;
    const ox = play ? Math.cos(tune.angle) * tune.offset : 0;
    const oz = play ? Math.sin(tune.angle) * tune.offset : 0;
    content.position.set(ox, 0, oz);
    s.vx = v.x - ox;
    s.vz = v.z - oz;
    const radius = play ? tune.radius : block.find.radius;
    const r = s.zone();

    if (dt > 0) {
      const sigma = tune.jitter / P90;
      const pull = dt / JITTER_TAU;
      const kick = sigma * Math.sqrt(2 * pull);
      jx += -jx * pull + kick * gauss();
      jz += -jz * pull + kick * gauss();
    }
    const mx = v.x + jx;
    const mz = v.z + jz;

    const phase = s.phase();
    const searching = play && phase === "search" && !s.outside && !s.skipped;
    let near = -1;
    let nearD = Infinity;
    for (let i = 0; i < n; i++) {
      const ex = spots[i].x + ox;
      const ez = spots[i].z + oz;
      s.dist[i] = Math.hypot(v.x - ex, v.z - ez);
      s.measured[i] = Math.hypot(mx - ex, mz - ez);
      if (s.isFound(i)) continue;
      if (s.dist[i] < nearD) {
        nearD = s.dist[i];
        near = i;
      }
    }
    s.target = near;

    if (searching) {
      for (let i = 0; i < n; i++) {
        if (s.isFound(i)) continue;
        if (s.measured[i] < radius) {
          s.dwell[i] += dt;
          if (s.dwell[i] >= DWELL) s.find(i);
        } else s.dwell[i] = 0;
      }
      if (s.phase() === "search") {
        memory.wait += dt;
        if (!s.hinting && memory.wait >= tune.hintAfter) s.hint();
        if (s.hinting && memory.wait < tune.hintAfter) s.hinting = false;
      }
    }
    // the last find opens the choice in this same frame
    const now = s.phase();
    if (play && now === "choose") s.stepChoose(dt, !s.outside && !s.skipped);
    const risen = !play || now !== "search";
    const pouring = s.pouring();

    for (let i = 0; i < n; i++) {
      const e = eggs[i];
      const found = s.isFound(i) || !play;
      const d = s.dist[i];
      const seen = found ? 1 : smooth(radius + SEEN_EXTRA, radius + 0.3, d);
      const crossed = play && memory.crossed.has(i);
      e.mat.opacity = crossed ? 0.5 * seen : seen;
      e.group.visible = seen > 0.01;
      e.open += ((found ? 1 : 0) - e.open) * k;
      e.pop += ((found ? 1 : 0) - e.pop) * k;
      e.lid.position.y = CRACK * EGG_H + e.open * 0.16;
      e.lid.rotation.z = e.open * 0.55;
      e.label.visible = e.pop > 0.02;
      // standing at the egg, the label shrinks so it never fills the view
      const close = play ? clamp(d / LABEL_FULL, LABEL_MIN, 1) : 1;
      e.label.scale.setScalar(Math.max(0.001, e.pop * close));
      const lx = spots[i].x + ox;
      const lz = spots[i].z + oz;
      e.label.rotation.y = Math.atan2(v.x - lx, v.z - lz);
      // a found egg rests; one still hidden breathes a little once it shows
      e.group.rotation.y = found ? 0 : Math.sin(t * 1.3 + i) * 0.25;
      // the label comes up to the eye while the visitor stands in this light
      const up =
        play && now !== "search" && (s.at === i || s.locked === i) && !crossed;
      e.raise += ((up ? e.raiseTo : 0) - e.raise) * k;
      e.hold.position.y = e.raise;

      // the pillar: open answers while choosing; while one is locked the others dim; at the end
      // only the right one stays, in the colour of a right answer
      let glow = 1;
      if (play) {
        if (now === "search" || crossed) glow = 0;
        else if (now === "done") glow = i === block.correct ? 1 : 0;
        else if (s.locked >= 0 && s.locked !== i) glow = 0.22;
        else if (s.byList >= 0 && s.byList !== i) glow = 0.4;
      }
      e.glow += (glow - e.glow) * kRise;
      e.pillar.visible = e.glow > 0.01;
      if (e.pillar.visible) {
        e.pillar.scale.set(r, 0.15 + 0.85 * Math.min(1, e.glow * 1.4), r);
        const u = e.u;
        u.uGlow.value = e.glow;
        u.uFill.value = play ? (now === "done" ? 1 : s.fill[i]) : 0;
        u.uTime.value = t;
        const flareAge = (t - s.flareAt) / FLARE_S;
        u.uFlare.value =
          s.flare === i && flareAge < 1 ? Math.sin(Math.PI * flareAge) : 0;
        if (play && now === "done" && i === block.correct && !e.right) {
          e.right = true;
          u.uColor.value.set(RIGHT);
        }
      }

      // the tease, for an egg not yet found
      const tease = play && !found && phase === "search" && !s.skipped;
      const warm = tease ? smooth(TEASE_FAR, radius, d) : 0;
      const hinted = s.hinting && i === s.target;
      const period = hinted
        ? GLINT_HINT
        : GLINT_SLOW + (GLINT_FAST - GLINT_SLOW) * warm;
      const at = (t + i * 1.37) % period;
      const glint =
        tease && at < GLINT_LEN ? Math.sin((Math.PI * at) / GLINT_LEN) : 0;
      const base = i * 3;
      gp[base] = spots[i].x;
      gp[base + 1] = options[i].lift + EGG_H + 0.12;
      gp[base + 2] = spots[i].z;
      const c = i * 4;
      gc[c] = gc[c + 1] = gc[c + 2] = 1;
      gc[c + 3] = glint * (hinted ? 1 : 0.55 + 0.45 * warm);
      for (let j = 0; j < SPARKS; j++) {
        const a = t * 0.9 + (j * Math.PI * 2) / SPARKS + i;
        const rr = 0.26 + 0.08 * Math.sin(t * 1.3 + j);
        const rise2 = (j * 0.37 + t * 0.22) % 1;
        const b = (i * SPARKS + j) * 3;
        sp[b] = spots[i].x + Math.cos(a) * rr;
        sp[b + 1] = options[i].lift + 0.05 + rise2 * 0.7;
        sp[b + 2] = spots[i].z + Math.sin(a) * rr;
        const q = (i * SPARKS + j) * 4;
        sc[q] = sc[q + 1] = sc[q + 2] = 1;
        const twinkle = 0.3 + 0.7 * Math.max(0, Math.sin(t * 5 + j * 1.9));
        sc[q + 3] = warm * warm * twinkle * (1 - rise2 * 0.6);
      }

      // the motes: slow and faint in a waiting pillar, quick and bright where the light pours
      const busy = i === pouring || i === s.locked ? 1 : s.fill[i];
      s.fall[i] += dt * (0.07 + 0.45 * busy);
      for (let j = 0; j < MOTES; j++) {
        const f = (s.fall[i] + j / MOTES + i * 0.13) % 1;
        const a = j * 2.39996 + i;
        const rr = r * (0.3 + 0.55 * ((j * 0.618) % 1));
        const b = (i * MOTES + j) * 3;
        mp[b] = spots[i].x + Math.cos(a) * rr;
        mp[b + 1] = PILLAR_H * 0.9 * (1 - f);
        mp[b + 2] = spots[i].z + Math.sin(a) * rr;
        const q = (i * MOTES + j) * 4;
        mc[q] = mc[q + 1] = mc[q + 2] = 1;
        mc[q + 3] =
          e.glow *
          (0.25 + 0.75 * busy) *
          Math.sin(Math.PI * f) *
          (play ? 1 : 0);
      }
    }
    glints.visible = sparks.visible = play && phase === "search";
    motes.visible = play && risen;
    glintGeo.attributes.position.needsUpdate = true;
    glintGeo.attributes.color.needsUpdate = true;
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;
    moteGeo.attributes.position.needsUpdate = true;
    moteGeo.attributes.color.needsUpdate = true;

    // the sign rises when the choice opens, and turns, eased, to face the visitor
    rise += ((risen ? 1 : 0) - rise) * kRise;
    sign.visible = rise > 0.01;
    if (sign.visible) {
      board.position.y = 0.4 + (SIGN_Y - 0.4) * rise + 0.05 * Math.sin(t * 0.8);
      board.scale.setScalar(Math.max(0.001, rise));
      const want = Math.atan2(s.vx, s.vz);
      signYaw += play
        ? wrapAngle(want - signYaw) * (1 - Math.exp(-dt / SIGN_TURN_TAU))
        : wrapAngle(want - signYaw);
      board.rotation.y = signYaw;
      // the bar: how full the light is while it pours, how long until it counts once locked
      let progress = -1;
      if (play && s.locked >= 0)
        progress = 1 - (t - s.lockAt) / Math.max(0.01, tune.grace);
      else if (play && pouring >= 0) progress = s.fill[pouring];
      bar.visible = signShows && progress >= 0;
      if (bar.visible) {
        bar.scale.x = Math.max(0.001, clamp(progress, 0, 1) * barW);
        const hue = s.locked >= 0 ? PICK : HUES[pouring];
        if (barMat.userData.hue !== hue) {
          barMat.userData.hue = hue;
          barMat.color.set(hue);
        }
      }
    }

    // The search arrow faces the eye; pointing up means straight ahead, sideways means turn that way.
    const to =
      searching && s.hinting && near >= 0 && s.dist[near] > radius + ARROW_NEAR
        ? near
        : -1;
    arrow.visible = to >= 0;
    if (to >= 0) {
      arrow.position.x = v.x + Math.sin(frame.viewYaw) * ARROW_AHEAD;
      arrow.position.z = v.z + Math.cos(frame.viewYaw) * ARROW_AHEAD;
      const bearing = Math.atan2(
        spots[to].x + ox - v.x,
        spots[to].z + oz - v.z,
      );
      arrow.rotation.y = frame.viewYaw + Math.PI;
      arrow.rotation.z = wrapAngle(bearing - frame.viewYaw);
      arrowMat.opacity = 0.75 + 0.25 * Math.sin(t * 4);
    }

    const overlay = play && tune.overlay;
    reach.visible = overlay;
    marks.visible = overlay;
    if (overlay) {
      reach.position.x = mx;
      reach.position.z = mz;
      reach.scale.setScalar(now === "search" ? radius : r);
    }

    if (s.burst >= 0) {
      const age = (t - s.burstAt) / 1.2;
      burst.visible = age < 1;
      if (burst.visible) {
        burst.position.set(spots[s.burst].x, 0.05, spots[s.burst].z);
        burst.scale.setScalar(
          now === "done" ? r * (1 + age * 1.3) : 0.4 + age * 1.6,
        );
        burstMat.opacity = 1 - age;
      } else s.burst = -1;
    }
  };

  return {
    object,
    update,
    leave: s.leave,
    back: s.back,
    dispose() {
      s.close();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      atlas.dispose();
      signTex.dispose();
      spark.dispose();
      reopening = true;
      queueMicrotask(() => (reopening = false));
    },
  };
}

/* ---------- the story card: DOM, inside el only ---------- */
const CSS = `
[data-kind="${NAME}"] .lp-q { margin-top: 2px; font-size: 13.5px; line-height: 1.3; color: var(--walk-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
[data-kind="${NAME}"] .lp-q b { color: var(--walk-ink); font-weight: 600; }
[data-kind="${NAME}"] .lp-count { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
[data-kind="${NAME}"] .lp-count b { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .lp-pips { display: flex; gap: 6px; }
[data-kind="${NAME}"] .lp-pips i { width: 18px; height: 22px; border-radius: 50% 50% 46% 46% / 58% 58% 42% 42%; border: 1.5px dashed rgb(255 255 255 / 45%); }
[data-kind="${NAME}"] .lp-pips i.on { border: 0; background: var(--hue); box-shadow: inset 0 -5px 0 rgb(255 255 255 / 55%); }
[data-kind="${NAME}"] .lp-found { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
[data-kind="${NAME}"] .lp-found > span { max-width: 100%; padding: 3px 9px; border-radius: 9px; border-left: 4px solid var(--hue); background: rgb(255 255 255 / 10%); font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-kind="${NAME}"] .lp-note { margin-top: 8px; font-size: 13.5px; line-height: 1.3; color: var(--walk-muted); }
[data-kind="${NAME}"] .lp-rest { margin-top: 8px; }
[data-kind="${NAME}"] .lp-row { display: flex; align-items: center; gap: 10px; min-height: 40px; margin-top: 4px; }
[data-kind="${NAME}"] .lp-glyph { display: flex; align-items: flex-end; gap: 5px; height: 24px; }
[data-kind="${NAME}"] .lp-glyph i { position: relative; width: 7px; height: 24px; border-radius: 4px; background: rgb(255 255 255 / 16%); overflow: hidden; }
[data-kind="${NAME}"] .lp-glyph i::after { content: ""; position: absolute; inset: 0; background: var(--hue); transform-origin: 50% 0; transform: scaleY(var(--f, 0)); transition: transform 0.3s linear; }
[data-kind="${NAME}"] .lp-glyph i.out { opacity: 0.25; }
[data-kind="${NAME}"] .lp-glyph i.on { box-shadow: 0 0 0 2px ${PICK}; }
[data-kind="${NAME}"] .lp-undo { min-height: 40px; padding: 6px 14px; font-size: 14px; }
[data-kind="${NAME}"] .lp-link { margin-left: auto; min-height: 40px; padding: 0 2px; border: 0; background: none; color: var(--walk-muted); font: inherit; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
[data-kind="${NAME}"] .answers .a { flex-direction: column; gap: 2px; text-align: center; }
[data-kind="${NAME}"] .lp-pill { margin-top: 8px; }
[data-kind="${NAME}"] .lp-pill .plus { margin-left: 0; }
[data-kind="${NAME}"] details { margin-top: 10px; border-top: 1px solid var(--walk-line); }
[data-kind="${NAME}"] summary { display: flex; align-items: center; min-height: 40px; font-size: 13.5px; font-weight: 600; color: var(--walk-muted); cursor: pointer; list-style: none; }
[data-kind="${NAME}"] summary::-webkit-details-marker { display: none; }
[data-kind="${NAME}"] summary::before { content: "+"; display: inline-block; width: 18px; font-weight: 700; }
[data-kind="${NAME}"] details[open] summary::before { content: "-"; }
[data-kind="${NAME}"] .f { margin-top: 4px; }
[data-kind="${NAME}"] .f output { float: right; color: var(--walk-ink); font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .lp-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
[data-kind="${NAME}"] .lp-btns .btn { min-height: 40px; padding: 6px 12px; font-size: 13.5px; }
[data-kind="${NAME}"] .lp-read { margin-top: 6px; font-size: 12.5px; line-height: 1.35; color: var(--walk-muted); font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .lp-warn { color: ${WRONG}; }
[data-kind="${NAME}"] .lp-why p { margin: 0 0 8px; font-size: 13.5px; line-height: 1.4; }
[data-kind="${NAME}"] .lp-why b { display: block; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--walk-found); }
@media (orientation: landscape) and (max-height: 520px) {
  [data-kind="${NAME}"] .lp-count { margin-top: 6px; }
  [data-kind="${NAME}"] .lp-found { margin-top: 5px; }
  [data-kind="${NAME}"] .lp-note { margin-top: 5px; font-size: 12.5px; }
  [data-kind="${NAME}"] .lp-row { min-height: 34px; }
}
`;

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function addStyle(el) {
  const style = document.createElement("style");
  style.textContent = CSS;
  el.append(style);
}

function whyBlock() {
  const why = make("details", "lp-why");
  why.append(make("summary", "", "Why this is in 3D, and the case against"));
  const a = make("p");
  a.append(make("b", "", "Why 3D"), document.createTextNode(WHY.for));
  const b = make("p");
  b.append(
    make("b", "", "The strongest case against"),
    document.createTextNode(WHY.against),
  );
  why.append(a, b);
  return why;
}

function slider(label, { min, max, step, value, unit, format }, onInput) {
  const row = make("label", "f", label);
  const out = make("output");
  const input = make("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const show = () =>
    (out.textContent = `${format(Number(input.value))} ${unit}`);
  input.addEventListener("input", () => {
    show();
    onInput(Number(input.value));
  });
  show();
  row.append(out, input);
  return row;
}

const metres = (m) => m.toFixed(m < 1 ? 2 : 1);
const seconds = (v) => v.toFixed(1);

function tuneBlock(s) {
  const box = make("details", "lp-tune");
  box.append(
    make("summary", "", "Try the feel: dwell, grace, radius, position error"),
  );
  box.append(
    slider(
      "Stand in the light for",
      {
        min: DWELL_MIN,
        max: DWELL_MAX,
        step: 0.5,
        value: tune.dwell,
        unit: "s",
        format: seconds,
      },
      (v) => (tune.dwell = v),
    ),
    slider(
      "Then it counts after",
      {
        min: 0,
        max: GRACE_MAX,
        step: 0.5,
        value: tune.grace,
        unit: "s",
        format: seconds,
      },
      (v) => (tune.grace = v),
    ),
    slider(
      "Pillar radius",
      {
        min: ZONE_MIN,
        max: ZONE_MAX,
        step: 0.25,
        value: tune.zone,
        unit: "m",
        format: metres,
      },
      (v) => (tune.zone = v),
    ),
    slider(
      "Found within",
      {
        min: RADIUS_MIN,
        max: RADIUS_MAX,
        step: 0.25,
        value: tune.radius,
        unit: "m",
        format: metres,
      },
      (v) => (tune.radius = v),
    ),
    slider(
      "A hint after",
      {
        min: HINT_MIN,
        max: HINT_MAX,
        step: 5,
        value: tune.hintAfter,
        unit: "s",
        format: String,
      },
      (v) => {
        tune.hintAfter = v;
        s.render();
      },
    ),
    slider(
      "Tracking jitter, 9 in 10 within",
      {
        min: 0,
        max: 1,
        step: 0.05,
        value: tune.jitter,
        unit: "m",
        format: metres,
      },
      (v) => (tune.jitter = v),
    ),
    slider(
      "Station placed off by",
      {
        min: 0,
        max: 5,
        step: 0.25,
        value: tune.offset,
        unit: "m",
        format: metres,
      },
      (v) => (tune.offset = v),
    ),
  );
  const toggle = make("label", "f check-row");
  const check = make("input");
  check.type = "checkbox";
  check.checked = tune.overlay;
  check.addEventListener("change", () => (tune.overlay = check.checked));
  toggle.append(check, document.createTextNode("Show what the phone measures"));
  const row = make("div", "lp-btns");
  const again = make("button", "btn", "Place the station off again");
  again.type = "button";
  again.addEventListener("click", () => {
    tune.angle = (tune.angle + 2.2 + Math.random() * 1.8) % (Math.PI * 2);
  });
  row.append(again);
  const read = make("p", "lp-read");
  const note = make(
    "p",
    "lp-read",
    `The light starts to pour ${ZONE_IN} m inside a pillar's edge and lets go ${ZONE_OUT} m outside it, so jitter at the edge neither starts nor stops it; stepping out drains it in ${DRAIN_S} s. Jitter moves the position that finding and the pillars measure; the station's placement error moves the eggs and pillars together. The ring and the crosses show both.`,
  );
  box.append(toggle, row, read, note);
  const tick = () => {
    if (!box.open) return;
    const lines = [];
    const phase = s.phase();
    if (phase === "search" && s.target >= 0) {
      const i = s.target;
      lines.push(
        `Nearest hidden answer: ${s.dist[i].toFixed(1)} m, measured ${s.measured[i].toFixed(1)} m.`,
      );
    } else if (phase === "choose" && s.at >= 0) {
      const i = s.at;
      lines.push(
        `In the light of "${s.label(i)}": measured ${s.measured[i].toFixed(1)} m from its middle, ${Math.round(s.fill[i] * 100)} % full${s.armed[i] ? "" : ", waiting for a step out"}.`,
      );
    }
    lines.push(
      `Stand ${seconds(tune.dwell)} s, counts after ${seconds(tune.grace)} s more; pillars ${metres(tune.zone)} m.`,
    );
    read.textContent = lines.join(" ");
  };
  return { box, tick };
}

function card(block, el, env) {
  const s = sessions.get(block);
  if (!s) return null;
  addStyle(el);
  const host = make("div");
  const { box, tick: tickTune } = tuneBlock(s);
  el.append(host, box, whyBlock());
  const { options } = block;
  const n = options.length;
  let note = null;
  const bars = []; // the glyph's little pillars while choosing

  const pill = () => {
    const row = make("p", "lp-pill");
    if (memory.result === "right" && memory.earned > 0)
      row.append(make("span", "plus", `+${memory.earned}`));
    else row.append(make("span", "plus none", "No points"));
    return row;
  };

  // The progress glyph: one tiny pillar per found answer, pouring from the top like the real one.
  const glyph = () => {
    const wrap = make("span", "lp-glyph");
    wrap.setAttribute("aria-hidden", "true");
    bars.length = 0;
    for (const i of memory.found) {
      const b = make("i");
      b.style.setProperty("--hue", HUES[i]);
      bars[i] = b;
      wrap.append(b);
    }
    return wrap;
  };

  const tickGlyph = () => {
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (!b) continue;
      const f = s.fill[i].toFixed(2);
      if (b.style.getPropertyValue("--f") !== f) b.style.setProperty("--f", f);
      b.classList.toggle("out", memory.crossed.has(i));
      b.classList.toggle("on", s.locked === i);
    }
  };

  // The way to answer without walking: closed by default, one quiet line on the card.
  const listBlock = () => {
    const wrap = make("div");
    const q = make("p", "lp-q");
    q.append(
      make("b", "", "The question: "),
      document.createTextNode(block.question),
    );
    const list = make("div", "answers small");
    for (const i of memory.found) {
      const tried = memory.crossed.has(i);
      let cls = "a";
      if (tried) cls += " wrong";
      if (s.byList === i || s.locked === i) cls += " on";
      const b = make("button", cls, options[i].label);
      b.type = "button";
      b.disabled = tried;
      b.dataset.answer = String(i);
      b.style.setProperty("--hue", HUES[i]);
      list.append(b);
    }
    wrap.append(q, list);
    return wrap;
  };

  const searchNote = () => {
    if (s.skipped) return "";
    if (s.outside) return "Come back inside the circle to keep looking.";
    if (s.hinting) return "Follow the arrow.";
    const left = Math.max(0, Math.ceil(tune.hintAfter - memory.wait));
    return `Look for a glint. A hint in ${left} s.`;
  };

  s.render = () => {
    host.replaceChildren();
    note = null;
    bars.length = 0;
    const phase = s.phase();
    if (phase === "done") {
      if (block.points > 0) host.append(pill());
      return;
    }
    if (phase === "choose") {
      if (s.skipped) return;
      const row = make("div", "lp-row");
      row.append(glyph());
      if (s.locked >= 0 || s.byList >= 0) {
        const undo = make("button", "btn lp-undo", "Undo");
        undo.type = "button";
        undo.dataset.act = "undo";
        row.append(undo);
      }
      const link = make(
        "button",
        "lp-link",
        s.listOpen ? "Hide the answers" : "Can't walk there? Answer here",
      );
      link.type = "button";
      link.dataset.act = "list";
      link.setAttribute("aria-expanded", String(s.listOpen));
      row.append(link);
      host.append(row);
      if (s.outside)
        host.append(
          make("p", "lp-note", "Come back inside the circle to choose."),
        );
      if (s.listOpen) host.append(listBlock());
      tickGlyph();
      return;
    }
    if (block.find.askFirst) {
      const q = make("p", "lp-q");
      q.append(
        make("b", "", "The question: "),
        document.createTextNode(block.question),
      );
      host.append(q);
    }
    const count = make("div", "lp-count");
    const pips = make("span", "lp-pips");
    pips.setAttribute("aria-hidden", "true");
    for (let k = 0; k < n; k++) {
      const pip = make("i", k < memory.found.length ? "on" : "");
      if (k < memory.found.length)
        pip.style.setProperty("--hue", HUES[memory.found[k]]);
      pips.append(pip);
    }
    count.append(make("b", "", `${memory.found.length} of ${n} found`), pips);
    host.append(count);
    if (memory.found.length) {
      const found = make("div", "lp-found");
      for (const i of memory.found) {
        const chip = make("span", "", options[i].label);
        chip.style.setProperty("--hue", HUES[i]);
        found.append(chip);
      }
      host.append(found);
    }
    note = make("p", "lp-note", searchNote());
    host.append(note);
    if (memory.hinted && !s.skipped) {
      const rest = make(
        "button",
        "btn lp-rest",
        "I cannot get there - show me the rest",
      );
      rest.type = "button";
      rest.dataset.act = "rest";
      host.append(rest);
    }
  };

  host.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === "rest") s.showRest();
    else if (act === "undo") s.undo();
    else if (act === "list") {
      s.listOpen = !s.listOpen;
      s.render();
    } else if (b.dataset.answer !== undefined)
      s.chooseFromList(Number(b.dataset.answer));
  });

  const phase = s.phase();
  if (phase === "search") {
    const intro = `${COUNT[n]} answers are hidden around this square, each by the thing it is about. Find them all; then each one becomes a light, and you answer by standing in one.`;
    env.say(
      memory.found.length
        ? `${memory.found.length} of ${n} found. Keep looking.`
        : intro,
      { eyebrow: "Find them, then stand in the light" },
    );
  } else if (phase === "choose") s.ask();
  else env.say(block.question, { ask: true });
  s.render();
  if (phase === "done") env.done();

  const ticker = setInterval(() => {
    if (note && s.phase() === "search") {
      const text = searchNote();
      if (note.textContent !== text) note.textContent = text;
    }
    tickGlyph();
    tickTune();
  }, 300);
  // The stage hides this element when the story moves on. Without an answer that is a skip, and
  // the seam has no other word for it, so the tease, the pillars and the hints stop on this.
  const watch = new MutationObserver(() => {
    if (el.hidden && !memory.result) s.skipped = true;
  });
  watch.observe(el, { attributes: true, attributeFilter: ["hidden"] });
  return {
    dispose() {
      clearInterval(ticker);
      watch.disconnect();
    },
  };
}

/* ---------- the edit panel: only what a FieldSpec cannot say ---------- */
function panel(raw, el, env) {
  addStyle(el);
  const list = Array.isArray(raw.answer?.options)
    ? raw.answer.options.slice(0, 4)
    : [];
  const unplaced = list
    .map((o, i) => (o && !o.hide ? o.label || `Answer ${i + 1}` : null))
    .filter(Boolean);
  el.append(
    make(
      "p",
      "lp-note",
      `Drag a ring to hide an answer. The filled disc is how close a visitor must come to find it; the pillar is where they stand to choose it. Keep answers at least ${APART_MIN} m apart: a pillar turns red when a neighbour is closer.`,
    ),
  );
  const anchors = env?.place?.anchors ?? {};
  const spots = list.map(
    (o, i) => readSpot(o?.hide) ?? fallbackSpot(i, anchors),
  );
  const labels = list.map((o, i) => o?.label || `Answer ${i + 1}`);
  for (const p of crowdedPairs(spots, labels))
    el.append(
      make(
        "p",
        "lp-note lp-warn",
        `"${p.a}" and "${p.b}" are ${p.d.toFixed(1)} m apart: a visitor at one could be read at the other. Move them at least ${APART_MIN} m apart.`,
      ),
    );
  if (unplaced.length)
    el.append(
      make(
        "p",
        "lp-note",
        `Not hidden yet, so waiting beside the nearest things: ${unplaced.join(", ")}.`,
      ),
    );
  el.append(whyBlock());
  return null;
}

/* ---------- the record ---------- */
function readSpot(v) {
  if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.z)) return null;
  return insideRing(v.x, v.z);
}

function read(v, _view, tools) {
  const question = tools.requiredText(v, "question", { max: 220 });
  const answer = v.answer;
  if (!answer || answer.type !== "single")
    throw new Error(
      '"answer.type" must be "single": each found answer is one choice',
    );
  const list = Array.isArray(answer.options) ? answer.options : [];
  const options = [];
  list.forEach((o, i) => {
    if (options.length >= 4) return;
    if (typeof o?.label !== "string" || !o.label.trim()) return;
    options.push({
      id: typeof o.id === "string" && o.id ? o.id : `option-${i}`,
      label: o.label.trim().slice(0, 60),
      ...(typeof o.clue === "string" && o.clue.trim()
        ? { clue: o.clue.trim().slice(0, 90) }
        : {}),
      hide: readSpot(o.hide),
      lift: clamp(Number(o.lift) || 0, 0, LIFT_MAX),
    });
  });
  if (options.length < 2) throw new Error("Give at least two answers to hide");
  const correct = options.findIndex((o) => o.id === answer.correct);
  if (correct < 0)
    throw new Error('"answer.correct" must name one of its options');
  const find = v.find ?? {};
  const choose = v.choose ?? {};
  const num = (x, d, a, b) => clamp(Number.isFinite(x) ? x : d, a, b);
  const says = (key) =>
    tools.optionalText(v.says, key, { max: 200 })[key] ?? SAYS[key];
  return {
    question,
    points: Math.max(0, Math.round(Number(v.points) || 0)),
    options,
    correct,
    find: {
      radius: num(find.radius, RADIUS_DEFAULT, RADIUS_MIN, RADIUS_MAX),
      hintAfterS: num(find.hintAfterS, HINT_DEFAULT, HINT_MIN, HINT_MAX),
      askFirst: find.askFirst !== false,
    },
    choose: {
      radius: num(choose.radius, ZONE_DEFAULT, ZONE_MIN, ZONE_MAX),
      dwellS: num(choose.dwellS, DWELL_DEFAULT, DWELL_MIN, DWELL_MAX),
      retry: choose.retry !== false,
    },
    says: { right: says("right"), retry: says("retry"), wrong: says("wrong") },
  };
}

function fields(raw) {
  const list = Array.isArray(raw.answer?.options) ? raw.answer.options : [];
  const rows = [];
  list.slice(0, 4).forEach((o, i) => {
    const n = `answer.options.${i}`;
    const name = `Answer ${i + 1}`;
    rows.push({ name: `${n}.label`, label: name, max: 60 });
    if (o?.hide)
      rows.push({
        name: `${n}.hide`,
        label: `${name}, hidden at`,
        type: "place",
      });
    rows.push({
      name: `${n}.lift`,
      label: `${name}, metres above the ground`,
      type: "range",
      min: 0,
      max: LIFT_MAX,
      step: 0.05,
    });
    rows.push({
      name: `${n}.clue`,
      label: `${name}, clue when found`,
      max: 90,
    });
  });
  return [
    { name: "question", label: "Question", prose: true },
    ...rows,
    {
      name: "answer.correct",
      label: "The right answer",
      type: "choice",
      options: list
        .slice(0, 4)
        .map((o, i) => [String(o?.id ?? ""), o?.label || `Answer ${i + 1}`]),
    },
    {
      name: "find.radius",
      label: "Found within, metres",
      type: "range",
      min: RADIUS_MIN,
      max: RADIUS_MAX,
      step: 0.25,
    },
    {
      name: "find.hintAfterS",
      label: "A hint after, seconds",
      type: "range",
      min: HINT_MIN,
      max: HINT_MAX,
      step: 5,
    },
    {
      name: "find.askFirst",
      label: "Show the question while they search",
      type: "toggle",
    },
    {
      name: "choose.radius",
      label: "Pillar radius, metres",
      type: "range",
      min: ZONE_MIN,
      max: ZONE_MAX,
      step: 0.25,
    },
    {
      name: "choose.dwellS",
      label: "Stand in the light for, seconds",
      type: "range",
      min: DWELL_MIN,
      max: DWELL_MAX,
      step: 0.5,
    },
    {
      name: "choose.retry",
      label: "One more try after a wrong answer",
      type: "toggle",
    },
    {
      name: "points",
      label: "Points",
      type: "range",
      min: 0,
      max: 50,
      step: 5,
    },
    { name: "says.right", label: "Guide, when right" },
    { name: "says.retry", label: "Guide, one more try" },
    { name: "says.wrong", label: "Guide, when wrong" },
  ];
}

export const kind = { name: NAME, read, fields, world, card, panel };
