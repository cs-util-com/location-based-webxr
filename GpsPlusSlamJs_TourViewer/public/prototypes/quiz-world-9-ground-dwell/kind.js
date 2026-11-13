// Stand in the ring: the answers are hidden around the station as in "find, then go back", and
// once all are found each one gets a ring on the ground. Standing still inside a ring closes it,
// two arcs growing from its far side round to the visitor's feet; when they meet, the answer locks
// in with a pulse and a sound, and a thin white seal then closes the same way. Stepping out before
// the seal is shut takes the answer back without a word; once it is shut, the ring turns teal or
// breaks apart. The question lies on the ground in the middle of the answers. On the stage's compact
// HUD the screen keeps only the stage's found-dots and its "i", behind which the answers can be
// chosen without walking; on the card HUD a small pill in the card does the same: the count while
// searching, a "more" button while choosing. Throwaway; not wired to the app.
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
  Vector2,
} from "three";

const NAME = "ground-dwell";
const FONT = 'Corbel, "Noto Sans", system-ui, sans-serif';

/* ---------- what the feel rests on: tune here, or with the sliders behind the "more" button ---------- */
const RADIUS_DEFAULT = 1.5; // metres: found when the measured position comes this close
const RADIUS_MIN = 0.5;
const RADIUS_MAX = 5;
const HINT_DEFAULT = 25; // seconds without a find before the arrow comes
const HINT_MIN = 5;
const HINT_MAX = 90;
// The answer ring. 2 m: standing anywhere inside it, its far half lies 2-4 m ahead, which a phone
// held for walking still sees; a smaller ring is passed under the view. Two rings 5 m apart keep a
// metre between them.
const RING_DEFAULT = 2;
const RING_MIN = 1;
const RING_MAX = 2.5;
const RING_LET_GO = 0.5; // metres past the ring before it lets go, so jitter at its edge cannot cancel
const ENTER_DELAY = 0.4; // seconds inside the ring before it starts, so a jitter spike cannot start it
// The dwell: seconds standing still inside a ring until it closes. 3 s is the time it takes to read
// the answer's label once more, long enough that stopping to look around is not a choice by
// accident, and short enough that nobody wonders whether it works. Walking pauses the fill (see
// STILL_SPEED), so passing through a ring never adds to it, whatever the dwell.
const DWELL_DEFAULT = 3;
const DWELL_MIN = 1.5;
const DWELL_MAX = 8;
const DRAIN = 2; // a ring left before it is full empties this many times faster than it filled
// Metres per second: slower than this counts as standing. The phone's own tracking measures motion
// well even while its place on the map drifts, so this reads the walker, not the jittered position.
const STILL_SPEED = 0.6;
const WALK_AWAY = 0.3; // seconds of walking that take a lock-in back
const SPEED_TAU = 0.25; // seconds the speed is smoothed over
// The grace: seconds after the lock-in while a step out still takes the answer back.
const GRACE_DEFAULT = 2.5;
const GRACE_MIN = 0;
const GRACE_MAX = 6;
const APART_MIN = 5; // metres: answers closer than this turn their rings red in edit
const RING_ROOM_EDGE = 12; // the station's ring: an answer ring past it turns red in edit
const FAR_EXTRA = 3; // metres past the ring that count as "far from every answer"
const FAR_HINT = 8; // seconds far from every open answer before the arrow and the way out come
const YES_GUARD_MS = 350; // the lock button wakes a moment later, for a thumb already moving
const LIST_BEAT = 0.9; // seconds between a lock from the list and its count, so the moment plays
const RESULT_HOLD = 1.8; // seconds the result plays in the world before the card says it
const SLIM_AFTER = 2; // metres walked before the intro gives way to the small pill
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
const CHEER_LEN = 2.6; // seconds the sparks rise from the right ring
const EGG_H = 0.32;
const EGG_R = 0.11;
const CRACK = 0.56; // where it opens, as a share of its height
const LABEL_W = 0.96;
const LABEL_H = 0.63;
const LABEL_GAP = 0.42; // metres between the egg's top and the label's foot
const LABEL_FULL = 2.5; // metres: closer than this the label shrinks with the distance
const LABEL_MIN = 0.45;
const BEAM_LEN = 1.8; // metres: the marker over a found answer, from the label's top up
const BEAM_R = 0.05;
const SWEEP_STEPS = 64; // segments per side of a ring's fill
const SHARDS = 8; // pieces a wrong ring breaks into
const BREAK_LEN = 1.3; // seconds the pieces fly
const LOCK_FLASH = 0.45; // seconds the fill flashes white at the lock-in
const PLATE_W = 3.6; // metres: the question lying on the ground
const PLATE_H = 1.8;
const PLATE_TILT = 0.61; // radians up from the ground, about 35 degrees, so it reads from afar
const PLATE_CLEAR = 1.2; // metres the plate keeps from every answer ring
const ARROW_AHEAD = 2.6; // metres ahead of the eye
const ARROW_Y = 1.72; // metres: at the eye
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
  retry: "Not that one. Have another think, and stand in another ring.",
  wrong: "No, that was not it.",
};

const WHY = {
  for: "The answer is given by standing at the thing it names, and nothing on the screen asks for it: the ring closes around the visitor's feet while they look at the answer's label, so the place carries the choice and the screen stays out of the way. Standing still for a few seconds is a deliberate act that a passing step or a drifting position does not make, and the white seal after the lock-in gives a quiet way back.",
  against:
    "A ring on the ground is seen only when the phone looks down at it, and a visitor who stands in the middle has its near half under their feet, out of view; the fill is drawn so it starts on the far side, but a visitor who looks up and away misses it. Choosing by standing also takes time on purpose, and someone who cannot reach the ring needs the hidden way out behind the small button. And each ring needs room: at least 5 m from the next, which a small station may not have.",
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
  revealed: false, // the card has said the result
  chosen: -1,
  earned: 0,
  wait: 0, // seconds since the last find
  hinted: false, // the first hint has come, so the way out is offered
  apart: 0, // seconds far from every open answer, while choosing
  slim: false, // the intro has given way to the small pill
  open: false, // the visitor opened the card with the "more" button
};
let reopening = false;

