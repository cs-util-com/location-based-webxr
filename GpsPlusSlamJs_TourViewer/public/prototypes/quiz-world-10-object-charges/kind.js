// Answers that listen: the answers are hidden around the station as in "find them, then go back",
// and once all are found the question rises out of the last egg, is read in the place, and flies
// into every egg. The visitor then answers by standing by an egg: it wakes, leans towards them,
// fills with light from below, rises and opens when the dwell is full, and counts down a short
// window in which stepping away takes the answer back. No rings, no markers, next to nothing in the
// card while choosing: the objects themselves show what is happening. On the stage's compact HUD the
// card waits behind the "i", and the screen keeps only the found-dots. Throwaway; not wired to the app.
import {
  BufferGeometry,
  Color,
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
  SphereGeometry,
  Vector2,
} from "three";

const NAME = "object-charges";
const FONT = 'Corbel, "Noto Sans", system-ui, sans-serif';

/* ---------- what the feel rests on: tune here, or with the sliders on the card ---------- */
const RADIUS_DEFAULT = 1.5; // metres: found when the measured position comes this close
const RADIUS_MIN = 0.5;
const RADIUS_MAX = 5;
const HINT_DEFAULT = 25; // seconds without a find before the arrow comes
const HINT_MIN = 5;
const HINT_MAX = 90;
const REACH_DEFAULT = 3; // metres: an egg charges while the measured position is this close
const REACH_MIN = 2;
const REACH_MAX = 5;
// metres from where the visitor stood when an egg took the answer: a step this long takes it back.
// Well above the default jitter (0.1 m, 9 in 10), and about a second's walk.
const STEP_AWAY = 1.5;
const REACH_LET_GO = 1; // metres past the reach before an egg lets go, so jitter at the edge cannot cancel
const SWITCH_MARGIN = 1.5; // metres closer another egg must be to take over the charge
// Seconds of standing by an egg before it takes the answer. Walking straight across a 3 m reach at
// 1.4 m/s takes about 4.3 s, and the charge only starts ARM seconds after stepping in, so passing
// by never locks; a tracking excursion into a wrong reach lasts about a second (the jitter model's
// 1.2 s wander) and drains again long before it fills.
const DWELL_DEFAULT = 4;
const DWELL_MIN = 2;
const DWELL_MAX = 10;
const ARM = 0.6; // seconds inside the reach before the charge starts, so a jitter dip at the edge starts nothing
const DRAIN = 2; // the charge falls this many times faster than it fills
// Seconds a taken answer still waits before it counts: stepping away in that time takes it back.
const GRACE_DEFAULT = 3;
const GRACE_MIN = 1;
const GRACE_MAX = 6;
const YES_GUARD_MS = 350; // the count button wakes a moment after the pick
const APART_MIN = 5; // metres: answers closer than this turn their rings red in edit
const DWELL = 0.25; // seconds inside the found radius, so a jitter spike cannot find
const SEEN_EXTRA = 3; // metres past the found radius where the egg itself starts to show
const TEASE_FAR = 16; // metres: inside this the shimmer grows
const GLINT_SLOW = 4.5; // seconds between glints, far away
const GLINT_FAST = 0.9; // seconds between glints, at the egg
const GLINT_HINT = 0.6; // the hinted egg glints this often
const GLINT_LEN = 0.35; // seconds one glint lasts
const SPARKS = 10; // sparks per egg: the shimmer while searching, the charge while choosing
const GLINT_SIZE = 0.5; // metres, a point sprite
const SPARK_SIZE = 0.17;
const EGG_H = 0.32;
const EGG_R = 0.11;
const CRACK = 0.56; // where it opens, as a share of its height
const LABEL_W = 0.78;
const LABEL_H = (0.78 * 200) / 256; // the cell's own proportion
const LABEL_GAP = 0.08; // metres between the egg's top and the label's foot
const LABEL_FULL = 2.5; // metres: closer than this the label shrinks with the distance
const LABEL_MIN = 0.55;
const LABEL_SHOW = 6; // metres: while choosing, an egg shows its answer when the visitor comes this close
const HOVER = 0.18; // metres an awake egg floats above where it was found
// metres above the ground a full charge brings the egg to: just under the eye, so the story card,
// which takes the lower part of a portrait view, never covers it
const RISE_Y = 1.3;
const COME = 0.5; // metres a charging egg comes towards the visitor
const KEEP = 2.1; // metres a charging egg keeps from the visitor, so egg and label stay in view
const WAKE_SCALE = 0.6; // an awake egg is this much larger, so it is seen across the square
const CHARGE_SCALE = 0;
const POOL_R = 0.8; // metres: the egg's own light on the ground below it
const Q_W = 1.6; // metres: the question as it rises out of the last egg
const Q_H = 0.8;
const Q_FILL = 0.8; // the share of the view's width the question takes
const Q_Y = 1.85;
const Q_RISE = 0.8; // seconds
const Q_SHRINK = 0.4;
const Q_FLY = 1.2; // seconds the question takes to fly into the eggs
const ARROW_AHEAD = 2.6; // metres ahead of the eye
const ARROW_Y = 1.72;
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
  retry: "Not that one. Have another think, and stand by another.",
  wrong: "No, that was not it.",
};

const WHY = {
  for: "The answer is given by the thing itself: standing by it is the choice, and the egg shows it is listening, waking, leaning towards the visitor, filling with light from below, rising and opening when it takes the answer. The card has nothing to do while they choose, so the eyes stay on the place, and the question has flown into the answers, so it is read again exactly where it is needed.",
  against:
    "Standing still is an unusual way to say yes: someone who stops by an answer only to read it, or to talk, may charge it without meaning to, which is why the dwell is longer than walking through takes and why the answer can still be taken back. The light inside a small egg is hard to see in bright sun or from far away, and a badly placed station can still hold a wrong answer for the whole dwell; the answers still need about 5 m between them.",
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
  woke: false, // the question has flown into the eggs, so they listen
  anywhere: false, // the visitor asked to answer without walking there
};
let reopening = false;

