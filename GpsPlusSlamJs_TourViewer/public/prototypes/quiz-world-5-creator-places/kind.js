// The creator places the answers. Each answer is a marker the creator stands where it belongs in
// the place (beside the fountain, under the tree), and the visitor answers by walking there,
// standing in its circle for a moment and confirming with one tap. The place is the answer.
//
// The editor side is the new part:
// - on the 3D view a marker is dragged by its ring (the stage's place handles);
// - on site, in AR, it is put where the creator stands, or where the creator aims at the ground
//   (the aim mark stands in for AR's tap on the ground, which this stage keeps for walking);
// - a marker can be moved again or taken out of the place;
// - two answers closer than the warning distance are drawn red and joined, with the gap in metres
//   and how often the phone would mix them up.
//
// Play runs on a SIMULATED phone position: the true walker plus a slowly drifting error, so close
// answers visibly blur together. The white dot on the ground is where the phone thinks you are.
import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Vector3,
} from "three";

const NAME = "creator-places";
const FONT = 'Corbel, "Noto Sans", system-ui, sans-serif';

/* ---------- what the feel rests on: tune here ---------- */
const P90_MEASURED = 3.6; // metres: the fused position is off by up to this for 9 readings in 10
const RADIAL_P90 = Math.sqrt(-2 * Math.log(0.1)); // 2.146: a 2D normal's p90 radius, in sigmas
const CIRCLE_MIN = 5; // metres: a found circle is never under 5 m
const CIRCLE_MAX = 8;
const CIRCLE_DEFAULT = 5;
const GAP_MIN = 2; // metres: the spacing warning's range, a slider so it can be felt
const GAP_MAX = 10;
const GAP_DEFAULT = 7; // about twice the p90 error: neighbours mixed up about 1 time in 50
const ROOM = 11; // metres from the item's foot: inside the station's 12 m ring
const DWELL = 1.5; // seconds inside a circle before it asks; long enough to filter a passing drift
const EXIT_MARGIN = 1; // metres past the circle before it lets go
const SWITCH_MARGIN = 1; // metres closer another marker must be to take over
const ARM_AFTER = 1.5; // metres walked before a circle may answer: the phone never answers for you
const SECOND_TAP = 0.6; // seconds: a double tap cannot answer unread
const YES_GUARD_MS = 350; // the confirm button wakes a moment later, for a thumb already moving
const DRIFT_TAU = 8; // seconds: how slowly the simulated error wanders (real ones are slower)
const TALLY_N = 100; // samples at 10 Hz: "where the phone put you" over the last 10 s
const TALLY_DT = 0.1;
const TRAIL_N = 48; // the phone's last guesses, one every quarter second
const TRAIL_DT = 0.25;
const AIM_MAX = 25; // metres: the aim mark ignores ground further than this
const POST_H = 1.95;
const POST_R = 0.045;
const SIGN_W = 1.6;
const SIGN_H = 0.8;
const NEAR_SIZE = 8; // metres: further than this a sign grows, so it stays readable
const SIZE_MAX = 2.2;
const NEAR_RISE = 3; // metres: nearer than this a sign climbs, so it never fills the view

// The simulated phone. "Typical" is the measured p90; the others bracket it.
const NOISE = [
  { id: "off", label: "Off", p90: 0 },
  { id: "good", label: "Good", p90: 1.8 },
  { id: "typical", label: "Typical", p90: P90_MEASURED },
  { id: "poor", label: "Poor", p90: 6 },
];
let noiseId = "typical"; // kept across opens, so a mode switch does not reset the choice

const LETTERS = "ABCD";
const HUES = ["#fbbf24", "#7dd3fc", "#fda4af", "#c4b5fd"];
const RIGHT = "#2dd4bf";
const WRONG = "#f87171";
const ACCENT = "#fb923c";
const INK = "#1c2128";
const PAPER = "#fbf8f0";
const GREY = "#aab1b8";

const SAYS = {
  right: "Yes, that is the place.",
  retry: "Not there. Have another look around, one more try.",
  wrong: "No, it was not there.",
};

const sigmaOf = (p90) => p90 / RADIAL_P90;
const noiseNow = () => NOISE.find((n) => n.id === noiseId) ?? NOISE[2];
const idOf = (slot) => `answer-${LETTERS[slot].toLowerCase()}`;
const round1 = (v) => Math.round(v * 10) / 10;

/* ---------- how often a neighbour wins: the number the spacing warning rests on ---------- */
// Abramowitz and Stegun 7.1.26, good to 1.5e-7: enough for "about 1 time in N".
function erfc(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
    Math.exp(-x * x);
  return x >= 0 ? y : 2 - y;
}

/** The chance that a walker standing on one marker is read as nearer to a neighbour `gap`
 *  metres away, with the measured error. It ignores the dwell and the margins, which help a
 *  little, and the other markers, which hurt a little. */
function misreadChance(gap, p90 = P90_MEASURED) {
  if (!(p90 > 0)) return 0;
  return 0.5 * erfc(gap / (2 * sigmaOf(p90) * Math.SQRT2));
}

function oneIn(p) {
  if (p >= 0.45) return "about every other time";
  if (p < 1 / 500) return "less than 1 time in 500";
  return `about 1 time in ${Math.max(2, Math.round(1 / p))}`;
}

/* ---------- the record: shared by read() and the edit panel ---------- */
function readAt(v) {
  if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.z)) return null;
  const d = Math.hypot(v.x, v.z);
  if (d <= ROOM) return { x: v.x, z: v.z };
  return { x: (v.x / d) * ROOM, z: (v.z / d) * ROOM };
}

/** The four answer slots of a raw record: text, id and place, a slot without text is empty. */
function slotsOf(v) {
  const list = Array.isArray(v?.answer?.options) ? v.answer.options : [];
  const slots = [];
  for (let slot = 0; slot < 4; slot++) {
    const o = list[slot];
    const text =
      typeof o?.label === "string" ? o.label.trim().slice(0, 80) : "";
    slots.push({
      slot,
      letter: LETTERS[slot],
      hue: HUES[slot],
      id: typeof o?.id === "string" && o.id ? o.id : idOf(slot),
      text,
      at: text ? readAt(o?.at) : null,
    });
  }
  return slots;
}

const gapOf = (v) =>
  Math.min(GAP_MAX, Math.max(GAP_MIN, Number(v?.warnGap) || GAP_DEFAULT));
const circleOf = (v) =>
  Math.min(
    CIRCLE_MAX,
    Math.max(CIRCLE_MIN, Number(v?.circle) || CIRCLE_DEFAULT),
  );

/** Every pair of placed answers closer than `gap`, closest first. */
function crowdedPairs(answers, gap) {
  const pairs = [];
  for (let i = 0; i < answers.length; i++) {
    for (let j = i + 1; j < answers.length; j++) {
      const a = answers[i].at;
      const b = answers[j].at;
      if (!a || !b) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < gap) pairs.push({ i, j, d });
    }
  }
  return pairs.sort((p, q) => p.d - q.d);
}