// The sliders behind the "more" button: a page-long test aid, not part of the record. Every value
// that the record also has starts from the record whenever it changes.
const tune = {
  key: "",
  radius: RADIUS_DEFAULT,
  hintAfter: HINT_DEFAULT,
  ring: RING_DEFAULT,
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
  memory.revealed = false;
  memory.chosen = -1;
  memory.earned = 0;
  memory.wait = 0;
  memory.hinted = false;
  memory.apart = 0;
  memory.slim = false;
  memory.open = false;
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

// The found radius, in edit: a faint fill and a bright rim.
const discGeometry = () =>
  bandsGeometry(
    [
      [0, 0.93, [1, 1, 1, 0.2]],
      [0.93, 1, [1, 1, 1, 0.95]],
    ],
    56,
  );

// The answer ring at rest: a very faint floor, a faint track where the fill will run, a bright rim
// and a thin dark edge outside it, so it reads on any ground.
const ringGeometry = () =>
  bandsGeometry(
    [
      [0, 0.56, [1, 1, 1, 0.07]],
      [0.56, 0.94, [1, 1, 1, 0.2]],
      [0.94, 1, [1, 1, 1, 0.95]],
      [1, 1.02, [0.07, 0.09, 0.11, 0.6]],
    ],
    72,
  );

// A band whose triangles run from angle 0 (+z) outwards on both sides at once, so a draw range of
// the first k pairs shows two arcs grown symmetrically from +z. Turned so +z points away from the
// visitor, the ring closes from its far side round to their feet. 12 vertices per step.
function sweepGeometry(inner, outer) {
  const pos = [];
  const at = (a, r) => [Math.sin(a) * r, 0, Math.cos(a) * r];
  for (let k = 0; k < SWEEP_STEPS; k++) {
    const a0 = (k / SWEEP_STEPS) * Math.PI;
    const a1 = ((k + 1) / SWEEP_STEPS) * Math.PI;
    for (const side of [1, -1]) {
      const p = at(a0 * side, inner);
      const q = at(a0 * side, outer);
      const r = at(a1 * side, outer);
      const s = at(a1 * side, inner);
      pos.push(...p, ...q, ...r, ...p, ...r, ...s);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setDrawRange(0, 0);
  return g;
}
const sweepCount = (share) => 12 * Math.ceil(clamp(share, 0, 1) * SWEEP_STEPS);

// One piece of a broken ring: an arc of the fill's band around +z, a small gap at each end.
function shardGeometry() {
  const half = Math.PI / SHARDS - 0.06;
  const g = new RingGeometry(0.56, 0.94, 8, 1, -half, half * 2).rotateX(
    -Math.PI / 2,
  );
  // Laid down, the arc sits around +x; a quarter turn brings it round to +z, where the piece flies.
  g.rotateY(-Math.PI / 2);
  return g;
}

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
  in: {
    band: null,
    paper: PAPER,
    ink: INK,
    word: "Stand still here",
    edge: "#ffffff",
  },
  locked: {
    band: PICK,
    paper: PAPER,
    ink: INK,
    word: "Locked in",
    edge: PICK,
  },
  rearm: {
    band: "#9aa3ab",
    paper: PAPER,
    ink: INK,
    word: "Step out, then in",
    edge: null,
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

/* ---------- the question on the ground: a dark plate, light words, a state line under them ---------- */
const PLATE_PX_W = 1024;
const PLATE_PX_H = 512;
const TONE = { calm: "#ffd391", locked: PICK, right: RIGHT, wrong: WRONG };

function drawPlate(g, w, h, st) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = "rgb(12 16 21 / 88%)";
  g.beginPath();
  g.roundRect(6, 6, w - 12, h - 12, 40);
  g.fill();
  g.strokeStyle = st.tone === "calm" ? "rgb(255 255 255 / 55%)" : TONE[st.tone];
  g.lineWidth = 8;
  g.stroke();
  const pad = 52;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillStyle = "#2dd4bf";
  g.font = `700 30px ${FONT}`;
  g.fillText(st.eyebrow.toUpperCase(), pad, 62, w - pad * 2);
  const room = h - 104 - 110;
  const q = fitText(
    g,
    st.text,
    w - pad * 2,
    room,
    [64, 56, 50, 44, 38, 32],
    700,
  );
  g.fillStyle = "#f3f5f7";
  g.font = `700 ${q.size}px ${FONT}`;
  const lh = q.size * 1.15;
  let y = 104 + (room - q.lines.length * lh) / 2 + lh / 2;
  for (const l of q.lines) {
    g.fillText(l, pad, y, w - pad * 2);
    y += lh;
  }
  g.fillStyle = "rgb(255 255 255 / 14%)";
  g.fillRect(pad, h - 104, w - pad * 2, 2);
  const sub = fitText(g, st.sub, w - pad * 2, 80, [34, 30, 26, 22], 600);
  g.fillStyle = TONE[st.tone];
  g.font = `600 ${sub.size}px ${FONT}`;
  let sy = h - 58 - ((sub.lines.length - 1) * sub.size * 1.15) / 2;
  for (const l of sub.lines) {
    g.fillText(l, pad, sy, w - pad * 2);
    sy += sub.size * 1.15;
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

// Where the question lies: amid the answers, pushed off any ring it would cover.
function plateSpot(spots, ring) {
  let x = 0;
  let z = 0;
  for (const p of spots) {
    x += p.x / spots.length;
    z += p.z / spots.length;
  }
  const clear = ring + PLATE_CLEAR + PLATE_W / 2;
  for (let round = 0; round < 8; round++) {
    let moved = false;
    for (const p of spots) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d >= clear) continue;
      const ux = d > 0.01 ? (x - p.x) / d : 0;
      const uz = d > 0.01 ? (z - p.z) / d : 1;
      x = p.x + ux * clear;
      z = p.z + uz * clear;
      moved = true;
    }
    if (!moved) break;
  }
  return insideRing(x, z);
}

// Pairs of answers too close to be told apart by where the visitor stands.
function crowdedPairs(spots, ring) {
  const limit = Math.max(APART_MIN, ring * 2 + RING_LET_GO);
  const pairs = [];
  for (let i = 0; i < spots.length; i++)
    for (let j = i + 1; j < spots.length; j++) {
      const d = Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z);
      if (d < limit) pairs.push([i, j, d]);
    }
  return { pairs, limit };
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
    open: -1, // the nearest answer still open to choose, while choosing
    at: -1, // the ring the visitor stands in
    entering: -1, // the ring the visitor has just stepped into, before it holds
    enterFor: 0,
    waiting: -1, // standing in a ring that does not take a choice until stepped out of once
    locked: -1, // locked in, its seal closing
    seal: 0,
    takenBack: false, // the last lock was taken back, so the question says how to go on
    help: false, // far from every open answer for FAR_HINT seconds: the arrow and the way out show
    moving: 0, // seconds walking while locked in
    armed: new Uint8Array(n), // a ring takes a choice only once the visitor was outside it
    fill: new Float64Array(n),
    face: new Float64Array(n), // where each ring's fill starts: away from the visitor
    flash: new Float64Array(n).fill(-9), // when each ring locked, for its flash
    dist: new Float64Array(n), // true horizontal metres, viewer to egg
    measured: new Float64Array(n), // the same from the measured position
    dwell: new Float64Array(n),
    speed: 0,
    px: Number.NaN,
    pz: Number.NaN,
    startX: Number.NaN,
    startZ: Number.NaN,
    yaw: 0,
    vx: 0, // the viewer in the station's own metres
    vz: 0,
    echoAt: 0, // the lock-in's second tick
    countAt: 0, // a lock from the list counts at this time
    countWhich: -1,
    revealAt: 0, // the card says the result at this time
    listPick: -1, // chosen in the list, waiting for "Lock it in"
    time: 0,
    fx() {},
    render() {},
    paint() {},
  };
  s.isFound = (i) => memory.found.includes(i);
  s.isOpen = (i) => s.isFound(i) && !memory.crossed.has(i);
  s.phase = () =>
    memory.result ? "done" : memory.found.length >= n ? "choose" : "search";
  s.ring = () => (env.mode === "play" ? tune.ring : block.choose.ring);
  s.label = (i) => block.options[i].label;

  s.look = (i) => {
    if (env.mode !== "play") return "edit";
    if (memory.result) {
      if (i === block.correct) return "right";
      return memory.crossed.has(i) ? "wrong" : "other";
    }
    if (memory.crossed.has(i)) return "wrong";
    if (s.phase() === "choose") {
      if (s.locked === i) return "locked";
      if (s.at === i) return "in";
      if (s.waiting === i) return "rearm";
    }
    return memory.shown.has(i) ? "shown" : "found";
  };

  // The words on the ground plate: what to do now, in one line under the question.
  s.plate = () => {
    const phase = s.phase();
    const ask = phase !== "search" || block.find.askFirst;
    const st = {
      eyebrow: "The question",
      text: ask
        ? block.question
        : `${COUNT[n]} answers are hidden around this square.`,
      sub: "",
      tone: "calm",
    };
    if (env.mode !== "play") {
      st.text = block.question;
      st.sub =
        "Visitors find the answers first, then stand in one ring to choose.";
      return st;
    }
    if (phase === "search") {
      st.eyebrow = `Find ${n} hidden answers`;
      st.sub = ask
        ? "Find them all first. Then answer here, by standing at one."
        : "Find them all; the question comes then.";
      return st;
    }
    if (phase === "done") {
      const right = memory.result === "right";
      st.eyebrow = right ? "Right" : "Not this time";
      st.tone = right ? "right" : "wrong";
      st.sub = right
        ? `"${s.label(block.correct)}" - right.`
        : `It was "${s.label(block.correct)}".`;
      return st;
    }
    if (memory.tries) st.eyebrow = "One more try";
    if (s.locked >= 0) {
      st.tone = "locked";
      st.sub = `Locked in: "${s.label(s.locked)}". Walk away now to take it back.`;
    } else if (s.takenBack)
      st.sub = "Taken back. Stand still in the ring of your answer.";
    else if (s.waiting >= 0)
      st.sub = `To choose "${s.label(s.waiting)}", step out of its ring and back in.`;
    else if (s.at >= 0)
      st.sub = `Stand still in "${s.label(s.at)}" until its ring closes.`;
    else if (memory.tries && memory.chosen >= 0) {
      st.tone = "wrong";
      st.sub = block.says.retry;
    } else st.sub = "Stand still in the ring of your answer until it closes.";
    return st;
  };

  const changed = () => {
    s.paint();
    s.render();
  };
  s.changed = changed;

  s.find = (i) => {
    if (s.isFound(i) || memory.result) return;
    memory.found.push(i);
    memory.wait = 0;
    memory.slim = true;
    s.hinting = false;
    s.fx("find", i);
    if (memory.found.length >= n) {
      env.sound("done").play();
      s.openChoice();
    } else env.sound("tap").play();
    changed();
  };

  // The choice opens: every ring the visitor already stands in waits until they step out once,
  // so the last find cannot become the answer by standing still to read it.
  s.openChoice = () => {
    const out = s.ring() + RING_LET_GO;
    for (let i = 0; i < n; i++) s.armed[i] = s.measured[i] > out ? 1 : 0;
    s.fx("open", -1);
  };

  s.showRest = () => {
    if (s.phase() !== "search") return;
    for (let i = 0; i < n; i++) {
      if (s.isFound(i)) continue;
      memory.found.push(i);
      memory.shown.add(i);
    }
    s.hinting = false;
    env.sound("done").play();
    s.openChoice();
    changed();
  };

  s.hint = () => {
    s.hinting = true;
    memory.hinted = true;
    s.render();
  };

  /* choosing: stand in a ring until it closes, then let the seal close */
  const setAt = (i) => {
    if (s.at === i) return;
    if (i >= 0) s.takenBack = false;
    s.at = i;
    changed();
  };

  s.lock = (i) => {
    s.moving = 0;
    s.locked = i;
    s.seal = 0;
    s.takenBack = false;
    s.flash[i] = s.time;
    s.echoAt = s.time + 0.13;
    env.sound("tap").play();
    s.fx("lock", i);
    changed();
  };

  // Quiet on purpose: no sound and no word on the screen, the seal and the fill drain away and the
  // plate says it was taken back. The ring then waits, like one stood in when the choice opened,
  // until the visitor has left it once: standing still again must not lock it straight back.
  s.takeBack = () => {
    const i = s.locked;
    if (i < 0) return;
    s.locked = -1;
    s.seal = 0;
    s.armed[i] = 0;
    s.at = -1;
    s.entering = -1;
    s.takenBack = true;
    changed();
  };

  const finish = (result) => {
    memory.result = result;
    memory.open = false;
    s.locked = -1;
    s.at = -1;
    s.listPick = -1;
    if (result === "right") {
      memory.earned = memory.tries
        ? Math.floor(block.points / 2)
        : block.points;
      s.fx("right", block.correct);
      env.sound("right").play();
    } else {
      s.fx("break", memory.chosen);
      env.sound("wrong").play();
    }
    s.revealAt = s.time + RESULT_HOLD;
    changed();
  };

  s.count = (i) => {
    if (memory.result || !s.isOpen(i)) return;
    memory.chosen = i;
    s.locked = -1;
    s.seal = 0;
    s.takenBack = false;
    s.listPick = -1;
    if (i === block.correct) {
      finish("right");
      return;
    }
    memory.crossed.add(i);
    memory.tries += 1;
    s.fill[i] = 0;
    if (s.at === i) s.at = -1;
    if (block.choose.retry && memory.tries < 2) {
      s.fx("break", i);
      env.sound("wrong").play();
      changed();
    } else finish("wrong");
  };

  // The card says the result once the world has shown it.
  s.reveal = () => {
    s.revealAt = 0;
    if (memory.revealed || !memory.result) return;
    memory.revealed = true;
    memory.open = false;
    const right = memory.result === "right";
    // The compact HUD has no card for the points: the guide says them.
    const line = right ? block.says.right : block.says.wrong;
    env.say(
      env.hud?.compact && right && memory.earned > 0
        ? `${line} +${memory.earned} points.`
        : line,
      {
        mood: right ? "happy" : "doubt",
        eyebrow: right ? "Right" : "Not this time",
      },
    );
    s.render();
    env.done();
  };

  // The way out for someone who cannot walk there: chosen in the list, it locks at its ring and
  // counts a moment later, without a seal: the list's own "Lock it in" was the deliberate step.
  s.lockFromList = (i) => {
    if (s.phase() !== "choose" || !s.isOpen(i) || s.countAt) return;
    s.listPick = -1;
    s.fill[i] = 1;
    s.face[i] = Math.atan2(s.spots[i].x - s.vx, s.spots[i].z - s.vz);
    s.flash[i] = s.time;
    s.echoAt = s.time + 0.13;
    env.sound("tap").play();
    s.fx("lock", i);
    s.countAt = s.time + LIST_BEAT;
    s.countWhich = i;
    changed();
  };

  // Every frame while choosing. No allocation: reads and rare state changes only.
  s.stepChoose = (dt) => {
    const r = s.ring();
    const out = r + RING_LET_GO;
    let near = -1;
    let nearD = Infinity;
    let open = -1;
    let openD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!s.isOpen(i)) continue;
      if (s.measured[i] > out) s.armed[i] = 1;
      if (s.measured[i] < nearD) {
        nearD = s.measured[i];
        near = i;
      }
      if (s.dist[i] < openD) {
        openD = s.dist[i];
        open = i;
      }
    }
    s.open = open;

    // the ring the visitor stands in: it holds until they are past its edge by RING_LET_GO
    if (s.at >= 0 && (!s.isOpen(s.at) || s.measured[s.at] > out)) setAt(-1);
    if (s.at < 0 && near >= 0 && nearD < r && s.armed[near]) {
      if (s.entering !== near) {
        s.entering = near;
        s.enterFor = 0;
      }
      s.enterFor += dt;
      if (s.enterFor >= ENTER_DELAY) setAt(near);
    } else if (s.at < 0) s.entering = -1;
    const waiting = near >= 0 && nearD < r && !s.armed[near] ? near : -1;
    if (waiting !== s.waiting) {
      s.waiting = waiting;
      changed();
    }

    // the fill: grows while standing still in the ring, pauses while walking in it, drains outside
    const still = s.speed < STILL_SPEED;
    for (let i = 0; i < n; i++) {
      if (i === s.locked || (s.countAt && i === s.countWhich)) continue;
      if (i === s.at && s.isOpen(i) && s.locked < 0) {
        if (!still) continue;
        if (s.fill[i] <= 0) {
          const dx = s.spots[i].x - s.vx;
          const dz = s.spots[i].z - s.vz;
          // the far side: past the egg from where the visitor stands, or ahead of them at its middle
          s.face[i] = Math.hypot(dx, dz) > 0.6 ? Math.atan2(dx, dz) : s.yaw;
        }
        s.fill[i] = Math.min(1, s.fill[i] + dt / tune.dwell);
        if (s.fill[i] >= 1) s.lock(i);
      } else if (s.fill[i] > 0)
        s.fill[i] = Math.max(0, s.fill[i] - (dt * DRAIN) / tune.dwell);
    }

    // the seal: closes while the visitor stands still. Walking for a moment takes the answer back,
    // and so does leaving the ring; the walk reads the walker's own speed, so jitter cannot do it.
    if (s.locked >= 0) {
      s.moving = still ? 0 : s.moving + dt;
      if (s.at !== s.locked || s.moving >= WALK_AWAY) s.takeBack();
      else if (still) {
        s.seal = tune.grace > 0 ? Math.min(1, s.seal + dt / tune.grace) : 1;
        if (s.seal >= 1) s.count(s.locked);
      }
    }

    // far from every ring for a while: the arrow and the way out come, and go again on the way
    const far = nearD > r + FAR_EXTRA;
    memory.apart = far ? memory.apart + dt : 0;
    const help = far && memory.apart >= FAR_HINT;
    if (help !== s.help) {
      s.help = help;
      s.render();
    }
  };

  s.leave = () => {
    s.outside = true;
    s.hinting = false;
    s.at = -1;
    s.entering = -1;
    if (s.locked >= 0) s.takeBack();
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
    s.fx = () => {};
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
    tune.ring = block.choose.ring;
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
  // a quiz reopened after it was chosen: every ring that counted stays closed
  if (memory.result) s.fill[memory.chosen] = 1;

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
  const plateTex = env.paintText({
    width: PLATE_PX_W,
    height: PLATE_PX_H,
    draw: (g, w, h) => drawPlate(g, w, h, s.plate()),
  });
  plateTex.premultiplyAlpha = true;
  let plateKey = "";
  const paintPlate = () => {
    const st = s.plate();
    const k = `${st.eyebrow}|${st.text}|${st.sub}|${st.tone}`;
    if (k === plateKey) return;
    plateKey = k;
    plateTex.repaint();
  };
  s.paint = () => {
    atlas.repaint();
    paintPlate();
  };
  const spark = env.paintText({ width: 64, height: 64, draw: drawSpark });
  spark.premultiplyAlpha = true;

  const geos = [];
  const mats = [];
  const flat = () => {}; // paint, light and the eggs take no tap, so a tap there walks the visitor
  const labelMat = new MeshBasicMaterial({ map: atlas, alphaTest: 0.5 });
  const discGeo = discGeometry();
  const ringGeo = ringGeometry();
  const beamGeo = new CylinderGeometry(BEAM_R, BEAM_R, BEAM_LEN, 6, 1, true);
  beamGeo.translate(0, BEAM_LEN / 2, 0);
  const burstGeo = new RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2);
  const burstMat = new MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    depthWrite: false,
  });
  geos.push(discGeo, ringGeo, beamGeo, burstGeo);
  mats.push(labelMat, burstMat);

  const hueColor = HUES.map((h) => new Color(h));
  const white = new Color("#ffffff");
  const teal = new Color(RIGHT);
  const grey = new Color("#8a929a");
  const red = new Color(WRONG);

  // Edit only: answers too close to tell apart, or rings that cross the station's edge.
  const { pairs } = crowdedPairs(spots, block.choose.ring);
  const bad = spots.map(
    (p, i) =>
      pairs.some(([a, b]) => a === i || b === i) ||
      Math.hypot(p.x, p.z) + block.choose.ring > RING_ROOM_EDGE,
  );
  const labelTop = EGG_H + LABEL_GAP + LABEL_H;
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
    // The egg and its label take no tap: a tap on them walks the visitor there, as on the ground.
    const low = new Mesh(lowGeo, mat);
    low.raycast = flat;
    const lid = new Group();
    lid.position.y = CRACK * EGG_H;
    const top = new Mesh(topGeo, mat);
    top.raycast = flat;
    lid.add(top);
    const labelGeo = labelGeometry(i);
    const label = new Mesh(labelGeo, labelMat);
    label.position.y = labelMid;
    label.raycast = flat;
    const beamMat = new MeshBasicMaterial({
      color: HUES[i],
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const beam = new Mesh(beamGeo, beamMat);
    beam.position.y = labelTop + 0.05;
    beam.raycast = flat;
    beam.visible = false;
    group.add(low, lid, label, beam);
    content.add(group);

    // The answer ring, on the ground under the egg: its rest look, and the fill on top of it.
    const ringMat = new MeshBasicMaterial({
      color: !play && bad[i] ? WRONG : HUES[i],
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    });
    const ring = new Group();
    ring.position.set(spots[i].x, 0, spots[i].z);
    ring.scale.setScalar(block.choose.ring);
    ring.visible = !play;
    const base = new Mesh(ringGeo, ringMat);
    base.position.y = 0.022;
    base.renderOrder = 2;
    base.raycast = flat;
    const sweepGeo = sweepGeometry(0.56, 0.94);
    const sweepMat = new MeshBasicMaterial({
      color: HUES[i],
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: DoubleSide,
    });
    const sweep = new Mesh(sweepGeo, sweepMat);
    sweep.position.y = 0.026;
    sweep.renderOrder = 3;
    sweep.raycast = flat;
    sweep.frustumCulled = false; // its draw range grows from nothing
    ring.add(base, sweep);
    content.add(ring);

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
      disc.raycast = flat;
      content.add(disc);
      mats.push(discMat);
    }
    geos.push(lowGeo, topGeo, labelGeo, sweepGeo);
    mats.push(mat, beamMat, ringMat, sweepMat);
    const found = s.isFound(i);
    return {
      group,
      mat,
      lid,
      label,
      beam,
      beamMat,
      ring,
      ringMat,
      sweep,
      sweepGeo,
      sweepMat,
      open: found || !play ? 1 : 0,
      pop: found || !play ? 1 : 0,
      ringOn: play ? 0 : 1,
    };
  });

  // The seal: one thin white band, at the ring that is locked in, closing the same way as its fill.
  const sealGeo = sweepGeometry(0.98, 1.1);
  const sealMat = new MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const seal = new Mesh(sealGeo, sealMat);
  seal.position.y = 0.03;
  seal.renderOrder = 3;
  seal.visible = false;
  seal.raycast = flat;
  seal.frustumCulled = false;
  content.add(seal);
  geos.push(sealGeo);
  mats.push(sealMat);

  // The pieces of a ring that breaks.
  const shardGeo = shardGeometry();
  const shardMat = new MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const shards = new Group();
  shards.visible = false;
  const pieces = [];
  for (let k = 0; k < SHARDS; k++) {
    const turn = new Group();
    turn.rotation.y = (k / SHARDS) * Math.PI * 2;
    const piece = new Mesh(shardGeo, shardMat);
    piece.raycast = flat;
    piece.renderOrder = 3;
    turn.add(piece);
    shards.add(turn);
    pieces.push(piece);
  }
  content.add(shards);
  geos.push(shardGeo);
  mats.push(shardMat);
  let breakAt = -9;
  let breakRing = -1;

  // The question on the ground, amid the answers, leaning up towards the visitor.
  const plateAt = plateSpot(spots, block.choose.ring);
  const plateGeo = new PlaneGeometry(PLATE_W, PLATE_H);
  const plateMat = new MeshBasicMaterial({
    map: plateTex,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  const plate = new Group();
  plate.position.set(plateAt.x, 0, plateAt.z);
  const plateMesh = new Mesh(plateGeo, plateMat);
  const lean = Math.PI / 2 - PLATE_TILT;
  plateMesh.rotation.x = -lean;
  plateMesh.position.set(
    0,
    (PLATE_H / 2) * Math.cos(lean) + 0.02,
    -(PLATE_H / 2) * Math.sin(lean),
  );
  plateMesh.raycast = flat;
  plateMesh.renderOrder = 1;
  plate.add(plateMesh);
  content.add(plate);
  geos.push(plateGeo);
  mats.push(plateMat);
  let plateYaw = Number.NaN;
  let plateRise = play ? 0 : 1;

  // The tease: a glint per egg, and a small shimmer around each that grows with nearness. At the
  // end the same sparks rise from the right ring.
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
  let cheerAt = -9;

  const burst = new Mesh(burstGeo, burstMat);
  burst.position.y = 0.05;
  burst.renderOrder = 4;
  burst.visible = false;
  burst.raycast = flat;
  content.add(burst);
  let burstAt = -9;
  let burstOn = -1;
  let burstFrom = 0;
  let burstTo = 1;
  let burstLen = 1;

  // What happens in the world on the visit's moments.
  s.fx = (what, i) => {
    const r = s.ring();
    const ring = (from, to, len, color) => {
      burstAt = s.time;
      burstOn = i;
      burstFrom = from;
      burstTo = to;
      burstLen = len;
      burstMat.color.set(color);
    };
    if (what === "find") ring(0.4, 2, 1.1, RIGHT);
    else if (what === "lock") ring(r, r * 1.6, 0.6, "#ffffff");
    else if (what === "right") {
      ring(r, r * 2.6, 1.5, RIGHT);
      cheerAt = s.time;
    } else if (what === "break") {
      breakAt = s.time;
      breakRing = i;
      shardMat.color.copy(hueColor[i]);
      shards.position.set(spots[i].x, 0.028, spots[i].z);
      shards.scale.setScalar(r);
    } else if (what === "open") plateRise = 0;
  };

  // The arrow: held a little ahead of the eye and turned, in its own plane, towards the nearest
  // egg still hidden, or while choosing towards the nearest answer still open.
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
  arrow.renderOrder = 6;
  arrow.visible = false;
  arrow.raycast = flat;
  object.add(arrow);
  geos.push(arrowGeo);
  mats.push(arrowMat);

  // What the phone measures: the found radius or the answer ring around the measured position,
  // and where the creator meant the eggs to be. Off unless the switch is on.
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
    const r = s.ring();

    // the walker's own speed, from the true position: see STILL_SPEED
    if (Number.isNaN(s.px)) {
      s.px = s.startX = v.x;
      s.pz = s.startZ = v.z;
    } else if (dt > 0) {
      const now = Math.hypot(v.x - s.px, v.z - s.pz) / dt;
      s.speed += (now - s.speed) * (1 - Math.exp(-dt / SPEED_TAU));
      s.px = v.x;
      s.pz = v.z;
    }

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
      // the intro gives way to the small pill once the visitor sets off
      if (
        !memory.slim &&
        Math.hypot(v.x - s.startX, v.z - s.startZ) > SLIM_AFTER
      ) {
        memory.slim = true;
        s.render();
      }
    }
    // the last find opens the choice in this same frame
    const now = s.phase();
    const choosing = play && now === "choose" && !s.outside && !s.skipped;
    if (choosing) s.stepChoose(dt);
    if (play) {
      if (s.echoAt && t >= s.echoAt) {
        s.echoAt = 0;
        env.sound("tap").play();
      }
      if (s.countAt && t >= s.countAt) {
        s.countAt = 0;
        s.count(s.countWhich);
      }
      if (s.revealAt && t >= s.revealAt) s.reveal();
    }
    const done = s.phase() === "done";

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
      // the lock-in: the lid hops once
      const since = t - s.flash[i];
      const hop =
        since >= 0 && since < LOCK_FLASH
          ? Math.sin((since / LOCK_FLASH) * Math.PI)
          : 0;
      e.lid.position.y = CRACK * EGG_H + e.open * 0.16 + hop * 0.12;
      e.lid.rotation.z = e.open * 0.55;
      e.label.visible = e.pop > 0.02;
      const close = play ? clamp(d / LABEL_FULL, LABEL_MIN, 1) : 1;
      // and never covers more than about 40 % of the view's width, however close
      e.label.scale.setScalar(
        Math.max(0.001, Math.min(e.pop * close, env.fitWidth(e.label, LABEL_W))),
      );
      const lx = spots[i].x + ox;
      const lz = spots[i].z + oz;
      e.label.rotation.y = Math.atan2(v.x - lx, v.z - lz);
      e.group.rotation.y = found ? 0 : Math.sin(t * 1.3 + i) * 0.25;

      // marked in place: a found answer still open keeps its marker until the quiz ends
      const isOpen = play && s.isFound(i) && !crossed && !done;
      e.beam.visible = isOpen && e.pop > 0.5;
      if (e.beam.visible) {
        e.beam.scale.y = Math.max(0.001, e.pop);
        e.beamMat.opacity = s.at === i ? 1 : 0.7;
      }
      // the ring: shown from the choice on; after the end only the right one and the chosen one
      let want = 0;
      if (!play) want = 1;
      else if (choosing && isOpen) want = 1;
      else if (play && now === "choose" && crossed && t - breakAt < BREAK_LEN)
        want = 1;
      else if (done && (i === block.correct || i === memory.chosen)) want = 1;
      e.ringOn += (want - e.ringOn) * k;
      e.ring.visible = e.ringOn > 0.02;
      if (!e.ring.visible || !play) continue;
      e.ring.scale.setScalar(r * (0.85 + 0.15 * e.ringOn));
      let op = 0.6;
      let fill = s.fill[i];
      e.ringMat.color.copy(hueColor[i]);
      e.sweepMat.color.copy(hueColor[i]);
      if (done) {
        if (i === block.correct) {
          e.ringMat.color.copy(teal);
          e.sweepMat.color.copy(teal);
          op = 0.95;
          // the right ring closes fully when it was chosen; shown as an outline when it was not
          fill = i === memory.chosen ? 1 : 0;
        } else {
          e.ringMat.color.copy(grey);
          op = 0.3;
          fill = 0;
        }
      } else if (crossed) {
        e.ringMat.color.copy(red);
        op = 0.5;
        fill = 0;
      } else if (!s.armed[i]) op = s.waiting === i ? 0.55 : 0.4;
      else if (s.at === i || s.locked === i) op = 0.98;
      e.ringMat.opacity = op * e.ringOn;
      e.sweep.visible = fill > 0.001;
      if (e.sweep.visible) {
        e.sweepGeo.setDrawRange(0, sweepCount(fill));
        e.sweep.rotation.y = s.face[i];
        // a white flash at the lock-in; a slow breath while the seal closes
        const f = since >= 0 && since < LOCK_FLASH ? 1 - since / LOCK_FLASH : 0;
        if (f > 0) e.sweepMat.color.lerp(white, f);
        e.sweepMat.opacity =
          s.locked === i ? 0.85 + 0.15 * Math.sin(t * 7) : 0.95;
      }
    }

    // the seal of the answer locked in
    seal.visible = play && s.locked >= 0;
    if (seal.visible) {
      const i = s.locked;
      seal.position.set(spots[i].x, 0.03, spots[i].z);
      seal.scale.setScalar(r);
      seal.rotation.y = s.face[i];
      sealGeo.setDrawRange(0, sweepCount(s.seal));
    }

    // the pieces of a broken ring fly out and fade
    const age = (t - breakAt) / BREAK_LEN;
    shards.visible = play && breakRing >= 0 && age >= 0 && age < 1;
    if (shards.visible) {
      const ease = 1 - (1 - age) * (1 - age);
      for (let j = 0; j < SHARDS; j++) {
        const p = pieces[j];
        p.position.z = 0.04 + ease * 0.55;
        p.rotation.y = ease * (j % 2 ? 0.5 : -0.5);
        p.position.y = -ease * 0.01;
      }
      shardMat.opacity = 1 - age;
    } else if (age >= 1) breakRing = -1;

    // the question plate: rises when the choice opens, turns slowly to face the visitor
    plateRise += (1 - plateRise) * (play ? 1 - Math.exp(-dt / 0.5) : 1);
    plateMesh.scale.setScalar(Math.max(0.001, plateRise));
    const toward = Math.atan2(s.vx - plateAt.x, s.vz - plateAt.z);
    if (Number.isNaN(plateYaw) || !play) plateYaw = toward;
    else plateYaw += wrapAngle(toward - plateYaw) * (1 - Math.exp(-dt / 0.8));
    plate.rotation.y = plateYaw;

    // the tease, for an egg not yet found; at the end, sparks rising from the right ring
    const cheer = (t - cheerAt) / CHEER_LEN;
    for (let i = 0; i < n; i++) {
      const found = s.isFound(i) || !play;
      const d = s.dist[i];
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
      const cheering = play && i === block.correct && cheer >= 0 && cheer < 1;
      for (let j = 0; j < SPARKS; j++) {
        const b = (i * SPARKS + j) * 3;
        const q = (i * SPARKS + j) * 4;
        sc[q] = sc[q + 1] = sc[q + 2] = 1;
        if (cheering) {
          const a = (j * Math.PI * 2) / SPARKS + cheer * 1.5;
          const rise = (cheer * 1.6 + j * 0.13) % 1;
          sp[b] = spots[i].x + Math.sin(a) * r * 0.8;
          sp[b + 1] = 0.1 + rise * 1.8;
          sp[b + 2] = spots[i].z + Math.cos(a) * r * 0.8;
          sc[q + 3] = (1 - cheer) * (1 - rise * 0.5);
          continue;
        }
        const a = t * 0.9 + (j * Math.PI * 2) / SPARKS + i;
        const rr = 0.26 + 0.08 * Math.sin(t * 1.3 + j);
        const rise = (j * 0.37 + t * 0.22) % 1;
        sp[b] = spots[i].x + Math.cos(a) * rr;
        sp[b + 1] = options[i].lift + 0.05 + rise * 0.7;
        sp[b + 2] = spots[i].z + Math.sin(a) * rr;
        const twinkle = 0.3 + 0.7 * Math.max(0, Math.sin(t * 5 + j * 1.9));
        sc[q + 3] = warm * warm * twinkle * (1 - rise * 0.6);
      }
    }
    sparkMat.size = cheer >= 0 && cheer < 1 ? SPARK_SIZE * 2 : SPARK_SIZE;
    glintGeo.attributes.position.needsUpdate = true;
    glintGeo.attributes.color.needsUpdate = true;
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;

    // The arrow faces the eye; pointing up means straight ahead, sideways means turn that way.
    let to = -1;
    if (
      searching &&
      s.hinting &&
      near >= 0 &&
      s.dist[near] > radius + ARROW_NEAR
    )
      to = near;
    if (choosing && s.help && s.open >= 0) to = s.open;
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

    if (burstOn >= 0) {
      const b = (t - burstAt) / burstLen;
      burst.visible = b >= 0 && b < 1;
      if (burst.visible) {
        burst.position.set(spots[burstOn].x, 0.05, spots[burstOn].z);
        burst.scale.setScalar(burstFrom + (burstTo - burstFrom) * b);
        burstMat.opacity = 1 - b;
      } else burstOn = -1;
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
      plateTex.dispose();
      spark.dispose();
      reopening = true;
      queueMicrotask(() => (reopening = false));
    },
  };
}

