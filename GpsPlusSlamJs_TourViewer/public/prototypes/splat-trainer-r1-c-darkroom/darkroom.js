// Splat trainer prototype C - darkroom. Everything here is a scripted
// simulation: no file is read, no graphics card is used, the previews are
// procedural drawings that sharpen over time.

const WALK_M = 236;
const PREVIEW_EVERY_S = 15;
const MEASURE_S = 20;

/** The fake walk, cut into eight stretches. */
const STRETCHES = [
  { from: 0, to: 30, photos: 48, dur: 300, out: "good" },
  { from: 30, to: 61, photos: 55, dur: 330, out: "good" },
  { from: 61, to: 90, photos: 51, dur: 310, out: "weak-far" },
  { from: 90, to: 121, photos: 60, dur: 350, out: "good" },
  { from: 121, to: 150, photos: 39, dur: 260, out: "poor" },
  { from: 150, to: 181, photos: 57, dur: 340, out: "good" },
  { from: 181, to: 209, photos: 52, dur: 320, out: "good" },
  { from: 209, to: 236, photos: 50, dur: 300, out: "weak-time" },
];

/** What each outcome looks like and says. Numbers are invented. */
const OUTCOMES = {
  good: {
    verdict: "good",
    sharp: 0.97,
    say: "Sharp from every photo.",
    reasons: [],
    db: [29.6, 23.4],
  },
  "weak-far": {
    verdict: "weak",
    sharp: 0.7,
    say: "A little soft between the photos.",
    reasons: ["photos far apart"],
    db: [26.1, 19.8],
  },
  "weak-time": {
    verdict: "weak",
    sharp: 0.74,
    say: "Stopped before it was fully sharp.",
    reasons: ["ran out of time"],
    db: [25.8, 20.3],
  },
  poor: {
    verdict: "poor",
    sharp: 0.3,
    ghost: true,
    say: "Stayed blurry. In the editor it would look smeared.",
    reasons: ["photos far apart", "many blurry photos"],
    db: [22.4, 17.1],
  },
  "poor-again": {
    verdict: "weak",
    sharp: 0.66,
    say: "Better after a second try, still a little soft.",
    reasons: ["photos far apart"],
    db: [25.2, 19.4],
  },
  "weak-again": {
    verdict: "good",
    sharp: 0.95,
    say: "Sharp now, after a second try.",
    reasons: [],
    db: [28.3, 22.6],
  },
};

const VERDICT_WORD = { good: "Good", weak: "Weak", poor: "Not good enough" };

const $ = (id) => document.getElementById(id);

/* ---------- seeded randomness and the procedural "photos" ---------- */

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const PALETTES = [
  { sky: [205, 60, 72], horizon: [30, 70, 84], ground: [95, 22, 42] },
  { sky: [215, 45, 58], horizon: [200, 30, 82], ground: [40, 18, 46] },
  { sky: [28, 70, 66], horizon: [45, 80, 82], ground: [80, 20, 34] },
  { sky: [190, 35, 70], horizon: [180, 20, 88], ground: [120, 18, 38] },
];

const hsl = (h, s, l, a = 1) => `hsl(${h} ${s}% ${l}% / ${a})`;

function drawSky(g, w, h, hy, pal) {
  const sky = g.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, hsl(...pal.sky));
  sky.addColorStop(1, hsl(...pal.horizon));
  g.fillStyle = sky;
  g.fillRect(0, 0, w, hy + 2);
}

function drawHills(g, w, h, hy, r, pal) {
  g.fillStyle = hsl(pal.ground[0] + 20, 15, pal.ground[2] + 18);
  g.beginPath();
  g.moveTo(0, hy);
  const a = r() * 6;
  for (let x = 0; x <= w; x += w / 40) {
    g.lineTo(x, hy - h * (0.05 + 0.04 * Math.sin(x / (w * 0.12) + a)));
  }
  g.lineTo(w, hy);
  g.fill();
}

function drawGround(g, w, h, hy, r, pal) {
  const ground = g.createLinearGradient(0, hy, 0, h);
  ground.addColorStop(0, hsl(pal.ground[0], pal.ground[1], pal.ground[2] + 10));
  ground.addColorStop(1, hsl(pal.ground[0], pal.ground[1], pal.ground[2] - 12));
  g.fillStyle = ground;
  g.fillRect(0, hy, w, h - hy);
  const cx = w * (0.35 + r() * 0.3);
  g.fillStyle = hsl(35, 18, 70, 0.85);
  g.beginPath();
  g.moveTo(cx - w * 0.02, hy);
  g.lineTo(cx + w * 0.02, hy);
  g.lineTo(cx + w * 0.32, h);
  g.lineTo(cx - w * 0.3, h);
  g.fill();
}