/** The pairs worth a line on the ground: a pair whose line runs through a third marker is
 *  left to the two shorter lines it already has, so a row of markers is not drawn twice. */
function drawnPairs(answers, pairs) {
  return pairs.filter(({ i, j, d }) => {
    const a = answers[i].at;
    const b = answers[j].at;
    return !answers.some((m, k) => {
      if (k === i || k === j || !m.at || d < 0.05) return false;
      const t =
        ((m.at.x - a.x) * (b.x - a.x) + (m.at.z - a.z) * (b.z - a.z)) / (d * d);
      if (t <= 0 || t >= 1) return false;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      return Math.hypot(m.at.x - x, m.at.z - z) < 1;
    });
  });
}

/* ---------- geometry: everything flat is merged, so a marker costs few draw calls ---------- */
const rgba = (hex, a) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
};

function fromSoup(pos, col) {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 4));
  return g;
}

function pour(geo, color, pos, col, y = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    pos.push(p.getX(i), p.getY(i) + y, p.getZ(i));
    col.push(color[0], color[1], color[2], color[3]);
  }
  if (g !== geo) g.dispose();
  geo.dispose();
}

const flatRing = (a, b, n = 64) =>
  new RingGeometry(a, b, n).rotateX(-Math.PI / 2);

// A surveyor's pole: bands read against a pale sky, dark paving and a camera image alike.
// Every placed marker's pole in one mesh: they never move while a world is open.
function postsGeometry(answers) {
  const pos = [];
  const col = [];
  const bands = 5;
  const band = POST_H / bands;
  for (const a of answers) {
    if (!a.at) continue;
    for (let i = 0; i < bands; i++) {
      const part = new CylinderGeometry(POST_R, POST_R, band, 6, 1, true);
      part.translate(a.at.x, 0, a.at.z);
      pour(part, rgba(i % 2 ? PAPER : INK, 1), pos, col, band * (i + 0.5));
    }
  }
  return fromSoup(pos, col);
}

// Edit's ground in one mesh: each answer's found circle as a thin outline, and the space it
// needs of its own (half the warning distance) as a filled disc, red where a pair is too close.
function editGroundGeometry(answers, r, half, crowded) {
  const pos = [];
  const col = [];
  answers.forEach((a, i) => {
    if (!a.at) return;
    const hex = crowded.has(i) ? WRONG : a.hue;
    const ring = (inner, outer, alpha) => {
      const g = flatRing(inner, outer);
      g.translate(a.at.x, 0, a.at.z);
      pour(g, rgba(hex, alpha), pos, col);
    };
    ring(0, half - 0.06, 0.2);
    ring(half - 0.06, half, 0.8);
    ring(r - 0.05, r, 0.5);
  });
  return fromSoup(pos, col);
}

// A found circle: a faint fill, a bright rim and a thin dark edge, so it reads on any ground.
function circleGeometry(r, fill) {
  const pos = [];
  const col = [];
  const band = (a, b, tint) => pour(flatRing(a, b), tint, pos, col);
  band(0, r - 0.2, [1, 1, 1, fill]);
  band(r - 0.2, r - 0.03, [1, 1, 1, 0.95]);
  band(r - 0.03, r + 0.04, [0.07, 0.09, 0.11, 0.6]);
  return fromSoup(pos, col);
}

function pushTri(pos, col, tint, ax, az, bx, bz, cx, cz) {
  pos.push(ax, 0, az, bx, 0, bz, cx, 0, cz);
  for (let i = 0; i < 3; i++) col.push(tint[0], tint[1], tint[2], tint[3]);
}

function pushDash(pos, col, tint, x, z, dx, dz, half, width) {
  const sx = -dz * width;
  const sz = dx * width;
  const ax = x - dx * half;
  const az = z - dz * half;
  const bx = x + dx * half;
  const bz = z + dz * half;
  pushTri(pos, col, tint, ax + sx, az + sz, bx - sx, bz - sz, bx + sx, bz + sz);
  pushTri(pos, col, tint, ax + sx, az + sz, ax - sx, az - sz, bx - sx, bz - sz);
}

// A red dashed line between every pair that sits too close.
function linkGeometry(answers, pairs) {
  const pos = [];
  const col = [];
  const dark = [0.07, 0.09, 0.11, 0.6];
  const red = rgba(WRONG, 1);
  for (const { i, j, d } of pairs) {
    const a = answers[i].at;
    const b = answers[j].at;
    if (d < 0.05) continue;
    const dx = (b.x - a.x) / d;
    const dz = (b.z - a.z) / d;
    for (let at = 0.3; at < d - 0.2; at += 0.7) {
      const x = a.x + dx * at;
      const z = a.z + dz * at;
      pushDash(pos, col, dark, x, z, dx, dz, 0.25, 0.09);
      pushDash(pos, col, red, x, z, dx, dz, 0.21, 0.06);
    }
  }
  return fromSoup(pos, col);
}

// The aim mark: where the middle of the view meets the ground.
function aimGeometry() {
  const pos = [];
  const col = [];
  const dark = [0.07, 0.09, 0.11, 0.65];
  const hue = rgba(ACCENT, 1);
  pour(flatRing(0.36, 0.52, 40), dark, pos, col);
  pour(flatRing(0.39, 0.49, 40), hue, pos, col);
  for (const [dx, dz] of [
    [1, 0],
    [0, 1],
  ]) {
    pushDash(pos, col, dark, 0, 0, dx, dz, 0.3, 0.05);
    pushDash(pos, col, hue, 0, 0, dx, dz, 0.27, 0.025);
  }
  return fromSoup(pos, col);
}

// Where the phone thinks you are: a white dot with a dark edge.
function ghostGeometry() {
  const pos = [];
  const col = [];
  pour(flatRing(0, 0.3, 24), [0.07, 0.09, 0.11, 0.8], pos, col);
  pour(flatRing(0, 0.24, 24), [1, 1, 1, 1], pos, col);
  return fromSoup(pos, col);
}

// The ring the phone is 9 times in 10 sure you stand inside: radius 1, scaled to the p90.
function spreadGeometry() {
  const pos = [];
  const col = [];
  pour(flatRing(0.965, 1.0, 72), [0.07, 0.09, 0.11, 0.55], pos, col);
  pour(flatRing(0.975, 0.99, 72), [1, 1, 1, 0.9], pos, col);
  return fromSoup(pos, col);
}

/* ---------- one atlas: every sign and every gap label share a single canvas ---------- */
const ATLAS = 512;
const CELL_W = 256;
const CELL_H = 128;
const BAND = 78;
const LAB_W = 128;
const LAB_H = 42;
const LAB_Y = 2 * CELL_H + 8;
const LAB_MAX = 6; // four markers make at most six pairs

function cellGeometry(w, h, px, py, pw, ph) {
  const g = new PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const inset = 2;
  for (let i = 0; i < uv.count; i++) {
    const u = px + inset + uv.getX(i) * (pw - inset * 2);
    const v = py + inset + (1 - uv.getY(i)) * (ph - inset * 2);
    uv.setXY(i, u / ATLAS, 1 - v / ATLAS);
  }
  return g;
}

