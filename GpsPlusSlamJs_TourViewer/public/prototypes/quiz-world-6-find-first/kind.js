// Find them first: a quiz whose answers are hidden around the station, each at the thing it is
// about. Hidden means not drawn: in AR nothing real can cover an egg, so an egg shows only when the
// visitor is close. From afar each one glints now and then, faster as the visitor comes near, and
// after a while without a find an arrow on the ground points at the nearest. A found egg opens and
// its answer and clue stand above it. When all are found, the question opens with them as the
// choices. Throwaway; not wired to the app.
import {
  BufferGeometry,
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

const NAME = "find-first";
const FONT = 'Corbel, "Noto Sans", system-ui, sans-serif';

/* ---------- what the feel rests on: tune here, or with the sliders on the card ---------- */
const RADIUS_DEFAULT = 1.5; // metres: found when the measured position comes this close
const RADIUS_MIN = 0.5;
const RADIUS_MAX = 5;
const HINT_DEFAULT = 25; // seconds without a find before the arrow comes
const HINT_MIN = 5;
const HINT_MAX = 90;
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
const INK = "#1c2128";
const PAPER = "#fbf8f0";
const COUNT = ["", "One", "Two", "Three", "Four"];

const SAYS = {
  right: "Yes, that is the one.",
  wrong: "No, that was not it.",
};

const WHY = {
  for: "Each answer is hidden at the thing it is about, so finding it means standing at that thing and looking at it. The walk does the teaching and the question checks it. A card on the screen cannot send anyone to the statue.",
  against:
    "It puts a search before the question. A visitor who only wants to answer, or cannot walk the whole square, meets a delay, and the button that rescues them also skips the idea. And when the station lands a few metres off, an answer hidden on the bench floats beside it: hiding places have to be loose, near a thing rather than on it.",
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

/* ---------- what lasts beyond one open ---------- */
// "Ten rounds" closes and opens the world within one visit, back to back in the same task; a
// Restart, a sample or an edit opens it later or with another record. So a world opened right after
// a dispose, for the same record, continues the visit, and anything else starts the search again.
const memory = {
  key: "",
  found: [], // indices, in the order found
  shown: new Set(), // found by "Show me the rest", not by walking
  result: null, // null | "right" | "wrong"
  chosen: -1,
  wait: 0, // seconds since the last find
  hinted: false, // the first hint has come, so the way out is offered
};
let reopening = false;

// The sliders on the card: a page-long test aid, not part of the record. Radius and hint start
// from the record whenever it changes.
const tune = {
  key: "",
  radius: RADIUS_DEFAULT,
  hintAfter: HINT_DEFAULT,
  jitter: JITTER_DEFAULT,
  offset: 0, // metres the whole station is placed off, as an AR alignment error
  angle: 0.9,
  overlay: false,
};

function startVisit(key) {
  memory.key = key;
  memory.found = [];
  memory.shown = new Set();
  memory.result = null;
  memory.chosen = -1;
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

// A disc of radius 1, scaled to the found radius: a faint fill and a bright rim.
function discGeometry() {
  const pos = [];
  const col = [];
  const band = (a, b, tint) => {
    const g = new RingGeometry(a, b, 56).rotateX(-Math.PI / 2).toNonIndexed();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), 0, p.getZ(i));
      col.push(tint[0], tint[1], tint[2], tint[3]);
    }
    g.dispose();
  };
  band(0, 0.93, [1, 1, 1, 0.2]);
  band(0.93, 1, [1, 1, 1, 0.95]);
  return soup(pos, col);
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
  found: { band: null, paper: PAPER, ink: INK, word: "Found" },
  shown: { band: "#9aa3ab", paper: PAPER, ink: INK, word: "Shown" },
  edit: { band: null, paper: PAPER, ink: INK, word: "Hidden here" },
  right: { band: RIGHT, paper: "#d7fbf4", ink: "#04201c", word: "Right" },
  wrong: { band: WRONG, paper: "#d9dcdf", ink: "#4d545b", word: "Not this" },
  other: { band: "#aab1b8", paper: "#d9dcdf", ink: "#4d545b", word: "" },
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
  if (!option.clue) return;
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

/* ---------- the visit: what the world part and the card share, per open ---------- */
const sessions = new WeakMap();

function makeSession(block, env) {
  const n = block.options.length;
  const s = {
    n,
    outside: false,
    skipped: false,
    closed: false,
    hinting: false, // the arrow is up now
    target: -1, // the nearest egg not yet found
    dist: new Float64Array(n), // true horizontal metres, viewer to egg
    measured: new Float64Array(n), // the same from the measured position
    dwell: new Float64Array(n),
    burst: -1,
    burstAt: 0,
    time: 0,
    render() {},
    paint() {},
  };
  s.isFound = (i) => memory.found.includes(i);
  s.phase = () =>
    memory.result ? "done" : memory.found.length >= n ? "ask" : "search";

  s.look = (i) => {
    if (env.mode !== "play") return "edit";
    if (memory.result) {
      if (i === block.correct) return "right";
      return i === memory.chosen ? "wrong" : "other";
    }
    return memory.shown.has(i) ? "shown" : "found";
  };

  const changed = () => {
    s.paint();
    s.render();
  };

  const openQuestion = () => {
    env.say(block.question, {
      ask: true,
      eyebrow: `All ${n} found - the question`,
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
      openQuestion();
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
    openQuestion();
    changed();
  };

  s.answer = (i) => {
    if (s.phase() !== "ask") return;
    memory.chosen = i;
    memory.result = i === block.correct ? "right" : "wrong";
    if (memory.result === "right") {
      env.sound("right").play();
      env.say(block.says.right, { mood: "happy" });
    } else {
      env.sound("wrong").play();
      env.say(block.says.wrong, { mood: "doubt" });
    }
    changed();
    env.done();
  };

  s.hint = () => {
    s.hinting = true;
    const first = !memory.hinted;
    memory.hinted = true;
    env.say(
      "Still looking? Follow the arrow, it points to the nearest one.",
      { eyebrow: "A hint" },
    );
    if (first) s.render();
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
  }
  const s = makeSession(block, env);
  sessions.set(block, s);
  const { options } = block;
  const n = options.length;
  const spots = options.map(
    (o, i) => o.hide ?? fallbackSpot(i, env.place.anchors),
  );

  const object = new Group();
  const content = new Group(); // moved as one by the placement error, the way an AR alignment is
  object.add(content);

  const atlas = env.paintText({
    width: ATLAS,
    height: ATLAS,
    draw(g) {
      options.forEach((o, i) => {
        g.save();
        g.translate((i % 2) * CELL_W, (i >> 1) * CELL_H);
        const look = s.look(i);
        drawCell(g, o, HUES[i], look, look === "edit" && i === block.correct);
        g.restore();
      });
    },
  });
  s.paint = () => atlas.repaint();
  const spark = env.paintText({ width: 64, height: 64, draw: drawSpark });
  spark.premultiplyAlpha = true;

  const geos = [];
  const mats = [];
  const labelMat = new MeshBasicMaterial({ map: atlas, alphaTest: 0.5 });
  const discGeo = discGeometry();
  const burstGeo = new RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
  const burstMat = new MeshBasicMaterial({
    color: RIGHT,
    transparent: true,
    depthWrite: false,
  });
  geos.push(discGeo, burstGeo);
  mats.push(labelMat, burstMat);

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
    const labelGeo = labelGeometry(i);
    const label = new Mesh(labelGeo, labelMat);
    label.position.y = EGG_H + LABEL_GAP + LABEL_H / 2;
    group.add(low, lid, label);
    content.add(group);

    // Edit only: how close a visitor must come, so the creator sees the reach of each place.
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
    mats.push(mat);
    const found = s.isFound(i);
    return {
      group,
      mat,
      lid,
      label,
      open: found || !play ? 1 : 0,
      pop: found || !play ? 1 : 0,
    };
  });

  // The tease: a glint per egg, and a small shimmer around each that grows with nearness.
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
  content.add(glints, sparks);
  geos.push(glintGeo, sparkGeo);
  mats.push(glintMat, sparkMat);
  // The buffers live in the attributes; keep the attributes' own arrays to write into.
  const gp = glintGeo.attributes.position.array;
  const gc = glintGeo.attributes.color.array;
  const sp = sparkGeo.attributes.position.array;
  const sc = sparkGeo.attributes.color.array;

  const burst = new Mesh(burstGeo, burstMat);
  burst.position.y = 0.05;
  burst.renderOrder = 3;
  burst.visible = false;
  content.add(burst);

  // The hint: held a little ahead of the eye and turned, in its own plane, towards the nearest
  // egg, the way a compass needle would be. Object metres, not moved with the station.
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
  object.add(arrow);
  geos.push(arrowGeo);
  mats.push(arrowMat);

  // What the phone measures: the found reach around the measured position, and where the
  // creator meant the eggs to be. Off unless the card's switch is on.
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
    const k = play ? 1 - Math.exp(-dt / EASE_TAU) : 1;
    const ox = play ? Math.cos(tune.angle) * tune.offset : 0;
    const oz = play ? Math.sin(tune.angle) * tune.offset : 0;
    content.position.set(ox, 0, oz);
    const radius = play ? tune.radius : block.find.radius;

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

    for (let i = 0; i < n; i++) {
      const e = eggs[i];
      const found = s.isFound(i) || !play;
      const d = s.dist[i];
      const seen = found ? 1 : smooth(radius + SEEN_EXTRA, radius + 0.3, d);
      e.mat.opacity = seen;
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
        const r = 0.26 + 0.08 * Math.sin(t * 1.3 + j);
        const rise = (j * 0.37 + t * 0.22) % 1;
        const b = (i * SPARKS + j) * 3;
        sp[b] = spots[i].x + Math.cos(a) * r;
        sp[b + 1] = options[i].lift + 0.05 + rise * 0.7;
        sp[b + 2] = spots[i].z + Math.sin(a) * r;
        const q = (i * SPARKS + j) * 4;
        sc[q] = sc[q + 1] = sc[q + 2] = 1;
        const twinkle = 0.3 + 0.7 * Math.max(0, Math.sin(t * 5 + j * 1.9));
        sc[q + 3] = warm * warm * twinkle * (1 - rise * 0.6);
      }
    }
    glintGeo.attributes.position.needsUpdate = true;
    glintGeo.attributes.color.needsUpdate = true;
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;

    // The arrow faces the eye; pointing up means straight ahead, sideways means turn that way.
    const showArrow =
      searching && s.hinting && near >= 0 && s.dist[near] > radius + ARROW_NEAR;
    arrow.visible = showArrow;
    if (showArrow) {
      const ax = v.x + Math.sin(frame.viewYaw) * ARROW_AHEAD;
      const az = v.z + Math.cos(frame.viewYaw) * ARROW_AHEAD;
      arrow.position.x = ax;
      arrow.position.z = az;
      const bearing = Math.atan2(spots[near].x + ox - v.x, spots[near].z + oz - v.z);
      arrow.rotation.y = frame.viewYaw + Math.PI;
      arrow.rotation.z = Math.atan2(
        Math.sin(bearing - frame.viewYaw),
        Math.cos(bearing - frame.viewYaw),
      );
      arrowMat.opacity = 0.75 + 0.25 * Math.sin(t * 4);
    }

    const overlay = play && tune.overlay;
    reach.visible = overlay;
    marks.visible = overlay;
    if (overlay) {
      reach.position.x = mx;
      reach.position.z = mz;
      reach.scale.setScalar(radius);
    }

    if (s.burst >= 0) {
      const age = (t - s.burstAt) / 1.1;
      burst.visible = age < 1;
      if (burst.visible) {
        burst.position.set(spots[s.burst].x, 0.05, spots[s.burst].z);
        burst.scale.setScalar(0.4 + age * 1.6);
        burstMat.opacity = 1 - age;
      } else s.burst = -1;
    }
  };

  return {
    object,
    update,
    leave() {
      s.outside = true;
      s.hinting = false;
      s.render();
    },
    back() {
      s.outside = false;
      s.render();
    },
    dispose() {
      s.close();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      atlas.dispose();
      spark.dispose();
      reopening = true;
      queueMicrotask(() => (reopening = false));
    },
  };
}