function drawBuilding(g, w, h, hy, r) {
  const bw = w * (0.1 + r() * 0.16);
  const bh = h * (0.18 + r() * 0.3);
  const x = r() * (w - bw);
  const y = hy - bh + h * 0.04;
  const hue = 20 + r() * 40;
  const light = 55 + r() * 25;
  g.fillStyle = hsl(hue, 25, light);
  g.fillRect(x, y, bw, bh);
  g.fillStyle = hsl(hue + 340, 35, light - 25);
  g.beginPath();
  g.moveTo(x - bw * 0.05, y);
  g.lineTo(x + bw / 2, y - bh * 0.25);
  g.lineTo(x + bw * 1.05, y);
  g.fill();
  g.fillStyle = hsl(210, 25, 25, 0.8);
  const cols = 3;
  const rows = 3;
  for (let i = 0; i < cols * rows; i++) {
    const wx = x + bw * (0.15 + (i % cols) * 0.27);
    const wy = y + bh * (0.15 + Math.floor(i / cols) * 0.25);
    g.fillRect(wx, wy, bw * 0.14, bh * 0.12);
  }
}

function drawTree(g, w, h, hy, r) {
  const x = r() * w;
  const base = hy + r() * h * 0.25;
  const size = h * (0.07 + r() * 0.1);
  g.fillStyle = hsl(30, 30, 25);
  g.fillRect(x - size * 0.08, base - size, size * 0.16, size);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = hsl(90 + r() * 50, 35, 22 + r() * 22);
    g.beginPath();
    g.arc(
      x + (r() - 0.5) * size,
      base - size - r() * size * 0.9,
      size * (0.35 + r() * 0.3),
      0,
      Math.PI * 2,
    );
    g.fill();
  }
}

const sceneCache = new Map();

/** A made-up place for one stretch, at one size; cached with its pixels. */
function scene(seed, w, h) {
  const key = `${seed}:${w}`;
  if (sceneCache.has(key)) {
    return sceneCache.get(key);
  }
  const r = rng(seed * 7919 + 13);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const pal = PALETTES[seed % PALETTES.length];
  const hy = h * (0.4 + r() * 0.14);
  drawSky(g, w, h, hy, pal);
  drawHills(g, w, h, hy, r, pal);
  drawGround(g, w, h, hy, r, pal);
  const buildings = 2 + Math.floor(r() * 3);
  for (let i = 0; i < buildings; i++) {
    drawBuilding(g, w, h, hy, r);
  }
  const trees = 3 + Math.floor(r() * 4);
  for (let i = 0; i < trees; i++) {
    drawTree(g, w, h, hy, r);
  }
  const entry = { canvas: c, pixels: g.getImageData(0, 0, w, h).data };
  sceneCache.set(key, entry);
  return entry;
}

/** Soft blobs over the picture: the "splats" still finding their place. */
function drawBlobs(g, base, w, h, sharp, seed) {
  const r = rng(seed * 104729 + 5);
  const count = 160;
  const k = w / 480;
  const radius = (2 + (1 - sharp) * 26) * k;
  const alpha = 0.06 + 0.55 * (1 - sharp);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h);
    const p = (y * w + x) * 4;
    const [cr, cg, cb] = [
      base.pixels[p],
      base.pixels[p + 1],
      base.pixels[p + 2],
    ];
    const grad = g.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, `rgb(${cr} ${cg} ${cb} / ${alpha})`);
    grad.addColorStop(1, `rgb(${cr} ${cg} ${cb} / 0)`);
    g.fillStyle = grad;
    g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}

function paperColour() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--print-paper")
    .trim();
}

/** Draws one print at a sharpness from 0 (blank paper) to 1 (sharp). */
function drawPrint(canvas, seed, sharp, ghost) {
  const w = canvas.width;
  const h = canvas.height;
  const k = w / 480;
  const base = scene(seed, w, h);
  const g = canvas.getContext("2d");
  g.save();
  g.filter = "none";
  g.globalAlpha = 1;
  g.fillStyle = paperColour();
  g.fillRect(0, 0, w, h);
  const developed = Math.min(1, 0.12 + sharp * 1.5);
  g.globalAlpha = developed;
  g.filter = `blur(${(1 - sharp) * 16 * k}px) saturate(${0.3 + 0.7 * sharp}) contrast(${0.7 + 0.3 * sharp})`;
  g.drawImage(base.canvas, 0, 0, w, h);
  if (ghost) {
    g.globalAlpha = developed * 0.45;
    g.drawImage(base.canvas, 14 * k, -4 * k, w, h);
  }
  g.filter = "none";
  g.globalAlpha = developed;
  drawBlobs(g, base, w, h, sharp, seed);
  g.restore();
}

/* ---------- state ---------- */

const S = {
  phase: "start",
  refusal: null,
  gpuIntegrated: false,
  gpuWarn: false,
  speed: 60,
  paused: false,
  saveFails: false,
  runElapsed: 0,
  current: -1,
  queue: [],
  banner: "",
  saved: false,
  prints: [],
};

function freshPrint(i) {
  return {
    i,
    status: "waiting",
    elapsed: 0,
    progress: 0,
    shown: 0,
    nextPreview: PREVIEW_EVERY_S,
    outcome: STRETCHES[i].out,
    verdict: null,
    decision: null,
    attempt: 1,
    drawnAt: -1,
  };
}

function resetState() {
  Object.assign(S, {
    phase: "start",
    refusal: null,
    gpuIntegrated: false,
    gpuWarn: false,
    runElapsed: 0,
    current: -1,
    queue: [],
    banner: "",
    saved: false,
    prints: STRETCHES.map((_, i) => freshPrint(i)),
  });
}

const durOf = (p) =>
  STRETCHES[p.i].dur * p.attempt * (S.gpuIntegrated ? 6.5 : 1);