// The sliders on the card: a page-long test aid, not part of the record. They start from the
// record whenever it changes.
const tune = {
  key: "",
  radius: RADIUS_DEFAULT,
  hintAfter: HINT_DEFAULT,
  reach: REACH_DEFAULT,
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
  memory.woke = false;
  memory.anywhere = false;
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

// Edit only, and the "what the phone measures" view: a faint fill and a bright rim.
const discGeometry = () =>
  bandsGeometry(
    [
      [0, 0.93, [1, 1, 1, 0.2]],
      [0.93, 1, [1, 1, 1, 0.95]],
    ],
    56,
  );

// Edit only: the reach around a hidden answer, a very faint fill and a bright rim.
const reachGeometry = () =>
  bandsGeometry(
    [
      [0, 0.95, [1, 1, 1, 0.12]],
      [0.95, 1, [1, 1, 1, 0.95]],
      [1, 1.015, [0.07, 0.09, 0.11, 0.6]],
    ],
    72,
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

// A glass skin just outside the whole egg, for the light that fills it from below.
function shellGeometry() {
  const steps = 16;
  const points = [];
  for (let k = 0; k <= steps; k++) {
    const f = k / steps;
    points.push(
      new Vector2(Math.max(0.0005, eggRadius(f) * 1.07 + 0.004), f * EGG_H),
    );
  }
  return new LatheGeometry(points, 20);
}

// The fill: everything below `level` (a share of the egg's height) glows in the egg's colour, with
// a bright, slightly moving surface line; above it the skin is not drawn at all.
function fillMaterial(hue) {
  return new ShaderMaterial({
    uniforms: {
      level: { value: 0 },
      tint: { value: new Color(hue) },
      time: { value: 0 },
    },
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
    side: DoubleSide,
  });
}

/* ---------- the labels: one atlas, a cell per answer ---------- */
const ATLAS = 512;
const CELL_W = 256;
const CELL_H = 200;
const BAND = 34;

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
  const lines = wrapLines(g, text, width);
  const kept = lines.slice(0, room);
  if (lines.length > room && kept.length)
    kept[kept.length - 1] =
      `${kept[kept.length - 1].replace(/\s*\S*$/, "")} ...`;
  return { size, lines: kept };
}

// What a label says, per look. `top` is the small line over the answer: the question while
// choosing, or how to take a held answer back.
const PLATE = {
  found: { band: null, paper: PAPER, ink: INK, word: "Found", clue: true },
  shown: {
    band: "#9aa3ab",
    paper: PAPER,
    ink: INK,
    word: "Shown",
    clue: true,
  },
  edit: { band: null, paper: PAPER, ink: INK, word: "Hidden here", clue: true },
  near: {
    band: null,
    paper: PAPER,
    ink: INK,
    word: "Stand here to choose",
    top: "question",
    clue: true,
  },
  blocked: {
    band: "#aab1b8",
    paper: PAPER,
    ink: INK,
    word: "Step out, then back in",
    top: "question",
    clue: true,
  },
  charging: {
    band: null,
    paper: PAPER,
    ink: INK,
    word: "Stay here...",
    top: "question",
    clue: true,
    edge: "#ffffff",
  },
  held: {
    band: PICK,
    paper: PAPER,
    ink: INK,
    word: "count",
    top: "undo",
    clue: false,
    edge: PICK,
  },
  right: {
    band: RIGHT,
    paper: "#d7fbf4",
    ink: "#04201c",
    word: "Right",
    clue: true,
  },
  wrong: {
    band: WRONG,
    paper: "#d9dcdf",
    ink: "#4d545b",
    word: "Not this",
    clue: true,
  },
  other: {
    band: "#aab1b8",
    paper: "#d9dcdf",
    ink: "#4d545b",
    word: "",
    clue: true,
  },
};
const LOOKS = Object.keys(PLATE);

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

function drawCell(g, option, hue, look, extra) {
  const plate = PLATE[look];
  g.fillStyle = plate.paper;
  g.beginPath();
  g.roundRect(0, 0, CELL_W, CELL_H, 16);
  g.fill();
  g.save();
  g.beginPath();
  g.roundRect(0, 0, CELL_W, CELL_H, 16);
  g.clip();
  g.fillStyle = plate.band ?? hue;
  g.fillRect(0, 0, CELL_W, BAND);
  g.restore();
  const word =
    plate.word === "count"
      ? extra.count
        ? `Yours in ${extra.count} s`
        : "Your answer?"
      : plate.word;
  g.fillStyle = INK;
  g.font = `700 19px ${FONT}`;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(word, 13, BAND / 2 + 1, CELL_W - 52);
  if (extra.tick) drawTick(g, CELL_W - 24, BAND / 2, 20);

  // Measure first, then draw the lines centred in the room under the band.
  const width = CELL_W - 22;
  g.textAlign = "center";
  const topText =
    plate.top === "question"
      ? extra.question
      : plate.top === "undo"
        ? extra.undo
        : "";
  const undo = plate.top === "undo";
  const topWeight = undo ? 700 : 500;
  const top = topText
    ? fitText(g, topText, width, undo ? 40 : 36, [16, 15, 14, 13], topWeight)
    : null;
  const topH = top ? top.lines.length * top.size * 1.15 + 12 : 0;
  const clueOn = plate.clue && option.clue;
  const room = CELL_H - BAND - 14 - topH;
  const head = fitText(
    g,
    option.label,
    width,
    clueOn ? Math.min(72, room * 0.55) : room,
    [30, 27, 24, 21, 18, 16],
    700,
  );
  const headH = head.lines.length * head.size * 1.15;
  const clue = clueOn
    ? fitText(g, option.clue, width, room - headH - 4, [18, 16, 14, 13, 12], 500)
    : null;
  const clueH = clue ? clue.lines.length * clue.size * 1.15 + 4 : 0;
  let y = BAND + Math.max(6, (CELL_H - BAND - topH - headH - clueH) / 2);
  const lines = (fit, weight, alpha, colour) => {
    g.globalAlpha = alpha;
    g.fillStyle = colour;
    g.font = `${weight} ${fit.size}px ${FONT}`;
    for (const l of fit.lines) {
      g.fillText(l, CELL_W / 2, y + (fit.size * 1.15) / 2, width);
      y += fit.size * 1.15;
    }
    g.globalAlpha = 1;
  };
  if (top) {
    lines(top, topWeight, undo ? 1 : 0.7, undo ? "#9a3412" : plate.ink);
    y += 5;
    g.strokeStyle = "rgb(28 33 40 / 22%)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(40, y);
    g.lineTo(CELL_W - 40, y);
    g.stroke();
    y += 7;
  }
  lines(head, 700, 1, plate.ink);
  if (clue) {
    y += 4;
    lines(clue, 500, 0.78, plate.ink);
  }
  if (plate.edge) {
    g.strokeStyle = plate.edge;
    g.lineWidth = 8;
    g.beginPath();
    g.roundRect(4, 4, CELL_W - 8, CELL_H - 8, 13);
    g.stroke();
  }
}

// The question as it rises out of the last egg: an opaque plate, so no edge fringes.
function drawQuestion(question) {
  return (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = PAPER;
    g.beginPath();
    g.roundRect(0, 0, w, h, 26);
    g.fill();
    g.save();
    g.beginPath();
    g.roundRect(0, 0, w, h, 26);
    g.clip();
    g.fillStyle = "#fbbf24";
    g.fillRect(0, 0, w, 44);
    g.restore();
    g.fillStyle = INK;
    g.font = `700 24px ${FONT}`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText("The question", 22, 23);
    g.textAlign = "center";
    const t = fitText(
      g,
      question,
      w - 48,
      h - 44 - 46,
      [38, 34, 30, 26, 22, 19],
      700,
    );
    g.font = `700 ${t.size}px ${FONT}`;
    const block = t.lines.length * t.size * 1.15;
    let y = 44 + (h - 44 - 36 - block) / 2 + (t.size * 1.15) / 2;
    for (const l of t.lines) {
      g.fillText(l, w / 2, y, w - 48);
      y += t.size * 1.15;
    }
    g.globalAlpha = 0.6;
    g.font = `500 18px ${FONT}`;
    g.fillText("It goes into every egg. Tap it once read.", w / 2, h - 22);
    g.globalAlpha = 1;
  };
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

// The egg's light on the ground: white in the middle, gone at the edge; the material tints it.
function drawPool(g, w, h) {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, "rgb(255 255 255 / 85%)");
  r.addColorStop(0.45, "rgb(255 255 255 / 35%)");
  r.addColorStop(1, "rgb(255 255 255 / 0%)");
  g.clearRect(0, 0, w, h);
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
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
    at: -1, // the open answer the visitor stands by, the one that charges
    arm: 0, // seconds at `at`; the charge starts after ARM
    charge: new Float64Array(n), // 0..1 per egg
    blocked: new Uint8Array(n), // stood in when the eggs woke: charges only after stepping out once
    held: -1, // charged full, counting down before it counts
    heldAt: 0,
    heldX: 0, // the measured position when it took the answer
    heldZ: 0,
    mx: 0, // the measured position, in the station's own metres
    mz: 0,
    remote: false, // held from the card, not by standing there
    qT0: -1, // when the question rose
    qCut: -1, // when the visitor tapped it as read
    qFrom: { x: 0, y: 0, z: 0 },
    qTo: { x: 0, y: 0, z: 0 },
    dist: new Float64Array(n), // true horizontal metres, viewer to egg
    measured: new Float64Array(n), // the same from the measured position
    dwell: new Float64Array(n),
    yaw: 0,
    vx: 0, // the viewer in the station's own metres
    vz: 0,
    burst: -1,
    burstAt: 0,
    burstBig: false,
    time: 0,
    render() {},
    paint() {},
  };
  s.isFound = (i) => memory.found.includes(i);
  s.isOpen = (i) => s.isFound(i) && !memory.crossed.has(i);
  s.phase = () =>
    memory.result ? "done" : memory.found.length >= n ? "choose" : "search";
  s.reach = () => (env.mode === "play" ? tune.reach : block.choose.reach);
  s.dwellS = () => (env.mode === "play" ? tune.dwell : block.choose.dwellS);
  s.graceS = () => (env.mode === "play" ? tune.grace : block.choose.graceS);
  s.label = (i) => block.options[i].label;
  s.count = () =>
    Math.max(1, Math.ceil(s.graceS() - (s.time - s.heldAt) - 1e-6));

  s.look = (i) => {
    if (env.mode !== "play") return "edit";
    if (memory.result) {
      if (i === block.correct) return "right";
      return memory.crossed.has(i) ? "wrong" : "other";
    }
    if (memory.crossed.has(i)) return "wrong";
    if (s.phase() === "choose" && memory.woke) {
      if (s.held === i) return "held";
      if (s.blocked[i]) return "blocked";
      if (s.at === i) return "charging";
      return "near";
    }
    return memory.shown.has(i) ? "shown" : "found";
  };

  const changed = () => {
    s.paint();
    s.render();
  };

  s.find = (i) => {
    if (s.isFound(i) || memory.result) return;
    memory.found.push(i);
    memory.wait = 0;
    s.hinting = false;
    s.burst = i;
    s.burstAt = s.time;
    s.burstBig = false;
    const o = block.options[i];
    if (memory.found.length >= n) {
      env.sound("done").play();
      env.say(`All ${COUNT[n].toLowerCase()} found. Here is the question.`, {
        mood: "happy",
        eyebrow: `${n} of ${n} found`,
      });
    } else {
      env.sound("tap").play();
      // The compact HUD keeps this off the screen: the egg's own label says it, in the world.
      if (!env.hud?.compact)
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
    env.say("Here they are. And here is the question.", {
      eyebrow: `${n} of ${n} shown`,
    });
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

  // The question has flown into the eggs: they listen now. An egg the visitor already stands by
  // waits until they step out once, so reading the question there never charges it.
  s.wake = () => {
    if (memory.woke) return;
    memory.woke = true;
    const r = s.reach();
    for (let i = 0; i < n; i++)
      s.blocked[i] = s.measured[i] < r + REACH_LET_GO ? 1 : 0;
    env.sound("tap").play();
    env.say("Stand by your answer until it lights up and takes it.", {
      eyebrow: memory.tries ? "One more try" : "Choose by standing",
    });
    changed();
  };

  s.cutQuestion = () => {
    if (s.qT0 >= 0 && s.qCut < 0) s.qCut = s.time;
  };

  /* choosing: stand by an egg until it is full, then a short window to take it back */
  s.hold = (i, remote) => {
    if (s.phase() !== "choose" || !s.isOpen(i) || memory.result) return;
    s.held = i;
    s.heldX = s.mx;
    s.heldZ = s.mz;
    s.heldAt = s.time;
    s.remote = remote;
    s.charge[i] = 1;
    s.burst = i;
    s.burstAt = s.time;
    s.burstBig = false;
    env.sound("tap").play();
    changed();
  };

  // Quiet on purpose: the egg closes and its light drains, nothing is said.
  s.release = () => {
    if (s.held < 0) return;
    s.held = -1;
    s.remote = false;
    changed();
  };

  const finish = (result) => {
    memory.result = result;
    s.held = -1;
    s.at = -1;
    if (result === "right") {
      memory.earned = memory.tries
        ? Math.floor(block.points / 2)
        : block.points;
      s.burst = block.correct;
      s.burstAt = s.time;
      s.burstBig = true;
      env.sound("right").play();
      // The compact HUD has no card for the points: the guide says them.
      env.say(
        env.hud?.compact && memory.earned > 0
          ? `${block.says.right} +${memory.earned} points.`
          : block.says.right,
        { mood: "happy" },
      );
    } else {
      env.sound("wrong").play();
      env.say(block.says.wrong, { mood: "doubt" });
    }
    changed();
    env.done();
  };

  s.commit = () => {
    const i = s.held;
    if (i < 0 || memory.result) return;
    memory.chosen = i;
    if (i === block.correct) {
      finish("right");
      return;
    }
    memory.crossed.add(i);
    memory.tries += 1;
    s.held = -1;
    s.remote = false;
    s.charge[i] = 0;
    if (s.at === i) s.at = -1;
    if (block.choose.retry && memory.tries < 2) {
      env.sound("wrong").play();
      env.say(block.says.retry, { mood: "doubt", eyebrow: "One more try" });
      changed();
    } else finish("wrong");
  };

  s.answerHere = (on) => {
    if (s.phase() !== "choose") return;
    memory.anywhere = on;
    s.render();
  };

  const setAt = (i) => {
    if (s.at === i) return;
    s.at = i;
    s.arm = 0;
    s.paint();
  };

  // Every frame while choosing. No allocation: reads and rare state changes only.
  s.stepChoose = (dt) => {
    const r = s.reach();
    const dwell = s.dwellS();
    let near = -1;
    let nearD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!s.isOpen(i)) continue;
      if (s.blocked[i]) {
        if (s.measured[i] > r + REACH_LET_GO) {
          s.blocked[i] = 0;
          s.paint();
        }
        continue;
      }
      if (s.measured[i] < nearD) {
        nearD = s.measured[i];
        near = i;
      }
    }
    // who charges: in at the reach, out only past reach + REACH_LET_GO, and another egg takes over
    // only when it is clearly closer
    if (s.at >= 0) {
      const held = s.measured[s.at];
      if (!s.isOpen(s.at) || s.blocked[s.at] || held > r + REACH_LET_GO)
        setAt(-1);
      else if (near !== s.at && nearD < r && nearD < held - SWITCH_MARGIN)
        setAt(near);
    } else if (near >= 0 && nearD < r) setAt(near);

    // A held answer stood for is taken back by walking to another one, or by a step away from where
    // the visitor stood when it took it: leaving the whole reach could take longer than the window.
    // Taken back that way it waits, like an egg stood by when they woke, until they step out once.
    if (s.held >= 0 && !s.remote) {
      const i = s.held;
      if (s.at !== i) s.release();
      else if (Math.hypot(s.mx - s.heldX, s.mz - s.heldZ) > STEP_AWAY) {
        s.release();
        s.blocked[i] = 1;
        s.at = -1;
      }
    }

    for (let i = 0; i < n; i++) {
      if (!s.isOpen(i) || s.held === i) continue;
      if (i === s.at) {
        s.arm += dt;
        if (s.arm >= ARM) {
          s.charge[i] = Math.min(1, s.charge[i] + dt / dwell);
          if (s.charge[i] >= 1) s.hold(i, false);
        }
      } else if (s.charge[i] > 0)
        s.charge[i] = Math.max(0, s.charge[i] - (DRAIN * dt) / dwell);
    }
    // Held by standing, it counts when its window runs out; held from the card, it waits for the
    // visitor's own "Count it", since a timer is the one thing that path must not impose.
    if (s.held >= 0 && !s.remote && s.time - s.heldAt >= s.graceS())
      s.commit();
  };

  s.leave = () => {
    s.outside = true;
    s.hinting = false;
    s.at = -1;
    if (!s.remote) s.release();
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
    tune.reach = block.choose.reach;
    tune.dwell = block.choose.dwellS;
    tune.grace = block.choose.graceS;
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

  const extra = { question: block.question, undo: "", count: 0, tick: false };
  const atlas = env.paintText({
    width: ATLAS,
    height: ATLAS,
    draw(g) {
      g.clearRect(0, 0, ATLAS, ATLAS);
      options.forEach((o, i) => {
        g.save();
        g.translate((i % 2) * CELL_W, (i >> 1) * CELL_H);
        const look = s.look(i);
        extra.count = s.held === i && !s.remote ? s.count() : 0;
        extra.undo = s.remote
          ? "Count it or take it back on the card"
          : "Step away to take it back";
        extra.tick =
          (look === "edit" && i === block.correct) || look === "right";
        drawCell(g, o, HUES[i], look, extra);
        g.restore();
      });
    },
  });
  s.paint = () => atlas.repaint();
  const spark = env.paintText({ width: 64, height: 64, draw: drawSpark });
  spark.premultiplyAlpha = true;
  const poolTex = env.paintText({ width: 64, height: 64, draw: drawPool });
  poolTex.premultiplyAlpha = true;
  const qTex = env.paintText({
    width: 512,
    height: 256,
    draw: drawQuestion(block.question),
  });

  const geos = [];
  const mats = [];
  const labelMat = new MeshBasicMaterial({ map: atlas, alphaTest: 0.5 });
  const discGeo = discGeometry();
  const reachGeo = reachGeometry();
  const shellGeo = shellGeometry();
  const countGeo = new RingGeometry(0.9, 1, 48);
  const poolGeo = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const burstGeo = new SphereGeometry(1, 16, 10);
  const burstMat = new MeshBasicMaterial({
    color: RIGHT,
    transparent: true,
    depthWrite: false,
  });
  geos.push(discGeo, reachGeo, shellGeo, countGeo, poolGeo, burstGeo);
  mats.push(labelMat, burstMat);
  // Nothing of the eggs takes a tap: a tap on one walks the visitor there, in every phase.
  const flat = () => {};

  // Edit only: two answers closer than APART_MIN cannot be told apart by where the visitor stands.
  const crowded = spots.map((p, i) =>
    spots.some(
      (q, j) => j !== i && Math.hypot(q.x - p.x, q.z - p.z) < APART_MIN,
    ),
  );

  const eggs = options.map((o, i) => {
    const group = new Group();
    group.position.set(spots[i].x, o.lift, spots[i].z);
    // The egg leans towards the visitor and swells as it listens: the pivot carries both.
    const pivot = new Group();
    pivot.rotation.order = "YXZ";
    const lowGeo = eggHalf(HUES[i], 0, CRACK);
    const topGeo = eggHalf(HUES[i], CRACK, 1);
    const mat = new MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      side: DoubleSide,
    });
    const low = new Mesh(lowGeo, mat);
    low.raycast = flat;
    const lid = new Group();
    lid.position.y = CRACK * EGG_H;
    const top = new Mesh(topGeo, mat);
    top.raycast = flat;
    lid.add(top);
    const fillMat = fillMaterial(HUES[i]);
    const shell = new Mesh(shellGeo, fillMat);
    shell.raycast = flat;
    shell.renderOrder = 3;
    shell.visible = false;
    pivot.add(low, lid, shell);
    const labelGeo = labelGeometry(i);
    const label = new Mesh(labelGeo, labelMat);
    label.raycast = flat;
    // While a taken answer waits, a ring closes in on the egg: when it reaches it, it counts.
    const countMat = new MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const count = new Mesh(countGeo, countMat);
    count.raycast = flat;
    count.renderOrder = 4;
    count.visible = false;
    group.add(pivot, label, count);
    content.add(group);

    // The egg's light on the ground below it, brighter as it fills.
    const poolMat = new MeshBasicMaterial({
      map: poolTex,
      color: HUES[i],
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    });
    const pool = new Mesh(poolGeo, poolMat);
    pool.position.set(spots[i].x, 0.02, spots[i].z);
    pool.raycast = flat;
    pool.renderOrder = 2;
    pool.visible = false;
    content.add(pool);

    // Edit only: how close a visitor stands to charge it, red when a neighbour is too close to
    // tell apart, and how close they must come to find it.
    if (!play) {
      const ringMat = new MeshBasicMaterial({
        color: crowded[i] ? WRONG : HUES[i],
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      });
      const ring = new Mesh(reachGeo, ringMat);
      ring.position.set(spots[i].x, 0.025, spots[i].z);
      ring.scale.setScalar(block.choose.reach);
      ring.renderOrder = 2;
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
      content.add(ring, disc);
      mats.push(ringMat, discMat);
    }
    geos.push(lowGeo, topGeo, labelGeo);
    mats.push(mat, fillMat, countMat, poolMat);
    const found = s.isFound(i);
    return {
      group,
      pivot,
      mat,
      lid,
      shell,
      fillMat,
      label,
      count,
      countMat,
      pool,
      poolMat,
      hue: new Color(HUES[i]),
      open: found || !play ? 1 : 0,
      pop: found || !play ? 1 : 0,
      wake: 0,
      lean: 0,
      key: -1, // what its label shows now, so the atlas repaints only on a change
    };
  });

  // The question: rises out of the last egg found, waits to be read, then flies into every egg.
  const qGeo = new PlaneGeometry(Q_W, Q_H);
  const qMat = new MeshBasicMaterial({ map: qTex, alphaTest: 0.5 });
  const sign = new Mesh(qGeo, qMat);
  sign.raycast = flat;
  sign.visible = false;
  sign.add(env.hitArea({ radius: 0.7, name: "question" }));
  content.add(sign);
  geos.push(qGeo);
  mats.push(qMat);
  const qHold = clamp(2.5 + block.question.length * 0.05, 4, 11);

  // Glints: one per egg, the tease while searching and the question's flight into the eggs.
  const glintPos = new Float32Array(n * 3);
  const glintCol = new Float32Array(n * 4);
  const sparkPos = new Float32Array(n * SPARKS * 3);
  const sparkCol = new Float32Array(n * SPARKS * 4);
  const glintGeo = new BufferGeometry();
  glintGeo.setAttribute("position", new Float32BufferAttribute(glintPos, 3));
  glintGeo.setAttribute("color", new Float32BufferAttribute(glintCol, 4));
  const sparkGeo = new BufferGeometry();
  sparkGeo.setAttribute("position", new Float32BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute("color", new Float32BufferAttribute(sparkCol, 4));
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
  const glints = new Points(glintGeo, glintMat);
  const sparks = new Points(sparkGeo, sparkMat);
  glints.frustumCulled = sparks.frustumCulled = false; // the positions move every frame
  glints.renderOrder = sparks.renderOrder = 5;
  glints.visible = sparks.visible = play;
  glints.raycast = sparks.raycast = flat;
  content.add(glints, sparks);
  geos.push(glintGeo, sparkGeo);
  mats.push(glintMat, sparkMat);
  const gp = glintGeo.attributes.position.array;
  const gc = glintGeo.attributes.color.array;
  const sp = sparkGeo.attributes.position.array;
  const sc = sparkGeo.attributes.color.array;

  const burst = new Mesh(burstGeo, burstMat);
  burst.renderOrder = 6;
  burst.visible = false;
  burst.raycast = flat;
  content.add(burst);

  // The search arrow: held a little ahead of the eye and turned, in its own plane, towards the
  // nearest egg still hidden. Object metres, not moved with the station.
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

  // What the phone measures: the found or charging reach around the measured position, and where
  // the creator meant the eggs to be. Off unless the card's switch is on.
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
  let seed = 20261108;
  const rnd = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const gauss = () =>
    Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  let jx = 0;
  let jz = 0;

  // Where the question starts and where it is read, once, when all are found.
  const placeQuestion = (frame) => {
    const last = memory.found.length
      ? memory.found[memory.found.length - 1]
      : -1;
    const walked = last >= 0 && !memory.shown.has(last);
    const yaw = frame.viewYaw;
    // far enough ahead that it fits the view, a portrait phone's narrow one included
    const ahead = clamp(Q_W / (2 * Q_FILL * frame.eye.tanH), 2.6, 7);
    s.qTo.x = s.vx + Math.sin(yaw) * ahead;
    s.qTo.z = s.vz + Math.cos(yaw) * ahead;
    s.qTo.y = Q_Y;
    s.qFrom.x = walked ? spots[last].x : s.qTo.x;
    s.qFrom.z = walked ? spots[last].z : s.qTo.z;
    s.qFrom.y = walked ? options[last].lift + EGG_H : 0.3;
  };

  const update = (frame) => {
    const t = frame.time;
    const dt = frame.dt;
    const v = frame.viewer;
    s.time = t;
    s.yaw = frame.viewYaw;
    const k = play ? 1 - Math.exp(-dt / EASE_TAU) : 1;
    const ox = play ? Math.cos(tune.angle) * tune.offset : 0;
    const oz = play ? Math.sin(tune.angle) * tune.offset : 0;
    content.position.set(ox, 0, oz);
    s.vx = v.x - ox;
    s.vz = v.z - oz;
    const radius = play ? tune.radius : block.find.radius;
    const r = s.reach();

    if (dt > 0) {
      const sigma = tune.jitter / P90;
      const pull = dt / JITTER_TAU;
      const kick = sigma * Math.sqrt(2 * pull);
      jx += -jx * pull + kick * gauss();
      jz += -jz * pull + kick * gauss();
    }
    const mx = v.x + jx;
    const mz = v.z + jz;
    s.mx = mx - ox;
    s.mz = mz - oz;

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

    // the last find raises the question in this same frame
    let now = s.phase();
    const asking = play && now === "choose" && !memory.woke && !s.skipped;
    let qa = -1; // seconds since the question rose, while it is up
    let qEnd = qHold;
    if (asking) {
      if (s.qT0 < 0) {
        s.qT0 = t;
        placeQuestion(frame);
      }
      qa = t - s.qT0;
      if (s.qCut >= 0) qEnd = Math.min(qEnd, Math.max(Q_RISE, s.qCut - s.qT0));
      if (qa >= qEnd + 0.2 + Q_FLY) {
        s.wake();
        qa = -1;
      }
    }
    if (qa >= 0) {
      const f = smooth(0, Q_RISE, qa);
      const g = smooth(qEnd, qEnd + Q_SHRINK, qa);
      const size = f * (1 - g);
      sign.visible = size > 0.01;
      // The question is read on it, so it may take more of the view than a label, never more than
      // its share: placed close, or walked into, it would overflow a portrait phone's narrow view.
      sign.scale.setScalar(
        Math.max(0.001, Math.min(size, env.fitWidth(sign, Q_W, Q_FILL))),
      );
      sign.position.set(
        s.qFrom.x + (s.qTo.x - s.qFrom.x) * f,
        s.qFrom.y + (s.qTo.y - s.qFrom.y) * f,
        s.qFrom.z + (s.qTo.z - s.qFrom.z) * f,
      );
      sign.rotation.y = Math.atan2(
        s.vx - sign.position.x,
        s.vz - sign.position.z,
      );
    } else sign.visible = false;
    const flight = qa >= 0 ? (qa - qEnd - 0.2) / Q_FLY : -1;

    const choosing =
      play && now === "choose" && memory.woke && !s.outside && !s.skipped;
    if (choosing) s.stepChoose(dt);
    now = s.phase();
    const live = play && now === "choose" && memory.woke && !s.skipped;

    let repaint = false;
    for (let i = 0; i < n; i++) {
      const e = eggs[i];
      const o = options[i];
      const found = s.isFound(i) || !play;
      const crossed = play && memory.crossed.has(i);
      const d = s.dist[i];
      const isRight = play && now === "done" && i === block.correct;
      const held = play && s.held === i;
      const c0 = play ? s.charge[i] : 0;
      const c = c0 * c0 * (3 - 2 * c0);

      // what the egg is doing: asleep, awake and listening, filling, held open, answered
      const wakeT = (live && s.isOpen(i)) || isRight ? 1 : 0;
      e.wake += (wakeT - e.wake) * k;
      let openT = 1;
      if (play) {
        if (now === "search") openT = s.isFound(i) ? 1 : 0;
        else if (now === "done") openT = isRight ? 1 : 0;
        else openT = held ? 1 : 0; // they close to listen as the question rises
      }
      e.open += (openT - e.open) * k;

      const seen = found ? 1 : smooth(radius + SEEN_EXTRA, radius + 0.3, d);
      e.mat.opacity = crossed ? 0.6 * seen : seen;
      // a crossed egg greys; a filling one darkens, so the light rising in it stands out
      e.mat.color.setScalar(crossed && !isRight ? 0.45 : held ? 1 : 1 - 0.65 * c);
      e.group.visible = seen > 0.01;

      // where: found where it was hidden, floating a little once awake, rising to the chest and
      // coming towards the visitor as it fills
      const base =
        o.lift + e.wake * (HOVER + 0.05 * Math.sin(t * 1.5 + i * 1.7));
      const riseTo = Math.max(base, RISE_Y);
      const lift = held ? 1 : c;
      let gx = spots[i].x;
      let gz = spots[i].z;
      const reachOut = Math.max(lift, d < KEEP ? e.wake : 0);
      if (reachOut > 0 && !s.remote) {
        // An awake egg keeps about arm's length, so it and its label stay in view: walked onto, it
        // floats out ahead; filling, it comes towards the visitor down to that length.
        const ux = d > 0.2 ? (gx - s.vx) / d : Math.sin(s.yaw);
        const uz = d > 0.2 ? (gz - s.vz) / d : Math.cos(s.yaw);
        const want = clamp(d - COME * lift, KEEP, Math.max(d, KEEP));
        const at = d + (want - d) * reachOut;
        gx = s.vx + ux * at;
        gz = s.vz + uz * at;
      }
      e.group.position.set(gx, base + (riseTo - base) * lift, gz);
      const toViewer = Math.atan2(s.vx - gx, s.vz - gz);

      const scale = 1 + WAKE_SCALE * e.wake + CHARGE_SCALE * lift;
      e.lean += (0.3 * e.wake + 0.15 * c - e.lean) * k;
      e.pivot.scale.setScalar(scale);
      e.pivot.rotation.x = e.lean;
      // a found egg rests; one still hidden breathes a little once it shows; a filling egg hums
      e.pivot.rotation.y =
        play && now === "search" && !s.isFound(i)
          ? Math.sin(t * 1.3 + i) * 0.25
          : toViewer;
      e.pivot.rotation.z = held ? 0 : Math.sin(t * 41) * 0.05 * c;
      e.lid.position.y = CRACK * EGG_H + e.open * 0.12;
      e.lid.position.z = -e.open * 0.05;
      e.lid.rotation.x = -e.open * 0.75;

      // the light inside: rises with the charge; once held, the egg is open and glows instead
      e.shell.visible = play && c0 > 0.01 && e.open < 0.3;
      if (e.shell.visible) {
        e.fillMat.uniforms.level.value = c0;
        e.fillMat.uniforms.time.value = t;
      }
      let glow = 0.16 * e.wake + 0.5 * c;
      if (held) glow = 0.55 + 0.2 * Math.sin(t * 8);
      if (isRight) glow = 0.6 + 0.1 * Math.sin(t * 2);
      e.mat.emissive.copy(e.hue).multiplyScalar(glow);

      e.pool.visible = play && (e.wake > 0.02 || held);
      if (e.pool.visible) {
        e.poolMat.opacity = Math.min(
          1,
          0.45 * e.wake + 0.45 * c + (held ? 0.3 : 0),
        );
        e.pool.scale.setScalar(POOL_R * (0.8 + 0.7 * lift));
      }

      // the closing ring while a taken answer waits
      e.count.visible = held;
      if (held) {
        const w = clamp((t - s.heldAt) / s.graceS(), 0, 1);
        e.count.position.y = EGG_H * scale * 0.5;
        e.count.rotation.y = toViewer;
        e.count.scale.setScalar(0.22 + 0.4 * (1 - w));
        e.countMat.opacity = 0.65 + 0.35 * Math.sin(t * 8);
      }

      // the label: open over a found egg while searching; while choosing only on approach
      let labelT = found ? 1 : 0;
      if (play && now === "choose")
        labelT = !memory.woke
          ? 0
          : held || s.at === i
            ? 1
            : smooth(LABEL_SHOW, LABEL_SHOW - 1.5, d);
      if (play && now === "done")
        labelT =
          isRight || i === memory.chosen
            ? 1
            : smooth(LABEL_SHOW, LABEL_SHOW - 1.5, d);
      e.pop += (labelT - e.pop) * k;
      e.label.visible = e.pop > 0.02;
      // standing at the egg, the label shrinks with the distance to the egg as it is drawn now
      const seenAt = Math.hypot(gx - s.vx, gz - s.vz);
      const close =
        play && !(held && s.remote)
          ? clamp(seenAt / LABEL_FULL, LABEL_MIN, 1)
          : 1;
      // and never covers more than about 40 % of the view's width, however close
      const ls = Math.max(
        0.001,
        Math.min(e.pop * close, env.fitWidth(e.label, LABEL_W)),
      );
      e.label.scale.setScalar(ls);
      e.label.position.y = EGG_H * scale + LABEL_GAP + (LABEL_H / 2) * ls;
      e.label.rotation.y = toViewer;

      const key =
        LOOKS.indexOf(s.look(i)) * 100 +
        (held && !s.remote ? s.count() : 0) +
        (s.remote ? 50 : 0);
      if (key !== e.key) {
        e.key = key;
        repaint = true;
      }

      // sparks: the shimmer of a hidden egg, drawn in while one fills, circling one held, flying
      // out of one that has just opened
      const tease = play && !found && now === "search" && !s.skipped;
      const warm = tease ? smooth(TEASE_FAR, radius, d) : 0;
      const hinted = s.hinting && i === s.target;
      const period = hinted
        ? GLINT_HINT
        : GLINT_SLOW + (GLINT_FAST - GLINT_SLOW) * warm;
      const at = (t + i * 1.37) % period;
      let glint =
        tease && at < GLINT_LEN ? Math.sin((Math.PI * at) / GLINT_LEN) : 0;
      glint *= hinted ? 1 : 0.55 + 0.45 * warm;
      const base3 = i * 3;
      gp[base3] = spots[i].x;
      gp[base3 + 1] = o.lift + EGG_H + 0.12;
      gp[base3 + 2] = spots[i].z;
      if (flight > 0 && flight < 1 && s.isOpen(i)) {
        // the question flies into the eggs on an arc
        const f = smooth(0, 1, flight);
        gp[base3] = s.qTo.x + (spots[i].x - s.qTo.x) * f;
        gp[base3 + 1] =
          s.qTo.y +
          (o.lift + EGG_H - s.qTo.y) * f +
          Math.sin(f * Math.PI) * 1.2;
        gp[base3 + 2] = s.qTo.z + (spots[i].z - s.qTo.z) * f;
        glint = 1;
      }
      if (live && s.isOpen(i) && !held && c0 === 0 && flight < 0) {
        // an awake egg glints now and then, so it is caught from across the square
        const p = (t + i * 0.83) % 2.6;
        gp[base3] = e.group.position.x;
        gp[base3 + 1] = e.group.position.y + EGG_H * scale + 0.06;
        gp[base3 + 2] = e.group.position.z;
        glint = p < 0.45 ? 0.85 * e.wake * Math.sin((Math.PI * p) / 0.45) : 0;
      }
      const c4 = i * 4;
      gc[c4] = gc[c4 + 1] = gc[c4 + 2] = 1;
      gc[c4 + 3] = glint;

      const cy = e.group.position.y + EGG_H * scale * 0.5;
      const burstAge = s.burst === i && !s.burstBig ? (t - s.burstAt) / 1.1 : 2;
      for (let j = 0; j < SPARKS; j++) {
        const b = (i * SPARKS + j) * 3;
        const q = (i * SPARKS + j) * 4;
        sc[q] = sc[q + 1] = sc[q + 2] = 1;
        const turn = (j * Math.PI * 2) / SPARKS;
        if (tease) {
          const a = t * 0.9 + turn + i;
          const rr = 0.26 + 0.08 * Math.sin(t * 1.3 + j);
          const rise = (j * 0.37 + t * 0.22) % 1;
          sp[b] = spots[i].x + Math.cos(a) * rr;
          sp[b + 1] = o.lift + 0.05 + rise * 0.7;
          sp[b + 2] = spots[i].z + Math.sin(a) * rr;
          const twinkle = 0.3 + 0.7 * Math.max(0, Math.sin(t * 5 + j * 1.9));
          sc[q + 3] = warm * warm * twinkle * (1 - rise * 0.6);
        } else if (burstAge < 1) {
          const rr = 0.2 + burstAge * 1.4;
          sp[b] = e.group.position.x + Math.cos(turn) * rr;
          sp[b + 1] = cy + burstAge * 0.9 * (0.5 + (j % 3) * 0.3);
          sp[b + 2] = e.group.position.z + Math.sin(turn) * rr;
          sc[q + 3] = 1 - burstAge;
        } else if (held) {
          const a = t * 2.2 + turn;
          sp[b] = e.group.position.x + Math.cos(a) * 0.4;
          sp[b + 1] = cy + 0.12 * Math.sin(t * 3 + j);
          sp[b + 2] = e.group.position.z + Math.sin(a) * 0.4;
          sc[q + 3] = 0.85;
        } else if (c0 > 0 && s.at === i) {
          // drawn in from all around, faster as it fills
          const fr = (j / SPARKS + t * (0.5 + c0)) % 1;
          const a = turn + t * 1.4;
          const rr = 0.18 + 0.9 * (1 - fr);
          sp[b] = e.group.position.x + Math.cos(a) * rr;
          sp[b + 1] = cy + (1 - fr) * 0.5 * Math.sin(turn * 3);
          sp[b + 2] = e.group.position.z + Math.sin(a) * rr;
          sc[q + 3] = Math.min(1, c0 * 2.5) * fr;
        } else sc[q + 3] = 0;
      }
    }
    if (repaint) s.paint();
    glintGeo.attributes.position.needsUpdate = true;
    glintGeo.attributes.color.needsUpdate = true;
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;

    // The search arrow faces the eye; pointing up means straight ahead, sideways means turn.
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
      reach.scale.setScalar(now === "choose" ? r : radius);
    }

    // a flash of light out of the egg that takes an answer, a big one for the right answer
    if (s.burst >= 0) {
      const age = (t - s.burstAt) / (s.burstBig ? 1.4 : 0.8);
      burst.visible = age < 1 && (s.burstBig || now !== "search");
      if (age < 1) {
        const e = eggs[s.burst];
        burst.position.set(
          e.group.position.x,
          e.group.position.y + EGG_H,
          e.group.position.z,
        );
        burst.scale.setScalar((s.burstBig ? 0.3 + age * 2.2 : 0.2 + age) * 1);
        burstMat.color.set(s.burstBig ? RIGHT : HUES[s.burst]);
        burstMat.opacity = 0.7 * (1 - age);
      } else s.burst = -1;
    }
  };

  return {
    object,
    update,
    tap(hit) {
      if (hit.name === "question") s.cutQuestion();
    },
    leave: s.leave,
    back: s.back,
    dispose() {
      s.close();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      atlas.dispose();
      spark.dispose();
      poolTex.dispose();
      qTex.dispose();
      reopening = true;
      queueMicrotask(() => (reopening = false));
    },
  };
}

