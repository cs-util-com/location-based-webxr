// Throwaway prototype: the guided matcher run. Not wired to the app; the
// matcher run is faked. Photos are real canvas captures (live camera or a
// drawn stand-in) kept in IndexedDB, so a reload keeps them.
"use strict";

const STORE_KEY = "fm2-guided-v1";
const MAX_LONG_EDGE = 1280;

/** The protocol's pairs, with plain-word instructions and a diagram kind. */
const PAIRS = {
  "1a": {
    purpose: "How many matches survive when nothing changes.",
    label: "light: control (same light)",
    title: "Same light twice",
    a: "Stand the phone on a table or shelf, aimed at a detailed part of the room.",
    change: "Change nothing.",
    b: "Capture again.",
    avoid: "Moving the phone, changing the light.",
    diagram: "light-same",
  },
  "1b": {
    purpose: "Does a method still match when the light gets weaker?",
    label: "light: dimmed",
    title: "Weaker light",
    a: "Light ON as normal.",
    change: "Dim the light: main light off, one small lamp on. Wait 2 seconds.",
    b: "Capture without moving the phone.",
    avoid: "Dimming before photo A.",
    diagram: "light-dim",
  },
  "1c": {
    purpose: "Does a method still match with very little light?",
    label: "light: dark, not black",
    title: "Very little light",
    a: "Light ON as normal.",
    change: "Dim as far as you can while the shapes still show on the screen.",
    b: "Capture without moving the phone.",
    avoid: "Dimming before A, a fully black picture.",
    diagram: "light-dark",
  },
  "2a": {
    purpose: "The baseline for the turning tests.",
    label: "rotation: control (both upright)",
    title: "Upright twice",
    a: "About 1.5 m from a flat surface with detail (poster, patterned door). Phone upright.",
    change: "Nothing. Same place, upright again. Holding by hand is fine.",
    b: "Capture again.",
    avoid: "A deep scene: use a flat surface.",
    diagram: "rot-0",
  },
  "2b": {
    purpose: "Does a method cope with a quarter turn?",
    label: "rotation: 90 deg",
    title: "Quarter turn",
    a: "Same flat surface, same place. Phone upright.",
    change: "Turn the phone sideways (either way), aim at the same centre.",
    b: "Capture sideways.",
    avoid: "Stepping closer or away.",
    diagram: "rot-90",
  },
  "2c": {
    purpose: "Does a method cope with a half turn?",
    label: "rotation: 180 deg",
    title: "Half turn",
    a: "Same flat surface, same place. Phone upright.",
    change: "Hold the phone upside down, aim at the same centre.",
    b: "Capture upside down.",
    avoid: "Stepping closer or away.",
    diagram: "rot-180",
  },
  "2d": {
    purpose: "Does a method cope with a slight tilt?",
    label: "rotation: tilted 30-45 deg",
    title: "Slight tilt",
    a: "Same flat surface, same place. Phone upright.",
    change: "Tilt the phone 30-45 deg, like a clock hand at one o'clock.",
    b: "Capture tilted.",
    avoid: "Stepping closer or away.",
    diagram: "rot-35",
  },
  "3a": {
    purpose: "The baseline for the distance tests.",
    label: "distance: control (both 1.5 m)",
    title: "Same distance twice",
    a: "1.5 m from the flat surface.",
    change: "Stay where you are.",
    b: "Capture again.",
    avoid: "Moving between A and B.",
    diagram: "dist-same",
  },
  "3b": {
    purpose: "Does a method match the same thing at half the size?",
    label: "distance: 1.5 m to 3 m",
    title: "Half the size",
    a: "1.5 m from the flat surface.",
    change: "Step straight back to about 3 m, keep it centred.",
    b: "Capture from 3 m.",
    avoid: "Zooming instead of stepping back.",
    diagram: "dist-2x",
  },
  "3c": {
    purpose: "Does a method match the same thing at a third of the size?",
    label: "distance: 1 m to 3 m",
    title: "A third of the size",
    a: "1 m from the flat surface.",
    change: "Step straight back to about 3 m, keep it centred.",
    b: "Capture from 3 m.",
    avoid: "Zooming instead of stepping back.",
    diagram: "dist-3x",
  },
  "4a": {
    purpose: "The baseline for the side step on a flat surface.",
    label: "side step, flat: control",
    title: "Flat surface, same spot",
    a: "Aim at the flat surface from one place.",
    change: "Stay where you are.",
    b: "Capture again.",
    avoid: "Moving between A and B.",
    diagram: "side-same-flat",
  },
  "4b": {
    purpose: "Does a method match after a change of viewpoint?",
    label: "side step, flat: 1 m",
    title: "Flat surface, step aside",
    a: "Aim at the flat surface.",
    change:
      "Step about 1 m to the side, parallel to it. Aim at the same centre.",
    b: "Capture from the new place.",
    avoid: "Stepping closer or away.",
    diagram: "side-flat",
  },
  "4c": {
    purpose: "The baseline for a scene with depth.",
    label: "side step, deep: control",
    title: "Deep scene, same spot",
    a: "Aim into a hallway or a deep room, things near and far.",
    change: "Stay where you are.",
    b: "Capture again.",
    avoid: "Anything moving: people, pets, a TV.",
    diagram: "side-same-deep",
  },
  "4d": {
    purpose: "Does a method match a deep scene after a change of viewpoint?",
    label: "side step, deep: 1 m",
    title: "Deep scene, step aside",
    a: "Aim into the deep scene.",
    change: "Step about 1 m to the side. Aim at the same centre.",
    b: "Capture from the new place.",
    avoid: "Anything moving: people, pets, a TV.",
    diagram: "side-deep",
  },
  x: {
    purpose: "Anything not in the list; the file name says other.",
    label: "other",
    title: "Your own pair",
    a: "Anything you want to test.",
    change: "Change one thing.",
    b: "Capture.",
    avoid: "Anything personal in the picture.",
    diagram: "other",
  },
};
const AFTER_LIGHT = [
  "2a",
  "2b",
  "2c",
  "2d",
  "3a",
  "3b",
  "3c",
  "4a",
  "4b",
  "4c",
  "4d",
];

