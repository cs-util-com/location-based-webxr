/* eslint-disable complexity -- render functions of a throwaway prototype */
// Splat trainer, variant B: the walk as a path.
// Throwaway prototype: everything here is simulated. The walk is a made-up
// curve, the census numbers and verdicts are scripted, and the previews are
// drawn in code. Nothing is read, trained, uploaded or saved.

const SVG_NS = "http://www.w3.org/2000/svg";
const WALK_M = 362;
const READ_SEC = 25; // simulated seconds to read the zip
const PREVIEW_EVERY = 15; // simulated seconds between preview renders

const REASONS = {
  far: "Frames far apart: the phone moved quickly here, so there are few photos per metre.",
  blurry: "Many blurry frames here.",
  time: "Ran out of time before it was sharp.",
  views:
    "Sharp where the photos were taken, poor between them: too few views of this place.",
  stillFar:
    "Still few photos per metre. More time helped, but a slower walk here would help more.",
};

// One row per stretch, in walk order. retry = the outcome of "Train again".
const SCRIPT = [
  { frames: 104, skipped: 3, min: 4.0, v: ["good", 29.4, 23.1] },
  { frames: 112, skipped: 2, min: 4.2, v: ["good", 28.8, 22.4] },
  { frames: 98, skipped: 1, min: 3.8, v: ["good", 30.1, 23.6] },
  {
    frames: 96,
    skipped: 18,
    min: 3.8,
    v: ["weak", 26.1, 20.2, ["blurry"]],
    retry: ["good", 27.6, 21.3],
  },
  { frames: 110, skipped: 4, min: 4.1, v: ["good", 28.2, 21.9] },
  { frames: 108, skipped: 2, min: 4.1, v: ["good", 29.0, 22.8] },
  {
    frames: 38,
    skipped: 0,
    min: 2.5,
    v: ["bad", 23.4, 17.6, ["far"]],
    retry: ["weak", 25.6, 19.4, ["stillFar"]],
  },
  { frames: 106, skipped: 3, min: 4.0, v: ["good", 28.5, 22.0] },
  {
    frames: 101,
    skipped: 2,
    min: 3.9,
    v: ["weak", 27.8, 19.9, ["views"]],
    retry: ["good", 28.4, 21.2],
  },
  { frames: 112, skipped: 5, min: 4.2, v: ["good", 28.9, 22.6] },
  {
    frames: 124,
    skipped: 2,
    min: 4.6,
    v: ["weak", 26.3, 20.7, ["time"]],
    retry: ["good", 27.9, 21.5],
  },
  { frames: 131, skipped: 0, min: 4.8, v: ["good", 29.2, 22.9] },
];

const SENTENCE = {
  good: "Good. This stretch looks sharp from where you walked.",
  weak: "Weak. It will show, but some parts look soft.",
  bad: "Not good enough. It would look smeared in the editor.",
};

const VERDICT_WORD = {
  good: "Good",
  weak: "Weak",
  bad: "Not good enough",
  waiting: "Waiting",
  training: "Training",
  discarded: "Left out",
};

const VERDICT_MARK = { good: "✓", weak: "!", bad: "×", discarded: "-" };

// ---------------------------------------------------------------- the walk
// A synthetic walk: a Catmull-Rom curve through made-up points that loops
// back over itself once (a place passed twice). Not a real place.
const CTRL = [
  [80, 540],
  [200, 565],
  [330, 520],
  [450, 545],
  [580, 500],
  [690, 420],
  [705, 300],
  [620, 195],
  [500, 165],
  [395, 225],
  [385, 340],
  [460, 430],
  [565, 478],
  [665, 545],
  [785, 565],
  [890, 490],
  [915, 370],
  [858, 262],
  [870, 160],
  [935, 92],
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a, b, c, d) =>
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

function buildWalk() {
  const raw = [];
  for (let i = 0; i < CTRL.length - 1; i++) {
    const p0 = CTRL[Math.max(0, i - 1)];
    const p3 = CTRL[Math.min(CTRL.length - 1, i + 2)];
    for (let k = 0; k < 24; k++)
      raw.push(catmull(p0, CTRL[i], CTRL[i + 1], p3, k / 24));
  }
  raw.push(CTRL[CTRL.length - 1]);
  const cum = [0];
  for (let i = 1; i < raw.length; i++) {
    cum.push(
      cum[i - 1] +
        Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]),
    );
  }
  const total = cum[cum.length - 1];
  const N = 720;
  const pts = [];
  let j = 1;
  for (let n = 0; n <= N; n++) {
    const s = (n / N) * total;
    while (j < cum.length - 1 && cum[j] < s) j++;
    const u = (s - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    pts.push([
      raw[j - 1][0] + (raw[j][0] - raw[j - 1][0]) * u,
      raw[j - 1][1] + (raw[j][1] - raw[j - 1][1]) * u,
    ]);
  }
  return { pts, total, mPerUnit: WALK_M / total };
}

const WALK = buildWalk();
const COUNT = SCRIPT.length;

// Cut by equal length: each stretch is about 30 m.
const CUTS = SCRIPT.map((_, i) => {
  const a = Math.round((i / COUNT) * (WALK.pts.length - 1));
  const b = Math.round(((i + 1) / COUNT) * (WALK.pts.length - 1));
  return WALK.pts.slice(a, b + 1);
});

function pointAt(pts, f) {
  const x = Math.max(0, Math.min(1, f)) * (pts.length - 1);
  const i = Math.floor(x);
  const u = x - i;
  const a = pts[i];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

function findRevisits() {
  const pts = WALK.pts;
  const found = [];
  const gap = Math.round(pts.length / 6);
  for (let i = 0; i < pts.length; i += 3) {
    for (let k = i + gap; k < pts.length; k += 3) {
      const d = Math.hypot(pts[i][0] - pts[k][0], pts[i][1] - pts[k][1]);
      if (d < 9) {
        const c = [(pts[i][0] + pts[k][0]) / 2, (pts[i][1] + pts[k][1]) / 2];
        if (!found.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < 60))
          found.push(c);
      }
    }
  }
  return found;
}

const REVISITS = findRevisits();

// ---------------------------------------------------------------- state
let speed = 60;
let playing = true;

function fresh() {
  return {
    phase: "start", // start | reading | census | running | cancelled | done | refused
    fileKind: "ok", // ok | broken | no-depth
    refusal: null, // phone | no-webgpu | broken | no-depth
    gpuSlow: false,
    gpuAck: false,
    readFrac: 0,
    queue: [],
    current: null,
    stretches: SCRIPT.map((d, i) => ({
      id: i + 1,
      status: "waiting", // waiting | training | done
      attempt: 0,
      planned: d.min * 60,
      elapsed: 0,
      result: null,
      prev: null,
      marked: false,
      discarded: false,
    })),
    pinned: null,
    hover: null,
    saved: false,
    stoppedAt: null,
  };
}

