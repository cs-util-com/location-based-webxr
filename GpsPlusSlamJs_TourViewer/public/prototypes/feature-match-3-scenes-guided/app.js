// Throwaway prototype: the photo test as three scenes with a shared first
// photo. Not wired to the app; the measuring is faked with timers. Photos are
// real canvas captures (live camera or a drawn stand-in) kept in IndexedDB,
// the run state in localStorage, so a reload resumes.
"use strict";

const STORE_KEY = "fm3-scenes-guided-v1";
const DB_NAME = "fm3-scenes-guided";
const MAX_LONG_EDGE = 1280;

/* ---------------- the protocol ---------------- */

/** Scene kinds with their shots, in plain words. `base` marks the shared first photo. */
const KINDS = {
  light: {
    name: "Light",
    short: "Light",
    rule: "still",
    intro:
      "Stand the phone on a table or shelf, aimed at a detailed part of the room. It stays there for all four photos.",
    shots: [
      {
        code: "L1",
        title: "Normal light",
        base: true,
        steps: [
          "Aim at something with detail: shelves, a rug, a poster.",
          "Light as you normally have it.",
        ],
        diagram: "bulb-2",
      },
      {
        code: "L2",
        title: "Again, unchanged",
        steps: [
          "Change nothing.",
          "Tap and take your hand away before the click.",
        ],
        note: "The control: how many matches survive when nothing changes.",
        diagram: "bulb-2",
      },
      {
        code: "L3",
        title: "Dimmed",
        steps: [
          "Stand up: main light off, one small lamp on.",
          "Wait 2 seconds, then tap. Do not move the phone.",
        ],
        diagram: "bulb-1",
      },
      {
        code: "L4",
        title: "As dark as possible",
        steps: [
          "Dim further, until the shapes only just show on the screen.",
          "Wait 2 seconds, then tap. Then the light can go back on.",
        ],
        diagram: "bulb-0",
      },
    ],
  },
  flat: {
    name: "Flat surface",
    short: "Flat",
    rule: "hand",
    intro:
      "Pick the phone up: from here it is hand-held. Find a flat surface with detail, like a poster or a patterned door.",
    shots: [
      {
        code: "F1",
        title: "Upright, 1.5 m",
        base: true,
        steps: [
          "Stand about 1.5 m from the flat surface.",
          "Hold the phone upright, the surface filling most of the view.",
        ],
        diagram: "phone-0",
      },
      {
        code: "F2",
        title: "Again (control)",
        steps: ["Same place, upright again."],
        note: "The quarter and half turn are computed from this photo. No need to turn the phone.",
        diagram: "phone-0",
      },
      {
        code: "F3",
        title: "Tilted 30-45 deg",
        steps: [
          "Same place.",
          "Tilt the phone like a clock hand at one o'clock, same centre.",
        ],
        diagram: "phone-35",
      },
      {
        code: "F4",
        title: "From 3 m",
        steps: [
          "Step straight back to about 3 m.",
          "Upright, same centre. Do not zoom.",
        ],
        diagram: "dist-3",
      },
      {
        code: "F5",
        title: "From 1 m",
        steps: ["Walk up to about 1 m from the surface.", "Upright, same centre."],
        diagram: "dist-1",
      },
      {
        code: "F6",
        title: "1 m to the side",
        steps: [
          "Go back to 1.5 m, then step 1 m to the side, along the surface.",
          "Aim at the same centre.",
        ],
        diagram: "side-flat",
      },
    ],
  },
  deep: {
    name: "Deep",
    short: "Deep",
    rule: "hand",
    intro:
      "Still hand-held. Aim into a hallway or a deep room, with things near and far.",
    shots: [
      {
        code: "D1",
        title: "Into the hallway",
        base: true,
        steps: [
          "Aim into a hallway or a deep room: things near and far.",
          "Nothing moving in the view: people, pets, a TV.",
        ],
        diagram: "deep",
      },
      {
        code: "D2",
        title: "Again (control)",
        steps: ["Same place, same aim."],
        diagram: "deep",
      },
      {
        code: "D3",
        title: "1 m to the side",
        steps: ["Step 1 m to the side.", "Aim at the same centre."],
        diagram: "side-deep",
      },
    ],
  },
  own: {
    name: "Your own pair",
    short: "Own",
    rule: "hand",
    intro: "Anything you want to test: two photos, one change between them.",
    shots: [
      {
        code: "X1",
        title: "Your first photo",
        base: true,
        steps: ["Anything with detail.", "Remember what you will change."],
        diagram: "own",
      },
      {
        code: "X2",
        title: "Your second photo",
        steps: ["Change one thing, then capture."],
        diagram: "own",
      },
    ],
  },
};

/** Pairs are derived, never captured. Turns are computed from F2. */
const PAIRS = {
  light: [
    ["L1", "L2", "control"],
    ["L1", "L3", "dimmed"],
    ["L1", "L4", "dark"],
  ],
  flat: [
    ["F1", "F2", "control"],
    ["F1", "F3", "tilt"],
    ["F1", "F4", "half size"],
    ["F5", "F4", "a third of the size"],
    ["F1", "F6", "side step"],
    ["F1", "F2", "quarter turn, computed", "turn90"],
    ["F1", "F2", "half turn, computed", "turn180"],
  ],
  deep: [
    ["D1", "D2", "control"],
    ["D1", "D3", "side step"],
  ],
  own: [["X1", "X2", "your pair"]],
};

/** Fake per-pair cost on a phone, in ms. ALIKED is slow on purpose: it is what the end view waits for. */
const METHODS = [
  { id: "sift", name: "SIFT", ms: 1500 },
  { id: "xfeat", name: "XFeat", ms: 700 },
  { id: "aliked", name: "ALIKED + LightGlue", ms: 5200 },
];
let speed = 1;

/* ---------------- state (persisted) ---------------- */

function freshState() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return {
    v: 1,
    session: [...b].map((x) => x.toString(16).padStart(2, "0")).join(""),
    spots: 1,
    own: false,
    started: false,
    screen: "intro",
    cur: null, // { scene, code }
    retake: null, // { scene, code }
    warn: null, // { scene, code }
    shots: {}, // "scene:code" -> { w, h, mean, bytes, take, check } | { skipped: true }
    results: {}, // "pairId|method" -> { matches, ms }
    choice: "now",
    zipResults: -1,
    takes: 0,
    settings: { countdown: 3, sound: true, simRoom: true },
  };
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (s && s.v === 1 && typeof s.session === "string" && s.shots) return s;
  } catch {
    /* storage blocked: start fresh */
  }
  return freshState();
}
let state = loadState();
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked: this run lives in memory only */
  }
}

/* ---------------- scenes, shots, pairs ---------------- */

function scenes() {
  const out = [];
  for (let p = 1; p <= state.spots; p++)
    out.push({ id: `light-${p}`, kind: "light", place: p });
  out.push({ id: "flat", kind: "flat" });
  out.push({ id: "deep", kind: "deep" });
  if (state.own) out.push({ id: "own", kind: "own" });
  return out;
}
function sceneById(id) {
  return scenes().find((s) => s.id === id) || null;
}
function sceneName(sc) {
  const k = KINDS[sc.kind];
  return sc.kind === "light" && state.spots > 1
    ? `${k.name}, place ${sc.place}`
    : k.name;
}
function sceneShort(sc) {
  const k = KINDS[sc.kind];
  return sc.kind === "light" && state.spots > 1
    ? `${k.short} ${sc.place}`
    : k.short;
}
function shotDef(sc, code) {
  return KINDS[sc.kind].shots.find((s) => s.code === code);
}
const skey = (sc, code) => `${sc.id}:${code}`;
function shotState(sc, code) {
  const r = state.shots[skey(sc, code)];
  if (!r) return "open";
  return r.skipped ? "skipped" : "taken";
}
function sceneComplete(sc) {
  return KINDS[sc.kind].shots.every((s) => shotState(sc, s.code) !== "open");
}
function takenCount() {
  return Object.values(state.shots).filter((r) => !r.skipped).length;
}
function totalShots() {
  return scenes().reduce((n, sc) => n + KINDS[sc.kind].shots.length, 0);
}
/** The first open shot, starting at the given scene, then wrapping round. */
function nextOpen(fromSceneId) {
  const list = scenes();
  const start = Math.max(
    0,
    list.findIndex((s) => s.id === fromSceneId),
  );
  for (let i = 0; i < list.length; i++) {
    const sc = list[(start + i) % list.length];
    for (const s of KINDS[sc.kind].shots)
      if (shotState(sc, s.code) === "open") return { scene: sc.id, code: s.code };
  }
  return null;
}
function openShots() {
  const out = [];
  for (const sc of scenes())
    for (const s of KINDS[sc.kind].shots) {
      const st = shotState(sc, s.code);
      if (st !== "taken") out.push({ sc, code: s.code, st });
    }
  return out;
}
function pairsOf(sc) {
  return PAIRS[sc.kind].map(([a, b, label, synth]) => ({
    id: `${sc.id}/${a}-${b}${synth ? "-" + synth : ""}`,
    sc,
    a,
    b,
    label,
    synth: synth || null,
  }));
}
function pairPossible(p) {
  return shotState(p.sc, p.a) === "taken" && shotState(p.sc, p.b) === "taken";
}
function pairsUsing(sc, code) {
  return pairsOf(sc).filter((p) => p.a === code || p.b === code);
}