/* ---------------- state (persisted) ---------------- */

function freshState() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return {
    v: 1,
    session: [...b].map((x) => x.toString(16).padStart(2, "0")).join(""),
    spots: 1,
    started: false,
    cur: 0,
    nextSeq: 1,
    extra: 0,
    slots: {},
    settings: { countdown: 3, sound: true },
    downloads: 0,
  };
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (s && s.v === 1 && typeof s.session === "string") return s;
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

/** The run's slot list: the light pairs per spot, then the rest, then extras. */
function slotList() {
  const out = [];
  for (let s = 1; s <= state.spots; s++) {
    for (const k of ["1a", "1b", "1c"])
      out.push({ id: `${k}-s${s}`, key: k, spot: s });
  }
  for (const k of AFTER_LIGHT) out.push({ id: `${k}-s1`, key: k, spot: 1 });
  for (let i = 1; i <= state.extra; i++)
    out.push({ id: `x${i}-s1`, key: "x", spot: 1 });
  return out;
}
function slotData(id) {
  if (!state.slots[id]) {
    state.slots[id] = {
      seq: 0,
      a: null,
      b: null,
      light: null,
      downloaded: false,
    };
  }
  return state.slots[id];
}
function slotStatus(id) {
  const d = state.slots[id];
  if (!d || (!d.a && !d.b)) return "missing";
  if (d.a && d.b) return d.light && d.light !== "ok" ? "retake" : "done";
  return "half";
}
function doneCount() {
  return slotList().filter(
    (s) => slotStatus(s.id) === "done" || slotStatus(s.id) === "retake",
  ).length;
}

/* ---------------- photo storage (IndexedDB, memory fallback) ---------------- */

const mem = new Map();
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const r = indexedDB.open("fm2-guided", 1);
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
  const d = await db();
  if (!d) return;
  await new Promise((res) => {
    const tx = d.transaction("shots", "readwrite");
    tx.objectStore("shots").clear();
    tx.oncomplete = res;
    tx.onerror = res;
  });
}
const urls = new Map();
async function shotUrl(key) {
  const blob = await getShot(key);
  if (!blob) return "";
  const old = urls.get(key);
  if (old && old.blob === blob) return old.url;
  if (old) URL.revokeObjectURL(old.url);
  const url = URL.createObjectURL(blob);
  urls.set(key, { blob, url });
  return url;
}

/* ---------------- log ---------------- */

const logLines = [];
function log(line) {
  logLines.push(line);
  if (logLines.length > 500) logLines.shift();
}
log(`page: guided run, session ${state.session}`);

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

/* ---------------- camera (live or drawn stand-in) ---------------- */

const $ = (id) => document.getElementById(id);
const video = $("video");
const fake = $("fake");
let stream = null;
let fakeOn = false;
let fakeDim = 1;
let fakeScene = null;