let S = fresh();

const gpuFactor = () => (S.gpuSlow ? 3 : 1);

function statusOf(s) {
  if (s.status === "training") return "training";
  if (s.status === "waiting") return "waiting";
  if (s.discarded) return "discarded";
  return s.result.verdict;
}

function finish(s) {
  const d = SCRIPT[s.id - 1];
  const row = s.attempt > 0 && d.retry ? d.retry : d.v;
  s.status = "done";
  s.result = {
    verdict: row[0],
    atCam: row[1],
    between: row[2],
    reasons: row[3] || [],
    trainedSec: s.planned,
    points: Math.round((d.frames * 2900 + s.id * 7100) / 1000) * 1000,
  };
}

function nextFromQueue() {
  const id = S.queue.shift();
  if (id == null) {
    S.current = null;
    S.phase = "done";
    return;
  }
  S.current = id;
  const s = S.stretches[id - 1];
  s.status = "training";
  s.elapsed = 0;
}

function advance(dt) {
  if (S.phase === "reading") {
    S.readFrac = Math.min(1, S.readFrac + dt / READ_SEC);
    if (S.readFrac >= 1) {
      if (S.fileKind === "broken") refuse("broken");
      else if (S.fileKind === "no-depth") refuse("no-depth");
      else S.phase = "census";
    }
    return;
  }
  while (S.phase === "running" && dt > 0 && S.current != null) {
    const s = S.stretches[S.current - 1];
    const step = Math.min(dt, s.planned - s.elapsed);
    s.elapsed += step;
    dt -= step;
    if (s.elapsed >= s.planned - 1e-6) {
      finish(s);
      nextFromQueue();
    }
  }
}

function startReading(kind = "ok") {
  S = fresh();
  S.gpuSlow = gpuSlowNext;
  S.fileKind = kind;
  S.phase = "reading";
}

function startTraining() {
  S.queue = S.stretches.map((s) => s.id);
  S.stretches.forEach(
    (s) => (s.planned = SCRIPT[s.id - 1].min * 60 * gpuFactor()),
  );
  S.phase = "running";
  S.stoppedAt = null;
  nextFromQueue();
}

function cancelTraining() {
  if (S.current != null) {
    const s = S.stretches[S.current - 1];
    s.status = "waiting";
    S.stoppedAt = { id: s.id, frac: s.elapsed / s.planned };
    s.elapsed = 0;
    S.queue.unshift(s.id);
  }
  S.current = null;
  S.phase = "cancelled";
}

function resumeTraining() {
  S.phase = "running";
  nextFromQueue();
}

function retrain(id) {
  const s = S.stretches[id - 1];
  s.prev = s.result ? s.result.verdict : null;
  s.result = null;
  s.status = "waiting";
  s.attempt += 1;
  s.marked = false;
  s.discarded = false;
  s.elapsed = 0;
  s.planned = SCRIPT[id - 1].min * 60 * 2 * gpuFactor();
  S.queue.push(id);
  if (S.phase === "done") {
    S.phase = "running";
    nextFromQueue();
  }
}

function refuse(kind) {
  S.phase = "refused";
  S.refusal = kind;
}

// ---------------------------------------------------------------- numbers
const fmtInt = (n) => n.toLocaleString("en-US");

function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

function fmtLeft(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 90) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  if (m < 10) return `${m} min ${Math.floor(r / 10) * 10} s`;
  return fmtDur(sec);
}

function totalPlanned() {
  return SCRIPT.reduce((a, d) => a + d.min * 60, 0) * gpuFactor();
}

function timeLeft() {
  let t = 0;
  if (S.current != null) {
    const s = S.stretches[S.current - 1];
    t += s.planned - s.elapsed;
  }
  for (const id of S.queue) t += S.stretches[id - 1].planned;
  return t;
}

function startsIn(id) {
  let t = 0;
  if (S.current != null) {
    const s = S.stretches[S.current - 1];
    t += s.planned - s.elapsed;
  }
  for (const q of S.queue) {
    if (q === id) return t;
    t += S.stretches[q - 1].planned;
  }
  return null;
}

function metresOf(id) {
  const a = Math.round(((id - 1) / COUNT) * WALK_M);
  const b = Math.round((id / COUNT) * WALK_M);
  return [a, b];
}

function counts() {
  const c = { good: 0, weak: 0, bad: 0, discarded: 0, waiting: 0, finished: 0 };
  for (const s of S.stretches) {
    const st = statusOf(s);
    if (st === "training" || st === "waiting") c.waiting++;
    else {
      c[st]++;
      c.finished++;
    }
  }
  return c;
}

// ---------------------------------------------------------------- previews
// Synthetic "renders": a seeded scene of gradients and shapes, shown through
// a blur and noise that shrink as the stretch trains.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 320;
const H = 200;
const sceneCache = new Map();
let noiseCanvas = null;