/* ---------------- photo storage (IndexedDB, memory fallback) ---------------- */

const mem = new Map();
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore("shots");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbp;
}
async function putShot(key, blob) {
  mem.set(key, blob);
  const d = await db();
  if (!d) return;
  await new Promise((res) => {
    const tx = d.transaction("shots", "readwrite");
    tx.objectStore("shots").put(blob, key);
    tx.oncomplete = res;
    tx.onerror = res;
  });
}
async function getShot(key) {
  if (mem.has(key)) return mem.get(key);
  const d = await db();
  if (!d) return null;
  return new Promise((res) => {
    const r = d.transaction("shots").objectStore("shots").get(key);
    r.onsuccess = () => {
      if (r.result) mem.set(key, r.result);
      res(r.result || null);
    };
    r.onerror = () => res(null);
  });
}
async function clearShots() {
  mem.clear();
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  const d = await db();
  if (!d) return;
  await new Promise((res) => {
    const tx = d.transaction("shots", "readwrite");
    tx.objectStore("shots").clear();
    tx.oncomplete = res;
    tx.onerror = res;
  });
}
/** Object URLs per shot key, so the strip can draw thumbnails synchronously. */
const urls = new Map();
function setUrl(key, blob) {
  const old = urls.get(key);
  if (old) URL.revokeObjectURL(old);
  urls.set(key, URL.createObjectURL(blob));
}
async function loadAllUrls() {
  for (const [key, r] of Object.entries(state.shots)) {
    if (r.skipped || urls.has(key)) continue;
    const blob = await getShot(key);
    if (blob) setUrl(key, blob);
  }
}

/* ---------------- log ---------------- */

const logLines = [];
function log(line) {
  logLines.push(line);
  if (logLines.length > 600) logLines.shift();
}
log(`page: scenes guided run, session ${state.session}`);

/* ---------------- sound and vibration ---------------- */

let audio = null;
function beep(freq, ms) {
  if (!state.settings.sound) return;
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.15, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  } catch {
    /* no audio: the countdown digits still show */
  }
}
function buzz(ms) {
  // Only at the tap, never at the shot: a vibration then would shake the photo.
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {
    /* no vibration */
  }
}

/* ---------------- toast: one quiet line ---------------- */

let toastTimer = 0;
function toast(text, ms = 2800) {
  const el = $("toast");
  // On the run screen the toast sits inside the viewfinder, so the scene header stays readable.
  const host = state.screen === "run" ? $("finder") : document.body;
  if (el.parentElement !== host) host.append(el);
  el.textContent = text;
  el.hidden = false;
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

/* ---------------- camera (live or drawn stand-in) ---------------- */

const $ = (id) => document.getElementById(id);
const video = $("video");
const fake = $("fake");
let stream = null;
let fakeOn = false;
const fakeScenes = {};

async function startCamera() {
  if (stream || fakeOn) return;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      throw new Error("no camera API");
    const s = await Promise.race([
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 } },
        audio: false,
      }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("camera did not answer")), 6000),
      ),
    ]);
    stream = s;
    video.srcObject = stream;
    await video.play();
    video.hidden = false;
    fake.hidden = true;
    ui.camReady = true;
    log(`camera: on ${video.videoWidth}x${video.videoHeight}`);
  } catch (e) {
    log(`camera: ${e.message || e} - using the simulated camera`);
    startFake();
  }
  render();
}
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    log("camera: off");
  }
}