const signCell = (slot) => [(slot % 2) * CELL_W, (slot >> 1) * CELL_H];
const labelCell = (n) => [(n % 4) * LAB_W, LAB_Y + Math.floor(n / 4) * LAB_H];

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

function fitText(g, text, width, height) {
  for (const size of [34, 30, 26, 23, 20, 17, 15]) {
    g.font = `700 ${size}px ${FONT}`;
    const lines = wrapLines(g, text, width);
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (lines.length * size * 1.12 <= height && widest <= width)
      return { size, lines };
  }
  return { size: 15, lines: wrapLines(g, text, width).slice(0, 5) };
}

const PLATE = {
  open: { band: null, paper: PAPER, ink: INK, edge: null },
  here: { band: null, paper: PAPER, ink: INK, edge: ACCENT },
  crossed: { band: WRONG, paper: "#d9dcdf", ink: "#4d545b", edge: null },
  out: { band: GREY, paper: "#d9dcdf", ink: "#4d545b", edge: null },
  right: { band: RIGHT, paper: "#d7fbf4", ink: "#04201c", edge: RIGHT },
  was: { band: RIGHT, paper: PAPER, ink: INK, edge: RIGHT },
  crowded: { band: null, paper: PAPER, ink: INK, edge: WRONG },
};

function drawGlyph(g, glyph, x, y, s, color = INK) {
  g.strokeStyle = color;
  g.lineWidth = s * 0.22;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  if (glyph === "tick") {
    g.moveTo(x - s * 0.5, y + s * 0.05);
    g.lineTo(x - s * 0.12, y + s * 0.42);
    g.lineTo(x + s * 0.5, y - s * 0.4);
  } else {
    g.moveTo(x - s * 0.4, y - s * 0.4);
    g.lineTo(x + s * 0.4, y + s * 0.4);
    g.moveTo(x + s * 0.4, y - s * 0.4);
    g.lineTo(x - s * 0.4, y + s * 0.4);
  }
  g.stroke();
}

function drawSign(g, a, look, markRight) {
  const plate = PLATE[look];
  g.fillStyle = plate.paper;
  g.fillRect(0, 0, CELL_W, CELL_H);
  g.fillStyle = plate.band ?? a.hue;
  g.fillRect(0, 0, BAND, CELL_H);
  g.fillStyle = INK;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `800 60px ${FONT}`;
  const glyph =
    look === "right" || look === "was"
      ? "tick"
      : look === "crossed"
        ? "cross"
        : null;
  if (glyph) {
    g.fillText(a.letter, BAND / 2, CELL_H / 2 - 18);
    drawGlyph(g, glyph, BAND / 2, CELL_H / 2 + 30, 26);
  } else g.fillText(a.letter, BAND / 2, CELL_H / 2 + 3);

  const room = CELL_W - BAND - 20;
  const { size, lines } = fitText(g, a.text, room, CELL_H - 20);
  g.fillStyle = plate.ink;
  g.font = `700 ${size}px ${FONT}`;
  const lh = size * 1.12;
  const y0 = (CELL_H - lines.length * lh) / 2 + lh / 2 + 1;
  const cx = BAND + (CELL_W - BAND) / 2;
  lines.forEach((l, i) => g.fillText(l, cx, y0 + i * lh, room));

  if (markRight) {
    g.fillStyle = RIGHT;
    g.beginPath();
    g.arc(CELL_W - 20, 20, 15, 0, Math.PI * 2);
    g.fill();
    drawGlyph(g, "tick", CELL_W - 20, 19, 15, "#04201c");
  }
  if (plate.edge) {
    g.strokeStyle = plate.edge;
    g.lineWidth = 10;
    g.strokeRect(5, 5, CELL_W - 10, CELL_H - 10);
  }
}