function scene(id) {
  if (sceneCache.has(id)) return sceneCache.get(id);
  const r = rng(id * 7919 + 17);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const hue = 190 + r() * 50;
  const horizon = H * (0.42 + r() * 0.12);
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, `hsl(${hue} 55% 62%)`);
  sky.addColorStop(1, `hsl(${hue + 15} 45% 84%)`);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, horizon);
  const ground = g.createLinearGradient(0, horizon, 0, H);
  const gh = 70 + r() * 40;
  ground.addColorStop(0, `hsl(${gh} 25% 52%)`);
  ground.addColorStop(1, `hsl(${gh - 20} 20% 30%)`);
  g.fillStyle = ground;
  g.fillRect(0, horizon, W, H - horizon);
  // a path on the ground, in perspective
  g.fillStyle = "hsl(35 18% 70%)";
  g.beginPath();
  g.moveTo(W * 0.47, horizon);
  g.lineTo(W * 0.53, horizon);
  g.lineTo(W * 0.78, H);
  g.lineTo(W * 0.22, H);
  g.closePath();
  g.fill();
  // blocks and round shapes standing on the horizon
  const n = 5 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const w = 24 + r() * 60;
    const h = 20 + r() * 70;
    if (r() < 0.55) {
      g.fillStyle = `hsl(${20 + r() * 30} ${20 + r() * 25}% ${40 + r() * 30}%)`;
      g.fillRect(x - w / 2, horizon - h, w, h + 4);
      g.fillStyle = "rgb(0 0 0 / 18%)";
      for (let k = 0; k < 3; k++)
        g.fillRect(
          x - w / 2 + 6 + k * (w / 3.2),
          horizon - h + 8,
          w / 6,
          h / 4,
        );
    } else {
      g.fillStyle = `hsl(${95 + r() * 40} 35% ${28 + r() * 15}%)`;
      g.beginPath();
      g.ellipse(x, horizon - h * 0.6, w * 0.45, h * 0.6, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  sceneCache.set(id, c);
  return c;
}

function noise() {
  if (noiseCanvas) return noiseCanvas;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const img = g.createImageData(W, H);
  const r = rng(99);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = r() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  noiseCanvas = c;
  return c;
}

const FINAL_SHARP = { good: 1, weak: 0.72, bad: 0.4 };

function drawPreview(canvas, id, sharp, ghost) {
  const g = canvas.getContext("2d");
  canvas.width = W;
  canvas.height = H;
  const blur = (1 - sharp) * 11;
  g.filter = `blur(${blur.toFixed(2)}px)`;
  g.drawImage(scene(id), 0, 0);
  if (ghost) {
    // a doubled, offset copy: what a smeared stretch looks like
    g.globalAlpha = 0.4;
    g.drawImage(scene(id), 9, -3);
    g.globalAlpha = 1;
  }
  g.filter = "none";
  g.globalAlpha = Math.max(0, (1 - sharp) * 0.55);
  g.globalCompositeOperation = "overlay";
  g.drawImage(noise(), 0, 0);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
}

/** Sharpness of the last preview taken at elapsed seconds, 0..1. */
function liveSharp(s) {
  const snap = Math.floor(s.elapsed / PREVIEW_EVERY) * PREVIEW_EVERY;
  const d = SCRIPT[s.id - 1];
  const row = s.attempt > 0 && d.retry ? d.retry : d.v;
  const fin = FINAL_SHARP[row[0]];
  return { sharp: fin * (1 - Math.exp((-3.2 * snap) / s.planned)), snap };
}

// ---------------------------------------------------------------- drawing the map
const $ = (sel) => document.querySelector(sel);
const svg = $("#walk");

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.appendChild(n);
  return n;
}

const pathD = (pts) =>
  pts
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join("");

const stretchEls = [];
let walkerG;
let dotsG;
let ghostPath;
let drawnG;

function buildSvg() {
  const defs = el("defs", {}, svg);
  const pat = el(
    "pattern",
    { id: "grid", width: 40, height: 40, patternUnits: "userSpaceOnUse" },
    defs,
  );
  el("path", { d: "M40 0H0V40", class: "grid-minor", fill: "none" }, pat);
  const pat2 = el(
    "pattern",
    { id: "grid2", width: 200, height: 200, patternUnits: "userSpaceOnUse" },
    defs,
  );
  el("path", { d: "M200 0H0V200", class: "grid-major", fill: "none" }, pat2);
  el(
    "rect",
    { x: -2000, y: -2000, width: 5000, height: 5000, fill: "url(#grid)" },
    svg,
  );
  el(
    "rect",
    { x: -2000, y: -2000, width: 5000, height: 5000, fill: "url(#grid2)" },
    svg,
  );

  ghostPath = el("path", { d: pathD(WALK.pts), class: "ghost-path" }, svg);

  drawnG = el("g", {}, svg);
  const revG = el("g", { class: "revisit" }, drawnG);
  for (const c of REVISITS) {
    el("circle", { cx: c[0], cy: c[1], r: 22 }, revG);
    const t = el(
      "text",
      { x: c[0], y: c[1] + 42, "text-anchor": "middle" },
      revG,
    );
    t.textContent = "passed twice";
  }

  const linesG = el("g", {}, drawnG);
  CUTS.forEach((pts, i) => {
    const id = i + 1;
    const g = el(
      "g",
      {
        class: "st",
        "data-id": id,
        tabindex: 0,
        role: "button",
      },
      linesG,
    );
    const d = pathD(pts);
    el("path", { d, class: "halo" }, g);
    el("path", { d, class: "vis" }, g);
    el("path", { d, class: "hit" }, g);
    // number badge, pushed off the line along its normal
    const m = pointAt(pts, 0.5);
    const a = pointAt(pts, 0.42);
    const b = pointAt(pts, 0.58);
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    // alternate sides; stretch 8 flips so it does not crowd the crossing
    const side = (i % 2 ? 1 : -1) * (id === 8 ? -1 : 1);
    const bx = m[0] + nx * 26 * side;
    const by = m[1] + ny * 26 * side;
    const bg = el(
      "g",
      {
        class: "badge",
        transform: `translate(${bx.toFixed(1)} ${by.toFixed(1)})`,
      },
      g,
    );
    el("circle", { r: 13 }, bg);
    el("text", {}, bg).textContent = String(id);
    const mk = el("g", { class: "mk" }, bg);
    el("circle", { r: 8, class: "mark-bg" }, mk);
    el("text", { class: "mark" }, mk);
    stretchEls.push(g);
  });

  dotsG = el("g", {}, drawnG);

  // start and end markers
  const ends = [
    [WALK.pts[0], "Start", -14, 34],
    [WALK.pts[WALK.pts.length - 1], "End", 16, 6],
  ];
  for (const [p, label, dx, dy] of ends) {
    const g = el("g", { class: "endpoint" }, drawnG);
    el("circle", { cx: p[0], cy: p[1], r: 8 }, g);
    el("text", { x: p[0] + dx, y: p[1] + dy }, g).textContent = label;
  }

  // fit the drawing to the walk, with room for labels and the legend
  const xs = WALK.pts.map((p) => p[0]);
  const ys = WALK.pts.map((p) => p[1]);
  const box = {
    x0: Math.min(...xs) - 60,
    y0: Math.min(...ys) - 50,
    x1: Math.max(...xs) + 70,
    y1: Math.max(...ys) + 95,
  };
  svg.setAttribute(
    "viewBox",
    `${box.x0} ${box.y0} ${box.x1 - box.x0} ${box.y1 - box.y0}`,
  );

  // scale bar: 30 m
  const sl = 30 / WALK.mPerUnit;
  const sx = box.x1 - 20;
  const sy = box.y1 - 22;
  const sg = el("g", { class: "scale" }, drawnG);
  el("line", { x1: sx - sl, y1: sy, x2: sx, y2: sy }, sg);
  el("line", { x1: sx - sl, y1: sy - 7, x2: sx - sl, y2: sy + 7 }, sg);
  el("line", { x1: sx, y1: sy - 7, x2: sx, y2: sy + 7 }, sg);
  el("text", { x: sx - sl, y: sy - 12 }, sg).textContent = "30 m";

  walkerG = el("g", { class: "walker-g" }, drawnG);
  el("circle", { r: 9, class: "walker-ring" }, walkerG);
  el("circle", { r: 7, class: "walker" }, walkerG);
  el("text", { x: 14, y: -12, class: "walker-label" }, walkerG).textContent =
    "stopped here";

  for (const g of stretchEls) {
    const id = Number(g.dataset.id);
    g.addEventListener("mouseenter", () => setHover(id));
    g.addEventListener("mouseleave", () => clearHoverSoon());
    g.addEventListener("click", () => pin(id));
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pin(id);
      }
    });
    g.addEventListener("focus", () => setHover(id));
    g.addEventListener("blur", () => clearHoverSoon());
  }
  svg.addEventListener("click", (e) => {
    if (!e.target.closest(".st")) unpin();
  });
}