/* ---------- the story card: DOM, inside el only ---------- */
const CSS = `
[data-kind="${NAME}"] .ff-q { margin-top: 2px; font-size: 13.5px; line-height: 1.3; color: var(--walk-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
[data-kind="${NAME}"] .ff-q b { color: var(--walk-ink); font-weight: 600; }
[data-kind="${NAME}"] .ff-count { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
[data-kind="${NAME}"] .ff-count b { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .ff-pips { display: flex; gap: 6px; }
[data-kind="${NAME}"] .ff-pips i { width: 18px; height: 22px; border-radius: 50% 50% 46% 46% / 58% 58% 42% 42%; border: 1.5px dashed rgb(255 255 255 / 45%); }
[data-kind="${NAME}"] .ff-pips i.on { border: 0; background: var(--hue); box-shadow: inset 0 -5px 0 rgb(255 255 255 / 55%); }
[data-kind="${NAME}"] .ff-found { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
[data-kind="${NAME}"] .ff-found span { max-width: 100%; padding: 3px 9px; border-radius: 9px; border-left: 4px solid var(--hue); background: rgb(255 255 255 / 10%); font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-kind="${NAME}"] .ff-note { margin-top: 8px; font-size: 13.5px; line-height: 1.3; color: var(--walk-muted); }
[data-kind="${NAME}"] .ff-rest { margin-top: 8px; }
[data-kind="${NAME}"] .answers .a { flex-direction: column; gap: 2px; text-align: center; }
[data-kind="${NAME}"] .answers .a small { font-size: 12.5px; font-weight: 500; line-height: 1.25; opacity: 0.8; }
[data-kind="${NAME}"] .ff-pill { margin-top: 8px; }
[data-kind="${NAME}"] .ff-pill .plus { margin-left: 0; }
[data-kind="${NAME}"] details { margin-top: 10px; border-top: 1px solid var(--walk-line); }
[data-kind="${NAME}"] summary { display: flex; align-items: center; min-height: 40px; font-size: 13.5px; font-weight: 600; color: var(--walk-muted); cursor: pointer; list-style: none; }
[data-kind="${NAME}"] summary::-webkit-details-marker { display: none; }
[data-kind="${NAME}"] summary::before { content: "+"; display: inline-block; width: 18px; font-weight: 700; }
[data-kind="${NAME}"] details[open] summary::before { content: "-"; }
[data-kind="${NAME}"] .f { margin-top: 4px; }
[data-kind="${NAME}"] .f output { float: right; color: var(--walk-ink); font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .ff-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
[data-kind="${NAME}"] .ff-row .btn { min-height: 40px; padding: 6px 12px; font-size: 13.5px; }
[data-kind="${NAME}"] .ff-read { margin-top: 6px; font-size: 12.5px; line-height: 1.35; color: var(--walk-muted); font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .ff-why p { margin: 0 0 8px; font-size: 13.5px; line-height: 1.4; }
[data-kind="${NAME}"] .ff-why b { display: block; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--walk-found); }
@media (orientation: landscape) and (max-height: 520px) {
  [data-kind="${NAME}"] .ff-count { margin-top: 6px; }
  [data-kind="${NAME}"] .ff-found { margin-top: 5px; }
  [data-kind="${NAME}"] .ff-note { margin-top: 5px; font-size: 12.5px; }
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
  const why = make("details", "ff-why");
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

function tuneBlock(s) {
  const box = make("details", "ff-tune");
  box.append(make("summary", "", "Try the feel: radius, hint, position error"));
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
  const row = make("div", "ff-row");
  const again = make("button", "btn", "Place the station off again");
  again.type = "button";
  again.addEventListener("click", () => {
    tune.angle = (tune.angle + 2.2 + Math.random() * 1.8) % (Math.PI * 2);
  });
  row.append(again);
  const read = make("p", "ff-read");
  const note = make(
    "p",
    "ff-read",
    "Walk with the stick or by tapping the ground. Jitter moves the position the found test measures; in AR that is the camera's own tracking, a few centimetres. The station's placement error moves all the eggs together, so they stay findable but leave the things they were hidden at. The ring and the crosses show both.",
  );
  box.append(toggle, row, read, note);
  const tick = () => {
    if (!box.open) return;
    const i = s.target;
    const lines = [];
    if (i >= 0 && s.phase() === "search") {
      lines.push(
        `Nearest hidden answer: ${s.dist[i].toFixed(1)} m, measured ${s.measured[i].toFixed(1)} m.`,
      );
    }
    lines.push(
      `Found within ${metres(tune.radius)} m; the egg shows from ${metres(tune.radius + SEEN_EXTRA)} m.`,
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

  const pill = () => {
    const row = make("p", "ff-pill");
    if (memory.result === "right" && block.points > 0)
      row.append(make("span", "plus", `+${block.points}`));
    else row.append(make("span", "plus none", "No points"));
    return row;
  };

  const answers = (done) => {
    const wrap = make("div", "answers small");
    for (const i of memory.found) {
      const o = options[i];
      let cls = "a";
      if (done) {
        if (i === block.correct) cls += i === memory.chosen ? " right" : " was";
        else cls += i === memory.chosen ? " wrong" : " dim";
      }
      const b = make("button", cls);
      b.type = "button";
      b.disabled = done;
      b.dataset.answer = String(i);
      b.style.setProperty("--hue", HUES[i]);
      b.append(make("span", "", o.label));
      if (o.clue) b.append(make("small", "", o.clue));
      wrap.append(b);
    }
    return wrap;
  };

  const noteText = () => {
    if (s.skipped) return "";
    if (s.outside) return "Come back inside the circle to keep looking.";
    if (s.hinting) return "Follow the arrow.";
    const left = Math.max(0, Math.ceil(tune.hintAfter - memory.wait));
    return `Look for a glint. A hint in ${left} s.`;
  };

  s.render = () => {
    host.replaceChildren();
    note = null;
    const phase = s.phase();
    if (phase === "done") {
      host.append(answers(true));
      if (block.points > 0) host.append(pill());
      return;
    }
    if (phase === "ask") {
      host.append(answers(false));
      return;
    }
    if (block.find.askFirst) {
      const q = make("p", "ff-q");
      q.append(
        make("b", "", "The question: "),
        document.createTextNode(block.question),
      );
      host.append(q);
    }
    const count = make("div", "ff-count");
    const pips = make("span", "ff-pips");
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
      const list = make("div", "ff-found");
      for (const i of memory.found) {
        const chip = make("span", "", options[i].label);
        chip.style.setProperty("--hue", HUES[i]);
        list.append(chip);
      }
      host.append(list);
    }
    note = make("p", "ff-note", noteText());
    host.append(note);
    if (memory.hinted && !s.skipped) {
      const rest = make(
        "button",
        "btn ff-rest",
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
    if (b.dataset.act === "rest") s.showRest();
    else if (b.dataset.answer !== undefined) s.answer(Number(b.dataset.answer));
  });

  const phase = s.phase();
  if (phase === "search") {
    const intro = `${COUNT[n]} answers are hidden around this square, each by the thing it is about. Find them, then I will ask.`;
    env.say(
      memory.found.length
        ? `${memory.found.length} of ${n} found. Keep looking.`
        : intro,
      {
        eyebrow: "Find them first",
      },
    );
  } else {
    env.say(block.question, {
      ask: true,
      eyebrow: `All ${n} found - the question`,
    });
  }
  s.render();
  if (phase === "done") env.done();

  const ticker = setInterval(() => {
    if (note) {
      const text = noteText();
      if (note.textContent !== text) note.textContent = text;
    }
    tickTune();
  }, 300);
  // The stage hides this element when the story moves on. Without an answer that is a skip, and
  // the seam has no other word for it, so the tease and the hint stop on this.
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
function panel(raw, el) {
  addStyle(el);
  const list = Array.isArray(raw.answer?.options) ? raw.answer.options : [];
  const unplaced = list
    .map((o, i) => (o && !o.hide ? o.label || `Answer ${i + 1}` : null))
    .filter(Boolean);
  el.append(
    make(
      "p",
      "ff-note",
      "Drag a ring to hide an answer. Its disc is how close a visitor must come to find it; the egg itself shows from 3 m further out. Hide each answer by the thing it is about, near it rather than on it: the station can land a few metres off.",
    ),
  );
  if (unplaced.length)
    el.append(
      make(
        "p",
        "ff-note",
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
  const num = (x, d, a, b) => clamp(Number.isFinite(x) ? x : d, a, b);
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
    says: {
      right:
        tools.optionalText(v.says, "right", { max: 200 }).right ?? SAYS.right,
      wrong:
        tools.optionalText(v.says, "wrong", { max: 200 }).wrong ?? SAYS.wrong,
    },
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
      name: "points",
      label: "Points",
      type: "range",
      min: 0,
      max: 50,
      step: 5,
    },
    { name: "says.right", label: "Guide, when right" },
    { name: "says.wrong", label: "Guide, when wrong" },
  ];
}

export const kind = { name: NAME, read, fields, world, card, panel };