async function startCamera() {
  if (stream || fakeOn) return;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("no camera API");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    video.hidden = false;
    fake.hidden = true;
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
function startFake() {
  fakeOn = true;
  fake.hidden = false;
  video.hidden = true;
  const portrait = innerHeight > innerWidth;
  fake.width = portrait ? 960 : 1280;
  fake.height = portrait ? 1280 : 960;
  fakeScene = drawScene(fake.width, fake.height);
  const ctx = fake.getContext("2d");
  let t = 0;
  const tick = () => {
    t++;
    ctx.filter = `brightness(${fakeDim})`;
    ctx.drawImage(fakeScene, 0, 0);
    ctx.filter = "none";
    // a little sensor grain so it reads as live
    ctx.fillStyle = `rgba(255,255,255,${0.02 + 0.02 * Math.sin(t / 7)})`;
    ctx.fillRect(0, 0, fake.width, fake.height);
    requestAnimationFrame(tick);
  };
  tick();
}
/** A made-up room corner: shelves, books, a patterned rug, a framed poster. */
function drawScene(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = "#7d7466";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#5a4c3c";
  g.fillRect(0, h * 0.72, w, h * 0.28);
  // rug pattern
  for (let y = h * 0.76; y < h; y += 26) {
    for (let x = (y / 26) % 2 ? 0 : 13; x < w; x += 26) {
      g.fillStyle = ["#9a3b2f", "#d6b56a", "#2f4f6a"][Math.floor(rnd() * 3)];
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 13, y + 13);
      g.lineTo(x, y + 26);
      g.lineTo(x - 13, y + 13);
      g.fill();
    }
  }
  // shelf with books
  const sx = w * 0.06;
  const sw = w * 0.42;
  for (let r = 0; r < 4; r++) {
    const sy = h * 0.12 + r * h * 0.14;
    g.fillStyle = "#3b2a1c";
    g.fillRect(sx, sy + h * 0.12, sw, h * 0.018);
    let x = sx + 6;
    while (x < sx + sw - 20) {
      const bw = 10 + rnd() * 22;
      const bh = h * (0.07 + rnd() * 0.05);
      g.fillStyle = `hsl(${Math.floor(rnd() * 360)} ${30 + rnd() * 40}% ${25 + rnd() * 35}%)`;
      g.fillRect(x, sy + h * 0.12 - bh, bw, bh);
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(x + 2, sy + h * 0.12 - bh + 8, bw - 4, 3);
      x += bw + 2;
    }
  }
  // framed poster with shapes
  const px = w * 0.56;
  const py = h * 0.1;
  const pw = w * 0.36;
  const ph = h * 0.42;
  g.fillStyle = "#1e1b18";
  g.fillRect(px - 10, py - 10, pw + 20, ph + 20);
  g.fillStyle = "#e9e2d0";
  g.fillRect(px, py, pw, ph);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `hsl(${Math.floor(rnd() * 360)} 55% 45%)`;
    g.beginPath();
    g.arc(px + rnd() * pw, py + rnd() * ph, 4 + rnd() * 22, 0, Math.PI * 2);
    g.fill();
  }
  // a plant pot and a lamp
  g.fillStyle = "#b8643a";
  g.fillRect(w * 0.66, h * 0.6, w * 0.08, h * 0.12);
  g.fillStyle = "#3f6b3a";
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.ellipse(
      w * 0.7 + (rnd() - 0.5) * w * 0.1,
      h * 0.56 - rnd() * h * 0.1,
      10,
      26,
      rnd() * 3,
      0,
      Math.PI * 2,
    );
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
  const g = c.getContext("2d");
  g.drawImage(src, 0, 0, w, h);
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

/** Same rules as today's page: B must be darker for the dimmed pairs, equal for the control. */
function lightCheck(key, a, b) {
  if (key === "1b" || key === "1c") {
    if (a < 10) return "too-dark-a";
    if (b < 3) return "too-dark-b";
    return b > 0.8 * a ? "not-darker" : "ok";
  }
  if (key === "1a") {
    const tol = a < 10 ? 3 : 0.2 * a;
    return Math.abs(b - a) > tol ? "changed" : "ok";
  }
  return null;
}
const LIGHT_TEXT = {
  ok: "Light check: ok.",
  "not-darker":
    "Photo B is not darker than A. Turn the light on, retake A, dim, then retake B.",
  "too-dark-a": "Photo A is almost black. Turn the light on and retake A.",
  "too-dark-b":
    "Photo B is black: nothing to match. Dim a little less and retake B.",
  changed:
    "The light changed during the control pair. Retake B with the same light.",
};

/* ---------------- the step machine ---------------- */

const ui = {
  screen: "intro",
  sheet: null,
  counting: null, // { left, shot, timer }
  retake: null, // "A" | "B" | null
  ghost: false,
  busy: false,
};

function current() {
  const list = slotList();
  state.cur = Math.max(0, Math.min(state.cur, list.length - 1));
  return list[state.cur];
}
/** Which shot the primary button takes now, or null when the pair is complete. */
function shotNow() {
  const s = current();
  const d = slotData(s.id);
  if (ui.retake) return ui.retake;
  if (!d.a) return "A";
  if (!d.b) return "B";
  return null;
}

function tapPrimary() {
  if (ui.busy) return;
  if (ui.counting) {
    cancelCount("cancelled");
    return;
  }
  const shot = shotNow();
  if (shot) {
    beginCount(shot);
    return;
  }
  // pair complete: next pair, or the end screen after the last
  const list = slotList();
  const next = list.findIndex(
    (s, i) => i > state.cur && slotStatus(s.id) !== "done",
  );
  const firstMissing = list.findIndex(
    (s) => slotStatus(s.id) === "missing" || slotStatus(s.id) === "half",
  );
  if (next >= 0) state.cur = next;
  else if (firstMissing >= 0 && firstMissing !== state.cur)
    state.cur = firstMissing;
  else {
    show("end");
    return;
  }
  ui.retake = null;
  ui.ghost = false;
  save();
  log(`next pair: ${current().id}`);
  render();
}