function drawFrameDots(id) {
  dotsG.replaceChildren();
  if (id == null || S.phase === "start" || S.phase === "reading") return;
  const d = SCRIPT[id - 1];
  const pts = CUTS[id - 1];
  const r = rng(id * 31);
  const skippedAt = new Set();
  while (skippedAt.size < d.skipped) skippedAt.add(Math.floor(r() * d.frames));
  // draw at most ~60 dots so a dense stretch stays readable; keep the ratio
  const step = Math.max(1, Math.round(d.frames / 60));
  for (let f = 0; f < d.frames; f += step) {
    const p = pointAt(pts, (f + 0.5) / d.frames);
    const skipped = [...skippedAt].some((k) => k >= f && k < f + step);
    el(
      "circle",
      {
        cx: p[0],
        cy: p[1],
        r: skipped ? 3.6 : 2.3,
        class: skipped ? "frame-dot skipped" : "frame-dot",
      },
      dotsG,
    );
  }
}

// ---------------------------------------------------------------- selection
let hoverTimer = 0;

function setHover(id) {
  clearTimeout(hoverTimer);
  if (S.hover === id) return;
  S.hover = id;
  renderAll();
}

function clearHoverSoon() {
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    S.hover = null;
    renderAll();
  }, 350);
}

function pin(id) {
  S.pinned = id;
  S.hover = null;
  renderAll();
}

function unpin() {
  S.pinned = null;
  S.hover = null;
  renderAll();
}

function shownId() {
  if (S.hover != null) return S.hover;
  if (S.pinned != null) return S.pinned;
  if (S.phase === "running") return S.current;
  return null;
}

// ---------------------------------------------------------------- rendering
const head = $("#head");
const panel = $("#panel");
const overlay = $("#map-overlay");
const mainEl = $("#main");
const hint = $("#map-hint");
const legend = $("#legend");
const phoneCard = $("#phone-card");

let headKey = "";
let panelKey = "";
let overlayKey = "";

function census() {
  const d = SCRIPT.reduce(
    (a, x) => ({ frames: a.frames + x.frames, skipped: a.skipped + x.skipped }),
    { frames: 0, skipped: 0 },
  );
  return {
    frames: d.frames,
    skipped: d.skipped,
    spacing: (WALK_M / d.frames).toFixed(1),
    revisits: REVISITS.length,
    estimate: totalPlanned(),
  };
}

function renderHead() {
  if (S.phase === "start" || S.phase === "reading" || S.phase === "refused") {
    const key = `${S.phase}|${S.refusal}`;
    if (key === headKey) return;
    headKey = key;
    head.innerHTML = `<div class="head-row"><span class="brand">Make a splat</span>
      <span class="local-pill">Your recording stays on this computer</span></div>`;
    return;
  }
  const c = census();
  const key = [
    S.phase,
    S.current,
    S.gpuSlow,
    S.saved,
    S.stretches.map(statusOf).join(","),
    shownId(),
  ].join("|");
  if (key !== headKey) {
    headKey = key;
    let actions = "";
    if (S.phase === "census")
      actions = `<button class="btn btn-primary" data-act="start">Start training</button>`;
    else if (S.phase === "running")
      actions = `<button class="btn" data-act="cancel">Cancel</button>`;
    else if (S.phase === "cancelled")
      actions = `<button class="btn btn-primary" data-act="resume">Resume</button>`;
    else if (S.phase === "done")
      actions = `<button class="btn btn-primary" data-act="save">${S.saved ? "Save again" : "Save package"}</button>`;
    const strip = S.stretches
      .map((s) => {
        const st = statusOf(s);
        return `<button type="button" data-pin="${s.id}" data-status="${st}" aria-current="${shownId() === s.id}" aria-label="Stretch ${s.id}: ${VERDICT_WORD[st]}" title="Stretch ${s.id}: ${VERDICT_WORD[st]}"></button>`;
      })
      .join("");
    head.innerHTML = `
      <div class="head-row">
        <span class="brand">Make a splat</span>
        <span class="file-chip">recording.zip</span>
        <div class="progress">
          <div class="strip" role="group" aria-label="Stretches along the walk">${strip}</div>
          <div class="status-text" data-live="status"></div>
        </div>
        <div class="actions">${actions}</div>
      </div>
      <div class="census" aria-label="About this recording">
        <span class="c"><b>${fmtInt(c.frames)}</b> frames</span>
        <span class="c"><b>${WALK_M} m</b> walked</span>
        <span class="c">a frame every <b>${c.spacing} m</b></span>
        <span class="c">depth: <b>yes</b></span>
        <span class="c"><b>${c.skipped}</b> frames skipped (blurry)</span>
        <span class="c"><b>${c.revisits}</b> ${c.revisits === 1 ? "place" : "places"} passed twice</span>
        <span class="c${S.gpuSlow ? " warn" : ""}">about <b>${fmtDur(c.estimate)}</b> on this computer${S.gpuSlow ? " (slow graphics)" : ""}</span>
        <span class="local-pill">Nothing leaves this computer</span>
      </div>`;
  }
  const st = head.querySelector('[data-live="status"]');
  if (!st) return;
  const cn2 = counts();
  if (S.phase === "census")
    st.innerHTML = `${COUNT} stretches of about 30 m<small>ready to train</small>`;
  else if (S.phase === "running") {
    const pos = S.current;
    const again = S.stretches[pos - 1].attempt > 0;
    st.innerHTML = `<span class="spinner" aria-hidden="true"></span>${again ? "Training again" : "Training"}: stretch ${pos} of ${COUNT}<small>about ${fmtLeft(timeLeft())} left - ${cn2.finished} finished</small>`;
  } else if (S.phase === "cancelled")
    st.innerHTML = `Stopped<small>${cn2.finished} of ${COUNT} finished, kept</small>`;
  else if (S.phase === "done")
    st.innerHTML = `Finished<small>${cn2.good} good, ${cn2.weak} weak, ${cn2.bad} not good enough${cn2.discarded ? `, ${cn2.discarded} left out` : ""}</small>`;
}