const outcomeOf = (p) => OUTCOMES[p.outcome];

/** Sharpness the preview reaches at a progress, ending at the outcome's. */
function sharpAt(p, progress) {
  const end = outcomeOf(p).sharp;
  return (end * (1 - Math.exp(-3 * progress))) / (1 - Math.exp(-3));
}

function finish(p) {
  const o = outcomeOf(p);
  p.status = "done";
  p.progress = 1;
  p.shown = o.sharp;
  p.verdict = o.verdict;
}

function startNext() {
  S.current = S.queue.length ? S.queue.shift() : -1;
  if (S.current < 0) {
    S.phase = "done";
    S.banner = "";
    return;
  }
  const p = S.prints[S.current];
  p.status = "training";
  p.elapsed = 0;
  p.progress = 0;
  p.shown = 0;
  p.nextPreview = PREVIEW_EVERY_S;
}

function tick(simDt) {
  const p = S.prints[S.current];
  if (!p) {
    return;
  }
  S.runElapsed += simDt;
  p.elapsed += simDt;
  p.progress = Math.min(1, p.elapsed / durOf(p));
  while (p.elapsed >= p.nextPreview) {
    p.shown = sharpAt(p, Math.min(1, p.nextPreview / durOf(p)));
    p.nextPreview += PREVIEW_EVERY_S;
  }
  if (p.progress >= 1) {
    finish(p);
    startNext();
    renderAll();
  }
}

function secondsLeft() {
  const p = S.prints[S.current];
  const rest = S.queue.reduce((sum, i) => sum + durOf(S.prints[i]), 0);
  return rest + (p ? durOf(p) - p.elapsed : 0);
}

/* ---------- actions ---------- */

function startTraining() {
  S.queue = S.prints.filter((p) => p.status !== "done").map((p) => p.i);
  S.phase = "training";
  S.runElapsed = 0;
  S.banner = "";
  startNext();
  renderAll();
}

function stopTraining() {
  const p = S.prints[S.current];
  if (p) {
    p.status = "stopped";
    S.queue.unshift(p.i);
  }
  S.current = -1;
  S.phase = "stopped";
  S.banner = "";
  renderAll();
}

function continueTraining() {
  const kept = S.prints.filter((p) => p.status === "done").length;
  const at = S.queue[0];
  for (const i of S.queue) {
    if (S.prints[i].status === "stopped") {
      S.prints[i].status = "waiting";
      S.prints[i].shown = 0;
    }
  }
  S.phase = "training";
  S.runElapsed = 0;
  startNext();
  S.banner = `Continued at stretch ${at + 1}. The ${kept} finished stretches were kept.`;
  renderAll();
}

function trainAgain(i) {
  const p = S.prints[i];
  p.attempt = 2;
  p.outcome = p.verdict === "poor" ? "poor-again" : "weak-again";
  p.verdict = null;
  p.decision = null;
  p.status = "queued";
  p.shown = 0;
  S.saved = false;
  S.queue.push(i);
  if (S.phase === "done") {
    S.phase = "training";
    S.runElapsed = 0;
    startNext();
    S.banner = `Training stretch ${i + 1} again, with twice the time.`;
  } else if (S.phase === "training") {
    S.banner = `Stretch ${i + 1} trains again, with twice the time, after the others.`;
  }
  closeModal();
  renderAll();
}

function decide(i, decision) {
  S.prints[i].decision = decision;
  S.saved = false;
  renderAll();
  if (!$("veil").hidden) {
    openLoupe(i);
  }
}

/* ---------- rendering: the contact sheet ---------- */

function walkPoint(t) {
  return [
    4 + 46 * t + 3 * Math.sin(t * 9),
    13 + 7 * Math.sin(t * 5.3) + 3 * Math.cos(t * 13),
  ];
}