/** What the simulated camera shows for the shot that is due. */
function fakeView() {
  const t = target();
  const sc = t && sceneById(t.scene);
  const v = { scene: "room", dim: 1, rot: 0, scale: 1, dx: 0 };
  if (!sc) return v;
  if (sc.kind === "light") {
    if (state.settings.simRoom) v.dim = { L3: 0.42, L4: 0.17 }[t.code] || 1;
    v.dx = (sc.place - 1) * 0.12;
  } else if (sc.kind === "flat") {
    v.scene = "poster";
    Object.assign(
      v,
      {
        F3: { rot: -0.6 },
        F4: { scale: 0.55 },
        F5: { scale: 1.45 },
        F6: { dx: 0.16, scale: 0.92 },
      }[t.code] || {},
    );
  } else if (sc.kind === "deep") {
    v.scene = "hall";
    if (t.code === "D3") v.dx = 0.14;
  }
  return v;
}
function startFake() {
  fakeOn = true;
  ui.camReady = true;
  fake.hidden = false;
  video.hidden = true;
  const portrait = innerHeight > innerWidth;
  fake.width = portrait ? 960 : 1280;
  fake.height = portrait ? 1280 : 960;
  const ctx = fake.getContext("2d");
  let t = 0;
  const tick = () => {
    t++;
    const v = fakeView();
    const src =
      fakeScenes[v.scene] ||
      (fakeScenes[v.scene] = drawScene(
        v.scene,
        fake.width * (v.scene === "poster" ? 2 : 1.6),
        fake.height * (v.scene === "poster" ? 2 : 1.6),
      ));
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, fake.width, fake.height);
    ctx.save();
    ctx.filter = `brightness(${v.dim})`;
    ctx.translate(fake.width / 2 - v.dx * fake.width, fake.height / 2);
    ctx.rotate(v.rot);
    ctx.scale(v.scale, v.scale);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    ctx.restore();
    ctx.fillStyle = `rgba(255,255,255,${0.015 + 0.015 * Math.sin(t / 7)})`;
    ctx.fillRect(0, 0, fake.width, fake.height);
    requestAnimationFrame(tick);
  };
  tick();
}
/** Made-up places: a room corner, a patterned poster, a hallway. Drawn twice the view size. */
function drawScene(kind, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  let seed = kind === "room" ? 7 : kind === "poster" ? 31 : 97;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  if (kind === "room") {
    g.fillStyle = "#7d7466";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#5a4c3c";
    g.fillRect(0, h * 0.68, w, h * 0.32);
    for (let y = h * 0.7; y < h; y += 40) {
      for (let x = (y / 40) % 2 ? 0 : 20; x < w; x += 40) {
        g.fillStyle = ["#9a3b2f", "#d6b56a", "#2f4f6a"][Math.floor(rnd() * 3)];
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 20, y + 20);
        g.lineTo(x, y + 40);
        g.lineTo(x - 20, y + 20);
        g.fill();
      }
    }
    for (let r = 0; r < 4; r++) {
      const sy = h * 0.22 + r * h * 0.11;
      const sx = w * 0.2;
      const sw = w * 0.3;
      g.fillStyle = "#3b2a1c";
      g.fillRect(sx, sy + h * 0.09, sw, h * 0.014);
      let x = sx + 6;
      while (x < sx + sw - 30) {
        const bw = 16 + rnd() * 30;
        const bh = h * (0.05 + rnd() * 0.035);
        g.fillStyle = `hsl(${Math.floor(rnd() * 360)} ${30 + rnd() * 40}% ${25 + rnd() * 35}%)`;
        g.fillRect(x, sy + h * 0.09 - bh, bw, bh);
        g.fillStyle = "rgba(255,255,255,0.35)";
        g.fillRect(x + 3, sy + h * 0.09 - bh + 10, bw - 6, 4);
        x += bw + 3;
      }
    }
    const px = w * 0.54;
    const py = h * 0.22;
    const pw = w * 0.24;
    const ph = h * 0.3;
    g.fillStyle = "#1e1b18";
    g.fillRect(px - 12, py - 12, pw + 24, ph + 24);
    g.fillStyle = "#e9e2d0";
    g.fillRect(px, py, pw, ph);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `hsl(${Math.floor(rnd() * 360)} 55% 45%)`;
      g.beginPath();
      g.arc(px + rnd() * pw, py + rnd() * ph, 6 + rnd() * 28, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#b8643a";
    g.fillRect(w * 0.6, h * 0.58, w * 0.06, h * 0.1);
    g.fillStyle = "#3f6b3a";
    for (let i = 0; i < 16; i++) {
      g.beginPath();
      g.ellipse(
        w * 0.63 + (rnd() - 0.5) * w * 0.08,
        h * 0.55 - rnd() * h * 0.08,
        14,
        36,
        rnd() * 3,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
  } else if (kind === "poster") {
    g.fillStyle = "#8b8478";
    g.fillRect(0, 0, w, h);
    const px = w * 0.3;
    const py = h * 0.3;
    const pw = w * 0.4;
    const ph = h * 0.4;
    g.fillStyle = "#222";
    g.fillRect(px - 14, py - 14, pw + 28, ph + 28);
    g.fillStyle = "#efe7d4";
    g.fillRect(px, py, pw, ph);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `hsl(${Math.floor(rnd() * 360)} 60% ${35 + rnd() * 25}%)`;
      const x = px + rnd() * pw;
      const y = py + rnd() * ph;
      const s = 8 + rnd() * 40;
      if (rnd() < 0.5) g.fillRect(x - s / 2, y - s / 2, s, s * 0.6);
      else {
        g.beginPath();
        g.arc(x, y, s / 2, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = "#1e1b18";
    g.font = `bold ${Math.round(h * 0.035)}px sans-serif`;
    g.fillText("EXHIBITION", px + pw * 0.08, py + ph * 0.93);
  } else {
    g.fillStyle = "#6f6a60";
    g.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.48;
    const bw = w * 0.14;
    const bh = h * 0.16;
    g.fillStyle = "#8a8172";
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(cx - bw, cy - bh);
    g.lineTo(cx - bw, cy + bh);
    g.lineTo(0, h);
    g.fill();
    g.fillStyle = "#7c7466";
    g.beginPath();
    g.moveTo(w, 0);
    g.lineTo(cx + bw, cy - bh);
    g.lineTo(cx + bw, cy + bh);
    g.lineTo(w, h);
    g.fill();
    g.fillStyle = "#4e4234";
    g.beginPath();
    g.moveTo(0, h);
    g.lineTo(cx - bw, cy + bh);
    g.lineTo(cx + bw, cy + bh);
    g.lineTo(w, h);
    g.fill();
    for (let i = 1; i < 14; i++) {
      const t = i / 14;
      const y = cy + bh + (h - cy - bh) * t * t;
      g.strokeStyle = "rgba(0,0,0,0.25)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    g.fillStyle = "#d9d2c0";
    g.fillRect(cx - bw, cy - bh, bw * 2, bh * 2);
    g.fillStyle = "#3b2a1c";
    g.fillRect(cx - bw * 0.35, cy - bh * 0.6, bw * 0.7, bh * 1.6);
    for (const [x0, x1, s] of [
      [0.1, 0.22, 1],
      [0.26, 0.32, 0.55],
    ]) {
      for (const side of [-1, 1]) {
        g.fillStyle = side < 0 ? "#3d3226" : "#33291f";
        const xa = side < 0 ? w * x0 : w * (1 - x0);
        const xb = side < 0 ? w * x1 : w * (1 - x1);
        g.beginPath();
        g.moveTo(xa, cy - h * 0.3 * s);
        g.lineTo(xb, cy - h * 0.18 * s);
        g.lineTo(xb, cy + h * 0.2 * s);
        g.lineTo(xa, cy + h * 0.34 * s);
        g.fill();
      }
    }
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `hsl(${Math.floor(rnd() * 360)} 45% 45%)`;
      g.fillRect(
        cx - bw * 0.95 + rnd() * bw * 1.9,
        cy - bh * 0.9 + rnd() * bh * 0.5,
        8 + rnd() * 14,
        8 + rnd() * 14,
      );
    }
    g.fillStyle = "#b8643a";
    g.fillRect(w * 0.36, h * 0.7, w * 0.05, h * 0.1);
    g.fillStyle = "#3f6b3a";
    g.beginPath();
    g.ellipse(w * 0.385, h * 0.67, 40, 60, 0, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Grabs the current frame at most 1280 px long, as a plain PNG plus its grey mean. */
async function grabFrame() {
  const src = stream ? video : fake;
  const sw = stream ? video.videoWidth : fake.width;
  const sh = stream ? video.videoHeight : fake.height;
  const k = Math.min(1, MAX_LONG_EDGE / Math.max(sw, sh));
  const w = Math.round(sw * k);
  const h = Math.round(sh * k);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(src, 0, 0, w, h);
  const small = document.createElement("canvas");
  small.width = 64;
  small.height = 48;
  const sg = small.getContext("2d");
  sg.drawImage(c, 0, 0, 64, 48);
  const px = sg.getImageData(0, 0, 64, 48).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4)
    sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const mean = sum / (px.length / 4);
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  if (!blob) throw new Error("PNG encode failed");
  return { blob, w, h, mean: Math.round(mean * 100) / 100 };
}

/* ---------------- light check (per shot, against L1 or L3) ---------------- */

const CHECK_OK = new Set(["same", "darker"]);
function lightCheck(sc, code, mean) {
  if (sc.kind !== "light" || code === "L1") return null;
  const base = state.shots[skey(sc, "L1")];
  if (!base || base.skipped) return null;
  const a = base.mean;
  if (code === "L2") {
    const tol = a < 10 ? 3 : 0.2 * a;
    return Math.abs(mean - a) > tol ? "changed" : "same";
  }
  if (mean < 3) return "black";
  if (code === "L3") return mean > 0.8 * a ? "not-darker" : "darker";
  const l3 = state.shots[skey(sc, "L3")];
  const ref = l3 && !l3.skipped ? l3.mean : a;
  return mean > 0.85 * ref ? "not-darker" : "darker";
}
function checkText(code, result) {
  const ref = code === "L4" ? "L3" : "L1";
  return {
    same: `Light check: same light as L1. Good.`,
    darker: `Light check: darker than ${ref}. Good.`,
    "not-darker": `${code} is not darker than ${ref}. Dim the light, wait 2 s, then retake ${code}.`,
    changed: `The light changed since L1. Put it back as it was and retake L2.`,
    black: `${code} is black: nothing to match. Dim a little less and retake.`,
  }[result];
}

/* ---------------- background measuring (faked with timers) ---------------- */

const proc = { running: null, timer: 0 };
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}
function jobDur(key, m) {
  return (m.ms * (0.8 + 0.4 * hash(key))) / speed;
}
/** Every job of a complete scene, measured or not; pairs with a skipped photo drop out. */
function jobsOf(sc) {
  if (!sceneComplete(sc)) return [];
  const out = [];
  for (const p of pairsOf(sc)) {
    if (!pairPossible(p)) continue;
    for (const m of METHODS) out.push({ key: `${p.id}|${m.id}`, pair: p, m });
  }
  return out;
}
function pendingJobs() {
  return scenes().flatMap((sc) => jobsOf(sc).filter((j) => !state.results[j.key]));
}
function pump() {
  if (proc.running) return;
  const j = pendingJobs()[0];
  if (!j) return;
  const dur = jobDur(j.key, j.m);
  proc.running = { ...j, t0: performance.now(), dur };
  proc.timer = setTimeout(finishJob, dur);
  renderProgress();
}
function finishJob() {
  const j = proc.running;
  proc.running = null;
  if (!j) return;
  const base = {
    control: 420,
    dimmed: 260,
    dark: 90,
    tilt: 230,
    "half size": 170,
    "a third of the size": 110,
    "side step": 190,
    "quarter turn, computed": 150,
    "half turn, computed": 140,
    "your pair": 200,
  }[j.pair.label];
  const f = { sift: 0.7, xfeat: 0.85, aliked: 1.15 }[j.m.id];
  state.results[j.key] = {
    matches: Math.round(base * f * (0.8 + 0.4 * hash(j.key + "m"))),
    ms: Math.round(j.dur * speed),
  };
  save();
  log(
    `measure: ${j.pair.id} ${j.m.name} ${state.results[j.key].matches} matches`,
  );
  const sc = j.pair.sc;
  const left = jobsOf(sc).filter((x) => !state.results[x.key]).length;
  if (!left) {
    log(`measure: ${sc.id} done`);
    if (state.screen === "run") toast(`${sceneName(sc)}: measured.`);
  }
  pump();
  renderProgress();
}
/** Drops results of pairs that use a retaken photo, and stops a job measuring the old one. */
function invalidate(sc, code) {
  const ids = new Set(pairsUsing(sc, code).map((p) => p.id));
  let n = 0;
  for (const k of Object.keys(state.results)) {
    if (ids.has(k.split("|")[0])) {
      delete state.results[k];
      n++;
    }
  }
  if (proc.running && ids.has(proc.running.pair.id)) {
    clearTimeout(proc.timer);
    proc.running = null;
  }
  if (n) log(`measure: ${n} results of ${sc.id} dropped for the retake of ${code}`);
}
function sceneProgress(sc) {
  const jobs = jobsOf(sc);
  if (!sceneComplete(sc)) return { b: "waiting", text: "waiting", frac: 0 };
  if (!jobs.length) return { b: "none", text: "nothing to measure", frac: 0 };
  let done = 0;
  let left = 0;
  for (const j of jobs) {
    if (state.results[j.key]) done++;
    else if (proc.running && proc.running.key === j.key) {
      const r = Math.min(0.95, (performance.now() - proc.running.t0) / proc.running.dur);
      done += r;
      left += proc.running.dur * (1 - r);
    } else left += jobDur(j.key, j.m);
  }
  const frac = done / jobs.length;
  if (frac >= 1) return { b: "done", text: "done", frac: 1, left: 0 };
  const running = proc.running && proc.running.pair.sc.id === sc.id;
  if (!running && done === 0) return { b: "waiting", text: "waiting", frac: 0, left };
  return { b: "measuring", text: frac >= 0.01 ? `measuring ${Math.floor(frac * 100)}%` : "measuring", frac, left };
}
function etaText(ms) {
  if (ms <= 0) return "";
  const s = ms / 1000;
  if (s < 50) return `about ${Math.max(5, Math.ceil(s / 5) * 5)} s`;
  return `about ${Math.ceil(s / 60)} min`;
}
function totalLeft() {
  return scenes().reduce((n, sc) => n + (sceneProgress(sc).left || 0), 0);
}
function resultCount() {
  const live = new Set(scenes().flatMap((sc) => jobsOf(sc).map((j) => j.key)));
  return Object.keys(state.results).filter((k) => live.has(k)).length;
}

/* ---------------- the step machine ---------------- */

const ui = { counting: null, busy: false, ghost: false, menu: false, browse: null, camReady: false };

/** The shot the card and the primary button are about now. */
function target() {
  return state.retake || state.warn || state.cur;
}
function ensureCur() {
  const c = state.cur && sceneById(state.cur.scene);
  if (!c || shotState(c, state.cur.code) !== "open") {
    state.cur = nextOpen(state.cur ? state.cur.scene : null);
  }
}
/** The primary action for the current mode. */
function mode() {
  if (ui.counting) return "counting";
  if (state.retake) return "retake";
  if (state.warn) return "warn";
  if (state.cur) return "capture";
  return "allDone";
}

function tapPrimary() {
  if (ui.busy) return;
  const m = mode();
  if (m === "counting") return cancelCount("cancelled");
  if (m === "allDone") return show("end");
  const t = target();
  beginCount(t);
}
function tapSecondary() {
  if (ui.busy || ui.counting) return;
  const m = mode();
  if (m === "retake") {
    state.retake = null;
    save();
    render();
    return;
  }
  if (m === "warn") {
    log(`light check: kept ${state.warn.scene}:${state.warn.code} anyway`);
    state.warn = null;
    advance();
    return;
  }
  if (m === "capture") {
    const sc = sceneById(state.cur.scene);
    if (isSceneStart(sc)) return skipScene(sc);
    const def = shotDef(sc, state.cur.code);
    state.shots[skey(sc, state.cur.code)] = { skipped: true };
    log(`skip: ${skey(sc, def.code)}`);
    toast(`${def.code} skipped. Tap it in the strip to take it later.`);
    advance();
  }
}
function isSceneStart(sc) {
  return KINDS[sc.kind].shots.every((s) => shotState(sc, s.code) === "open");
}
function skipScene(sc) {
  for (const s of KINDS[sc.kind].shots)
    if (shotState(sc, s.code) === "open")
      state.shots[skey(sc, s.code)] = { skipped: true };
  log(`skip scene: ${sc.id}`);
  toast(`${sceneName(sc)} skipped. Its photos can still be taken from the strip.`, 3600);
  state.retake = null;
  state.warn = null;
  advance();
}
/** After a capture or skip: the next open photo, or the end view when none is left. */
function advance() {
  const from = state.cur ? state.cur.scene : null;
  state.cur = nextOpen(from);
  ui.ghost = false;
  save();
  pump();
  if (!state.cur) {
    log("run: no photo left, end view");
    show("end");
    return;
  }
  render();
}

function beginCount(t) {
  const secs = state.settings.countdown;
  buzz(30);
  if (!secs) return capture(t);
  ui.counting = { left: secs, timer: 0 };
  beep(660, 90);
  ui.counting.timer = setInterval(() => {
    if (!ui.counting) return;
    ui.counting.left -= 1;
    if (ui.counting.left <= 0) {
      clearInterval(ui.counting.timer);
      ui.counting = null;
      capture(t);
    } else {
      beep(660, 90);
      render();
    }
  }, 1000);
  render();
}
function cancelCount(why) {
  if (!ui.counting) return;
  clearInterval(ui.counting.timer);
  ui.counting = null;
  log(`countdown: ${why}`);
  render();
}

async function capture(t) {
  const sc = sceneById(t.scene);
  if (!sc) return;
  const key = skey(sc, t.code);
  const retaking = !!state.retake;
  ui.busy = true;
  render();
  try {
    const f = await grabFrame();
    beep(1320, 60);
    $("flash").hidden = false;
    setTimeout(() => ($("flash").hidden = true), 360);
    await putShot(key, f.blob);
    setUrl(key, f.blob);
    if (retaking || state.warn) invalidate(sc, t.code);
    const rec = {
      w: f.w,
      h: f.h,
      mean: f.mean,
      bytes: f.blob.size,
      take: ++state.takes,
    };
    rec.check = lightCheck(sc, t.code, f.mean);
    state.shots[key] = rec;
    log(
      `photo ${key} take ${rec.take} ${f.w}x${f.h} grey mean ${f.mean}${retaking ? " (retake)" : ""}${moving ? " (phone moved during countdown)" : ""}`,
    );
    if (rec.check) log(`light check ${key}: ${rec.check}`);
    state.retake = null;
    state.warn = null;
    const wasComplete = sceneComplete(sc);
    if (rec.check && !CHECK_OK.has(rec.check)) {
      state.warn = { scene: sc.id, code: t.code };
      save();
      return;
    }
    if (retaking) {
      toast(
        pairsUsing(sc, t.code).length && wasComplete
          ? `${t.code} retaken. ${sceneName(sc)} is measured again in the background.`
          : `${t.code} retaken and saved.`,
      );
      save();
      pump();
      if (!state.cur) ensureCur();
      if (!state.cur) show("end");
      return;
    }
    const sceneDone = sceneComplete(sc);
    if (sceneDone) {
      toast(`${sceneName(sc)} complete. Measuring starts in the background.`, 3400);
    }
    advance();
  } catch (e) {
    log(`ERROR capture: ${e.message || e}`);
    toast("Could not take the photo. Try again.");
  } finally {
    ui.busy = false;
    render();
  }
}

function tapThumb(sc, code) {
  if (ui.counting || ui.busy) return;
  const st = shotState(sc, code);
  if (st === "taken") {
    const same = state.retake && state.retake.scene === sc.id && state.retake.code === code;
    state.retake = same ? null : { scene: sc.id, code };
    state.warn = null;
  } else {
    if (st === "skipped") delete state.shots[skey(sc, code)];
    state.retake = null;
    state.warn = null;
    state.cur = { scene: sc.id, code };
  }
  ui.ghost = false;
  save();
  if (state.screen !== "run") show("run");
  else render();
}

/* ---------------- motion: a steady hint where the sensor exists ---------------- */

let moving = false;
let motionSeen = false;
let motionLevel = 0;
addEventListener("devicemotion", (ev) => {
  const r = ev.rotationRate;
  if (!r || (r.alpha == null && r.beta == null && r.gamma == null)) return;
  motionSeen = true;
  const m = Math.abs(r.alpha || 0) + Math.abs(r.beta || 0) + Math.abs(r.gamma || 0);
  motionLevel = motionLevel * 0.8 + m * 0.2;
  const was = moving;
  moving = motionLevel > 6;
  if (was !== moving || $("steady").hidden) renderSteady();
});
function renderSteady() {
  const el = $("steady");
  el.hidden = !motionSeen || state.screen !== "run";
  el.textContent = moving ? "phone moving" : "steady";
  el.classList.toggle("moving", moving);
}

/* ---------------- download: one zip ---------------- */

function zipName() {
  return `feature-match-scenes-${state.session}.zip`;
}
function mb(n) {
  return n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`;
}
function estimateBytes() {
  return Object.values(state.shots).reduce((n, r) => n + (r.bytes || 0), 0);
}
function deviceLine() {
  const ua = navigator.userAgent;
  const android = /Android ([\d.]+)/.exec(ua);
  const chrome = /Chrome\/(\d+)/.exec(ua);
  return `${android ? "Android " + android[1] : navigator.platform || "unknown OS"}, ${chrome ? "Chrome " + chrome[1] : "browser"}, ${navigator.hardwareConcurrency || "-"} cores`;
}
function pairsJson() {
  const out = [];
  for (const sc of scenes()) {
    for (const p of pairsOf(sc)) {
      const ok = pairPossible(p);
      out.push({
        pair: p.id,
        scene: sc.id,
        a: `${sc.id}-${p.a}.png`,
        b: `${sc.id}-${p.b}.png`,
        change: p.label,
        synthetic: p.synth,
        status: !ok ? "not possible (photo missing)" : null,
        results: ok
          ? Object.fromEntries(
              METHODS.map((m) => [m.id, state.results[`${p.id}|${m.id}`] || "measure on the PC"]),
            )
          : null,
      });
    }
  }
  return out;
}
function summaryText() {
  const lines = [
    "Feature matcher photo test (scenes) - summary",
    `Session: ${state.session}`,
    `Photos: ${takenCount()} of ${totalShots()}`,
    `Results finished on the phone: ${resultCount()} of ${scenes().reduce((n, sc) => n + jobsOf(sc).length, 0)}`,
  ];
  for (const sc of scenes()) {
    const pr = sceneProgress(sc);
    const checks = KINDS[sc.kind].shots
      .map((s) => state.shots[skey(sc, s.code)])
      .filter((r) => r && r.check);
    lines.push(
      `- ${sceneName(sc)}: ${pr.text}${checks.length ? ", light checks " + checks.map((r) => r.check).join("/") : ""}`,
    );
  }
  const miss = openShots();
  lines.push(`Not taken: ${miss.length ? miss.map((o) => `${o.sc.id}:${o.code}`).join(", ") : "none"}`);
  lines.push(`Phone: ${deviceLine()}`);
  lines.push("No location, no time and no names are included.");
  return lines.join("\n");
}
async function downloadZip() {
  if (ui.busy) return;
  ui.busy = true;
  const st = $("download-state");
  st.className = "state";
  st.textContent = "Packing the zip. Keep this page open.";
  renderEnd();
  const enc = new TextEncoder();
  try {
    const entries = [];
    for (const sc of scenes()) {
      for (const s of KINDS[sc.kind].shots) {
        if (shotState(sc, s.code) !== "taken") continue;
        const blob = await getShot(skey(sc, s.code));
        if (!blob) throw new Error(`photo ${s.code} of ${sceneName(sc)} is missing from storage`);
        entries.push({
          name: `${sc.id}-${s.code}.png`,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        });
      }
    }
    if (!entries.length) throw new Error("no photo yet");
    const n = resultCount();
    entries.push({
      name: "pairs-and-results.json",
      bytes: enc.encode(
        JSON.stringify(
          {
            format: "feature-match-scenes/1",
            session: state.session,
            methods: METHODS.map((m) => m.name),
            device: deviceLine(),
            pairs: pairsJson(),
          },
          null,
          2,
        ),
      ),
    });
    entries.push({ name: "summary.txt", bytes: enc.encode(summaryText()) });
    log(`download: ${entries.length - 1} files, ${n} results, as ${zipName()}`);
    entries.push({ name: "log.txt", bytes: enc.encode(logLines.join("\n") + "\n") });
    const zip = window.storeZip(entries);
    const url = URL.createObjectURL(zip);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    state.zipResults = n;
    save();
    st.className = "state ok";
    st.textContent = `Saved ${zipName()} (${mb(zip.size)}) to Downloads. Send this one file.`;
  } catch (e) {
    log(`ERROR download: ${e.message || e}`);
    st.className = "state err";
    st.textContent = `Could not make the zip: ${e.message || e}. Nothing was lost; try again.`;
  } finally {
    ui.busy = false;
    renderEnd();
  }
}

/* ---------------- diagrams: one small panel per photo ---------------- */

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
function bulb(level) {
  const fill = ["#2a2a2a", "#7a6524", "#f2c14e"][level];
  const rays = level === 2 ? 8 : level === 1 ? 4 : 0;
  let r = "";
  for (let i = 0; i < rays; i++) {
    const t = (i / rays) * Math.PI * 2;
    r += `<line x1="${50 + Math.cos(t) * 15}" y1="${34 + Math.sin(t) * 15}" x2="${50 + Math.cos(t) * 22}" y2="${34 + Math.sin(t) * 22}" stroke="${fill}" stroke-width="3" stroke-linecap="round"/>`;
  }
  return `${r}<circle cx="50" cy="34" r="11" fill="${fill}" stroke="#555"/><rect x="45" y="44" width="10" height="6" rx="2" fill="#666"/>
    <line x1="12" y1="86" x2="88" y2="86" stroke="#7b858f" stroke-width="3"/>
    <rect x="64" y="66" width="11" height="20" rx="2" fill="#2a3138" stroke="#f2b544" stroke-width="1.6"/>`;
}
function phoneSvg(angle) {
  return `<rect x="22" y="8" width="56" height="12" rx="2" fill="#cfd6dc" opacity="0.5"/>
    <g transform="rotate(${angle} 50 58)">
    <rect x="36" y="32" width="28" height="50" rx="5" fill="#2a3138" stroke="#cfd6dc" stroke-width="2"/>
    <circle cx="50" cy="57" r="7" fill="none" stroke="#f2b544" stroke-width="2"/>
    <path d="M45 38 L50 33 L55 38" fill="none" stroke="#cfd6dc" stroke-width="2"/></g>`;
}
function distSvg(py, label) {
  return `<line x1="14" y1="12" x2="86" y2="12" stroke="#cfd6dc" stroke-width="3"/>
    <line x1="50" y1="${py}" x2="14" y2="12" stroke="#f2b544" stroke-dasharray="3 3"/>
    <line x1="50" y1="${py}" x2="86" y2="12" stroke="#f2b544" stroke-dasharray="3 3"/>
    <path d="M44 ${py + 6} L50 ${py - 6} L56 ${py + 6} Z" fill="#f2b544"/>
    <text x="92" y="${Math.min(py + 4, 94)}" text-anchor="end" font-size="12" fill="#aab3bc" font-family="sans-serif">${label}</text>`;
}
function topSvg(px, deep, aside) {
  const things = deep
    ? `<rect x="20" y="22" width="14" height="9" fill="#4b5560"/><rect x="64" y="34" width="12" height="11" fill="#4b5560"/><rect x="42" y="48" width="10" height="7" fill="#4b5560"/>`
    : "";
  const ghost = aside
    ? `<path d="M44 92 L50 80 L56 92 Z" fill="none" stroke="#7b858f" stroke-dasharray="2 2"/><path d="M58 86 H${px - 8}" stroke="#aab3bc" stroke-width="2" marker-end="url(#ah)"/>`
    : "";
  return `<defs><marker id="ah" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#aab3bc"/></marker></defs>
    <line x1="10" y1="12" x2="90" y2="12" stroke="#cfd6dc" stroke-width="3"/>${things}
    <line x1="${px}" y1="78" x2="50" y2="12" stroke="#f2b544" stroke-dasharray="3 3"/>
    ${ghost}<path d="M${px - 6} 92 L${px} 80 L${px + 6} 92 Z" fill="#f2b544"/>`;
}
function diagram(kind) {
  const body = {
    "bulb-2": () => bulb(2),
    "bulb-1": () => bulb(1),
    "bulb-0": () => bulb(0),
    "phone-0": () => phoneSvg(0),
    "phone-35": () => phoneSvg(35),
    "dist-3": () => distSvg(84, "3 m"),
    "dist-1": () => distSvg(38, "1 m"),
    "side-flat": () => topSvg(78, false, true),
    deep: () => topSvg(50, true, false),
    "side-deep": () => topSvg(78, true, true),
    own: () =>
      `<rect x="20" y="30" width="60" height="42" rx="8" fill="#2a3138" stroke="#cfd6dc" stroke-width="2"/><circle cx="50" cy="51" r="12" fill="none" stroke="#f2b544" stroke-width="2.5"/><rect x="36" y="22" width="16" height="9" rx="2" fill="#cfd6dc"/>`,
  }[kind];
  const tint = kind === "bulb-0" ? "#08090a" : kind === "bulb-1" ? "#0e1013" : "#14181c";
  return `<svg ${SVG_NS} viewBox="0 0 100 100" role="img"><rect x="1" y="1" width="98" height="98" rx="12" fill="${tint}" stroke="#3a434c"/>${body ? body() : ""}</svg>`;
}

/* ---------------- rendering ---------------- */

function show(screen) {
  state.screen = screen;
  save();
  if (screen === "run") startCamera();
  else stopCamera();
  render();
}

function render() {
  $("screen-intro").hidden = state.screen !== "intro";
  $("screen-run").hidden = state.screen !== "run";
  $("screen-end").hidden = state.screen !== "end";
  $("sheet-menu").hidden = !ui.menu;
  for (const b of document.querySelectorAll("[data-spots]")) {
    b.setAttribute("aria-checked", String(Number(b.dataset.spots) === state.spots));
    b.disabled = Object.keys(state.shots).some((k) => k.startsWith("light-"));
  }
  $("intro-start").textContent = state.started ? "Continue where you left off" : "Start";
  for (const b of document.querySelectorAll("[data-countdown]"))
    b.setAttribute("aria-checked", String(Number(b.dataset.countdown) === state.settings.countdown));
  $("sound").checked = state.settings.sound;
  $("sim-room").checked = state.settings.simRoom;
  renderSteady();
  if (state.screen === "run") renderRun();
  if (state.screen === "end") renderEnd();
  if (ui.menu) renderMenu();
}

let lastTarget = "";
function renderRun() {
  ensureCur();
  const t = target();
  const tk = t ? `${t.scene}:${t.code}` : "";
  if (tk !== lastTarget) {
    lastTarget = tk;
    if (t) ui.browse = t.scene;
  }
  const sc = t ? sceneById(t.scene) : scenes()[scenes().length - 1];
  const kind = KINDS[sc.kind];
  const list = scenes();
  const idx = list.findIndex((s) => s.id === sc.id);
  const main = list.filter((s) => s.kind !== "own").length;
  $("scene-kicker").textContent =
    sc.kind === "own" ? "Extra" : `Scene ${idx + 1} of ${main}`;
  $("scene-name").textContent = sceneName(sc);
  const chip = $("rule-chip");
  chip.dataset.rule = kind.rule;
  $("rule-text").textContent = kind.rule === "still" ? "Phone stays still" : "Hand-held";
  renderStrip();
  renderCard(sc, t);
  renderFinder(sc, t);
  renderActions(sc, t);
}

function renderStrip() {
  const t = target();
  const list = scenes();
  if (!ui.browse || !sceneById(ui.browse)) ui.browse = t ? t.scene : list[0].id;
  const segs = $("segs");
  segs.textContent = "";
  for (const sc of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(ui.browse === sc.id));
    b.dataset.now = String(!!t && t.scene === sc.id);
    b.innerHTML = `<span class="seg-name"></span><span class="badge" id="badge-${sc.id}"><i></i><span></span></span>`;
    b.querySelector(".seg-name").textContent = sceneShort(sc);
    b.addEventListener("click", () => {
      ui.browse = sc.id;
      renderStrip();
    });
    segs.append(b);
  }
  const sc = sceneById(ui.browse);
  const row = $("thumbs");
  row.textContent = "";
  for (const s of KINDS[sc.kind].shots) {
    const key = skey(sc, s.code);
    const st = shotState(sc, s.code);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "th";
    b.dataset.st = st;
    if (t && t.scene === sc.id && t.code === s.code) {
      if (state.retake) b.dataset.retake = "true";
      else b.setAttribute("aria-current", "step");
    }
    const rec = state.shots[key];
    if (rec && rec.check && !CHECK_OK.has(rec.check)) b.dataset.warn = "true";
    const url = st === "taken" ? urls.get(key) : "";
    b.innerHTML = `${url ? `<img alt="" src="${url}">` : ""}<span class="th-code">${s.code}</span>`;
    b.setAttribute(
      "aria-label",
      `${s.code} ${s.title}: ${{ taken: "taken, tap to retake", open: "not taken yet", skipped: "skipped, tap to take it" }[st]}`,
    );
    b.addEventListener("click", () => tapThumb(sc, s.code));
    row.append(b);
  }
  if (KINDS[sc.kind].shots.length <= 4) {
    const h = document.createElement("span");
    h.className = "th-hint";
    h.textContent = takenCount() ? "Tap a photo to retake it" : "Your photos appear here";
    row.append(h);
  }
  updateBadges();
}
function updateBadges() {
  for (const sc of scenes()) {
    const el = $(`badge-${sc.id}`);
    if (!el) continue;
    const p = sceneProgress(sc);
    el.dataset.b = p.b;
    const n = KINDS[sc.kind].shots.filter((s) => shotState(sc, s.code) !== "open").length;
    const total = KINDS[sc.kind].shots.length;
    el.querySelector("span").textContent =
      p.b === "waiting" && !sceneComplete(sc) ? `${n} of ${total}` : p.text;
    el.title = p.left ? `${p.text}, ${etaText(p.left)} left` : p.text;
  }
}

function renderCard(sc, t) {
  const banner = $("card-banner");
  const m = mode();
  banner.hidden = true;
  if (!t) {
    $("card-code").textContent = "All";
    $("card-code").dataset.mode = "done";
    $("card-title").textContent = "Every photo is taken";
    $("card-count").textContent = "";
    $("card-diagram").innerHTML = "";
    $("card-diagram").dataset.kind = "";
    $("card-steps").innerHTML = "<li>Tap any photo in the strip above to retake it.</li><li>Or see the measuring and make the zip.</li>";
    $("card-note").textContent = "";
    return;
  }
  const def = shotDef(sc, t.code);
  const shots = KINDS[sc.kind].shots;
  const pos = shots.findIndex((s) => s.code === t.code) + 1;
  $("card-code").textContent = def.code;
  $("card-code").dataset.mode = m === "retake" || m === "warn" ? "retake" : "";
  $("card-title").textContent = def.title;
  $("card-count").textContent = `photo ${pos} of ${shots.length}`;
  const dg = $("card-diagram");
  if (dg.dataset.kind !== def.diagram) {
    dg.innerHTML = diagram(def.diagram);
    dg.dataset.kind = def.diagram;
  }
  const steps = $("card-steps");
  steps.textContent = "";
  for (const s of def.steps) {
    const li = document.createElement("li");
    li.textContent = s;
    steps.append(li);
  }
  let note = def.note || "";
  if (m === "retake") {
    const using = pairsUsing(sc, def.code);
    banner.hidden = false;
    banner.dataset.kind = "retake";
    $("banner-title").textContent = def.base
      ? `Retake ${def.code}, the base photo`
      : `Retake ${def.code}`;
    const turns = sc.kind === "flat" && (def.code === "F1" || def.code === "F2");
    $("banner-text").textContent =
      (using.length
        ? `${using.length} pair${using.length > 1 ? "s" : ""} use${using.length > 1 ? "" : "s"} it${turns ? ", the computed turns included" : ""}; ${using.length > 1 ? "they are" : "it is"} measured again. `
        : "") +
      (sc.kind === "light"
        ? "Put the phone back exactly where it stood. "
        : "") +
      "The other photos stay.";
  } else if (m === "warn") {
    const rec = state.shots[skey(sc, def.code)];
    banner.hidden = false;
    banner.dataset.kind = "warn";
    $("banner-title").textContent = "The light check is not happy";
    $("banner-text").textContent = checkText(def.code, rec.check);
  } else if (isSceneStart(sc)) {
    const prev = scenes()[scenes().findIndex((s) => s.id === sc.id) - 1];
    const prevP = prev ? sceneProgress(prev) : null;
    banner.hidden = false;
    banner.dataset.kind = KINDS[sc.kind].rule;
    $("banner-title").textContent =
      sc.kind === "light" && sc.place > 1
        ? `New place: ${sceneName(sc)}`
        : `New scene: ${sceneName(sc)}`;
    $("banner-text").textContent =
      sc.kind === "light" && sc.place > 1
        ? "Stand the phone somewhere else, aimed at another detailed spot. It stays there for all four photos."
        : KINDS[sc.kind].intro;
    if (prevP && (prevP.b === "measuring" || prevP.b === "waiting")) {
      // Dropped on a short landscape screen: the strip badge already says it.
      const extra = document.createElement("span");
      extra.className = "banner-extra";
      extra.textContent = ` ${sceneName(prev)} is being measured in the background - carry on.`;
      $("banner-text").append(extra);
    }
  } else if (sc.kind === "light" && pos > 1) {
    // quiet feedback: the light check of the previous photo
    const prevRec = state.shots[skey(sc, shots[pos - 2].code)];
    if (prevRec && prevRec.check && CHECK_OK.has(prevRec.check))
      note = `${shots[pos - 2].code}: ${checkText(shots[pos - 2].code, prevRec.check).replace("Light check: ", "")}${note ? " " + note : ""}`;
  }
  if (def.base && m !== "retake") {
    const n = pairsUsing(sc, def.code).length;
    note = `The base photo: ${n} pair${n > 1 ? "s" : ""} compare${n > 1 ? "" : "s"} against it.${note ? " " + note : ""}`;
  }
  $("card-note").textContent = note;
}

function renderFinder(sc, t) {
  const m = mode();
  $("sim-chip").hidden = !fakeOn;
  $("cam-wait").hidden = ui.camReady;
  $("still-chip").hidden = KINDS[sc.kind].rule !== "still" || !t;
  const n = takenCount();
  $("saved-text").textContent = n
    ? `${n} photo${n > 1 ? "s" : ""} saved on this phone`
    : "Photos are saved as you go";
  const base = KINDS[sc.kind].shots[0];
  const baseTaken = shotState(sc, base.code) === "taken";
  const gt = $("ghost-toggle");
  const ghostable = t && baseTaken && t.code !== base.code && m !== "counting";
  gt.hidden = !ghostable;
  gt.textContent = `Show ${base.code}`;
  gt.setAttribute("aria-pressed", String(ui.ghost));
  const ghost = $("ghost");
  if (ghostable && ui.ghost) {
    ghost.src = urls.get(skey(sc, base.code)) || "";
    ghost.hidden = false;
  } else ghost.hidden = true;
  $("count").hidden = !ui.counting;
  if (ui.counting) $("count-num").textContent = String(ui.counting.left);
}

function renderActions(sc, t) {
  const m = mode();
  const btn = $("primary");
  const sec = $("secondary");
  btn.className = "primary main";
  btn.disabled = ui.busy || (!ui.camReady && (m === "capture" || m === "retake" || m === "warn"));
  sec.disabled = ui.busy || m === "counting";
  sec.hidden = false;
  const secs = state.settings.countdown;
  const after = secs ? `then ${secs} s hands off` : "shoots at once";
  if (m === "counting") {
    btn.classList.add("counting");
    $("primary-label").textContent = "Cancel";
    $("primary-sub").textContent = `shooting ${t.code} in ${ui.counting.left} s`;
    sec.textContent = "Skip photo";
  } else if (m === "retake") {
    btn.classList.add("retake");
    $("primary-label").textContent = `Retake ${t.code}`;
    $("primary-sub").textContent = after;
    const back = state.cur ? `Back to ${state.cur.code}` : "Cancel";
    sec.textContent = back;
  } else if (m === "warn") {
    btn.classList.add("retake");
    $("primary-label").textContent = `Retake ${t.code}`;
    $("primary-sub").textContent = after;
    sec.textContent = "Keep it, go on";
  } else if (m === "capture") {
    $("primary-label").textContent = `Capture ${t.code}`;
    $("primary-sub").textContent = ui.camReady ? after : "waiting for the camera";
    sec.textContent = isSceneStart(sc) ? "Skip scene" : "Skip photo";
  } else {
    btn.classList.add("next");
    $("primary-label").textContent = "See the measuring";
    $("primary-sub").textContent = "and make the zip";
    sec.hidden = true;
  }
  $("screen-run").querySelector(".actions").style.gridTemplateColumns = sec.hidden
    ? "minmax(0, 1fr)"
    : "";
}

function renderEnd() {
  const open = openShots();
  const total = totalShots();
  const taken = takenCount();
  const pend = pendingJobs().length;
  const allJobs = scenes().reduce((n, sc) => n + jobsOf(sc).length, 0);
  const done = resultCount();
  $("end-kicker").textContent = open.length ? `${taken} of ${total} photos taken` : "All photos taken";
  $("end-title").textContent = pend ? "Measuring the last pairs" : allJobs ? "Everything is measured" : "Nothing measured yet";
  $("end-lede").textContent = pend
    ? "The phone keeps measuring while this page is open. Make the zip now with what is finished, or wait for the rest."
    : allJobs
      ? "One zip holds every photo, every result and the log."
      : "Complete a scene and it is measured by itself. The zip can still be made with the photos.";
  const left = totalLeft();
  const eta = $("end-eta");
  eta.textContent = pend ? `${etaText(left)} left` : allJobs ? "all done" : "";
  eta.classList.toggle("done", !pend);

  const ul = $("end-list");
  ul.textContent = "";
  for (const sc of scenes()) {
    const pr = sceneProgress(sc);
    const jobs = jobsOf(sc);
    const pairs = pairsOf(sc);
    const possible = pairs.filter(pairPossible).length;
    const li = document.createElement("li");
    li.className = "prow";
    const head = document.createElement("div");
    head.className = "prow-head";
    head.innerHTML = `<b></b><span class="pairs"></span><span class="badge"><i></i><span></span></span>`;
    head.querySelector("b").textContent = sceneName(sc);
    head.querySelector(".pairs").textContent = `${possible} pair${possible === 1 ? "" : "s"}`;
    const bd = head.querySelector(".badge");
    bd.dataset.b = pr.b;
    bd.querySelector("span").textContent =
      pr.b === "measuring" && pr.left ? `${etaText(pr.left)}` : pr.text;
    li.append(head);
    if (sceneComplete(sc) && jobs.length) {
      const bar = document.createElement("span");
      bar.className = `bar${pr.b === "done" ? " done" : ""}`;
      bar.innerHTML = `<span style="width:${Math.round(pr.frac * 100)}%"></span>`;
      const ms = document.createElement("ul");
      ms.className = "methods";
      for (const m of METHODS) {
        const mj = jobs.filter((j) => j.m.id === m.id);
        const md = mj.filter((j) => state.results[j.key]).length;
        const run = proc.running && proc.running.pair.sc.id === sc.id && proc.running.m.id === m.id;
        const mli = document.createElement("li");
        mli.className = md === mj.length ? "done" : run ? "run" : "";
        mli.textContent = `${m.name} ${md}/${mj.length}`;
        ms.append(mli);
      }
      li.append(bar, ms);
    } else {
      const p = document.createElement("p");
      p.className = "prow-note";
      const missing = KINDS[sc.kind].shots.filter((s) => shotState(sc, s.code) !== "taken").map((s) => s.code);
      p.textContent = !sceneComplete(sc)
        ? `Starts when ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} taken or skipped.`
        : "No pair left to measure: photos were skipped.";
      li.append(p);
    }
    ul.append(li);
  }

  const choice = $("choice");
  choice.hidden = !pend;
  for (const b of choice.querySelectorAll("[data-choice]"))
    b.setAttribute("aria-checked", String(b.dataset.choice === state.choice));
  $("choice-now-sub").textContent = `${done} of ${allJobs} results go in now. The rest is measured on the PC later.`;
  $("choice-wait-sub").textContent = `${etaText(left)} more. The download wakes up by itself when it is done.`;

  const dl = $("download");
  dl.classList.remove("waiting");
  const fresh = state.zipResults >= 0 && state.zipResults === done && !pend;
  if (ui.busy) {
    $("dl-label").textContent = "Packing the zip...";
    $("dl-sub").textContent = "";
    dl.disabled = true;
  } else if (pend && state.choice === "wait") {
    $("dl-label").textContent = "Waiting for the rest";
    $("dl-sub").textContent = `${etaText(left)} left, then it is ready`;
    dl.disabled = true;
    // The waiting button doubles as the progress bar of everything still measuring.
    dl.classList.add("waiting");
    dl.style.setProperty("--p", `${Math.round((100 * done) / Math.max(1, allJobs))}%`);
  } else {
    const again = state.zipResults >= 0;
    $("dl-label").textContent = fresh ? "Download again" : again ? "Download the new zip" : pend ? "Make the zip now" : "Download the zip";
    $("dl-sub").textContent = `${taken} photos, ${done} results, about ${mb(estimateBytes())}`;
    dl.disabled = taken === 0;
  }
  $("trust-text").textContent = `Saved on this phone: ${taken} photo${taken === 1 ? "" : "s"}, the log and ${done} result${done === 1 ? "" : "s"}. A reload continues right here; the zip can be made any time.`;

  const miss = $("end-missing");
  miss.hidden = !open.length;
  if (open.length) {
    $("missing-hint").textContent = "Optional. Tap one to take it now; the end view comes back after it.";
    const row = $("missing-list");
    row.textContent = "";
    for (const o of open) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "secondary";
      b.textContent = `${o.code}${o.sc.kind === "light" && state.spots > 1 ? " (" + sceneShort(o.sc) + ")" : ""}${o.st === "skipped" ? ", skipped" : ""}`;
      b.addEventListener("click", () => tapThumb(o.sc, o.code));
      row.append(b);
    }
  }
}
function renderProgress() {
  if (state.screen === "run") updateBadges();
  if (state.screen === "end" && !ui.busy) renderEnd();
}
setInterval(() => {
  if (proc.running) renderProgress();
}, 700);

function renderMenu() {
  const t = target();
  const sc = t && sceneById(t.scene);
  const skip = document.querySelector('[data-act="skip-scene"]');
  skip.hidden = !sc || state.screen !== "run" || sceneComplete(sc);
  if (sc) $("skip-scene-label").textContent = `Skip ${sceneName(sc)}`;
  document.querySelector('[data-act="own"]').hidden = state.own;
  document.querySelector('[data-act="finish"]').hidden = state.screen === "end";
}

/* ---------------- wiring ---------------- */

for (const b of document.querySelectorAll("[data-spots]")) {
  b.addEventListener("click", () => {
    state.spots = Number(b.dataset.spots);
    save();
    render();
  });
}
for (const b of document.querySelectorAll("[data-countdown]")) {
  b.addEventListener("click", () => {
    state.settings.countdown = Number(b.dataset.countdown);
    save();
    render();
  });
}
for (const b of document.querySelectorAll("[data-choice]")) {
  b.addEventListener("click", () => {
    state.choice = b.dataset.choice;
    save();
    renderEnd();
  });
}
$("intro-start").addEventListener("click", () => {
  state.started = true;
  log(`run: light scene at ${state.spots} place(s), ${totalShots()} photos`);
  ensureCur();
  show(state.cur ? "run" : "end");
});
$("open-menu").addEventListener("click", () => {
  cancelCount("menu opened");
  ui.menu = true;
  render();
});
$("end-menu").addEventListener("click", () => {
  ui.menu = true;
  render();
});
$("close-menu").addEventListener("click", () => {
  ui.menu = false;
  render();
});
$("sheet-menu").addEventListener("click", (e) => {
  if (e.target === $("sheet-menu")) {
    ui.menu = false;
    render();
  }
});
document.querySelector(".menu-list").parentElement.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "cockpit") {
    ui.menu = false;
    render();
    toast("In the app, this opens the cockpit view: every photo and pair in one table.", 3600);
  } else if (act === "own") {
    state.own = true;
    state.cur = { scene: "own", code: "X1" };
    state.retake = state.warn = null;
    ui.menu = false;
    log("run: own pair added");
    show("run");
  } else if (act === "skip-scene") {
    const sc = sceneById(target().scene);
    ui.menu = false;
    skipScene(sc);
  } else if (act === "finish") {
    ui.menu = false;
    show("end");
  } else if (act === "help") {
    ui.menu = false;
    show("intro");
  } else if (act === "copy-log") {
    const st = $("copy-log-state");
    try {
      await navigator.clipboard.writeText(logLines.join("\n"));
      st.textContent = "Copied";
    } catch {
      st.textContent = "Copy refused by the browser";
    }
  } else if (act === "reload") {
    save();
    log("run: simulated reload");
    try {
      sessionStorage.setItem("fm3-reloaded", "1");
    } catch {
      /* fine without it */
    }
    location.reload();
  } else if (act === "reset") {
    if (!confirm("Delete every photo on this phone and start again? Make the zip first if you want to keep them.")) return;
    clearTimeout(proc.timer);
    proc.running = null;
    await clearShots();
    state = freshState();
    save();
    ui.menu = false;
    log(`run: started over, session ${state.session}`);
    show("intro");
  }
});
$("sound").addEventListener("change", (e) => {
  state.settings.sound = e.target.checked;
  save();
});
$("sim-room").addEventListener("change", (e) => {
  state.settings.simRoom = e.target.checked;
  save();
});
$("primary").addEventListener("click", tapPrimary);
$("secondary").addEventListener("click", tapSecondary);
$("ghost-toggle").addEventListener("click", () => {
  ui.ghost = !ui.ghost;
  render();
});
$("download").addEventListener("click", downloadZip);
$("end-back").addEventListener("click", () => {
  state.retake = state.warn = null;
  ensureCur();
  show("run");
});
addEventListener("pagehide", stopCamera);
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ui.menu) {
    ui.menu = false;
    render();
  }
});

/* ---------------- start: resume where the run was ---------------- */

(async () => {
  let reloaded = false;
  try {
    reloaded = sessionStorage.getItem("fm3-reloaded") === "1";
    sessionStorage.removeItem("fm3-reloaded");
  } catch {
    /* fine */
  }
  await loadAllUrls();
  const n = takenCount();
  if (state.started && n) {
    const r = resultCount();
    log(`run: resumed with ${n} photos, ${r} results`);
    toast(
      `${reloaded ? "Reloaded. " : ""}Picked up where you left off: ${n} photo${n > 1 ? "s" : ""} and ${r} result${r === 1 ? "" : "s"} were safe on this phone.`,
      4200,
    );
  }
  show(state.started ? (state.screen === "intro" ? "run" : state.screen) : "intro");
  pump();
})();

// Prototype hooks for the screenshot script.
window.__proto = {
  state: () => state,
  ui,
  render,
  show,
  speed: (k) => (speed = k),
  shoot: async () => {
    const t = target();
    if (t) await capture(t);
  },
  thumb: (sceneId, code) => tapThumb(sceneById(sceneId), code),
  menu: (on) => {
    ui.menu = on;
    render();
  },
};