function renderMap() {
  const showWalk = !["start"].includes(S.phase) && S.refusal !== "no-webgpu";
  drawnG.style.display = showWalk ? "" : "none";
  ghostPath.style.display = S.phase === "start" ? "" : "none";
  legend.hidden = !["census", "running", "cancelled", "done"].includes(S.phase);

  if (S.phase === "reading") {
    // the walk draws itself as the zip is read
    const n = Math.max(2, Math.round(S.readFrac * WALK.pts.length));
    ghostPath.style.display = "";
    stretchEls.forEach((g, i) => {
      const from = Math.round((i / COUNT) * (WALK.pts.length - 1));
      g.style.display = from < n ? "" : "none";
      g.dataset.status = "waiting";
      g.querySelector(".badge").style.display = "none";
    });
  } else {
    stretchEls.forEach((g) => {
      g.style.display = "";
      g.querySelector(".badge").style.display = "";
    });
  }
  walkerG.style.display = "none";
  if (S.phase === "reading" || S.phase === "start") return;

  const shown = shownId();
  S.stretches.forEach((s, i) => {
    const g = stretchEls[i];
    const st = statusOf(s);
    g.dataset.status = st;
    g.classList.toggle("is-selected", shown === s.id);
    g.setAttribute("aria-label", `Stretch ${s.id}, ${VERDICT_WORD[st]}`);
    const mk = g.querySelector(".mk");
    const mark = VERDICT_MARK[st];
    mk.style.display = mark ? "" : "none";
    if (mark) {
      mk.querySelector(".mark-bg").setAttribute("class", `mark-bg ${st}`);
      mk.querySelector(".mark").textContent =
        s.marked && st === "bad" ? "!" : mark;
    }
  });
  walkerG.classList.toggle("is-stopped", S.phase === "cancelled");
  if (S.phase === "cancelled" && S.stoppedAt) {
    const p = pointAt(CUTS[S.stoppedAt.id - 1], S.stoppedAt.frac);
    walkerG.style.display = "";
    walkerG.setAttribute(
      "transform",
      `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`,
    );
  }
  if (S.phase === "running" && S.current != null) {
    const s = S.stretches[S.current - 1];
    const p = pointAt(CUTS[S.current - 1], s.elapsed / s.planned);
    walkerG.style.display = "";
    walkerG.setAttribute(
      "transform",
      `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`,
    );
  }
  if (dotsG.dataset.for !== String(shown)) {
    dotsG.dataset.for = String(shown);
    drawFrameDots(shown);
  }
}

function renderOverlay() {
  let key = `${S.phase}|${S.refusal}|${S.gpuSlow && !S.gpuAck}`;
  if (S.phase === "reading") key += `|r`;
  if (key !== overlayKey) {
    overlayKey = key;
    overlay.classList.remove("dim");
    if (S.phase === "start") {
      overlay.innerHTML = `
        <div class="card drop">
          <h2>Drop your recording zip here</h2>
          <p>This page turns a walk you recorded with the recorder app into a 3D splat of the place, for the tour editor.</p>
          <button class="btn btn-primary btn-big" data-act="choose">Choose a recording</button>
          <p class="fine">The file is read here, in this tab. Nothing is uploaded.</p>
        </div>`;
    } else if (S.phase === "reading") {
      overlay.innerHTML = `
        <div class="card" style="align-self:end; margin-bottom: 60px">
          <h2>Reading the recording</h2>
          <div class="reading-bar"><i data-live="read" style="width:0%"></i></div>
          <p class="fine" data-live="readtext"></p>
        </div>`;
    } else if (S.phase === "refused") {
      overlay.classList.add("dim");
      overlay.innerHTML = refusalCard(S.refusal);
    } else overlay.innerHTML = "";
  }
  if (S.phase === "reading") {
    const bar = overlay.querySelector('[data-live="read"]');
    const tx = overlay.querySelector('[data-live="readtext"]');
    if (bar) bar.style.width = `${Math.round(S.readFrac * 100)}%`;
    if (tx)
      tx.textContent = `${fmtInt(Math.round(S.readFrac * 1240))} frames read. The walk draws itself as it is read.`;
  }
}

function refusalCard(kind) {
  if (kind === "no-webgpu")
    return `<div class="card refuse">
      <h2>This browser cannot train a splat</h2>
      <p>Training needs your graphics card, and this browser does not give the page access to it.</p>
      <ul>
        <li>Use a current Chrome or Edge on a desktop or laptop computer.</li>
        <li>If you already do: in the browser settings, under System, turn on "Use graphics acceleration when available", then restart the browser.</li>
      </ul>
      <p class="fine">Nothing was read from your recording.</p>
      <button class="btn" data-act="restart">Try again</button>
    </div>`;
  if (kind === "broken")
    return `<div class="card refuse">
      <h2>This recording cannot be read</h2>
      <p>It was made by an older version of the recorder app, or the file is incomplete (for example, the copy stopped early).</p>
      <ul>
        <li>Copy the zip from the phone again and try that copy.</li>
        <li>If it still fails, record the place again with the current recorder app.</li>
      </ul>
      <button class="btn btn-primary" data-act="restart">Choose another recording</button>
    </div>`;
  if (kind === "no-depth")
    return `<div class="card refuse">
      <h2>This recording has no depth data</h2>
      <p>A splat needs to know how far away each part of each photo is. The phone saves this as depth while it records, and this recording has none.</p>
      <ul>
        <li>Record the place again with a phone that records depth in the recorder app.</li>
      </ul>
      <button class="btn btn-primary" data-act="restart">Choose another recording</button>
    </div>`;
  return "";
}