function walkPath(a, b) {
  const pts = [];
  for (let n = 0; n <= 40; n++) {
    const [x, y] = walkPoint(a + ((b - a) * n) / 40);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

function ringPath(seed) {
  // A hand-drawn loop around the print, a little different on each one.
  const r = rng(seed * 31 + 3);
  const j = () => (r() - 0.5) * 6;
  return `M ${8 + j()} ${14 + j()} C ${40 + j()} ${4 + j()}, ${260 + j()} ${2 + j()}, ${292 + j()} ${12 + j()} C ${300 + j()} ${60 + j()}, ${298 + j()} ${150 + j()}, ${288 + j()} ${190 + j()} C ${220 + j()} ${198 + j()}, ${60 + j()} ${197 + j()}, ${10 + j()} ${188 + j()} C ${3 + j()} ${140 + j()}, ${4 + j()} ${50 + j()}, ${14 + j()} ${8 + j()}`;
}

function buildSheet() {
  const sheet = $("sheet");
  sheet.textContent = "";
  STRETCHES.forEach((st, i) => {
    const el = document.createElement("article");
    el.className = "print";
    el.dataset.i = String(i);
    el.innerHTML = `
      <button type="button" class="print-frame" aria-label="Look closer at stretch ${i + 1}">
        <canvas width="480" height="320"></canvas>
        <span class="print-hatch"></span>
        <svg class="print-ring" viewBox="0 0 300 200" preserveAspectRatio="none" aria-hidden="true"><path d="${ringPath(i + 1)}" /></svg>
        <span class="print-mark"></span>
        <span class="print-reasons"></span>
        <span class="print-progress"><span></span></span>
        <span class="print-live"><span><span class="print-live-dot"></span><span class="live-pct"></span></span><span class="live-next"></span></span>
        <span class="print-empty">Waiting</span>
        <span class="print-stamp"><span></span></span>
      </button>
      <div class="print-cap">
        <div class="print-head">
          <span class="print-no">Stretch ${i + 1}</span>
          <span class="print-where">${st.from}-${st.to} m</span>
          <svg class="print-path" viewBox="0 0 54 26" aria-hidden="true"><title>Where this stretch is on the walk</title>
            <polyline class="walk" points="${walkPath(0, 1)}" />
            <polyline class="here" points="${walkPath(st.from / WALK_M, st.to / WALK_M)}" />
          </svg>
        </div>
        <p class="print-say"></p>
        <div class="print-actions"></div>
      </div>`;
    el.querySelector(".print-frame").addEventListener("click", () => {
      if (S.prints[i].status !== "waiting") {
        openLoupe(i);
      }
    });
    sheet.append(el);
  });
}

function actionsFor(p) {
  if (p.status !== "done") {
    return [];
  }
  if (p.decision) {
    return [["Undo", () => decide(p.i, null)]];
  }
  if (p.verdict === "poor") {
    return [
      ["Train again with more time", () => trainAgain(p.i), "accent"],
      ["Save anyway, marked", () => decide(p.i, "keep"), "quiet"],
      ["Discard", () => decide(p.i, "discard"), "quiet"],
    ];
  }
  if (p.verdict === "weak" && p.attempt === 1) {
    return [["Train again with more time", () => trainAgain(p.i)]];
  }
  return [];
}

function sayFor(p) {
  if (p.status === "stopped") {
    return "Stopped here. This stretch starts over when you continue.";
  }
  if (p.status === "queued") {
    return "Waiting to train again, with twice the time.";
  }
  if (p.status !== "done") {
    return "";
  }
  const say = outcomeOf(p).say;
  if (p.decision === "keep") {
    return `${say} Kept in the file, marked.`;
  }
  if (p.decision === "discard") {
    return "Left out of the file.";
  }
  return say;
}

function stampFor(p) {
  if (p.status === "stopped") {
    return "Stopped - starts over";
  }
  if (p.status === "queued") {
    return "Trains again";
  }
  return p.decision === "discard" ? "Left out" : "";
}

function fillActions(box, list) {
  box.textContent = "";
  for (const [label, fn, tone] of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn btn--small${tone ? ` btn--${tone}` : ""}`;
    b.textContent = label;
    b.addEventListener("click", fn);
    box.append(b);
  }
}

function fillReasons(box, p) {
  box.textContent = "";
  if (p.status !== "done" || p.decision === "discard") {
    return;
  }
  for (const reason of outcomeOf(p).reasons) {
    const s = document.createElement("span");
    s.className = "reason";
    s.textContent = reason;
    box.append(s);
  }
}

function renderPrint(el, p) {
  el.dataset.status = p.status;
  setData(el, "verdict", p.status === "done" ? p.verdict : null);
  setData(el, "decision", p.decision);
  el.querySelector(".print-mark").textContent = p.verdict
    ? VERDICT_WORD[p.verdict] + (p.decision === "keep" ? ", marked" : "")
    : "";
  el.querySelector(".print-say").textContent = sayFor(p);
  el.querySelector(".print-stamp span").textContent = stampFor(p);
  fillReasons(el.querySelector(".print-reasons"), p);
  fillActions(el.querySelector(".print-actions"), actionsFor(p));
  redrawIfNeeded(el, p);
}

function setData(el, key, value) {
  if (value == null) {
    delete el.dataset[key];
  } else {
    el.dataset[key] = value;
  }
}

function redrawIfNeeded(el, p) {
  if (p.drawnAt === p.shown && el.dataset.drawnTheme === themeKey()) {
    return;
  }
  const ghost = Boolean(outcomeOf(p).ghost) && p.status === "done";
  drawPrint(el.querySelector("canvas"), p.i + 1, p.shown, ghost);
  p.drawnAt = p.shown;
  el.dataset.drawnTheme = themeKey();
}

function themeKey() {
  return `${document.documentElement.dataset.theme || ""}${matchMedia("(prefers-color-scheme: light)").matches}`;
}

/** Cheap per-frame update of the training print and the bar. */
function renderLive() {
  const p = S.prints[S.current];
  if (p) {
    const el = $("sheet").children[p.i];
    el.querySelector(".print-progress span").style.width =
      `${(p.progress * 100).toFixed(1)}%`;
    el.querySelector(".live-pct").textContent =
      `Training ${Math.floor(p.progress * 100)} %`;
    const next = Math.max(0, Math.ceil(p.nextPreview - p.elapsed));
    el.querySelector(".live-next").textContent = `new look in ${next} s`;
    redrawIfNeeded(el, p);
  }
  renderBar();
}

/* ---------- rendering: the bar ---------- */

function minutesText(sec) {
  const min = Math.max(1, Math.round(sec / 60));
  if (min >= 90) {
    return `about ${Math.round(min / 60)} hours`;
  }
  return `about ${min} min`;
}

function counts() {
  const c = { good: 0, weak: 0, poor: 0, done: 0 };
  for (const p of S.prints) {
    if (p.status === "done") {
      c.done += 1;
      c[p.verdict] += 1;
    }
  }
  return c;
}

function summaryText() {
  const c = counts();
  const parts = [`${c.good} good`];
  if (c.weak) {
    parts.push(`${c.weak} weak`);
  }
  if (c.poor) {
    parts.push(`${c.poor} not good enough`);
  }
  return parts.join(", ");
}

function inFile() {
  return S.prints.filter(
    (p) =>
      p.status === "done" &&
      p.decision !== "discard" &&
      (p.verdict !== "poor" || p.decision === "keep"),
  );
}

function undecided() {
  return S.prints.filter(
    (p) => p.status === "done" && p.verdict === "poor" && !p.decision,
  );
}

function barTraining() {
  const p = S.prints[S.current];
  const again = p.attempt > 1 ? " again" : "";
  const line = `Training stretch ${p.i + 1}${again} of ${STRETCHES.length}`;
  const left =
    S.runElapsed < MEASURE_S
      ? "Measuring how fast this computer is..."
      : `${minutesText(secondsLeft())} left.`;
  return [
    line,
    `${left} You can leave it running, or stop: finished stretches are kept.`,
  ];
}

function barStopped() {
  const c = counts();
  return [
    `Stopped. ${c.done} of ${STRETCHES.length} stretches are finished and kept on this computer.`,
    `Continue starts at stretch ${S.queue[0] + 1}. If you close this page, choose the same recording again to continue.`,
  ];
}

function barDone() {
  if (S.saved) {
    return [
      `Saved. ${inFile().length} stretches are in the file.`,
      "Open it in the tour editor by dropping it onto the globe.",
    ];
  }
  const open = undecided();
  const sub = open.length
    ? `Stretch ${open.map((p) => p.i + 1).join(", ")} is not good enough: train it again, keep it marked, or discard it. Then save.`
    : `Ready to save: ${inFile().length} stretches go into the file.`;
  return [summaryText(), sub];
}

const BAR_TEXT = {
  training: barTraining,
  stopped: barStopped,
  done: barDone,
};

function renderStrip() {
  const strip = $("strip");
  if (strip.children.length !== STRETCHES.length) {
    strip.textContent = "";
    for (const st of STRETCHES) {
      const seg = document.createElement("div");
      seg.className = "seg";
      seg.style.flex = String(st.to - st.from);
      seg.append(document.createElement("span"));
      strip.append(seg);
    }
  }
  S.prints.forEach((p, i) => {
    const seg = strip.children[i];
    const v =
      p.decision === "discard"
        ? "discard"
        : p.status === "done"
          ? p.verdict
          : null;
    setData(seg, "v", v);
    seg.firstChild.style.width =
      p.status === "training" ? `${p.progress * 100}%` : "0";
  });
}

function renderBar() {
  const fn = BAR_TEXT[S.phase];
  $("bar").hidden = !fn;
  if (!fn) {
    return;
  }
  const [line, sub] = fn();
  setText($("barLine"), line);
  setText($("barSub"), sub);
  renderStrip();
}

function setText(el, text) {
  if (el.textContent !== text) {
    el.textContent = text;
  }
}

function renderBarButtons() {
  const open = S.phase === "done" ? undecided() : [];
  $("showBtn").hidden = !open.length;
  $("showBtn").textContent = open.length ? `Show stretch ${open[0].i + 1}` : "";
  $("cancelBtn").hidden = S.phase !== "training";
  $("resumeBtn").hidden = S.phase !== "stopped";
  const save = $("saveBtn");
  save.hidden = !(S.phase === "done" || S.phase === "stopped");
  save.classList.toggle("btn--accent", S.phase === "done" && !S.saved);
  save.textContent =
    S.phase === "stopped"
      ? "Save the finished ones"
      : S.saved
        ? "Save again"
        : "Save";
}

/* ---------- rendering: phases ---------- */

function renderAll() {
  const phase = S.phase;
  $("drop").hidden = !(phase === "start" || phase === "reading");
  $("census").hidden = phase !== "census";
  $("gpuWarn").hidden = !(phase === "census" && S.gpuWarn);
  $("refusal").hidden = phase !== "refusal";
  const sheetOn = ["census", "training", "stopped", "done"].includes(phase);
  $("sheet").hidden = !sheetOn;
  $("sheet").dataset.dim = String(phase === "census");
  $("banner").hidden = !S.banner;
  $("banner").textContent = S.banner;
  $("fileChip").hidden = !sheetOn;
  $("fileChip").textContent = "walk-recording.zip";
  renderGpuChip(sheetOn);
  $("censusTime").textContent = S.gpuIntegrated ? "5 hours" : "45 minutes";
  $("startBtn").disabled = S.gpuWarn;
  if (phase === "refusal") {
    renderRefusal(S.refusal);
  }
  if (sheetOn) {
    S.prints.forEach((p) => renderPrint($("sheet").children[p.i], p));
  }
  renderBarButtons();
  renderLive();
}

function renderGpuChip(on) {
  const chip = $("gpuChip");
  chip.hidden = !on;
  chip.textContent = S.gpuIntegrated
    ? "Built-in graphics (slow)"
    : "Graphics card ready";
  setData(chip, "tone", S.gpuIntegrated ? "warn" : null);
}

/* ---------- refusals ---------- */

const ART = {
  monitor:
    '<svg viewBox="0 0 120 84"><rect x="20" y="8" width="80" height="52" rx="4"/><path d="M50 72h20M60 60v12"/><path class="cross" d="M48 22l24 24M72 22L48 46"/></svg>',
  phone:
    '<svg viewBox="0 0 120 84"><rect x="6" y="14" width="30" height="56" rx="5"/><path class="cross" d="M12 34l18 18M30 34L12 52"/><path d="M44 42h18m-6-6 6 6-6 6"/><rect x="70" y="18" width="46" height="32" rx="3"/><path d="M86 62h14M93 50v12"/><path class="tick" d="M84 34l6 6 12-12"/></svg>',
  file: '<svg viewBox="0 0 120 84"><path d="M38 6h32l16 16v56H38z"/><path d="M70 6v16h16"/><path class="cross" d="M50 38l20 20M70 38L50 58"/></svg>',
};

const REFUSALS = {
  "no-webgpu": {
    art: "monitor",
    head: "This browser cannot make splats",
    body: [
      "Making a splat uses the graphics card through a feature called WebGPU. This browser does not offer it, or it is switched off.",
      "Open this page in Chrome or Edge on a desktop computer. Your recording stays where it is.",
    ],
    actions: [["Copy this page's link", "copy"]],
  },
  phone: {
    art: "phone",
    head: "Use a desktop computer",
    body: [
      "Making a splat keeps a graphics card busy for 30 to 60 minutes. A phone cannot do that, so this page only works on a desktop computer with Chrome or Edge.",
      "Copy the recording from your phone to the computer, then open this page there.",
    ],
    actions: [["Copy this page's link", "copy"]],
  },
  old: {
    art: "file",
    head: "This recording cannot be used",
    body: [
      "It was made with an older version of the recorder app, or the file is damaged. It has photos, but no camera positions.",
      "Record the place again with the current recorder app.",
    ],
    actions: [["Choose another recording", "again"]],
  },
  "no-depth": {
    art: "file",
    head: "This recording has no depth",
    body: [
      "A splat needs to know how far away things were, and this recording did not save that.",
      "Record the place again on a phone that records depth.",
    ],
    actions: [["Choose another recording", "again"]],
  },
};

function renderRefusal(key) {
  const r = REFUSALS[key];
  $("refusalArt").innerHTML = ART[r.art];
  $("refusalHead").textContent = r.head;
  $("refusalBody").innerHTML = r.body.map((t) => `<p>${t}</p>`).join("");
  const box = $("refusalActions");
  box.textContent = "";
  for (const [label, kind] of r.actions) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn--accent";
    b.textContent = label;
    b.addEventListener("click", () => refusalAction(kind, b));
    box.append(b);
  }
}

function refusalAction(kind, button) {
  if (kind === "again") {
    resetState();
    renderAll();
    return;
  }
  // Fake copy with feedback: the real page would use the clipboard.
  button.dataset.busy = "true";
  setTimeout(() => {
    delete button.dataset.busy;
    button.textContent = "Link copied";
  }, 400);
}

/* ---------- modals: stop, save, loupe ---------- */

function openModal(html, wide = false) {
  const m = $("modal");
  m.innerHTML = html;
  m.dataset.wide = String(wide);
  $("veil").hidden = false;
  const first = m.querySelector("[data-focus]") || m.querySelector("button");
  first?.focus();
}

function closeModal() {
  $("veil").hidden = true;
  $("modal").textContent = "";
}

function openStop() {
  const p = S.prints[S.current];
  const kept = counts().done;
  openModal(`
    <h2 id="modalHead">Stop training?</h2>
    <p class="prose">The ${kept} finished stretches stay on this computer. Stretch ${p.i + 1} is ${Math.floor(p.progress * 100)} % done and starts over when you continue.</p>
    <div class="modal-actions">
      <button type="button" class="btn btn--quiet" data-act="close" data-focus>Keep training</button>
      <button type="button" class="btn" data-act="stop">Stop</button>
    </div>`);
}

const LOCK =
  '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>';

function saveContentsLine() {
  const files = inFile();
  const marks = [];
  const weak = files.filter((p) => p.verdict === "weak").length;
  const poor = files.filter((p) => p.verdict === "poor").length;
  if (weak) {
    marks.push(`${weak} marked weak`);
  }
  if (poor) {
    marks.push(`${poor} marked not good enough`);
  }
  let line = `The file holds ${files.length} stretches`;
  line += marks.length ? `: ${marks.join(", ")}.` : ", all good.";
  const open = undecided();
  if (open.length) {
    line += ` Stretch ${open.map((p) => p.i + 1).join(", ")} is left out unless you choose "Save anyway, marked" on its print.`;
  }
  return line;
}

function openSave() {
  const size = inFile().length * 76;
  openModal(`
    <h2 id="modalHead">Save the splat</h2>
    <p class="prose">${saveContentsLine()} About ${size} MB.</p>
    <div class="modal-privacy">${LOCK}<p class="prose"><strong>The file contains where it was recorded.</strong> Anyone you give it to can see the place. It is saved to your disk only; nothing is uploaded.</p></div>
    <div class="save-progress" hidden><span></span></div>
    <p class="save-error prose" role="alert" hidden></p>
    <div class="modal-actions">
      <button type="button" class="btn btn--quiet" data-act="close">Cancel</button>
      <button type="button" class="btn btn--accent" data-act="save" data-focus>Save to disk</button>
    </div>`);
}

function runSave(button) {
  const m = $("modal");
  const bar = m.querySelector(".save-progress");
  const fill = bar.querySelector("span");
  const err = m.querySelector(".save-error");
  err.hidden = true;
  bar.hidden = false;
  button.disabled = true;
  button.dataset.busy = "true";
  button.textContent = "Saving...";
  const t0 = performance.now();
  const step = () => {
    const f = Math.min(1, (performance.now() - t0) / 1600);
    fill.style.width = `${f * 100}%`;
    if (S.saveFails && f > 0.6) {
      return saveFailed(button, bar, err);
    }
    if (f < 1) {
      return requestAnimationFrame(step);
    }
    S.saved = true;
    closeModal();
    renderAll();
    return 0;
  };
  requestAnimationFrame(step);
}

function saveFailed(button, bar, err) {
  bar.hidden = true;
  err.hidden = false;
  err.textContent =
    "Saving did not work: the disk may be full, or the folder cannot be written to. Nothing was lost. Try again, or pick another folder.";
  button.disabled = false;
  delete button.dataset.busy;
  button.textContent = "Try again";
  return 0;
}

function numbersHtml(p) {
  if (p.status !== "done") {
    return `<div><span>Progress</span><span>${Math.floor(p.progress * 100)} %</span></div>`;
  }
  const [atPhotos, between] = outcomeOf(p).db;
  const mins = Math.round(durOf(p) / 60);
  return `
    <div><span>Sharpness at the photos</span><span>${atPhotos} dB</span></div>
    <div><span>Sharpness between them</span><span>${between} dB</span></div>
    <div><span>Photos used</span><span>${STRETCHES[p.i].photos}</span></div>
    <div><span>Training time</span><span>${mins} min</span></div>`;
}

function openLoupe(i) {
  const p = S.prints[i];
  const st = STRETCHES[i];
  const word = p.status === "done" ? VERDICT_WORD[p.verdict] : "Still training";
  openModal(
    `
    <div class="loupe">
      <canvas width="1200" height="800" aria-label="Preview of stretch ${i + 1}"></canvas>
      <div class="loupe-side">
        <h2 id="modalHead">Stretch ${i + 1} <span class="hint hint--dim">${st.from}-${st.to} m</span></h2>
        <p class="print-no loupe-word">${word}</p>
        <p class="prose">${sayFor(p) || "This is the newest look. It gets sharper while it trains."}</p>
        <div class="print-reasons" data-loupe></div>
        <details><summary class="hint">Numbers</summary><div class="numbers">${numbersHtml(p)}</div></details>
        <div class="print-actions" data-loupe></div>
        <div class="modal-actions">
          <button type="button" class="btn btn--small" data-act="prev" ${i === 0 ? "disabled" : ""}>Previous</button>
          <button type="button" class="btn btn--small" data-act="next" ${i === STRETCHES.length - 1 ? "disabled" : ""}>Next</button>
          <button type="button" class="btn btn--small" data-act="close" data-focus>Close</button>
        </div>
      </div>
    </div>`,
    true,
  );
  const m = $("modal");
  m.dataset.loupe = String(i);
  setData(m, "verdict", p.status === "done" ? p.verdict : null);
  const ghost = Boolean(outcomeOf(p).ghost) && p.status === "done";
  drawPrint(m.querySelector("canvas"), i + 1, p.shown, ghost);
  fillReasons(m.querySelector(".print-reasons[data-loupe]"), p);
  fillActions(m.querySelector(".print-actions[data-loupe]"), actionsFor(p));
}

function onModalClick(e) {
  const act = e.target.closest("[data-act]")?.dataset.act;
  const i = Number($("modal").dataset.loupe);
  const handlers = {
    close: closeModal,
    stop: () => {
      closeModal();
      stopTraining();
    },
    save: () => runSave(e.target.closest("button")),
    prev: () => openLoupe(i - 1),
    next: () => openLoupe(i + 1),
  };
  handlers[act]?.();
}

function showUndecided() {
  const p = undecided()[0];
  if (!p) {
    return;
  }
  const el = $("sheet").children[p.i];
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.dataset.flash = "true";
  el.querySelector(".print-frame").focus({ preventScroll: true });
  setTimeout(() => delete el.dataset.flash, 2000);
}

/* ---------- start: choosing and reading a recording ---------- */

function chooseRecording() {
  S.phase = "reading";
  const line = $("readLine");
  line.hidden = false;
  $("chooseBtn").disabled = true;
  $("chooseBtn").dataset.busy = "true";
  const total = 2104;
  const t0 = performance.now();
  const step = () => {
    const f = Math.min(1, (performance.now() - t0) / 1500);
    line.textContent = `Reading the recording on this computer... ${Math.floor(f * total).toLocaleString("en")} of ${total.toLocaleString("en")} files`;
    if (f < 1) {
      requestAnimationFrame(step);
      return;
    }
    $("chooseBtn").disabled = false;
    delete $("chooseBtn").dataset.busy;
    line.hidden = true;
    S.phase = "census";
    renderAll();
  };
  requestAnimationFrame(step);
}

/* ---------- jumping to a state ---------- */

function finishFirst(n) {
  for (let i = 0; i < n; i++) {
    finish(S.prints[i]);
  }
}

function trainAt(i, progress, queue) {
  S.phase = "training";
  S.queue = [i, ...queue];
  startNext();
  const p = S.prints[i];
  p.elapsed = progress * durOf(p);
  p.progress = progress;
  p.nextPreview = Math.ceil(p.elapsed / PREVIEW_EVERY_S) * PREVIEW_EVERY_S;
  p.shown = sharpAt(p, Math.max(0, p.nextPreview - PREVIEW_EVERY_S) / durOf(p));
  S.runElapsed = 120;
}

const JUMPS = {
  start: () => {},
  census: () => {
    S.phase = "census";
  },
  "census-gpu": () => {
    S.phase = "census";
    S.gpuIntegrated = true;
    S.gpuWarn = true;
  },
  training: () => {
    finishFirst(2);
    trainAt(2, 0.45, [3, 4, 5, 6, 7]);
  },
  poor: () => {
    finishFirst(5);
    trainAt(5, 0.22, [6, 7]);
  },
  cancelled: () => {
    finishFirst(3);
    trainAt(3, 0.52, [4, 5, 6, 7]);
    stopTraining();
  },
  resumed: () => {
    finishFirst(3);
    trainAt(3, 0.52, [4, 5, 6, 7]);
    stopTraining();
    continueTraining();
  },
  done: () => {
    finishFirst(8);
    S.phase = "done";
  },
  saved: () => {
    finishFirst(8);
    S.prints[4].decision = "keep";
    S.phase = "done";
    S.saved = true;
  },
};

function jumpTo(name) {
  closeModal();
  resetState();
  if (REFUSALS[name]) {
    S.phase = "refusal";
    S.refusal = name;
  } else {
    (JUMPS[name] || JUMPS.start)();
  }
  $("protoState").value = name;
  renderAll();
}

/* ---------- prototype controls and the clock ---------- */

function setTheme(value) {
  if (value) {
    document.documentElement.dataset.theme = value;
  } else {
    delete document.documentElement.dataset.theme;
  }
  $("protoTheme").value = value;
  renderAll();
}

function wireControls() {
  $("protoToggle").addEventListener("click", () => {
    const open = $("protoPanel").hidden;
    $("protoPanel").hidden = !open;
    $("protoToggle").setAttribute("aria-expanded", String(open));
  });
  $("protoState").addEventListener("change", (e) => jumpTo(e.target.value));
  $("protoSpeed").addEventListener("change", (e) => {
    S.speed = Number(e.target.value);
  });
  $("protoTheme").addEventListener("change", (e) => setTheme(e.target.value));
  $("protoPause").addEventListener("change", (e) => {
    S.paused = e.target.checked;
  });
  $("protoFail").addEventListener("change", (e) => {
    S.saveFails = e.target.checked;
  });
}

function wirePage() {
  $("chooseBtn").addEventListener("click", chooseRecording);
  const drop = $("drop");
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.dataset.over = "true";
  });
  drop.addEventListener("dragleave", () => delete drop.dataset.over);
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    delete drop.dataset.over;
    chooseRecording();
  });
  $("startBtn").addEventListener("click", startTraining);
  $("otherBtn").addEventListener("click", () => jumpTo("start"));
  $("gpuRecheck").addEventListener("click", () => {
    // Faked: the setting was changed, a graphics card is found now.
    S.gpuIntegrated = false;
    S.gpuWarn = false;
    renderAll();
  });
  $("gpuAnyway").addEventListener("click", () => {
    S.gpuWarn = false;
    renderAll();
  });
  $("cancelBtn").addEventListener("click", openStop);
  $("showBtn").addEventListener("click", showUndecided);
  $("resumeBtn").addEventListener("click", continueTraining);
  $("saveBtn").addEventListener("click", openSave);
  $("modal").addEventListener("click", onModalClick);
  $("veil").addEventListener("click", (e) => {
    if (e.target === $("veil")) {
      closeModal();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("veil").hidden) {
      closeModal();
    }
  });
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (S.phase === "training" && !S.paused) {
    tick(dt * S.speed);
  }
  renderLive();
  requestAnimationFrame(frame);
}

function init() {
  resetState();
  buildSheet();
  wireControls();
  wirePage();
  const params = new URLSearchParams(location.search);
  const speed = params.get("speed");
  if (speed) {
    S.speed = Number(speed);
    $("protoSpeed").value = speed;
  }
  if (params.get("pause") === "1") {
    S.paused = true;
    $("protoPause").checked = true;
  }
  setTheme(params.get("theme") || "");
  const narrow = matchMedia("(max-width: 700px)").matches;
  jumpTo(params.get("state") || (narrow ? "phone" : "start"));
  matchMedia("(prefers-color-scheme: light)").addEventListener(
    "change",
    renderAll,
  );
  requestAnimationFrame(frame);
}

init();