/* ---------- the story card: DOM, inside el only ---------- */
// On the compact HUD the stage keeps the card behind its "i" and shows the found-dots itself; this
// card then holds only what the "more" button opens. On the card HUD the card keeps a small pill.
const CSS = `
[data-kind="${NAME}"] .dw-pill { display: flex; align-items: center; gap: 10px; min-height: 44px; }
[data-kind="${NAME}"] .dw-pill.has-count { padding-left: 12px; }
[data-kind="${NAME}"] .dw-count { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-kind="${NAME}"] .dw-pips { display: flex; gap: 4px; }
[data-kind="${NAME}"] .dw-pips i { width: 11px; height: 14px; border-radius: 50% 50% 46% 46% / 58% 58% 42% 42%; border: 1.5px dashed rgb(255 255 255 / 50%); }
[data-kind="${NAME}"] .dw-pips i.on { border: 0; background: var(--hue); }
[data-kind="${NAME}"] .dw-help { min-height: 36px; padding: 0 12px; border: 1px solid rgb(255 255 255 / 30%); border-radius: 18px; background: rgb(255 255 255 / 10%); color: var(--walk-ink); font-size: 13.5px; font-weight: 600; white-space: nowrap; }
[data-kind="${NAME}"] .dw-more { flex: none; display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%; background: rgb(255 255 255 / 12%); color: var(--walk-ink); }
[data-kind="${NAME}"] .dw-more svg { width: 20px; height: 20px; fill: currentColor; }
[data-kind="${NAME}"] .dw-note { margin-top: 8px; font-size: 13.5px; line-height: 1.35; color: var(--walk-muted); }
[data-kind="${NAME}"] .dw-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
[data-kind="${NAME}"] .dw-row .btn { min-height: 44px; }
[data-kind="${NAME}"] .dw-yes { display: flex; gap: 8px; margin-top: 10px; }
[data-kind="${NAME}"] .dw-yes .btn { min-height: 52px; }
[data-kind="${NAME}"] .dw-yes .btn:not(.primary) { flex: none; }
[data-kind="${NAME}"] .answers .a { flex-direction: column; gap: 2px; text-align: center; }
[data-kind="${NAME}"] .answers .a small { font-size: 12.5px; font-weight: 500; line-height: 1.25; opacity: 0.8; }
[data-kind="${NAME}"] .answers .a:not(:disabled) { border-left: 5px solid var(--hue); }
[data-kind="${NAME}"] .dw-points { margin-top: 8px; }
[data-kind="${NAME}"] .dw-points .plus { margin-left: 0; }
[data-kind="${NAME}"] details { margin-top: 10px; border-top: 1px solid var(--walk-line); }
[data-kind="${NAME}"] summary { display: flex; align-items: center; min-height: 40px; font-size: 13.5px; font-weight: 600; color: var(--walk-muted); cursor: pointer; list-style: none; }
[data-kind="${NAME}"] summary::-webkit-details-marker { display: none; }
[data-kind="${NAME}"] summary::before { content: "+"; display: inline-block; width: 18px; font-weight: 700; }
[data-kind="${NAME}"] details[open] summary::before { content: "-"; }
[data-kind="${NAME}"] .f { margin-top: 4px; }
[data-kind="${NAME}"] .f output { float: right; color: var(--walk-ink); font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .dw-read { margin-top: 6px; font-size: 12.5px; line-height: 1.35; color: var(--walk-muted); font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .dw-why p { margin: 0 0 8px; font-size: 13.5px; line-height: 1.4; }
[data-kind="${NAME}"] .dw-why b { display: block; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--walk-found); }
@media (orientation: landscape) and (max-height: 520px) {
  [data-kind="${NAME}"] .dw-yes .btn { min-height: 44px; }
  [data-kind="${NAME}"] .dw-note { margin-top: 5px; font-size: 12.5px; }
}
`;