// ------------------------------------------------ panel
function renderPanel() {
  const noPanel =
    S.phase === "refused" || S.phase === "start" || S.phase === "reading";
  mainEl.classList.toggle("no-panel", noPanel);
  if (noPanel) {
    panelKey = "";
    hint.textContent = "";
    return;
  }
  const id = shownId();
  const s = id != null ? S.stretches[id - 1] : null;
  const key = [
    S.phase,
    id,
    S.pinned,
    S.hover,
    s && statusOf(s),
    s && s.attempt,
    s && s.marked,
    S.gpuSlow,
    S.gpuAck,
    S.saved,
    counts().finished,
  ].join("|");
  if (key !== panelKey) {
    panelKey = key;
    panel.innerHTML = s ? stretchPanel(s) : overviewPanel();
    const cv = panel.querySelector("canvas");
    if (cv) cv.dataset.snap = "";
  }
  if (S.phase === "census")
    hint.textContent = "Point at a stretch of the walk to see where it is.";
  else if (S.phase === "running" && S.pinned == null)
    hint.textContent =
      "The panel follows the stretch that is training. Click any stretch to look at it.";
  else if (S.phase === "done")
    hint.textContent =
      "Click a stretch to see it and decide what to do with it.";
  else hint.textContent = "";
  if (s && S.phase !== "census") {
    hint.textContent +=
      " Dots: one per photo of this stretch. Red rings: photos skipped as blurry.";
  }
  if (s) updateStretchLive(s);
}

function overviewPanel() {
  if (S.phase === "census") {
    const c = census();
    const warn =
      S.gpuSlow && !S.gpuAck
        ? `<div class="notice weak">
            <strong>This computer is using its built-in graphics.</strong>
            <p>Training will take about ${fmtDur(c.estimate)} instead of about ${fmtDur(c.estimate / 3)}. If the computer has a second, faster graphics card:</p>
            <p>Windows Settings &gt; System &gt; Display &gt; Graphics. Pick your browser, choose "High performance", then restart the browser.</p>
            <button class="btn" data-act="gpu-ack">Continue with the built-in graphics</button>
          </div>`
        : "";
    return `
      <div class="panel-top"><h2>Ready to train</h2></div>
      ${warn}
      <p>The walk is cut into <strong>${COUNT} stretches</strong> of about 30 m. Each one trains in turn on your graphics card and colours in on the drawing when it is done.</p>
      <ul class="steps">
        <li>It takes <strong>about ${fmtDur(c.estimate)}</strong> on this computer.</li>
        <li>You can leave it running, or cancel at any time. Finished stretches are kept, and you can resume later.</li>
        <li>Nothing leaves this computer. At the end you save one file.</li>
      </ul>
      <button class="btn btn-primary btn-big" data-act="start">Start training</button>`;
  }
  if (S.phase === "cancelled") {
    const cn = counts();
    const st = S.stoppedAt;
    return `
      <div class="panel-top"><h2>Training stopped</h2></div>
      <div class="notice good"><strong>${cn.finished} finished ${cn.finished === 1 ? "stretch is" : "stretches are"} kept.</strong>
      ${st ? `<p>Stretch ${st.id} was ${Math.round(st.frac * 100)} % done. It starts again from the beginning when you resume.</p>` : ""}</div>
      <p>About ${fmtDur(timeLeft())} of training is left.</p>
      <button class="btn btn-primary btn-big" data-act="resume">Resume</button>
      <p class="where">You can also close this page. The finished stretches stay in this browser, and opening the same recording again offers to resume.</p>`;
  }
  if (S.phase === "done") {
    const cn = counts();
    const problems = S.stretches.filter((s) =>
      ["weak", "bad"].includes(statusOf(s)),
    );
    const list = problems
      .map((s) => {
        const st = statusOf(s);
        const r = s.result.reasons[0];
        const [m0] = metresOf(s.id);
        return `<li><button data-pin="${s.id}"><span><strong>Stretch ${s.id}</strong> <small class="where">at ${m0} m</small><br><small class="where">${r ? REASONS[r].split(":")[0].replace(/[.]$/, "") : ""}</small></span><span class="pill ${st}">${VERDICT_MARK[st]} ${VERDICT_WORD[st]}</span></button></li>`;
      })
      .join("");
    return `
      <div class="panel-top"><h2>Training finished</h2></div>
      <div class="counts">
        <div class="good"><b>${cn.good}</b><span>good</span></div>
        <div class="weak"><b>${cn.weak}</b><span>weak</span></div>
        <div class="bad"><b>${cn.bad}</b><span>not good enough</span></div>
      </div>
      ${problems.length ? `<h3>Needs a look</h3><ul class="problem-list">${list}</ul>` : `<p>Every stretch is good.</p>`}
      ${cn.discarded ? `<p class="where">${cn.discarded} left out of the package.</p>` : ""}
      <button class="btn btn-primary btn-big" data-act="save">${S.saved ? "Save again" : "Save package"}</button>
      ${S.saved ? `<p class="where">Saved as splat-package.zip.</p>` : ""}`;
  }
  return "";
}