function drawLabel(g, text) {
  g.fillStyle = "#1c2128";
  g.beginPath();
  g.roundRect(1, 1, LAB_W - 2, LAB_H - 2, 12);
  g.fill();
  g.fillStyle = WRONG;
  g.beginPath();
  g.roundRect(4, 4, LAB_W - 8, LAB_H - 8, 9);
  g.fill();
  g.fillStyle = "#2a0606";
  g.font = `800 25px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, LAB_W / 2, LAB_H / 2 + 1, LAB_W - 14);
}

/* ---------- the aim: where the middle of the view meets the ground ---------- */
const aimDir = new Vector3();
/** Writes the aim point into `out` ({ x, z }) and answers true, or false while the view looks
 *  at the sky or at ground too far away to mean anything. */
function aimAt(frame, out) {
  const eye = frame.eye;
  aimDir.set(0, 0, -1).applyQuaternion(eye.quaternion);
  if (aimDir.y > -0.03) return false;
  const t = -eye.position.y / aimDir.y;
  const x = eye.position.x + aimDir.x * t;
  const z = eye.position.z + aimDir.z * t;
  if (Math.hypot(x - eye.position.x, z - eye.position.z) > AIM_MAX)
    return false;
  out.x = x;
  out.z = z;
  return true;
}

/* ---------- a seeded random, so the same walk drifts the same way ---------- */
function makeRandom(seed) {
  let s = seed >>> 0;
  let spare = Number.NaN;
  const uniform = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return function gauss() {
    if (!Number.isNaN(spare)) {
      const v = spare;
      spare = Number.NaN;
      return v;
    }
    let u = 0;
    while (u === 0) u = uniform();
    const m = Math.sqrt(-2 * Math.log(u));
    const a = 2 * Math.PI * uniform();
    spare = m * Math.sin(a);
    return m * Math.cos(a);
  };
}

/* ---------- the quiz's state: the world part and the card share one record, per open ---------- */
const sessions = new WeakMap();

function makeSession(block, env) {
  const { answers } = block;
  const r = block.circle;
  const n = answers.length;
  const gauss = makeRandom(20261108);
  const sigma0 = sigmaOf(noiseNow().p90);
  const s = {
    picked: -1,
    armed: false, // the walk answers only after the first steps, never where the question opened
    openX: Number.NaN,
    openZ: Number.NaN,
    via: "", // "walk" | "tap" | "card"
    pickedAt: 0,
    standing: -1,
    dismissed: -1, // "Not this one": it stays quiet until the phone has you out of the circle
    dwell: 0,
    crossed: new Set(),
    tries: 0,
    result: null, // null | "right" | "wrong"
    chosen: -1,
    earned: 0,
    outside: false,
    skipped: false,
    time: 0,
    dist: new Float64Array(n), // from where the phone thinks you are
    ex: gauss() * sigma0, // the simulated error, metres, starting from its steady spread
    ez: gauss() * sigma0,
    fx: 0, // where the phone thinks you are
    fz: 0,
    tally: new Int8Array(TALLY_N).fill(-2), // -2 no sample, -1 in no circle, else the answer
    tallyAt: 0,
    tallyClock: 0,
    burst: -1,
    burstAt: 0,
    closed: false,
    render() {}, // the card
    paint() {}, // the signs
  };

  const line = (text, opts) => env.say(text, opts);
  const changed = () => {
    s.paint();
    s.render();
  };
  s.quiet = () => s.outside || s.skipped;

  s.look = (i) => {
    if (s.result === "right") return i === s.chosen ? "right" : "out";
    if (s.result === "wrong") {
      if (i === block.right) return "was";
      return s.crossed.has(i) ? "crossed" : "out";
    }
    if (s.crossed.has(i)) return "crossed";
    return s.picked === i ? "here" : "open";
  };

  s.clear = (silent) => {
    if (s.picked < 0) return;
    s.picked = -1;
    s.via = "";
    if (!silent)
      line(block.question, {
        ask: true,
        eyebrow: s.tries ? "One more try" : "A question",
      });
    changed();
  };

  s.select = (i, via) => {
    if (s.result || s.crossed.has(i)) return;
    if (s.picked === i) {
      if (via === "walk") s.via = "walk";
      changed();
      return;
    }
    s.picked = i;
    s.via = via;
    s.pickedAt = s.time;
    const a = answers[i];
    if (via !== "walk") env.sound("tap").play();
    line(`${a.letter}: "${a.text}". Is that your answer?`, {
      ask: true,
      eyebrow:
        via === "walk"
          ? `The phone puts you at ${a.letter}`
          : `Answer ${a.letter}`,
    });
    changed();
  };

  const finish = (result) => {
    s.result = result;
    s.picked = -1;
    s.via = "";
    s.standing = -1;
    if (result === "right") {
      s.earned = s.tries ? Math.floor(block.points / 2) : block.points;
      s.burst = answers[s.chosen].at ? s.chosen : -1;
      s.burstAt = s.time;
      env.sound("right").play();
      line(SAYS.right, { mood: "happy" });
    } else {
      env.sound("wrong").play();
      line(SAYS.wrong, { mood: "doubt" });
    }
    changed();
    env.done();
  };

  s.confirm = () => {
    if (s.picked < 0 || s.result) return;
    const i = s.picked;
    s.chosen = i;
    if (i === block.right) {
      finish("right");
      return;
    }
    s.crossed.add(i);
    s.picked = -1;
    s.via = "";
    s.tries += 1;
    if (s.tries < 2) {
      env.sound("wrong").play();
      line(SAYS.retry, { mood: "doubt", eyebrow: "One more try" });
      changed();
    } else finish("wrong");
  };

  s.decline = () => {
    if (s.picked < 0) return;
    if (s.standing === s.picked) s.dismissed = s.picked;
    s.clear();
  };

  s.tapMarker = (i) => {
    if (s.result) return;
    if (s.crossed.has(i)) {
      line(`You tried ${answers[i].letter} already. Try another one.`, {
        mood: "doubt",
        eyebrow: "One more try",
      });
      return;
    }
    if (s.picked === i) {
      if (s.time - s.pickedAt >= SECOND_TAP) s.confirm();
      return;
    }
    s.select(i, "tap");
  };

  const setStanding = (i) => {
    s.standing = i;
    s.dwell = 0;
    if (i !== s.dismissed) s.dismissed = -1;
    if (i >= 0 && i !== s.dismissed) s.select(i, "walk");
    else if (i < 0 && s.via === "walk") s.clear();
  };

  /** The simulated phone, every frame: no allocation. */
  s.stepPhone = (viewer, dt) => {
    const sigma = sigmaOf(noiseNow().p90);
    if (dt > 0) {
      if (sigma > 0) {
        const a = Math.exp(-dt / DRIFT_TAU);
        const kick = sigma * Math.sqrt(1 - a * a);
        s.ex = s.ex * a + kick * gauss();
        s.ez = s.ez * a + kick * gauss();
      } else s.ex = s.ez = 0;
    }
    if (Number.isNaN(s.openX)) {
      s.openX = viewer.x;
      s.openZ = viewer.z;
    } else if (!s.armed)
      s.armed = Math.hypot(viewer.x - s.openX, viewer.z - s.openZ) > ARM_AFTER;
    s.fx = viewer.x + s.ex;
    s.fz = viewer.z + s.ez;
    for (let i = 0; i < n; i++) {
      const at = answers[i].at;
      s.dist[i] = at ? Math.hypot(s.fx - at.x, s.fz - at.z) : Infinity;
    }
  };

  /** Which circle the phone has you in: the nearest open one inside its radius. */
  s.nearest = () => {
    let near = -1;
    let nearD = Infinity;
    for (let i = 0; i < n; i++) {
      if (s.crossed.has(i)) continue;
      if (s.dist[i] < nearD) {
        nearD = s.dist[i];
        near = i;
      }
    }
    return nearD < r ? near : -1;
  };

  s.stepStanding = (dt) => {
    if (!s.armed) {
      s.dwell = 0;
      return;
    }
    let near = -1;
    let nearD = Infinity;
    for (let i = 0; i < n; i++) {
      if (s.crossed.has(i)) continue;
      if (s.dist[i] < nearD) {
        nearD = s.dist[i];
        near = i;
      }
    }
    if (s.standing >= 0) {
      const held = s.dist[s.standing];
      if (held > r + EXIT_MARGIN || s.crossed.has(s.standing)) setStanding(-1);
      else if (near !== s.standing && nearD < r && nearD < held - SWITCH_MARGIN)
        setStanding(near);
      return;
    }
    if (near >= 0 && nearD < r) {
      s.dwell += dt;
      if (s.dwell >= DWELL) setStanding(near);
    } else s.dwell = 0;
  };

  s.stepTally = (dt) => {
    s.tallyClock += dt;
    while (s.tallyClock >= TALLY_DT) {
      s.tallyClock -= TALLY_DT;
      s.tally[s.tallyAt] = s.nearest();
      s.tallyAt = (s.tallyAt + 1) % TALLY_N;
    }
  };

  /** Shares of the last 10 s: per answer, and in no circle. Null before any sample. */
  s.shares = () => {
    const counts = new Array(n).fill(0);
    let none = 0;
    let all = 0;
    for (let k = 0; k < TALLY_N; k++) {
      const v = s.tally[k];
      if (v === -2) continue;
      all += 1;
      if (v < 0) none += 1;
      else counts[v] += 1;
    }
    return all ? { counts, none, all } : null;
  };

  s.leave = () => {
    s.outside = true;
    s.standing = -1;
    s.dismissed = -1;
    s.clear();
  };
  s.back = () => {
    s.outside = false;
  };
  s.close = () => {
    s.closed = true;
    s.render = () => {};
    s.paint = () => {};
  };
  return s;
}

/* ---------- the world part: one for play and edit ---------- */
function world(block, env) {
  const play = env.mode === "play";
  const s = makeSession(block, env);
  sessions.set(block, s);
  const { answers, circle: r } = block;
  const object = new Group();
  const tooClose = play ? [] : crowdedPairs(answers, block.warnGap);
  const crowded = new Set(tooClose.flatMap((p) => [p.i, p.j]));
  const pairs = drawnPairs(answers, tooClose).slice(0, LAB_MAX);

  const atlas = env.paintText({
    width: ATLAS,
    height: ATLAS,
    draw(g) {
      answers.forEach((a, i) => {
        const [x, y] = signCell(a.slot);
        g.save();
        g.translate(x, y);
        g.beginPath();
        g.rect(0, 0, CELL_W, CELL_H);
        g.clip();
        const look = play ? s.look(i) : crowded.has(i) ? "crowded" : "open";
        drawSign(g, a, look, !play && i === block.right);
        g.restore();
      });
      pairs.forEach((p, k) => {
        const [x, y] = labelCell(k);
        g.save();
        g.translate(x, y);
        drawLabel(g, `${p.d.toFixed(1)} m`);
        g.restore();
      });
    },
  });
  s.paint = () => atlas.repaint();

  const flat = () => {}; // paint on the ground takes no tap, so a tap there walks the visitor in
  const vertex = (extra) =>
    new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      ...extra,
    });
  const postMat = new MeshBasicMaterial({ vertexColors: true });
  const signMat = new MeshBasicMaterial({ map: atlas });
  const geos = [];
  const mats = [postMat, signMat];
  const keep = (geo) => (geos.push(geo), geo);
  const own = (mat) => (mats.push(mat), mat);
  const poles = new Mesh(keep(postsGeometry(answers)), postMat);
  poles.raycast = flat; // the hit areas take the taps
  object.add(poles);
  const circleGeo = play ? keep(circleGeometry(r, 0.14)) : null;

  const markers = answers.map((a, i) => {
    if (!a.at) return null;
    const post = new Group();
    post.name = `marker-${i}`;
    post.position.set(a.at.x, 0, a.at.z);
    const head = new Group();
    head.position.y = POST_H + SIGN_H / 2 - 0.05;
    const [px, py] = signCell(a.slot);
    const signGeo = keep(cellGeometry(SIGN_W, SIGN_H, px, py, CELL_W, CELL_H));
    head.add(
      new Mesh(signGeo, signMat),
      env.hitArea({ radius: 0.9, name: post.name }),
    );
    post.add(
      head,
      env.hitArea({ radius: 0.6, at: new Vector3(0, 1.1, 0), name: post.name }),
    );
    object.add(post);
    if (!play) return { post, head, disc: null, circleMat: null };
    const circleMat = own(vertex({ color: a.hue, opacity: 0.85 }));
    const disc = new Mesh(circleGeo, circleMat);
    disc.position.set(a.at.x, 0.03, a.at.z);
    disc.renderOrder = 2;
    disc.raycast = flat;
    object.add(disc);
    return { post, head, disc, circleMat };
  });

  /* edit only: the circles and the space each answer needs, the red links, the gap labels,
     the aim mark */
  const labels = [];
  let aim = null;
  if (!play) {
    const ground = new Mesh(
      keep(editGroundGeometry(answers, r, block.warnGap / 2, crowded)),
      own(vertex()),
    );
    ground.position.y = 0.02;
    ground.renderOrder = 1;
    ground.raycast = flat;
    object.add(ground);
    if (pairs.length) {
      const links = new Mesh(keep(linkGeometry(answers, pairs)), own(vertex()));
      links.position.y = 0.04;
      links.renderOrder = 3;
      links.raycast = flat;
      object.add(links);
    }
    pairs.forEach((p, k) => {
      const a = answers[p.i].at;
      const b = answers[p.j].at;
      const [lx, ly] = labelCell(k);
      const plate = new Mesh(
        keep(cellGeometry(0.9, 0.3, lx, ly, LAB_W, LAB_H)),
        signMat,
      );
      // Above the stage's own ring labels, which stand at about half a metre.
      plate.position.set((a.x + b.x) / 2, 1.15, (a.z + b.z) / 2);
      plate.raycast = flat;
      object.add(plate);
      labels.push(plate);
    });
    aim = new Mesh(keep(aimGeometry()), own(vertex()));
    aim.position.y = 0.05;
    aim.renderOrder = 4;
    aim.raycast = flat;
    aim.visible = false;
    object.add(aim);
  }

  /* play only: where the phone thinks you are, its spread, its last guesses, the burst */
  let ghost = null;
  let spread = null;
  let trail = null;
  let trailGeo = null;
  let burst = null;
  let burstMat = null;
  let trailAt = 0;
  let trailCount = 0;
  let trailClock = 0;
  if (play) {
    ghost = new Mesh(keep(ghostGeometry()), own(vertex()));
    ghost.renderOrder = 5;
    ghost.raycast = flat;
    spread = new Mesh(keep(spreadGeometry()), own(vertex()));
    spread.renderOrder = 5;
    spread.raycast = flat;
    trailGeo = keep(new BufferGeometry());
    trailGeo.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array(TRAIL_N * 3), 3),
    );
    trailGeo.setDrawRange(0, 0);
    trail = new Points(
      trailGeo,
      own(
        new PointsMaterial({
          color: "#ffffff",
          size: 0.16,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
        }),
      ),
    );
    trail.frustumCulled = false;
    trail.renderOrder = 5;
    trail.raycast = flat;
    burstMat = own(
      new MeshBasicMaterial({
        color: RIGHT,
        transparent: true,
        depthWrite: false,
      }),
    );
    burst = new Mesh(keep(flatRing(0.9, 1, 64)), burstMat);
    burst.visible = false;
    burst.raycast = flat;
    object.add(ghost, spread, trail, burst);
  }

  const spot = { x: 0, z: 0 };
  const update = (frame) => {
    const v = frame.viewer;
    const t = frame.time;
    s.time = t;
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      if (!m) continue;
      const dx = v.x - m.post.position.x;
      const dz = v.z - m.post.position.z;
      const d = Math.hypot(dx, dz);
      // Far signs grow so their words stay readable; near ones keep their size.
      const size = Math.min(SIZE_MAX, Math.max(1, d / NEAR_SIZE));
      m.head.rotation.y = Math.atan2(dx, dz);
      m.head.scale.setScalar(size);
      // Standing at the marker, the sign rises out of the way of the view.
      const rise = Math.max(0, (NEAR_RISE - d) / NEAR_RISE) * 1.3;
      m.head.position.y = POST_H + (SIGN_H * size) / 2 - 0.05 + rise;
    }

    if (!play) {
      for (let k = 0; k < labels.length; k++) {
        const l = labels[k];
        l.rotation.y = Math.atan2(v.x - l.position.x, v.z - l.position.z);
      }
      aim.visible = aimAt(frame, spot);
      if (aim.visible) aim.position.set(spot.x, 0.05, spot.z);
      return;
    }

    s.stepPhone(v, frame.dt);
    const open = s.result === null && !s.quiet();
    if (open) {
      s.stepStanding(frame.dt);
      s.stepTally(frame.dt);
    }
    const p90 = noiseNow().p90;
    const showPhone = open && p90 > 0;
    ghost.visible = showPhone;
    spread.visible = showPhone;
    trail.visible = showPhone;
    if (showPhone) {
      ghost.position.set(s.fx, 0.07, s.fz);
      spread.position.set(s.fx, 0.06, s.fz);
      spread.scale.setScalar(p90);
      trailClock += frame.dt;
      if (trailClock >= TRAIL_DT) {
        trailClock = 0;
        const arr = trailGeo.attributes.position.array;
        arr[trailAt * 3] = s.fx;
        arr[trailAt * 3 + 1] = 0.08;
        arr[trailAt * 3 + 2] = s.fz;
        trailAt = (trailAt + 1) % TRAIL_N;
        trailCount = Math.min(TRAIL_N, trailCount + 1);
        trailGeo.setDrawRange(0, trailCount);
        trailGeo.attributes.position.needsUpdate = true;
      }
    }

    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      if (!m) continue;
      m.disc.visible = open && !s.crossed.has(i);
      if (!m.disc.visible) continue;
      const inside = s.dist[i] < r;
      // Every circle the phone has you in pulses: two at once is the blur, made visible.
      m.circleMat.opacity =
        s.picked === i
          ? 0.82 + Math.sin(t * 6) * 0.18
          : inside
            ? 0.7 + Math.sin(t * 3.4) * 0.25
            : 0.55;
    }

    if (s.burst >= 0) {
      const age = (t - s.burstAt) / 1.1;
      burst.visible = age < 1;
      if (burst.visible) {
        const at = answers[s.burst].at;
        burst.position.set(at.x, 0.05, at.z);
        burst.scale.setScalar(r * (1 + age * 1.3));
        burstMat.opacity = 1 - age;
      } else s.burst = -1;
    }
  };

  return {
    object,
    update,
    tap(hit) {
      const name = hit.name ?? "";
      if (name.startsWith("marker-")) s.tapMarker(Number(name.slice(7)));
    },
    leave: s.leave,
    back: s.back,
    dispose() {
      s.close();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      atlas.dispose();
    },
  };
}

/* ---------- the story card: DOM, inside el only ---------- */
const CSS = `
[data-kind="${NAME}"] .cp-row { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; margin-top: 10px; }
[data-kind="${NAME}"] .cp-row .a { flex-direction: column; gap: 0; min-height: 56px; padding: 4px 2px 3px; font-size: 19px; border-bottom: 5px solid var(--hue); }
[data-kind="${NAME}"] .cp-row .a small { font-size: 12.5px; font-weight: 600; color: var(--walk-muted); font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .cp-row .a.wrong small { color: inherit; }
[data-kind="${NAME}"] .cp-note { margin-top: 8px; font-size: 13.5px; line-height: 1.3; color: var(--walk-muted); }
[data-kind="${NAME}"] .cp-blur { margin-top: 8px; padding: 7px 10px; border-radius: 10px; background: rgb(255 255 255 / 8%); font-size: 13.5px; line-height: 1.35; font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .cp-blur b { font-weight: 700; }
[data-kind="${NAME}"] .cp-blur.two { background: rgb(248 113 113 / 18%); }
[data-kind="${NAME}"] .cp-yes { display: flex; gap: 8px; margin-top: 10px; }
[data-kind="${NAME}"] .cp-yes .btn { min-height: 56px; }
[data-kind="${NAME}"] .cp-yes .btn:not(.primary) { flex: none; }
[data-kind="${NAME}"] .answers .a b { font-weight: 800; margin-right: 2px; }
[data-kind="${NAME}"] .cp-pill { margin-top: 8px; }
[data-kind="${NAME}"] .cp-pill .plus { margin-left: 0; }
[data-kind="${NAME}"] .cp-sim { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--walk-line); }
[data-kind="${NAME}"] .cp-sim .cp-simh { font-size: 11.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--walk-muted); }
[data-kind="${NAME}"] .cp-chips { display: flex; flex-wrap: wrap; gap: 5px; }
[data-kind="${NAME}"] .cp-chips button { min-height: 36px; padding: 4px 10px; border-radius: 19px; border: 1px solid rgb(255 255 255 / 30%); background: transparent; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .cp-chips button[aria-pressed="true"] { background: #fff; color: #14171d; border-color: #fff; }
[data-kind="${NAME}"] .cp-why { margin-top: 12px; padding: 9px 11px; border-radius: 12px; background: rgb(255 255 255 / 7%); font-size: 13.5px; line-height: 1.38; }
[data-kind="${NAME}"] .cp-why summary { cursor: pointer; font-weight: 700; color: var(--walk-ink); }
[data-kind="${NAME}"] .cp-why p { margin-top: 6px; color: var(--walk-muted); }
[data-kind="${NAME}"] .cp-why b { color: var(--walk-ink); }
[data-kind="${NAME}"] .cp-h { margin-top: 14px; font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--walk-muted); }
[data-kind="${NAME}"] .cp-warn { margin-top: 6px; padding: 7px 10px; border-radius: 10px; font-size: 13.5px; line-height: 1.35; background: rgb(255 255 255 / 7%); }
[data-kind="${NAME}"] .cp-warn.bad { background: rgb(248 113 113 / 18%); color: #fecaca; }
[data-kind="${NAME}"] .cp-warn.ok { background: rgb(45 212 191 / 14%); color: #c6f7ee; }
[data-kind="${NAME}"] .cp-slot { display: grid; grid-template-columns: 34px 1fr; gap: 4px 8px; align-items: center; margin-top: 8px; padding: 8px; border-radius: 12px; background: rgb(255 255 255 / 6%); }
[data-kind="${NAME}"] .cp-slot i { grid-row: span 2; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; background: var(--hue); color: #1c2128; font-style: normal; font-weight: 800; font-size: 18px; }
[data-kind="${NAME}"] .cp-slot span { min-width: 0; font-size: 13.5px; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-kind="${NAME}"] .cp-slot span small { display: block; color: var(--walk-muted); font-size: 12px; }
[data-kind="${NAME}"] .cp-acts { display: flex; flex-wrap: wrap; gap: 5px; }
[data-kind="${NAME}"] .cp-acts .btn { min-height: 38px; padding: 5px 9px; font-size: 13px; }
[data-kind="${NAME}"] .cp-acts .btn:disabled { opacity: 0.45; cursor: default; }
@media (orientation: landscape) and (max-height: 520px) {
  [data-kind="${NAME}"] .cp-row { margin-top: 6px; }
  [data-kind="${NAME}"] .cp-row .a { min-height: 46px; font-size: 16px; }
  [data-kind="${NAME}"] .cp-yes .btn { min-height: 46px; }
  [data-kind="${NAME}"] .cp-note, [data-kind="${NAME}"] .cp-blur { margin-top: 5px; font-size: 12.5px; }
  [data-kind="${NAME}"] .cp-sim { margin-top: 8px; padding-top: 6px; }
}
`;

function make(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function addStyle(el) {
  const style = document.createElement("style");
  style.textContent = CSS;
  el.append(style);
}

/** The simulation's own row: not part of a tour, it makes the phone's error something to feel. */
function simRow(s) {
  const wrap = make("div", "cp-sim");
  wrap.append(
    make("p", "cp-simh", "Phone error, simulated"),
  );
  const chips = make("div", "cp-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Simulated position error");
  for (const level of NOISE) {
    const b = make(
      "button",
      "",
      level.p90 ? `${level.p90} m` : level.label,
    );
    b.type = "button";
    b.dataset.noise = level.id;
    b.title = level.p90
      ? `${level.label}: off by up to ${level.p90} m for 9 readings in 10`
      : "No error: the phone knows exactly where you are";
    b.setAttribute("aria-pressed", String(level.id === noiseId));
    chips.append(b);
  }
  chips.addEventListener("click", (e) => {
    const b = e.target.closest("[data-noise]");
    if (!b) return;
    const before = sigmaOf(noiseNow().p90);
    noiseId = b.dataset.noise;
    const after = sigmaOf(noiseNow().p90);
    // Keep the drift's direction and give it the new size at once, so the change is visible.
    if (before > 0) {
      s.ex *= after / before;
      s.ez *= after / before;
    } else {
      s.ex = after * 0.7;
      s.ez = -after * 0.7;
    }
    for (const c of chips.children)
      c.setAttribute("aria-pressed", String(c.dataset.noise === noiseId));
  });
  wrap.append(chips);
  return wrap;
}

function card(block, el, env) {
  const s = sessions.get(block);
  if (!s) return null;
  addStyle(el);
  const host = make("div");
  const sim = simRow(s);
  el.append(host, sim);
  const { answers } = block;
  let yesTimer = 0;
  let chips = [];
  let blurEl = null;

  const row = () => {
    const wrap = make("div", "cp-row");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "The answers");
    chips = [];
    answers.forEach((a, i) => {
      const b = make("button", "a");
      b.type = "button";
      b.style.setProperty("--hue", a.hue);
      b.dataset.answer = String(i);
      b.setAttribute("aria-label", `Answer ${a.letter}, ${a.text}`);
      const crossed = s.crossed.has(i);
      if (crossed) b.classList.add("wrong");
      b.disabled = crossed;
      const metres = make("small");
      b.append(make("span", "", a.letter), metres);
      chips[i] = metres;
      wrap.append(b);
    });
    return wrap;
  };

  const tiles = () => {
    const wrap = make("div", "answers small");
    answers.forEach((a, i) => {
      const look = s.look(i);
      const cls =
        look === "right"
          ? "right"
          : look === "was"
            ? "was"
            : look === "crossed"
              ? "wrong"
              : "dim";
      const b = make("button", `a ${cls}`);
      b.type = "button";
      b.disabled = true;
      b.append(make("b", "", a.letter), make("span", "", a.text));
      wrap.append(b);
    });
    return wrap;
  };

  // The live lines: metres from the phone's guess, and what it said over the last 10 s.
  const tick = () => {
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i];
      if (!c) continue;
      const text = !answers[i].at
        ? "card only"
        : s.standing === i
          ? "here"
          : `${Math.round(s.dist[i])} m`;
      if (c.textContent !== text) c.textContent = text;
    }
    if (!blurEl) return;
    const shares = s.shares();
    const inside = [];
    for (let i = 0; i < answers.length; i++)
      if (!s.crossed.has(i) && s.dist[i] < block.circle)
        inside.push(answers[i].letter);
    const parts = [];
    if (shares) {
      shares.counts.forEach((c, i) => {
        if (c)
          parts.push(
            `${answers[i].letter} ${Math.round((c / shares.all) * 100)} %`,
          );
      });
      if (shares.none)
        parts.push(
          `none ${Math.round((shares.none / shares.all) * 100)} %`,
        );
    }
    const now =
      inside.length > 1
        ? `inside ${inside.join(" and ")} at once`
        : inside.length
          ? `inside ${inside[0]}`
          : "in no circle";
    const text = `The phone (white dot): ${now}. Last 10 s: ${parts.join(", ") || "nothing yet"}.`;
    if (blurEl.textContent !== text) blurEl.textContent = text;
    blurEl.classList.toggle("two", inside.length > 1 || parts.length > 2);
  };

  s.render = () => {
    clearTimeout(yesTimer);
    host.replaceChildren();
    blurEl = null;
    chips = [];
    if (s.result) {
      host.append(tiles());
      const pill = make("p", "cp-pill");
      pill.append(
        s.earned > 0
          ? make("span", "plus", `+${s.earned}`)
          : make("span", "plus none", "No points"),
      );
      host.append(pill);
      return;
    }
    if (s.picked >= 0) {
      const a = answers[s.picked];
      host.append(make("p", "echo", block.question));
      const yes = make("div", "cp-yes");
      const ok = make("button", "btn primary", `Yes, ${a.letter}`);
      ok.type = "button";
      ok.dataset.act = "yes";
      ok.disabled = true;
      yesTimer = setTimeout(() => (ok.disabled = false), YES_GUARD_MS);
      ok.addEventListener("click", () => s.confirm());
      const no = make("button", "btn", "Not this one");
      no.type = "button";
      no.dataset.act = "no";
      no.addEventListener("click", () => s.decline());
      yes.append(ok, no);
      host.append(yes);
      if (s.via === "walk") {
        blurEl = make("p", "cp-blur");
        host.append(blurEl);
      } else
        host.append(
          make(
            "p",
            "cp-note",
            a.at
              ? `Walk to ${a.letter} and stand in its circle, or choose it from here.`
              : `${a.letter} has no place in the square: choose it from here.`,
          ),
        );
      tick();
      return;
    }
    host.append(row());
    blurEl = make("p", "cp-blur");
    host.append(
      make(
        "p",
        "cp-note",
        "Walk to your answer and stand in its circle. Cannot get there? Tap its letter.",
      ),
      blurEl,
    );
    tick();
  };

  host.addEventListener("click", (e) => {
    const b = e.target.closest("[data-answer]");
    if (b && !b.disabled) s.select(Number(b.dataset.answer), "card");
  });

  // The stage hides this element when the story moves on. Without an answer that is a skip.
  const watch = new MutationObserver(() => {
    if (el.hidden && !s.result) s.skipped = true;
  });
  watch.observe(el, { attributes: true, attributeFilter: ["hidden"] });

  env.say(block.question, { ask: true, eyebrow: "A question" });
  s.render();
  const timer = setInterval(tick, 300);
  return {
    dispose() {
      clearTimeout(yesTimer);
      clearInterval(timer);
      watch.disconnect();
    },
  };
}

/* ---------- the edit panel: placing on site, and the spacing check ---------- */
const WHY = [
  [
    "Why this is in 3D.",
    ' The place is the answer. The creator stands each answer where it belongs, beside the fountain or under the tree, and the visitor answers with their feet. A card with four buttons cannot say "here".',
  ],
  [
    "The strongest case against.",
    " The phone's position is off by up to 3.6 m for 9 readings in 10, so two answers a few metres apart blur into one, and four placements are the heaviest step a creator has. A card never misreads, and needs no walking.",
  ],
];

function whyBox() {
  const box = make("details", "cp-why");
  box.append(make("summary", "", "Why 3D, and the case against"));
  for (const [head, rest] of WHY) {
    const p = make("p");
    p.append(make("b", "", head), rest);
    box.append(p);
  }
  return box;
}

/**
 * A panel can write the raw record but has no word for "I changed it". The stage redraws the
 * world and its place rings when a field changes AND the field list answers another list, so
 * a move is written as a removal and then a placement, each announced through the question
 * field's own input event (which writes back the same text). Named in the page's limits.
 */
function writer(raw, hostEdit) {
  const announce = () => {
    const field = hostEdit.querySelector('[data-field="question"]');
    field?.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return (slot, at) => {
    raw.answer ??= { type: "single", options: [] };
    raw.answer.options ??= [];
    const options = raw.answer.options;
    options[slot] ??= { id: idOf(slot), label: "" };
    const o = options[slot];
    const body = hostEdit.closest(".body");
    const top = body?.scrollTop ?? 0;
    if (o.at && at) {
      delete o.at;
      announce();
    }
    if (at) o.at = { x: round1(at.x), z: round1(at.z) };
    else delete o.at;
    announce();
    if (body) body.scrollTop = top;
  };
}

function panel(raw, el, env) {
  addStyle(el);
  const hostEdit = el.parentElement;
  const write = writer(raw, hostEdit);
  const spacing = make("div");
  const places = make("div");
  el.append(
    whyBox(),
    make("p", "cp-h", "Spacing"),
    spacing,
    make("p", "cp-h", "Place the answers"),
    make(
      "p",
      "cp-note",
      "On this 3D view, drag a marker's teal ring. On site, walk to the spot and press Where I stand, or aim the middle of the view at the ground and press Where I aim: in AR that is a tap on the ground.",
    ),
    places,
  );

  let sig = "";
  const draw = () => {
    const slots = slotsOf(raw);
    const gap = gapOf(raw);
    const next = JSON.stringify([slots.map((a) => [a.text, a.at]), gap]);
    if (next === sig) return;
    sig = next;

    spacing.replaceChildren();
    const placed = slots.filter((a) => a.at);
    const pairs = crowdedPairs(placed, gap);
    const intro = make(
      "p",
      "cp-note",
      `Warn under ${gap} m. At ${gap} m apart, a visitor standing on one answer is read as nearer to the other ${oneIn(misreadChance(gap))}.`,
    );
    spacing.append(intro);
    if (!placed.length)
      spacing.append(
        make("p", "cp-warn", "No answer stands in the place yet."),
      );
    else if (!pairs.length)
      spacing.append(
        make(
          "p",
          "cp-warn ok",
          placed.length > 1
            ? `Every pair is at least ${gap} m apart.`
            : "Only one answer stands in the place.",
        ),
      );
    for (const p of pairs) {
      const a = placed[p.i];
      const b = placed[p.j];
      spacing.append(
        make(
          "p",
          "cp-warn bad",
          `${a.letter} and ${b.letter} are ${p.d.toFixed(1)} m apart. Standing at ${a.letter}, the phone reads ${b.letter} as nearer ${oneIn(misreadChance(p.d))}.`,
        ),
      );
    }
    for (const a of slots)
      if (a.text && !a.at)
        spacing.append(
          make(
            "p",
            "cp-warn",
            `${a.letter} has no place yet: visitors can only choose it in the card.`,
          ),
        );

    places.replaceChildren();
    for (const a of slots) {
      const item = make("div", "cp-slot");
      item.style.setProperty("--hue", a.hue);
      const name = make("span", "", a.text || `Answer ${a.letter} is empty`);
      name.append(
        make(
          "small",
          "",
          !a.text
            ? "Write it above first."
            : a.at
              ? `Stands ${Math.round(Math.hypot(a.at.x, a.at.z))} m from the middle.`
              : "Not in the place.",
        ),
      );
      const acts = make("div", "cp-acts");
      for (const [act, label] of [
        ["stand", "Where I stand"],
        ["aim", "Where I aim"],
        ["remove", "Take out"],
      ]) {
        const b = make("button", "btn", label);
        b.type = "button";
        b.dataset.act = act;
        b.dataset.slot = String(a.slot);
        b.disabled = !a.text || (act === "remove" && !a.at);
        acts.append(b);
      }
      item.append(make("i", "", a.letter), name, acts);
      places.append(item);
    }
  };

  const spot = { x: 0, z: 0 };
  places.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const slot = Number(b.dataset.slot);
    if (b.dataset.act === "remove") write(slot, null);
    else if (b.dataset.act === "stand") write(slot, readAt(env.frame.viewer));
    else if (aimAt(env.frame, spot)) write(slot, readAt(spot));
    else {
      b.textContent = "Aim at the ground";
      setTimeout(() => (b.textContent = "Where I aim"), 1400);
    }
  });

  draw();
  // The stage's drag writes the raw record directly; a light poll keeps this panel in step.
  const timer = setInterval(draw, 250);
  return {
    dispose() {
      clearInterval(timer);
    },
  };
}

/* ---------- the record ---------- */
function read(v, _view, tools) {
  const question = tools.requiredText(v, "question", { max: 220 });
  const type = v.answer?.type ?? "single";
  if (type !== "single")
    throw new Error("This prototype places single-choice answers only");
  const slots = slotsOf(v).filter((a) => a.text);
  if (slots.length < 2) throw new Error("Give at least two answers");
  const right = Math.max(
    0,
    slots.findIndex((a) => a.id === v.answer?.correct),
  );
  return {
    question,
    points: Math.max(0, Math.round(Number(v.points ?? 10)) || 0),
    answers: slots,
    right,
    circle: circleOf(v),
    warnGap: gapOf(v),
  };
}

function fields(raw) {
  const options = Array.isArray(raw.answer?.options) ? raw.answer.options : [];
  const rows = [];
  for (let slot = 0; slot < 4; slot++) {
    rows.push({
      name: `answer.options.${slot}.label`,
      label: `Answer ${LETTERS[slot]}`,
      max: 80,
    });
    if (options[slot]?.at)
      rows.push({
        name: `answer.options.${slot}.at`,
        label: `Marker ${LETTERS[slot]}`,
        type: "place",
      });
  }
  return [
    { name: "question", label: "Question", prose: true },
    ...rows,
    {
      name: "answer.correct",
      label: "The right answer",
      type: "choice",
      options: [0, 1, 2, 3].map((slot) => [
        options[slot]?.id || idOf(slot),
        LETTERS[slot],
      ]),
    },
    {
      name: "warnGap",
      label: "Warn when two answers are closer than, metres",
      type: "range",
      min: GAP_MIN,
      max: GAP_MAX,
      step: 0.5,
    },
    {
      name: "circle",
      label: "Answer circle radius, metres (never under 5)",
      type: "range",
      min: CIRCLE_MIN,
      max: CIRCLE_MAX,
      step: 0.5,
    },
    {
      name: "points",
      label: "Points",
      type: "number",
      min: 0,
      max: 100,
      step: 1,
    },
  ];
}

export const kind = { name: NAME, read, fields, world, card, panel };