/* ---------- the story card: DOM, inside el only ---------- */
const CSS = `
[data-kind="${NAME}"] .oc-q { margin-top: 2px; font-size: 13.5px; line-height: 1.3; color: var(--walk-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
[data-kind="${NAME}"] .oc-q b { color: var(--walk-ink); font-weight: 600; }
[data-kind="${NAME}"] .oc-count { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
[data-kind="${NAME}"] .oc-count b { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .oc-pips { display: flex; gap: 6px; }
[data-kind="${NAME}"] .oc-pips i { width: 18px; height: 22px; border-radius: 50% 50% 46% 46% / 58% 58% 42% 42%; border: 1.5px dashed rgb(255 255 255 / 45%); }
[data-kind="${NAME}"] .oc-pips i.on { border: 0; background: var(--hue); box-shadow: inset 0 -5px 0 rgb(255 255 255 / 55%); }
[data-kind="${NAME}"] .oc-found { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
[data-kind="${NAME}"] .oc-found > span { max-width: 100%; padding: 3px 9px; border-radius: 9px; border-left: 4px solid var(--hue); background: rgb(255 255 255 / 10%); font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-kind="${NAME}"] .oc-note { margin-top: 8px; font-size: 13.5px; line-height: 1.3; color: var(--walk-muted); }
[data-kind="${NAME}"] .oc-rest { margin-top: 8px; }
[data-kind="${NAME}"] .oc-alt { display: inline-flex; align-items: center; min-height: 40px; margin-top: 2px; padding: 0; border: 0; background: none; color: var(--walk-muted); font: inherit; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
[data-kind="${NAME}"] .answers .a { flex-direction: column; gap: 2px; text-align: center; border-left: 5px solid var(--hue); }
[data-kind="${NAME}"] .answers .a small { font-size: 12.5px; font-weight: 500; line-height: 1.25; opacity: 0.8; }
[data-kind="${NAME}"] .oc-yes { display: flex; gap: 8px; margin-top: 8px; }
[data-kind="${NAME}"] .oc-yes .btn { min-height: 48px; }
[data-kind="${NAME}"] .oc-yes .btn:not(.primary) { flex: none; }
[data-kind="${NAME}"] .oc-pill { margin-top: 8px; }
[data-kind="${NAME}"] .oc-pill .plus { margin-left: 0; }
[data-kind="${NAME}"] details { margin-top: 6px; border-top: 1px solid var(--walk-line); }
[data-kind="${NAME}"] summary { display: flex; align-items: center; min-height: 36px; font-size: 13px; font-weight: 600; color: var(--walk-muted); cursor: pointer; list-style: none; }
[data-kind="${NAME}"] summary::-webkit-details-marker { display: none; }
[data-kind="${NAME}"] summary::before { content: "+"; display: inline-block; width: 18px; font-weight: 700; }
[data-kind="${NAME}"] details[open] summary::before { content: "-"; }
[data-kind="${NAME}"] .f { margin-top: 4px; }
[data-kind="${NAME}"] .f output { float: right; color: var(--walk-ink); font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .oc-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
[data-kind="${NAME}"] .oc-row .btn { min-height: 40px; padding: 6px 12px; font-size: 13.5px; }
[data-kind="${NAME}"] .oc-read { margin-top: 6px; font-size: 12.5px; line-height: 1.35; color: var(--walk-muted); font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .oc-why p { margin: 0 0 8px; font-size: 13.5px; line-height: 1.4; }
[data-kind="${NAME}"] .oc-why b { display: block; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--walk-found); }
@media (orientation: landscape) and (max-height: 520px) {
  [data-kind="${NAME}"] .oc-count { margin-top: 6px; }
  [data-kind="${NAME}"] .oc-found { margin-top: 5px; }
  [data-kind="${NAME}"] .oc-note { margin-top: 5px; font-size: 12.5px; }
  [data-kind="${NAME}"] .oc-alt { min-height: 34px; }
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

function whyParas(box) {
  const a = make("p");
  a.append(make("b", "", "Why 3D"), document.createTextNode(WHY.for));
  const b = make("p");
  b.append(
    make("b", "", "The strongest case against"),
    document.createTextNode(WHY.against),
  );
  box.append(a, b);
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

// One folded row at the foot of the card: the test sliders and the case for and against. The
// card itself stays nearly empty while choosing.
function aboutBlock(s) {
  const box = make("details", "oc-why");
  box.append(make("summary", "", "Try the feel, and why this design"));
  box.append(
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
      "An egg listens within",
      {
        min: REACH_MIN,
        max: REACH_MAX,
        step: 0.5,
        value: tune.reach,
        unit: "m",
        format: metres,
      },
      (v) => (tune.reach = v),
    ),
    slider(
      "Stand by it for",
      {
        min: DWELL_MIN,
        max: DWELL_MAX,
        step: 0.5,
        value: tune.dwell,
        unit: "s",
        format: (x) => x.toFixed(1),
      },
      (v) => (tune.dwell = v),
    ),
    slider(
      "Then it can be taken back for",
      {
        min: GRACE_MIN,
        max: GRACE_MAX,
        step: 0.5,
        value: tune.grace,
        unit: "s",
        format: (x) => x.toFixed(1),
      },
      (v) => (tune.grace = v),
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
  const row = make("div", "oc-row");
  const again = make("button", "btn", "Place the station off again");
  again.type = "button";
  again.addEventListener("click", () => {
    tune.angle = (tune.angle + 2.2 + Math.random() * 1.8) % (Math.PI * 2);
  });
  row.append(again);
  const read = make("p", "oc-read");
  const note = make(
    "p",
    "oc-read",
    `Why ${DWELL_DEFAULT} s: walking straight across a ${REACH_DEFAULT} m reach takes about ${((REACH_DEFAULT * 2) / 1.4).toFixed(1)} s and the light only starts ${ARM} s after stepping in, so passing by never takes an answer, and a tracking wander into the wrong reach (about a second) drains before it fills. Stepping ${REACH_LET_GO} m past the reach lets go, so jitter at the edge neither starts nor stops it; once an egg has taken the answer, a ${STEP_AWAY} m step from where you stood takes it back. Jitter and the placement error move the measured position the way AR tracking would.`,
  );
  box.append(toggle, row, read, note);
  whyParas(box);
  const tick = () => {
    if (!box.open) return;
    const lines = [];
    const i = s.phase() === "search" ? s.target : s.at >= 0 ? s.at : s.held;
    if (i >= 0)
      lines.push(
        `"${s.label(i)}": ${s.dist[i].toFixed(1)} m, measured ${s.measured[i].toFixed(1)} m, light ${Math.round(s.charge[i] * 100)} %.`,
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
  const { box, tick: tickAbout } = aboutBlock(s);
  el.append(host, box);
  const { options } = block;
  const n = options.length;
  const compact = env.hud?.compact === true;
  let note = null;
  let heldNote = null;
  let yesTimer = 0;

  const pill = () => {
    const row = make("p", "oc-pill");
    if (memory.result === "right" && memory.earned > 0)
      row.append(make("span", "plus", `+${memory.earned}`));
    else row.append(make("span", "plus none", "No points"));
    return row;
  };

  const tiles = (pickable) => {
    const wrap = make("div", "answers small");
    for (const i of memory.found) {
      const o = options[i];
      let cls = "a";
      if (!pickable) {
        if (i === block.correct) cls += i === memory.chosen ? " right" : " was";
        else cls += memory.crossed.has(i) ? " wrong" : " dim";
      } else if (memory.crossed.has(i)) cls += " wrong";
      if (pickable && s.held === i) cls += " on";
      const b = make("button", cls);
      b.type = "button";
      b.disabled = !pickable || memory.crossed.has(i);
      if (pickable) b.dataset.answer = String(i);
      b.style.setProperty("--hue", HUES[i]);
      b.append(make("span", "", o.label));
      if (o.clue) b.append(make("small", "", o.clue));
      wrap.append(b);
    }
    return wrap;
  };

  const searchNote = () => {
    if (s.skipped) return "";
    if (s.outside) return "Come back inside the circle to keep looking.";
    if (s.hinting) return "Follow the arrow.";
    const left = Math.max(0, Math.ceil(tune.hintAfter - memory.wait));
    return `Look for a glint. A hint in ${left} s.`;
  };

  const heldText = () =>
    s.held >= 0 ? `"${options[s.held].label}" is your answer?` : "";

  s.render = () => {
    clearTimeout(yesTimer);
    host.replaceChildren();
    note = null;
    if (compact)
      env.hud.dots(
        s.phase() === "search" && !s.skipped ? n : 0,
        memory.found.map((i) => HUES[i]),
      );
    heldNote = null;
    const phase = s.phase();
    if (phase === "done") {
      host.append(tiles(false));
      if (block.points > 0) host.append(pill());
      return;
    }
    if (phase === "choose") {
      // While choosing the card holds one quiet way to answer without walking, and nothing else.
      if (!memory.woke || s.skipped) return;
      if (s.outside) {
        host.append(
          make("p", "oc-note", "Come back inside the circle to choose."),
        );
        return;
      }
      if (!memory.anywhere) {
        const alt = make("button", "oc-alt", "Cannot walk there? Choose here");
        alt.type = "button";
        alt.dataset.act = "here";
        host.append(alt);
        return;
      }
      const q = make("p", "oc-q");
      q.append(
        make("b", "", "The question: "),
        document.createTextNode(block.question),
      );
      host.append(q, tiles(true));
      if (s.held >= 0 && s.remote) {
        heldNote = make("p", "oc-note", heldText());
        heldNote.setAttribute("aria-live", "polite");
        const row = make("div", "oc-yes");
        const yes = make("button", "btn primary", "Count it");
        yes.type = "button";
        yes.dataset.act = "count";
        // wakes a moment later, for a thumb that is still moving from the answer it tapped
        yes.disabled = true;
        yesTimer = setTimeout(() => (yes.disabled = false), YES_GUARD_MS);
        const back = make("button", "btn", "Take it back");
        back.type = "button";
        back.dataset.act = "undo";
        row.append(yes, back);
        host.append(heldNote, row);
      } else {
        const close = make("button", "oc-alt", "Close the list");
        close.type = "button";
        close.dataset.act = "walk";
        host.append(close);
      }
      return;
    }
    if (block.find.askFirst) {
      const q = make("p", "oc-q");
      q.append(
        make("b", "", "The question: "),
        document.createTextNode(block.question),
      );
      host.append(q);
    }
    // The compact HUD shows none of this: the stage's dots say how many, the eggs say which, and
    // the hint comes as the guide's line when it is due. The question asked first and the way out
    // stay in the card, behind the "i".
    if (!compact) {
      const count = make("div", "oc-count");
      const pips = make("span", "oc-pips");
      pips.setAttribute("aria-hidden", "true");
      for (let k = 0; k < n; k++) {
        const pip = make("i", k < memory.found.length ? "on" : "");
        if (k < memory.found.length)
          pip.style.setProperty("--hue", HUES[memory.found[k]]);
        pips.append(pip);
      }
      count.append(
        make("b", "", `${memory.found.length} of ${n} found`),
        pips,
      );
      host.append(count);
      if (memory.found.length) {
        const found = make("div", "oc-found");
        for (const i of memory.found) {
          const chip = make("span", "", options[i].label);
          chip.style.setProperty("--hue", HUES[i]);
          found.append(chip);
        }
        host.append(found);
      }
      note = make("p", "oc-note", searchNote());
      host.append(note);
    }
    if (memory.hinted && !s.skipped) {
      const rest = make(
        "button",
        "btn oc-rest",
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
    else if (act === "here") s.answerHere(true);
    else if (act === "walk") s.answerHere(false);
    else if (act === "undo") s.release();
    else if (act === "count") s.commit();
    else if (b.dataset.answer !== undefined) {
      const i = Number(b.dataset.answer);
      if (s.held === i) return;
      s.hold(i, true);
    }
  });

  const phase = s.phase();
  if (phase === "search") {
    const intro = `${COUNT[n]} answers are hidden around this square, each by the thing it is about. Find them all; then stand by the one you think is right until it takes your answer.`;
    env.say(
      memory.found.length
        ? `${memory.found.length} of ${n} found. Keep looking.`
        : intro,
      { eyebrow: "Find them, then stand by one" },
    );
  } else if (phase === "choose")
    env.say(
      memory.woke
        ? "Stand by your answer until it lights up and takes it."
        : `All ${COUNT[n].toLowerCase()} found. Here is the question.`,
      { eyebrow: memory.tries ? "One more try" : "Choose by standing" },
    );
  else env.say(block.question, { ask: true });
  s.render();
  if (phase === "done") env.done();

  const ticker = setInterval(() => {
    if (note && s.phase() === "search") {
      const text = searchNote();
      if (note.textContent !== text) note.textContent = text;
    }
    if (heldNote) {
      const text = heldText();
      if (heldNote.textContent !== text) heldNote.textContent = text;
    }
    tickAbout();
    // read by the page's own checks: which egg listens, how full it is, which one is held
    host.dataset.at = String(s.at);
    host.dataset.charge = s.at >= 0 ? s.charge[s.at].toFixed(2) : "0";
    host.dataset.held = String(s.held);
  }, 300);
  // The stage hides this element when the story moves on. Without an answer that is a skip, and
  // the seam has no other word for it, so the tease, the charge and the hints stop on this.
  const watch = new MutationObserver(() => {
    if (el.hidden && !memory.result) {
      s.skipped = true;
      s.release();
    }
  });
  watch.observe(el, { attributes: true, attributeFilter: ["hidden"] });
  return {
    dispose() {
      clearInterval(ticker);
      clearTimeout(yesTimer);
      watch.disconnect();
    },
  };
}

/* ---------- the edit panel: only what a FieldSpec cannot say ---------- */
function panel(raw, el) {
  addStyle(el);
  const list = Array.isArray(raw.answer?.options) ? raw.answer.options : [];
  const unplaced = list
    .map((o, i) => (o && !o.hide ? o.label || `Answer ${i + 1}` : null))
    .filter(Boolean);
  el.append(
    make(
      "p",
      "oc-note",
      `Drag a ring to hide an answer. The filled disc is how close a visitor must come to find it; the outer ring is how close they stand for the egg to listen and fill. Keep answers at least ${APART_MIN} m apart: a ring turns red when a neighbour is closer.`,
    ),
  );
  const close = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]?.hide;
      const b = list[j]?.hide;
      if (!a || !b) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < APART_MIN)
        close.push(
          `${list[i].label || `Answer ${i + 1}`} and ${list[j].label || `Answer ${j + 1}`} (${d.toFixed(1)} m)`,
        );
    }
  if (close.length)
    el.append(
      make(
        "p",
        "oc-note",
        `Too close to tell apart by standing: ${close.join("; ")}. Move them at least ${APART_MIN} m apart.`,
      ),
    );
  if (unplaced.length)
    el.append(
      make(
        "p",
        "oc-note",
        `Not hidden yet, so waiting beside the nearest things: ${unplaced.join(", ")}.`,
      ),
    );
  const why = make("details", "oc-why");
  why.append(make("summary", "", "Why this is in 3D, and the case against"));
  whyParas(why);
  el.append(why);
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
      reach: num(choose.reach, REACH_DEFAULT, REACH_MIN, REACH_MAX),
      dwellS: num(choose.dwellS, DWELL_DEFAULT, DWELL_MIN, DWELL_MAX),
      graceS: num(choose.graceS, GRACE_DEFAULT, GRACE_MIN, GRACE_MAX),
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
      name: "choose.reach",
      label: "An egg listens within, metres",
      type: "range",
      min: REACH_MIN,
      max: REACH_MAX,
      step: 0.5,
    },
    {
      name: "choose.dwellS",
      label: "Stand by it for, seconds",
      type: "range",
      min: DWELL_MIN,
      max: DWELL_MAX,
      step: 0.5,
    },
    {
      name: "choose.graceS",
      label: "Then it can be taken back for, seconds",
      type: "range",
      min: GRACE_MIN,
      max: GRACE_MAX,
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