function stretchPanel(s) {
  const st = statusOf(s);
  const [a, b] = metresOf(s.id);
  const d = SCRIPT[s.id - 1];
  let mode = "";
  if (S.hover === s.id && S.pinned !== s.id) mode = "Click to keep this open";
  else if (S.pinned === s.id)
    mode = `<button class="btn-link" data-act="unpin">${S.phase === "running" ? "Back to the live stretch" : "Back to the overview"}</button>`;
  else if (S.phase === "running") mode = "Live";
  const tag = ["weak", "bad"].includes(st)
    ? `<span class="pill tag ${st}">${VERDICT_MARK[st]} ${VERDICT_WORD[st]}</span>`
    : "";
  let body;
  if (st === "training") {
    body = `
      <div class="bar"><i data-live="bar" style="width:0%"></i></div>
      <p data-live="left"></p>
      <p class="where">The preview gets sharper as it trains. <span data-live="next"></span></p>
      ${S.queue.length ? `<p>Up next: stretch ${S.queue[0]}.</p>` : ""}
      <div class="notice">You can leave this running and use the computer for other things; keep this tab open. <strong>Cancel</strong> at any time: finished stretches are kept.</div>`;
  } else if (st === "waiting") {
    const t = startsIn(s.id);
    body = `<p>${s.attempt > 0 ? `Waiting to train again, with twice the time.${s.prev ? ` Before: ${VERDICT_WORD[s.prev].toLowerCase()}.` : ""}` : "Waiting to train."}
      ${t != null && S.phase === "running" ? ` Starts in about ${fmtDur(t)}.` : ""}${S.phase === "census" ? ` ${d.frames} frames.` : ""}</p>`;
  } else {
    const r = s.result;
    const reasons = r.reasons.map((k) => `<li>${REASONS[k]}</li>`).join("");
    let acts;
    if (s.discarded) {
      acts = `<div class="notice">Left out. This stretch will not be in the package.</div>
        <div class="stack"><button class="btn" data-act="undiscard" data-id="${s.id}">Put it back</button></div>`;
    } else if (r.verdict === "bad") {
      acts = `${s.marked ? `<div class="notice bad">Kept, marked as not good enough. The editor shows it with a mark.</div>` : ""}
        <div class="stack">
          <button class="btn btn-primary" data-act="retrain" data-id="${s.id}">Train again with more time<small>about ${fmtDur(d.min * 60 * 2 * gpuFactor())}</small></button>
          ${s.marked ? "" : `<button class="btn" data-act="mark" data-id="${s.id}">Save anyway, marked<small>it stays in the package with a "not good enough" mark</small></button>`}
          <button class="btn" data-act="discard" data-id="${s.id}">Discard<small>leave this stretch out of the package</small></button>
        </div>`;
    } else if (r.verdict === "weak") {
      acts = `<div class="stack">
          <button class="btn" data-act="retrain" data-id="${s.id}">Train again with more time<small>about ${fmtDur(d.min * 60 * 2 * gpuFactor())}</small></button>
          <button class="btn" data-act="discard" data-id="${s.id}">Discard<small>leave this stretch out of the package</small></button>
        </div>
        <p class="where">Weak stretches are saved, marked as weak.</p>`;
    } else {
      acts = `<div class="stack"><button class="btn" data-act="discard" data-id="${s.id}">Leave out of the package</button></div>`;
    }
    body = `
      <p class="sentence">${SENTENCE[r.verdict]}</p>
      ${reasons ? `<h3>Why</h3><ul class="reasons">${reasons}</ul>` : ""}
      ${acts}
      <details class="nums"><summary>Numbers</summary>
        <dl class="numbers">
          <dt>Frames</dt><dd>${d.frames} (${d.skipped} skipped)</dd>
          <dt>Length</dt><dd>${b - a} m</dd>
          <dt>Trained for</dt><dd>${fmtDur(r.trainedSec)}</dd>
          <dt>Points</dt><dd>${fmtInt(r.points)}</dd>
          <dt>Sharpness at the photos</dt><dd>${r.atCam.toFixed(1)} dB</dd>
          <dt>Sharpness between photos</dt><dd>${r.between.toFixed(1)} dB</dd>
        </dl>
      </details>`;
  }
  const previewWanted = st !== "waiting";
  return `
    <div class="panel-top">
      <h2>Stretch ${s.id} <span class="pill ${st}">${VERDICT_MARK[st] ? `${VERDICT_MARK[st]} ` : ""}${VERDICT_WORD[st]}</span></h2>
    </div>
    <div class="panel-top"><span class="where">From ${a} m to ${b} m along the walk${s.attempt ? ` - try ${s.attempt + 1}` : ""}</span><span class="panel-mode">${mode}</span></div>
    ${
      previewWanted
        ? `<div class="preview ${st}"><canvas width="${W}" height="${H}" aria-label="Preview render of stretch ${s.id}"></canvas>${tag}<span class="cap" data-live="cap"></span><div class="empty" data-live="empty" hidden>The first preview arrives in a few seconds.</div></div>`
        : ""
    }
    ${body}`;
}

function updateStretchLive(s) {
  const st = statusOf(s);
  const cv = panel.querySelector("canvas");
  const cap = panel.querySelector('[data-live="cap"]');
  const empty = panel.querySelector('[data-live="empty"]');
  if (st === "training") {
    const { sharp, snap } = liveSharp(s);
    const f = s.elapsed / s.planned;
    const bar = panel.querySelector('[data-live="bar"]');
    if (bar) bar.style.width = `${(f * 100).toFixed(1)}%`;
    const left = panel.querySelector('[data-live="left"]');
    if (left)
      left.textContent = `${Math.floor(f * 100)} % - about ${fmtLeft(s.planned - s.elapsed)} left in this stretch`;
    const next = panel.querySelector('[data-live="next"]');
    if (next)
      next.textContent = `Next preview in ${Math.ceil(PREVIEW_EVERY - (s.elapsed - snap))} s.`;
    if (empty) empty.hidden = snap > 0;
    if (cap)
      cap.textContent =
        snap > 0 ? `preview from ${Math.round(s.elapsed - snap)} s ago` : "";
    if (cv && cv.dataset.snap !== String(snap)) {
      cv.dataset.snap = String(snap);
      if (snap > 0) drawPreview(cv, s.id, sharp, false);
      else cv.getContext("2d").clearRect(0, 0, W, H);
    }
  } else if (cv && cv.dataset.snap !== "final") {
    cv.dataset.snap = "final";
    const v = s.result.verdict;
    drawPreview(cv, s.id, FINAL_SHARP[v], v === "bad");
    if (cap) cap.textContent = "final preview";
  }
}

function renderAll() {
  // keep labels readable when the drawing is shown small
  const vb = svg.viewBox.baseVal;
  if (vb && svg.clientWidth && svg.clientHeight) {
    const k = Math.max(
      vb.width / svg.clientWidth,
      vb.height / svg.clientHeight,
    );
    svg.style.setProperty("--k", Math.min(1.6, Math.max(1, k)).toFixed(2));
  }
  const phone = S.refusal === "phone" || (narrow.matches && !forceDesktop);
  document.body.classList.toggle("is-phone", phone);
  phoneCard.hidden = !phone;
  if (phone) return;
  renderHead();
  renderMap();
  renderOverlay();
  renderPanel();
}

// ---------------------------------------------------------------- actions
let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4200);
}

function openCancel() {
  const cn = counts();
  const s = S.stretches[S.current - 1];
  $("#dlg-cancel-text").textContent =
    `${cn.finished} finished ${cn.finished === 1 ? "stretch is" : "stretches are"} kept. Stretch ${s.id} is ${Math.floor((s.elapsed / s.planned) * 100)} % done and will start again from its beginning when you resume.`;
  $("#dlg-cancel").showModal();
}

function openSave() {
  const cn = counts();
  const bad = S.stretches.filter((s) => statusOf(s) === "bad");
  const marked = bad.filter((s) => s.marked).length;
  const out = bad.length - marked;
  const items = [
    `${cn.good} good ${cn.good === 1 ? "stretch" : "stretches"}`,
    cn.weak ? `${cn.weak} weak, marked as weak` : "",
    marked ? `${marked} not good enough, marked` : "",
    out
      ? `${out} not good enough, left out (choose "Save anyway, marked" on it to include it)`
      : "",
    cn.discarded ? `${cn.discarded} left out by you` : "",
    `about ${Math.round(18 + cn.good * 6.5 + cn.weak * 6 + marked * 5)} MB`,
  ].filter(Boolean);
  $("#dlg-save-list").innerHTML = items.map((x) => `<li>${x}</li>`).join("");
  $("#dlg-save").showModal();
}