function beginCount(shot) {
  const secs = state.settings.countdown;
  buzz(30);
  if (!secs) {
    capture(shot);
    return;
  }
  ui.counting = { left: secs, shot, timer: 0 };
  beep(660, 90);
  ui.counting.timer = setInterval(() => {
    if (!ui.counting) return;
    ui.counting.left -= 1;
    if (ui.counting.left <= 0) {
      clearInterval(ui.counting.timer);
      ui.counting = null;
      capture(shot);
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

async function capture(shot) {
  const s = current();
  const d = slotData(s.id);
  ui.busy = true;
  render();
  try {
    const f = await grabFrame();
    beep(1320, 60);
    $("flash").hidden = false;
    setTimeout(() => ($("flash").hidden = true), 360);
    // A retake after a download is a new take: a new running number, so the
    // saved files never share a name with the new ones.
    if (!d.seq || d.downloaded) {
      d.seq = state.nextSeq++;
      d.downloaded = false;
    }
    await putShot(`${s.id}:${shot}`, f.blob);
    d[shot.toLowerCase()] = {
      w: f.w,
      h: f.h,
      mean: f.mean,
      bytes: f.blob.size,
    };
    d.light = d.a && d.b ? lightCheck(s.key, d.a.mean, d.b.mean) : null;
    log(
      `photo ${shot}: ${s.id} #${d.seq} ${f.w}x${f.h} grey mean ${f.mean}${moving ? " (phone moved during countdown)" : ""}`,
    );
    if (d.light) log(`light check ${s.id}: ${d.light}`);
    ui.retake = null;
    if (shot === "A") ui.ghost = false;
    save();
  } catch (e) {
    log(`ERROR capture: ${e.message || e}`);
  } finally {
    ui.busy = false;
    render();
  }
}

function tapSlot(shot) {
  if (ui.counting || ui.busy) return;
  const d = slotData(current().id);
  const has = shot === "A" ? d.a : d.b;
  if (!has) return;
  ui.retake = ui.retake === shot ? null : shot;
  render();
}

/* ---------------- motion: a steady hint where the sensor exists ---------------- */

let moving = false;
let motionSeen = false;
let motionLevel = 0;
addEventListener("devicemotion", (ev) => {
  const r = ev.rotationRate;
  if (!r || (r.alpha == null && r.beta == null && r.gamma == null)) return;
  motionSeen = true;
  const m =
    Math.abs(r.alpha || 0) + Math.abs(r.beta || 0) + Math.abs(r.gamma || 0);
  motionLevel = motionLevel * 0.8 + m * 0.2;
  const was = moving;
  moving = motionLevel > 6;
  if (was !== moving || $("steady").hidden) renderSteady();
});
function renderSteady() {
  const el = $("steady");
  el.hidden = !motionSeen || ui.screen !== "run" || !$("review").hidden;
  el.textContent = moving ? "phone moving" : "steady";
  el.classList.toggle("moving", moving);
}

/* ---------------- download: one zip ---------------- */

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function baseName(s, d) {
  return `feature-match-${String(d.seq).padStart(2, "0")}-${s.key}-s${s.spot}-${slug(PAIRS[s.key].label)}`;
}
function frameJson(s, d) {
  return JSON.stringify(
    {
      format: "feature-match-frames/1",
      pair: s.key,
      pairLabel: PAIRS[s.key].label,
      spot: s.spot,
      sequence: d.seq,
      session: state.session,
      lightCheck: d.light,
      captureMaxLongEdge: MAX_LONG_EDGE,
      frames: ["a", "b"].map((k) => ({
        name: k.toUpperCase(),
        file: `${baseName(s, d)}-frame-${k}.png`,
        width: d[k].w,
        height: d[k].h,
        greyMean: d[k].mean,
      })),
      device: deviceLine(),
    },
    null,
    2,
  );
}
function deviceLine() {
  const ua = navigator.userAgent;
  const android = /Android ([\d.]+)/.exec(ua);
  const chrome = /Chrome\/(\d+)/.exec(ua);
  return `${android ? "Android " + android[1] : navigator.platform || "unknown OS"}, ${chrome ? "Chrome " + chrome[1] : "browser"}, ${navigator.hardwareConcurrency || "-"} cores`;
}
function zipName() {
  return `feature-match-run-${state.session}.zip`;
}
function estimateBytes() {
  let n = 0;
  for (const s of slotList()) {
    const d = state.slots[s.id];
    if (d && d.a) n += d.a.bytes || 0;
    if (d && d.b) n += d.b.bytes || 0;
  }
  return n;
}
function mb(n) {
  return n < 1e6
    ? `${Math.max(1, Math.round(n / 1e3))} KB`
    : `${(n / 1e6).toFixed(1)} MB`;
}

async function downloadAll() {
  if (ui.busy) return;
  const btn = $("download-all");
  const st = $("download-state");
  ui.busy = true;
  btn.disabled = true;
  btn.textContent = "Preparing the zip...";
  st.className = "state";
  st.textContent = "Packing the photos. Keep this page open.";
  const enc = new TextEncoder();
  try {
    const entries = [];
    const done = [];
    for (const s of slotList()) {
      const d = state.slots[s.id];
      if (!d || !d.a || !d.b) continue;
      const base = baseName(s, d);
      for (const k of ["A", "B"]) {
        const blob = await getShot(`${s.id}:${k}`);
        if (!blob)
          throw new Error(`photo ${k} of ${s.id} is missing from storage`);
        entries.push({
          name: `${base}-frame-${k.toLowerCase()}.png`,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        });
      }
      entries.push({
        name: `${base}-frames.json`,
        bytes: enc.encode(frameJson(s, d)),
      });
      done.push(d);
    }
    if (!entries.length) throw new Error("no complete pair yet");
    log(`download: ${done.length} pairs as ${zipName()}`);
    entries.push({
      name: "feature-match-summary.txt",
      bytes: enc.encode(summaryText()),
    });
    entries.push({
      name: "feature-match-log.txt",
      bytes: enc.encode(logLines.join("\n") + "\n"),
    });
    const zip = storeZip(entries);
    const url = URL.createObjectURL(zip);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    done.forEach((d) => (d.downloaded = true));
    state.downloads++;
    save();
    btn.textContent = "Download again";
    st.className = "state ok";
    st.textContent = `Saved ${zipName()} (${mb(zip.size)}) to Downloads. Send this file.`;
  } catch (e) {
    log(`ERROR download: ${e.message || e}`);
    btn.textContent = "Download all";
    st.className = "state err";
    st.textContent = `Could not prepare the zip: ${e.message || e}. Nothing was lost; try again.`;
  } finally {
    ui.busy = false;
    btn.disabled = false;
    $("summary").value = summaryText();
  }
}

function summaryText() {
  const list = slotList();
  const complete = list.filter(
    (s) => state.slots[s.id] && state.slots[s.id].a && state.slots[s.id].b,
  );
  const light = list
    .filter((s) => state.slots[s.id] && state.slots[s.id].light)
    .map((s) => `${s.id} ${state.slots[s.id].light}`);
  const missing = list.filter((s) => !complete.includes(s)).map((s) => s.id);
  const retakes =
    logLines.filter((l) => /^photo [AB]:/.test(l)).length - complete.length * 2;
  return [
    "Feature matcher photo test - summary",
    `Session: ${state.session}`,
    `Pairs complete: ${complete.length} of ${list.length} (light tests at ${state.spots} place${state.spots > 1 ? "s" : ""})`,
    `Missing: ${missing.length ? missing.join(", ") : "none"}`,
    `Light checks: ${light.length ? light.join(", ") : "-"}`,
    `Extra shots (retakes): ${Math.max(0, retakes)}`,
    `File: ${zipName()}${state.downloads ? "" : " (not downloaded yet)"}`,
    `Phone: ${deviceLine()}`,
    "No location, no time and no names are included.",
  ].join("\n");
}

async function copyText(text, stateEl) {
  try {
    await navigator.clipboard.writeText(text);
    stateEl.textContent = "copied";
  } catch {
    stateEl.textContent = "copy refused: select the text and copy by hand";
  }
}

/* ---------------- fake measurement (today's run, faked) ---------------- */

async function fakeMeasure(synthetic) {
  const st = $("measure-state");
  const rows = $("measure-rows");
  const done = slotList().filter(
    (s) => slotStatus(s.id) === "done" || slotStatus(s.id) === "retake",
  );
  if (!synthetic && !done.length) {
    st.textContent = "no complete pair yet";
    return;
  }
  $("measure-run").disabled = $("measure-synth").disabled = true;
  rows.textContent = "";
  const methods = [
    ["SIFT (js)", 95, 40, 310],
    ["XFeat webgpu fp16", 22, 6, 420],
    ["ALIKED + LightGlue webgpu", 61, 48, 380],
  ];
  for (const [i, m] of methods.entries()) {
    st.textContent = `running ${m[0]} (${i + 1}/3)...`;
    await new Promise((r) => setTimeout(r, 450));
    const tr = document.createElement("tr");
    const n = synthetic ? 1 : done.length;
    [
      m[0],
      synthetic ? "synthetic" : String(n),
      String(m[1]),
      String(m[2]),
      String(m[3]),
    ].forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    });
    rows.append(tr);
    log(
      `measure (fake): ${m[0]} extract ${m[1]} ms match ${m[2]} ms matches ${m[3]}`,
    );
  }
  st.textContent =
    "done (prototype numbers); the next Download all includes them";
  $("measure-run").disabled = $("measure-synth").disabled = false;
}

/* ---------------- diagrams ---------------- */

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
function panel(x, label, body, tint) {
  const col = label === "A" ? "var(--a)" : "var(--b)";
  return `<g transform="translate(${x} 0)">
    <rect x="1" y="1" width="128" height="98" rx="10" fill="${tint || "#14181c"}" stroke="#3a434c"/>
    ${body}
    <rect x="6" y="6" width="20" height="18" rx="4" fill="${col}"/>
    <text x="16" y="19.5" text-anchor="middle" font-size="12" font-weight="800" fill="#111">${label}</text>
  </g>`;
}
function caption(text) {
  return `<text x="65" y="92" text-anchor="middle" font-size="11" fill="#aab3bc">${text}</text>`;
}
function bulb(level) {
  const fill = ["#2a2a2a", "#7a6524", "#f2c14e"][level];
  const rays = level === 2 ? 8 : level === 1 ? 4 : 0;
  let r = "";
  for (let i = 0; i < rays; i++) {
    const t = (i / rays) * Math.PI * 2;
    r += `<line x1="${65 + Math.cos(t) * 16}" y1="${40 + Math.sin(t) * 16}" x2="${65 + Math.cos(t) * 24}" y2="${40 + Math.sin(t) * 24}" stroke="${fill}" stroke-width="3" stroke-linecap="round"/>`;
  }
  return `${r}<circle cx="65" cy="40" r="12" fill="${fill}" stroke="#555"/><rect x="60" y="51" width="10" height="7" rx="2" fill="#666"/>`;
}
function phone(angle) {
  return `<g transform="rotate(${angle} 65 44)">
    <rect x="51" y="20" width="28" height="48" rx="5" fill="#2a3138" stroke="#cfd6dc" stroke-width="2"/>
    <circle cx="65" cy="44" r="7" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <path d="M60 26 L65 21 L70 26" fill="none" stroke="#cfd6dc" stroke-width="2"/>
  </g>`;
}
function topView(px, py, deep) {
  const surf = deep
    ? `<line x1="20" y1="14" x2="110" y2="14" stroke="#cfd6dc" stroke-width="3"/>
       <rect x="28" y="26" width="16" height="10" fill="#4b5560"/><rect x="82" y="36" width="14" height="12" fill="#4b5560"/><rect x="58" y="48" width="12" height="8" fill="#4b5560"/>`
    : `<line x1="20" y1="14" x2="110" y2="14" stroke="#cfd6dc" stroke-width="3"/>`;
  return `${surf}
    <line x1="${px}" y1="${py}" x2="65" y2="14" stroke="var(--accent)" stroke-dasharray="3 3"/>
    <path d="M${px - 6} ${py + 6} L${px} ${py - 6} L${px + 6} ${py + 6} Z" fill="var(--accent)"/>`;
}
function distView(py, label) {
  return `<line x1="25" y1="14" x2="105" y2="14" stroke="#cfd6dc" stroke-width="3"/>
    <line x1="65" y1="${py}" x2="25" y2="14" stroke="var(--accent)" stroke-dasharray="3 3"/>
    <line x1="65" y1="${py}" x2="105" y2="14" stroke="var(--accent)" stroke-dasharray="3 3"/>
    <path d="M59 ${py + 6} L65 ${py - 6} L71 ${py + 6} Z" fill="var(--accent)"/>
    <text x="100" y="${Math.min(py + 4, 80)}" text-anchor="end" font-size="11" fill="#aab3bc">${label}</text>`;
}
function arrow(text) {
  return `<g transform="translate(130 0)">
    <path d="M8 50 H32 M26 44 L32 50 L26 56" fill="none" stroke="#aab3bc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="20" y="74" text-anchor="middle" font-size="10" fill="#7b858f">${text}</text>
  </g>`;
}
function diagram(kind) {
  let a = "";
  let b = "";
  let tintB = "";
  let mid = "then";
  switch (kind) {
    case "light-same":
      a = bulb(2) + caption("light on");
      b = bulb(2) + caption("same light");
      mid = "nothing";
      break;
    case "light-dim":
      a = bulb(2) + caption("light on");
      b = bulb(1) + caption("dimmed");
      tintB = "#0e1013";
      mid = "dim";
      break;
    case "light-dark":
      a = bulb(2) + caption("light on");
      b = bulb(0) + caption("very dim");
      tintB = "#08090a";
      mid = "dim";
      break;
    case "rot-0":
      a = phone(0) + caption("upright");
      b = phone(0) + caption("upright");
      mid = "nothing";
      break;
    case "rot-90":
      a = phone(0) + caption("upright");
      b = phone(90) + caption("sideways");
      mid = "turn";
      break;
    case "rot-180":
      a = phone(0) + caption("upright");
      b = phone(180) + caption("upside down");
      mid = "turn";
      break;
    case "rot-35":
      a = phone(0) + caption("upright");
      b = phone(35) + caption("tilted 30-45");
      mid = "tilt";
      break;
    case "dist-same":
      a = distView(54, "1.5 m");
      b = distView(54, "1.5 m");
      mid = "stay";
      break;
    case "dist-2x":
      a = distView(48, "1.5 m");
      b = distView(80, "3 m");
      mid = "step back";
      break;
    case "dist-3x":
      a = distView(36, "1 m");
      b = distView(80, "3 m");
      mid = "step back";
      break;
    case "side-same-flat":
      a = topView(65, 76, false) + caption("flat");
      b = topView(65, 76, false) + caption("same place");
      mid = "stay";
      break;
    case "side-flat":
      a = topView(45, 72, false) + caption("flat");
      b = topView(95, 72, false) + caption("1 m aside");
      mid = "step aside";
      break;
    case "side-same-deep":
      a = topView(65, 76, true) + caption("deep");
      b = topView(65, 76, true) + caption("same place");
      mid = "stay";
      break;
    case "side-deep":
      a = topView(45, 72, true) + caption("deep");
      b = topView(95, 72, true) + caption("1 m aside");
      mid = "step aside";
      break;
    default:
      a = caption("your scene");
      b = caption("one change");
  }
  return `<svg ${SVG_NS} viewBox="0 0 300 100" role="img">${panel(0, "A", a)}${arrow(mid)}${panel(170, "B", b, tintB)}</svg>`;
}

/* ---------------- rendering ---------------- */

function show(screen) {
  ui.screen = screen;
  if (screen === "run") startCamera();
  else stopCamera();
  render();
}

let renderGen = 0;
function render() {
  const gen = ++renderGen;
  $("screen-intro").hidden = ui.screen !== "intro";
  $("screen-run").hidden = ui.screen !== "run";
  $("screen-end").hidden = ui.screen !== "end";
  $("sheet-pairs").hidden = ui.sheet !== "pairs";
  $("sheet-measure").hidden = ui.sheet !== "measure";
  for (const b of document.querySelectorAll("[data-spots]")) {
    b.setAttribute(
      "aria-checked",
      String(Number(b.dataset.spots) === state.spots),
    );
    b.disabled = Object.keys(state.slots).length > 0;
  }
  $("intro-start").textContent = state.started
    ? "Continue where you left off"
    : "Start";
  for (const b of document.querySelectorAll("[data-countdown]")) {
    b.setAttribute(
      "aria-checked",
      String(Number(b.dataset.countdown) === state.settings.countdown),
    );
  }
  $("sound").checked = state.settings.sound;
  renderSteady();

  const list = slotList();
  const total = list.length;
  const done = doneCount();
  if (ui.screen === "run") renderRun(list, total, done, gen);
  if (ui.sheet === "pairs") renderPairs(list, done, total);
  if (ui.screen === "end") renderEnd(list, done, total);
}

function renderRun(list, total, done, gen) {
  const s = current();
  const p = PAIRS[s.key];
  const d = slotData(s.id);
  const shot = shotNow();
  $("head-pos").textContent = `Pair ${state.cur + 1} of ${total}`;
  $("card-place").textContent = s.key.startsWith("1") ? `place ${s.spot}` : "";
  $("card-purpose").textContent = p.purpose;
  $("head-bar").style.width = `${(100 * done) / total}%`;
  $("head-done").textContent = `${done}/${total}`;
  $("card-key").textContent = s.key;
  $("card-title").textContent = p.title;
  const chip = $("card-shot");
  chip.dataset.shot = shot || "done";
  chip.textContent = shot
    ? ui.retake
      ? `Retake ${shot}`
      : `Shot ${shot}`
    : "Check";
  const dg = $("card-diagram");
  if (dg.dataset.kind !== p.diagram) {
    dg.innerHTML = diagram(p.diagram);
    dg.dataset.kind = p.diagram;
  }
  $("seq-a-text").textContent = p.a;
  $("seq-change-text").textContent = p.change;
  $("seq-b-text").textContent = p.b;
  const nowPart =
    shot === "A"
      ? "A"
      : shot === "B"
        ? d.a && !ui.retake
          ? "change"
          : "B"
        : null;
  for (const [id, part] of [
    ["seq-a", "A"],
    ["seq-change", "change"],
    ["seq-b", "B"],
  ]) {
    const li = $(id);
    const isNow = part === nowPart || (nowPart === "change" && part === "B");
    li.classList.toggle("now", isNow);
    li.classList.toggle(
      "past",
      !isNow &&
        ((part === "A" && d.a) ||
          (part === "change" && d.b) ||
          (part === "B" && d.b)) &&
        !ui.retake,
    );
  }
  $("card-avoid").textContent = `Avoid: ${p.avoid}`;

  // viewfinder: live while a shot is due, the pair review once both exist
  const reviewing = !shot && !ui.counting;
  $("review").hidden = !reviewing;
  $("sim-chip").hidden = !fakeOn || reviewing;
  renderSteady();
  const gt = $("ghost-toggle");
  gt.hidden = !(shot === "B" && d.a);
  gt.setAttribute("aria-pressed", String(ui.ghost));
  if (reviewing) {
    const note = $("review-note");
    note.className = `review-note ${d.light && d.light !== "ok" ? "warn" : "ok"}`;
    note.textContent = d.light
      ? LIGHT_TEXT[d.light]
      : "Pair complete. Check both photos are sharp; tap A or B below to retake one.";
    Promise.all([shotUrl(`${s.id}:A`), shotUrl(`${s.id}:B`)]).then(
      ([ua, ub]) => {
        if (gen !== renderGen) return;
        $("review-a").src = ua;
        $("review-b").src = ub;
      },
    );
  }
  const ghost = $("ghost");
  if (ui.ghost && shot === "B" && d.a) {
    shotUrl(`${s.id}:A`).then((u) => gen === renderGen && (ghost.src = u));
    ghost.hidden = false;
  } else ghost.hidden = true;

  const count = $("count");
  count.hidden = !ui.counting;
  if (ui.counting) $("count-num").textContent = String(ui.counting.left);

  // slots: thumbnails and the retake toggle
  for (const k of ["A", "B"]) {
    const el = $(`slot-${k.toLowerCase()}`);
    const has = k === "A" ? d.a : d.b;
    el.dataset.filled = String(!!has);
    el.dataset.retaking = String(ui.retake === k);
    el.disabled = !has || !!ui.counting || ui.busy;
    el.querySelector(".slot-sub").textContent =
      ui.retake === k ? "retaking" : has ? "retake" : "empty";
    const img = el.querySelector("img");
    if (has) {
      shotUrl(`${s.id}:${k}`).then((u) => {
        if (gen !== renderGen) return;
        img.src = u;
        img.hidden = false;
      });
    } else img.hidden = true;
  }

  const btn = $("primary");
  btn.classList.toggle("counting", !!ui.counting);
  btn.classList.toggle("next", !shot && !ui.counting);
  btn.disabled = ui.busy;
  const secs = state.settings.countdown;
  if (ui.counting) {
    $("primary-label").textContent = "Cancel";
    $("primary-sub").textContent =
      `shooting ${ui.counting.shot} in ${ui.counting.left} s`;
  } else if (shot) {
    $("primary-label").textContent = ui.retake
      ? `Retake ${shot}`
      : `Capture ${shot}`;
    $("primary-sub").textContent = secs
      ? `then ${secs} s hands off`
      : "shoots at once";
  } else {
    const nextIdx = list.findIndex(
      (x, i) => i > state.cur && slotStatus(x.id) !== "done",
    );
    const anyOpen = list.some(
      (x) => slotStatus(x.id) === "missing" || slotStatus(x.id) === "half",
    );
    if (nextIdx >= 0) {
      $("primary-label").textContent = "Next pair";
      $("primary-sub").textContent =
        `${list[nextIdx].key}: ${PAIRS[list[nextIdx].key].title}`;
      if (d.light && d.light !== "ok")
        $("primary-sub").textContent = "or tap A or B to retake first";
    } else if (anyOpen) {
      $("primary-label").textContent = "Next missing pair";
      $("primary-sub").textContent = "some pairs are not done yet";
    } else {
      $("primary-label").textContent = "Finish";
      $("primary-sub").textContent = "all pairs done: download";
    }
  }
}

function renderPairs(list, done, total) {
  $("pairs-count").textContent = `${done} of ${total} done`;
  const grid = $("pair-grid");
  grid.textContent = "";
  list.forEach((s, i) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const st = slotStatus(s.id);
    if (i === state.cur && ui.screen === "run")
      b.setAttribute("aria-current", "step");
    b.innerHTML = `<i class="dot ${st}"></i><b></b><small></small>`;
    b.querySelector("b").textContent = s.key.startsWith("1")
      ? `${s.key} place ${s.spot}`
      : s.key;
    b.querySelector("small").textContent =
      `${PAIRS[s.key].title} - ${{ done: "done", half: "A only", retake: "retake suggested", missing: "missing" }[st]}`;
    b.addEventListener("click", () => {
      state.cur = i;
      ui.retake = null;
      ui.sheet = null;
      save();
      show("run");
    });
    li.append(b);
    grid.append(li);
  });
  $("fake-dim").checked = fakeDim < 1;
}

function renderEnd(list, done, total) {
  const all = done === total;
  $("end-kicker").textContent = all
    ? "All pairs captured"
    : `${done} of ${total} pairs captured`;
  $("end-title").textContent = all
    ? "Thank you. One last step."
    : "You can send what you have.";
  $("end-lede").textContent = all
    ? "Download the zip, then send it together with the summary below."
    : "Only complete pairs go into the zip. Go back to the pairs any time to add the rest.";
  if (!ui.busy && !$("download-state").classList.contains("ok")) {
    $("download-state").textContent =
      `One zip with ${done} pair${done === 1 ? "" : "s"}, about ${mb(estimateBytes())}, saved to this phone only.`;
  }
  $("download-all").disabled = done === 0 || ui.busy;
  $("summary").value = summaryText();
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
$("intro-start").addEventListener("click", () => {
  state.started = true;
  save();
  log(
    `run: light tests at ${state.spots} place(s), ${slotList().length} pairs`,
  );
  show("run");
});
$("open-help").addEventListener("click", () => show("intro"));
$("open-pairs").addEventListener("click", () => {
  cancelCount("pairs opened");
  ui.sheet = "pairs";
  render();
});
$("close-pairs").addEventListener("click", () => {
  ui.sheet = null;
  render();
});
$("primary").addEventListener("click", tapPrimary);
$("slot-a").addEventListener("click", () => tapSlot("A"));
$("slot-b").addEventListener("click", () => tapSlot("B"));
$("ghost-toggle").addEventListener("click", () => {
  ui.ghost = !ui.ghost;
  render();
});
$("sound").addEventListener("change", (e) => {
  state.settings.sound = e.target.checked;
  save();
});
$("fake-dim").addEventListener("change", (e) => {
  fakeDim = e.target.checked ? 0.4 : 1;
});
$("add-other").addEventListener("click", () => {
  state.extra++;
  state.cur = slotList().length - 1;
  ui.sheet = null;
  save();
  show("run");
});
$("go-end").addEventListener("click", () => {
  ui.sheet = null;
  show("end");
});
$("start-over").addEventListener("click", async () => {
  if (
    !confirm(
      "Delete every photo on this phone and start again? Download first if you want to keep them.",
    )
  )
    return;
  await clearShots();
  state = freshState();
  save();
  ui.sheet = null;
  log(`run: started over, session ${state.session}`);
  show("intro");
});
$("download-all").addEventListener("click", downloadAll);
$("copy-summary").addEventListener("click", () =>
  copyText(summaryText(), $("copy-summary-state")),
);
$("copy-log").addEventListener("click", () =>
  copyText(logLines.join("\n"), $("copy-log-state")),
);
$("end-back").addEventListener("click", () => show("run"));
$("open-measure").addEventListener("click", () => {
  ui.sheet = "measure";
  render();
});
$("close-measure").addEventListener("click", () => {
  ui.sheet = null;
  render();
});
$("measure-run").addEventListener("click", () => fakeMeasure(false));
$("measure-synth").addEventListener("click", () => fakeMeasure(true));
addEventListener("pagehide", stopCamera);
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ui.sheet) {
    ui.sheet = null;
    render();
  }
});

// Start on the intro the first time, straight into the run on later visits.
show(state.started ? "run" : "intro");

// Prototype hook for the screenshot script.
window.__proto = {
  state: () => state,
  ui,
  show,
  render,
  capture: (s) => capture(s),
  tapPrimary,
};