const SVG = "http://www.w3.org/2000/svg";

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dotsIcon() {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  for (const x of [4, 10, 16]) {
    const c = document.createElementNS(SVG, "circle");
    c.setAttribute("cx", String(x));
    c.setAttribute("cy", "10");
    c.setAttribute("r", "1.9");
    svg.append(c);
  }
  return svg;
}

function addStyle(el) {
  const style = document.createElement("style");
  style.textContent = CSS;
  el.append(style);
}

function whyBlock() {
  const why = make("details", "dw-why");
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
  const box = make("details", "dw-tune");
  box.append(
    make("summary", "", "Try the feel: ring, dwell, take-back, position error"),
  );
  box.append(
    slider(
      "Answer ring radius",
      {
        min: RING_MIN,
        max: RING_MAX,
        step: 0.25,
        value: tune.ring,
        unit: "m",
        format: metres,
      },
      (v) => (tune.ring = v),
    ),
    slider(
      "Stand still this long to lock in",
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
      "Then a step out takes it back for",
      {
        min: GRACE_MIN,
        max: GRACE_MAX,
        step: 0.5,
        value: tune.grace,
        unit: "s",
        format: seconds,
      },
      (v) => (tune.grace = v),
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
      (v) => (tune.hintAfter = v),
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
  const row = make("div", "dw-row");
  const again = make("button", "btn", "Place the station off again");
  again.type = "button";
  again.addEventListener("click", () => {
    tune.angle = (tune.angle + 2.2 + Math.random() * 1.8) % (Math.PI * 2);
  });
  row.append(again);
  const read = make("p", "dw-read");
  const note = make(
    "p",
    "dw-read",
    `A ring starts ${ENTER_DELAY} s after the visitor is in it and lets go only ${RING_LET_GO} m past its edge, so jitter at the edge neither starts nor cancels it. The fill grows only while the walker is slower than ${STILL_SPEED} m/s, so walking through a ring adds nothing; outside it drains ${DRAIN} times faster than it filled. A ring the visitor stands in when the choice opens waits until they step out once.`,
  );
  box.append(toggle, row, read, note);
  const tick = () => {
    if (!box.open) return;
    const lines = [];
    const phase = s.phase();
    const i = phase === "search" ? s.target : phase === "choose" ? s.open : -1;
    if (i >= 0) {
      const what = phase === "search" ? "hidden" : "open";
      lines.push(
        `Nearest ${what} answer: ${s.dist[i].toFixed(1)} m, measured ${s.measured[i].toFixed(1)} m.`,
      );
    }
    lines.push(`Walking at ${s.speed.toFixed(1)} m/s.`);
    if (s.at >= 0)
      lines.push(`In "${s.label(s.at)}": ${Math.round(s.fill[s.at] * 100)} %.`);
    read.textContent = lines.join(" ");
  };
  return { box, tick };
}

function card(block, el, env) {
  const s = sessions.get(block);
  if (!s) return null;
  addStyle(el);
  const host = make("div", "dw");
  el.append(host);
  const { options } = block;
  const n = options.length;
  const compact = env.hud?.compact === true;
  let yesTimer = 0;
  let tickTune = () => {};
  // Compact: the way out is behind the "i", so the guide says once that it is there.
  const told = { search: false, choose: false };
  const tell = (key, text) => {
    if (told[key]) return;
    told[key] = true;
    env.say(text, { eyebrow: "A way out" });
  };

  const intro = `${COUNT[n]} answers are hidden around this square, each by the thing it is about. Find them all, then stand in the ring of the one you think is right until it closes.`;

  const pointsRow = () => {
    const row = make("p", "dw-points");
    if (memory.result === "right" && memory.earned > 0)
      row.append(make("span", "plus", `+${memory.earned}`));
    else row.append(make("span", "plus none", "No points"));
    return row;
  };

  const tiles = () => {
    const wrap = make("div", "answers small");
    for (const i of memory.found) {
      const o = options[i];
      let cls = "a";
      if (i === block.correct) cls += i === memory.chosen ? " right" : " was";
      else cls += memory.crossed.has(i) ? " wrong" : " dim";
      const b = make("button", cls);
      b.type = "button";
      b.disabled = true;
      b.style.setProperty("--hue", HUES[i]);
      b.append(make("span", "", o.label));
      if (o.clue) b.append(make("small", "", o.clue));
      wrap.append(b);
    }
    return wrap;
  };

  const moreButton = () => {
    const more = make("button", "dw-more");
    more.type = "button";
    more.dataset.act = "more";
    more.setAttribute(
      "aria-label",
      "More: answer without walking there, and the settings",
    );
    more.append(dotsIcon());
    return more;
  };

  // The pill: the count while searching; while choosing only the "more" button, joined by a way
  // out when the visitor has stood far from every ring for a while.
  const pill = () => {
    const row = make("div", "dw-pill");
    const phase = s.phase();
    if (phase === "search") {
      row.classList.add("has-count");
      row.append(make("span", "dw-count", `${memory.found.length} of ${n}`));
      const pips = make("span", "dw-pips");
      pips.setAttribute("aria-hidden", "true");
      for (let k = 0; k < n; k++) {
        const pip = make("i", k < memory.found.length ? "on" : "");
        if (k < memory.found.length)
          pip.style.setProperty("--hue", HUES[memory.found[k]]);
        pips.append(pip);
      }
      row.append(pips);
      if (memory.hinted && !s.skipped) {
        const help = make("button", "dw-help", "Cannot get there?");
        help.type = "button";
        help.dataset.act = "more";
        row.append(help);
      }
    } else if (phase === "choose" && s.help && !s.skipped) {
      const help = make("button", "dw-help", "Cannot walk there?");
      help.type = "button";
      help.dataset.act = "more";
      row.append(help);
    }
    row.append(moreButton());
    return row;
  };

  // Behind the "more" button: the way to answer without walking, then the settings and the why.
  const openView = () => {
    const phase = s.phase();
    if (phase === "search") {
      host.append(
        make(
          "p",
          "dw-note",
          `${memory.found.length} of ${n} found. If you cannot get to the rest, they can be shown, and you choose from here.`,
        ),
      );
      const rest = make("button", "btn", "Show me the rest");
      rest.type = "button";
      rest.dataset.act = "rest";
      const row = make("div", "dw-row");
      row.append(rest);
      host.append(row);
    } else if (phase === "choose") {
      host.append(
        make(
          "p",
          "dw-note",
          s.countAt
            ? "Locked in."
            : "Cannot walk to a ring? Choose here instead.",
        ),
      );
      const wrap = make("div", "answers small");
      for (const i of memory.found) {
        const o = options[i];
        const tried = memory.crossed.has(i);
        let cls = "a";
        if (tried) cls += " wrong";
        else if (s.listPick === i || (s.countAt && s.countWhich === i))
          cls += " on";
        const b = make("button", cls);
        b.type = "button";
        b.disabled = tried || s.countAt > 0;
        b.dataset.answer = String(i);
        b.style.setProperty("--hue", HUES[i]);
        b.append(make("span", "", o.label));
        if (o.clue) b.append(make("small", "", o.clue));
        wrap.append(b);
      }
      if (compact) {
        // the question lies on the ground; here it is once more, for an answer chosen from the list
        const q = make("p", "dw-note");
        q.append(make("b", "", "The question: "), document.createTextNode(block.question));
        host.append(q);
      }
      host.append(wrap);
      if (s.listPick >= 0 && !s.countAt) {
        const yes = make("div", "dw-yes");
        const ok = make("button", "btn primary", "Lock it in");
        ok.type = "button";
        ok.dataset.act = "yes";
        ok.disabled = true;
        yesTimer = setTimeout(() => (ok.disabled = false), YES_GUARD_MS);
        const no = make("button", "btn", "Not this one");
        no.type = "button";
        no.dataset.act = "no";
        yes.append(ok, no);
        host.append(yes);
      }
    }
    if (!compact) {
      // the compact HUD's sheet has its own close
      const row = make("div", "dw-row");
      const back = make("button", "btn", "Back to the place");
      back.type = "button";
      back.dataset.act = "less";
      row.append(back);
      host.append(row);
    }
    const { box, tick } = tuneBlock(s);
    tickTune = tick;
    host.append(box, whyBlock());
  };

  s.render = () => {
    clearTimeout(yesTimer);
    tickTune = () => {};
    host.replaceChildren();
    host.className = "dw";
    const phase = s.phase();
    if (compact)
      env.hud.dots(
        phase === "search" && !s.skipped ? n : 0,
        memory.found.map((i) => HUES[i]),
      );
    if (phase === "done" && memory.revealed) {
      host.append(tiles());
      if (block.points > 0) host.append(pointsRow());
      return;
    }
    if (compact) {
      // Everything the "more" button would open, always, since it already sits behind the "i".
      if (phase === "search" && memory.hinted && !s.skipped)
        tell(
          "search",
          "Follow the arrow. If you cannot get there, the i button can show you the rest.",
        );
      if (phase === "choose" && s.help && !s.skipped)
        tell(
          "choose",
          "Cannot walk to a ring? The i button lets you choose from here.",
        );
      if (phase !== "done") openView();
      return;
    }
    if (memory.open) {
      openView();
      return;
    }
    if (!memory.slim) return; // the intro: the stage's own line says it
    host.classList.add("dw-slim");
    host.append(pill());
  };

  const openMore = () => {
    memory.open = true;
    memory.slim = true;
    const phase = s.phase();
    if (phase === "choose")
      env.say(block.question, {
        ask: true,
        eyebrow: memory.tries ? "One more try" : "Answer from here",
      });
    else if (phase === "search")
      env.say(
        block.find.askFirst
          ? block.question
          : `${COUNT[n]} answers are hidden around this square.`,
        {
          ask: block.find.askFirst,
          eyebrow: `${memory.found.length} of ${n} found`,
        },
      );
    s.render();
  };

  host.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === "more") openMore();
    else if (act === "less") {
      memory.open = false;
      s.listPick = -1;
      s.render();
    } else if (act === "rest") {
      s.showRest();
      if (!compact) openMore();
    } else if (act === "yes") s.lockFromList(s.listPick);
    else if (act === "no") {
      s.listPick = -1;
      s.render();
    } else if (b.dataset.answer !== undefined) {
      s.listPick = Number(b.dataset.answer);
      s.render();
    }
  });

  const phase = s.phase();
  if (phase === "done") {
    if (memory.revealed) {
      const right = memory.result === "right";
      env.say(right ? block.says.right : block.says.wrong, {
        mood: right ? "happy" : "doubt",
      });
    } else s.reveal();
  } else if (memory.open && !compact) openMore();
  else
    env.say(memory.found.length ? block.question : intro, {
      eyebrow: "Find them, then stand in a ring",
    });
  s.render();
  if (phase === "done") env.done();

  const ticker = setInterval(() => tickTune(), 300);
  // The stage hides this element when the story moves on. Without an answer that is a skip, and
  // the seam has no other word for it, so the tease, the rings and the hints stop on this.
  const watch = new MutationObserver(() => {
    if (el.hidden && !memory.result) s.skipped = true;
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
function panel(raw, el, env) {
  addStyle(el);
  const list = Array.isArray(raw.answer?.options) ? raw.answer.options : [];
  const ring = Number.isFinite(raw.choose?.ring)
    ? clamp(raw.choose.ring, RING_MIN, RING_MAX)
    : RING_DEFAULT;
  const name = (i) => list[i]?.label || `Answer ${i + 1}`;
  const spots = list
    .slice(0, 4)
    .map((o, i) =>
      o?.hide && Number.isFinite(o.hide.x) && Number.isFinite(o.hide.z)
        ? insideRing(o.hide.x, o.hide.z)
        : fallbackSpot(i, env.place.anchors),
    );
  const { pairs, limit } = crowdedPairs(spots, ring);
  el.append(
    make(
      "p",
      "dw-note",
      `Drag a ring to hide an answer. The filled disc is how close a visitor must come to find it; the outer ring is where they stand to choose it. Keep answers at least ${metres(limit)} m apart, and their rings inside the station: a ring turns red when it is not.`,
    ),
  );
  for (const [i, j, d] of pairs)
    el.append(
      make(
        "p",
        "dw-note",
        `"${name(i)}" and "${name(j)}" are only ${d.toFixed(1)} m apart: a visitor between them could stand in the wrong ring.`,
      ),
    );
  const unplaced = list
    .slice(0, 4)
    .map((o, i) => (o && !o.hide ? name(i) : null))
    .filter(Boolean);
  if (unplaced.length)
    el.append(
      make(
        "p",
        "dw-note",
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
      ring: num(choose.ring, RING_DEFAULT, RING_MIN, RING_MAX),
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
      name: "choose.ring",
      label: "Answer ring radius, metres",
      type: "range",
      min: RING_MIN,
      max: RING_MAX,
      step: 0.25,
    },
    {
      name: "choose.dwellS",
      label: "Stand still this long to lock in, seconds",
      type: "range",
      min: DWELL_MIN,
      max: DWELL_MAX,
      step: 0.5,
    },
    {
      name: "choose.graceS",
      label: "Then a step out takes it back for, seconds",
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