document.addEventListener("click", (e) => {
  const pinBtn = e.target.closest("[data-pin]");
  if (pinBtn) {
    pin(Number(pinBtn.dataset.pin));
    return;
  }
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const id = Number(b.dataset.id);
  switch (b.dataset.act) {
    case "choose":
      startReading(nextFileKind);
      break;
    case "start":
      startTraining();
      S.pinned = null;
      break;
    case "cancel":
      openCancel();
      break;
    case "resume":
      resumeTraining();
      toast("Resumed. Finished stretches are not trained again.");
      break;
    case "save":
      openSave();
      break;
    case "retrain":
      retrain(id);
      toast(`Stretch ${id} will train again with twice the time.`);
      break;
    case "mark":
      S.stretches[id - 1].marked = true;
      break;
    case "discard":
      S.stretches[id - 1].discarded = true;
      break;
    case "undiscard":
      S.stretches[id - 1].discarded = false;
      break;
    case "unpin":
      unpin();
      break;
    case "gpu-ack":
      S.gpuAck = true;
      break;
    case "restart":
      S = fresh();
      break;
  }
  headKey = panelKey = overlayKey = "";
  renderAll();
});

panel.addEventListener("mouseenter", () => clearTimeout(hoverTimer));
panel.addEventListener("mouseleave", () => {
  if (S.hover != null) clearHoverSoon();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.querySelector("dialog[open]")) unpin();
});

$("#dlg-cancel").addEventListener("close", () => {
  if ($("#dlg-cancel").returnValue === "stop" && S.phase === "running") {
    cancelTraining();
    S.pinned = null;
    toast("Training stopped. Finished stretches are kept.");
    headKey = panelKey = "";
    renderAll();
  }
});

$("#dlg-save").addEventListener("close", () => {
  if ($("#dlg-save").returnValue === "save") {
    S.saved = true;
    toast(
      "Saved splat-package.zip to your Downloads folder. (Prototype: no file is written.)",
    );
    headKey = panelKey = "";
    renderAll();
  }
});

$("#copy-link").addEventListener("click", () => {
  navigator.clipboard?.writeText(location.href).catch(() => {});
  toast("Link copied. Open it on your computer.");
});

// ---------------------------------------------------------------- prototype controls
const narrow = matchMedia("(max-width: 700px)");
let forceDesktop = false;
let nextFileKind = "ok";
let gpuSlowNext = false;

function stretchEnd(id) {
  return SCRIPT.slice(0, id).reduce((a, d) => a + d.min * 60, 0);
}

function jump(name) {
  S = fresh();
  nextFileKind = "ok";
  gpuSlowNext = false;
  forceDesktop = false;
  const census = () => {
    startReading("ok");
    advance(READ_SEC + 1);
  };
  switch (name) {
    case "start":
      break;
    case "census":
      census();
      break;
    case "training":
      census();
      startTraining();
      advance(stretchEnd(4) + 0.45 * SCRIPT[4].min * 60);
      break;
    case "not-good-enough":
      census();
      startTraining();
      advance(stretchEnd(7) + 20);
      S.pinned = 7;
      break;
    case "cancelled":
      census();
      startTraining();
      advance(stretchEnd(5) + 0.5 * SCRIPT[5].min * 60);
      cancelTraining();
      break;
    case "resumed":
      census();
      startTraining();
      advance(stretchEnd(5) + 0.5 * SCRIPT[5].min * 60);
      cancelTraining();
      resumeTraining();
      advance(40);
      break;
    case "done":
      census();
      startTraining();
      advance(1e6);
      break;
    case "refusal-phone":
      refuse("phone");
      break;
    case "refusal-no-webgpu":
      refuse("no-webgpu");
      forceDesktop = true;
      break;
    case "refusal-integrated-gpu":
      gpuSlowNext = true;
      census();
      break;
    case "refusal-broken":
      nextFileKind = "broken";
      startReading("broken");
      break;
    case "refusal-no-depth":
      nextFileKind = "no-depth";
      startReading("no-depth");
      break;
  }
  if (name !== "refusal-phone") forceDesktop = true;
  headKey = panelKey = overlayKey = "";
  dotsG.dataset.for = "";
  renderAll();
}

function applyTheme(v) {
  if (v === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = v;
}

$("#proto-state").addEventListener("change", (e) => jump(e.target.value));
$("#proto-speed").addEventListener(
  "change",
  (e) => (speed = Number(e.target.value)),
);
$("#proto-theme").addEventListener("change", (e) => applyTheme(e.target.value));
$("#proto-play").addEventListener("click", (e) => {
  playing = !playing;
  e.currentTarget.textContent = playing ? "Pause" : "Play";
  e.currentTarget.setAttribute("aria-pressed", String(!playing));
});
narrow.addEventListener("change", () => renderAll());

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (playing) {
    const before = `${S.phase}|${S.current}`;
    advance(dt * speed);
    if (`${S.phase}|${S.current}` !== before)
      headKey = panelKey = overlayKey = "";
  }
  renderAll();
  requestAnimationFrame(frame);
}

buildSvg();
{
  const art = document.querySelector(".phone-art");
  const xs = WALK.pts.map((p) => p[0]);
  const ys = WALK.pts.map((p) => p[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const k = Math.min(84 / (Math.max(...xs) - x0), 48 / (Math.max(...ys) - y0));
  const d = WALK.pts
    .filter((_, i) => i % 6 === 0)
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${(18 + (p[0] - x0) * k).toFixed(1)} ${(15 + (p[1] - y0) * k).toFixed(1)}`,
    )
    .join("");
  el("path", { d, class: "art-walk" }, art);
}
const q = new URLSearchParams(location.search);
if (q.get("theme")) {
  applyTheme(q.get("theme"));
  $("#proto-theme").value = q.get("theme");
}
if (q.get("speed")) {
  speed = Number(q.get("speed")) || 60;
  $("#proto-speed").value = String(speed);
}
if (q.get("pause") === "1") {
  playing = false;
  $("#proto-play").textContent = "Play";
}
const initial = q.get("state") || "start";
$("#proto-state").value = initial;
jump(initial);
if (initial === "start") forceDesktop = false;
requestAnimationFrame(frame);
