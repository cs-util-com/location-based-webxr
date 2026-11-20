// Sign speaks 6.3 - the visitor's view. Throwaway prototype: not wired to the app, linked from
// nothing in it. The sign says who speaks and whether the voice runs; the plate under it carries
// the line being spoken while it is legible and in view; otherwise the round 5 box at the bottom
// edge carries the words. Never both at once.
import * as THREE from "three";
import { createBox, TAP_SLOP } from "./box.js";
import * as kind from "./kind.js";
import { buildLane, canvasTexture, phoneCamera } from "./scene.js";
import {
  clamp,
  createToneVoice,
  lineFloatAt,
  lineTimes,
  makeTimeline,
  SPEAKER,
  STORY,
  SYNTHETIC,
  timeAtLine,
  TITLE,
  wordAt,
} from "./story.js";

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const RADIUS_M = 20; // the station's radius: narration only inside it
const EYE_M = 1.6;
const ANGLE_MAX = 60; // degrees off the plate's face beyond which it carries no words
const SWITCH_HOLD_S = 0.25; // a new place for the words must hold this long before it shows

// ---------- settings (URL options and the tester panel) ----------
const params = new URLSearchParams(location.search);
const pick = (key, allowed, fallback) =>
  allowed.includes(params.get(key)) ? params.get(key) : fallback;
const cfg = {
  thr: Number(pick("thr", ["10", "12", "14", "16"], "12")),
  fs: Number(pick("fs", ["14", "16", "18"], "16")),
  grow: pick("grow", ["on", "off"], "on"),
  turn: pick("turn", ["on", "off"], "on"),
  orient: pick("orient", ["auto", "portrait", "landscape"], "auto"),
  words: pick("words", ["sign", "screen"], "sign"), // the creator's choice for this text
  view: pick("view", ["sign", "captions"], "sign"), // the visitor's own pick in the view menu
  sound: pick("sound", ["tone", "silent"], "tone"),
  shake: pick("shake", ["still", "hand", "walk"], "hand"),
};

// ---------- the narration ----------
const record = {
  title: TITLE,
  text: STORY,
  speaker: SPEAKER,
  synthetic: SYNTHETIC,
  voice: "voice-1",
  words: cfg.words,
};
const { block } = kind.read(record);
const timeline = makeTimeline(block.text);
const { words, total } = timeline;
const st = {
  t: 0,
  playing: false,
  finished: false,
  started: false,
  pausedByLeaving: false,
  scrub: null, // "box" | "plate" while a finger moves the words
  voiceMissing: false,
  where: "plate", // plate | box | sheet | none
  pending: null,
  pendingFor: 0,
  why: "",
};
const voice = createToneVoice();

// ---------- the page ----------
const device = $("device");
const hud = $("hud");
const readout = $("readout");
const coach = $("coach");
const sheet = $("sheet");
const sheetText = $("sheetText");
const canvas = $("cam");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
buildLane(scene);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
camera.rotation.order = "YXZ";
const part = kind.world(block, { canvasTexture, mode: "play" });
scene.add(part.object);
const plateLines = part.setPlateWords(words.map((w) => w.text));
const plateLt = lineTimes(words, plateLines.lineOf, total);
const plateMaxScroll = Math.max(0, plateLines.nLines - kind.PLATE.rows);

const pageScale = () =>
  device.getBoundingClientRect().width / Math.max(1, device.clientWidth);
const box = createBox({
  host: hud,
  speaker: block.speaker,
  synthetic: block.synthetic,
  timeline,
  scale: pageScale,
  on: {
    tap: (x, y) => togglePlay(x, y),
    scrubStart: () => startScrub("box"),
    scrub: (t) => scrubTo(t),
    scrubEnd: () => endScrub(),
  },
});

// the whole text in the sheet, opened by a tap on the sign (as the app's reading sign does)
const sheetSpans = words.map((w) => {
  const s = document.createElement("span");
  s.textContent = w.text;
  sheetText.append(s, " ");
  return s;
});
$("sheetTitle").textContent = block.title;
$("sheetWho").textContent =
  `${block.speaker.name}${block.synthetic ? " · AI voice" : ""}`;
$("sheetWho").style.color = block.speaker.color;
$("sheetClose").addEventListener("click", () => {
  sheet.hidden = true;
});

// ---------- playback ----------
function togglePlay(x, y) {
  if (st.voiceMissing) {
    return;
  }
  voice.unlock();
  if (st.finished || st.t >= total) {
    st.t = 0;
    st.finished = false;
    st.playing = true;
  } else {
    st.playing = !st.playing;
  }
  st.started = true;
  st.pausedByLeaving = false;
  coach.classList.add("gone");
  tapSign(x, y, st.playing);
}
function startScrub(who) {
  st.scrub = who;
}
function scrubTo(t) {
  st.t = clamp(t, 0, total);
  st.finished = false;
}
function endScrub() {
  st.scrub = null;
  if (st.t >= total) {
    finish();
  }
}
function finish() {
  st.playing = false;
  st.finished = true;
  st.t = total;
}
const ICON_PLAY =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
function tapSign(x, y, nowPlaying) {
  const r = device.getBoundingClientRect();
  const k = pageScale();
  const fx = document.createElement("div");
  fx.className = "tapfx";
  fx.style.left = `${(x - r.left) / k}px`;
  fx.style.top = `${(y - r.top) / k}px`;
  fx.innerHTML = nowPlaying ? ICON_PLAY : ICON_PAUSE;
  device.append(fx);
  fx.addEventListener("animationend", () => fx.remove());
  setTimeout(() => fx.remove(), 1500);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    st.playing = false;
  }
});

// ---------- where the viewer stands: the beats move here, a sideways drag on the view turns ----------
const pose = { d: 6, ang: 0, yaw: 0 };
let anim = null; // { from, to, t0, dur }
function goTo(to, dur = 1.4) {
  anim = {
    from: { ...pose },
    to: { ...pose, ...to },
    t0: performance.now() / 1000,
    dur: reduceMotion ? 0.01 : dur,
  };
}
let away = false;
const BEATS = {
  walk: () => {
    Object.assign(pose, { d: 26, ang: 0, yaw: 0 });
    away = false;
    goTo({ d: 5 }, 9);
  },
  near: () => goTo({ d: 3, ang: 0, yaw: 0 }),
  usual: () => goTo({ d: 7, ang: 0, yaw: 0 }),
  far: () => goTo({ d: 16, ang: 0, yaw: 0 }, 2.4),
  side: () => goTo({ d: 7, ang: (65 * Math.PI) / 180, yaw: 0 }),
  away: () => {
    away = !away;
    goTo({ yaw: away ? 2.6 : 0 }, 1.1);
  },
  novoice: () => {
    st.voiceMissing = !st.voiceMissing;
    st.playing = false;
  },
  end: () => {
    voice.unlock();
    const lastSentence = words.findLastIndex(
      (w, i) => i < words.length - 1 && /[.!?]$/.test(w.text),
    );
    st.t = words[lastSentence + 1].start;
    st.playing = true;
    st.finished = false;
    st.started = true;
    st.voiceMissing = false;
    coach.classList.add("gone");
  },
};
document.querySelectorAll("[data-beat]").forEach((b) => {
  b.addEventListener("click", () => {
    BEATS[b.dataset.beat]();
    syncBeatButtons();
  });
});
function syncBeatButtons() {
  document.querySelector('[data-beat="away"]').textContent = away
    ? "Turn back"
    : "Turn away";
  document
    .querySelector('[data-beat="novoice"]')
    .setAttribute("aria-pressed", String(st.voiceMissing));
}

// ---------- pointer on the view: the plate's words, the sign, or looking around ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmp = new THREE.Vector3();
let press = null;
function hit(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  ray.setFromCamera(ndc, camera);
  const targets = [part.signMesh];
  if (st.where === "plate" && part.plateMesh.visible) {
    targets.push(part.plateMesh);
  }
  const h = ray.intersectObjects(targets, false)[0];
  return h ? h.object : null;
}
/** The plate's centre on screen, in device px (to measure how far it moves under a finger). */
function plateOnScreen() {
  part.plateMesh.getWorldPosition(tmp).project(camera);
  return {
    x: ((tmp.x + 1) / 2) * device.clientWidth,
    y: ((1 - tmp.y) / 2) * device.clientHeight,
  };
}
canvas.addEventListener("pointerdown", (e) => {
  const obj = hit(e);
  const base = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  if (obj === part.plateMesh) {
    // A drag that starts on the plate is read from the finger's motion on the screen from here
    // on: the plate moves with the hand, so it is not hit-tested again while the finger moves.
    const lineFloat = lineFloatAt(plateLt, st.t);
    press = {
      ...base,
      kind: "plate",
      line0: lineFloat,
      offset: clamp(plateScroll - lineFloat, -0.9, 0),
      linePx: Math.max(16, lastLetter.linePx),
      plate0: plateOnScreen(),
    };
    dragDrift = 0;
  } else if (obj === part.signMesh) {
    press = { ...base, kind: "sign" };
  } else {
    press = { ...base, kind: "look", yaw0: lookYaw };
  }
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // ignored: the moves still arrive while the finger stays on the canvas
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (!press || e.pointerId !== press.id) {
    return;
  }
  const k = pageScale();
  const dx = (e.clientX - press.x) / k;
  const dy = (press.y - e.clientY) / k;
  if (!press.moved && Math.hypot(dx, dy) > TAP_SLOP) {
    press.moved = true;
    if (press.kind === "plate") {
      startScrub("plate");
    }
  }
  if (!press.moved) {
    return;
  }
  if (press.kind === "plate") {
    const lines = dy / press.linePx;
    scrubTo(timeAtLine(plateLt, press.line0 + lines));
    plateScroll = clamp(press.line0 + lines + press.offset, 0, plateMaxScroll);
  } else if (press.kind === "look") {
    lookYaw = press.yaw0 + dx * 0.005;
  }
});
function endCanvasPress(e) {
  if (!press || e.pointerId !== press.id) {
    return;
  }
  const p = press;
  press = null;
  if (p.kind === "plate" && p.moved) {
    endScrub();
    return;
  }
  if (e.type !== "pointerup" || p.moved) {
    return;
  }
  if (p.kind === "plate") {
    togglePlay(e.clientX, e.clientY);
  } else if (p.kind === "sign") {
    sheet.hidden = false;
  }
}
canvas.addEventListener("pointerup", endCanvasPress);
canvas.addEventListener("pointercancel", endCanvasPress);
canvas.addEventListener("lostpointercapture", endCanvasPress);
let lookYaw = 0;
let dragDrift = 0;

// ---------- legibility: the plate's letters on screen, its angle, whether it is all in view ----------
const lastLetter = { px: 0, linePx: 0, angle: 0, inView: false };
const corner = new THREE.Vector3();
const toCam = new THREE.Vector3();
const normal = new THREE.Vector3();
function measurePlate() {
  const plate = part.plateMesh;
  plate.updateWorldMatrix(true, false);
  const h = device.clientHeight;
  const w = device.clientWidth;
  const proj = (x, y) =>
    corner.set(x, y, 0).applyMatrix4(plate.matrixWorld).project(camera).clone();
  const a = proj(0, kind.PLATE.emM / 2);
  const b = proj(0, -kind.PLATE.emM / 2);
  const la = proj(0, kind.PLATE.lineM / 2);
  const lb = proj(0, -kind.PLATE.lineM / 2);
  lastLetter.px = (Math.abs(a.y - b.y) / 2) * h;
  lastLetter.linePx = (Math.abs(la.y - lb.y) / 2) * h;
  const { textHalfW: hw, textHalfH: hh } = kind.PLATE;
  lastLetter.inView = [
    proj(-hw, hh),
    proj(hw, hh),
    proj(-hw, -hh),
    proj(hw, -hh),
  ].every((c) => c.z < 1 && c.x >= -1 && c.x <= 1 && c.y >= -1 && c.y <= 1);
  if (a.z >= 1) {
    lastLetter.inView = false;
  }
  plate.getWorldPosition(tmp);
  toCam.copy(camera.position).sub(tmp).normalize();
  normal.set(0, 0, 1).transformDirection(plate.matrixWorld);
  lastLetter.angle =
    (Math.acos(clamp(normal.dot(toCam), -1, 1)) * 180) / Math.PI;
  return { w, h };
}

/** Where the words belong now, and why (for the readout). */
function wordsPlace(inRadius) {
  if (!inRadius) {
    return ["none", "outside the station: no words"];
  }
  if (st.voiceMissing) {
    return ["none", "no voice: the sign offers the text"];
  }
  if (!sheet.hidden) {
    return ["sheet", "the whole text is open"];
  }
  if (cfg.view === "captions") {
    return ["box", "the visitor picked Captions: their pick wins"];
  }
  if (cfg.words === "screen") {
    return ["box", "the creator chose On screen"];
  }
  if (st.scrub) {
    return [st.scrub, "a finger holds the words where they are"];
  }
  const onPlate = st.where === "plate";
  const thr = cfg.thr * (onPlate ? 0.95 : 1);
  const angMax = ANGLE_MAX + (onPlate ? 3 : 0);
  if (!lastLetter.inView) {
    return ["box", "the plate is not all in view"];
  }
  if (lastLetter.angle > angMax) {
    return [
      "box",
      `seen at ${lastLetter.angle.toFixed(0)} degrees, over ${ANGLE_MAX}`,
    ];
  }
  if (lastLetter.px < thr) {
    return ["box", `letters ${lastLetter.px.toFixed(1)} px, under ${cfg.thr}`];
  }
  return [
    "plate",
    `letters ${lastLetter.px.toFixed(1)} px, at least ${cfg.thr}`,
  ];
}

// ---------- the sign's state ----------
function signState(inRadius) {
  if (!inRadius) {
    return ["far", "Come closer to listen"];
  }
  if (st.voiceMissing) {
    return ["novoice", "Tap the sign to read the text"];
  }
  if (st.finished) {
    return ["ended", "Tap the words to hear it again"];
  }
  if (st.playing || st.scrub) {
    return ["speaking", "Tap the sign for the whole text"];
  }
  if (st.started) {
    return ["paused", "Tap the words to go on"];
  }
  return [
    "listen",
    st.where === "plate"
      ? "Tap the words below"
      : "Tap the words on your screen",
  ];
}

// ---------- the frame loop ----------
let plateScroll = 0;
let plateFade = 1;
let level = 0;
let lastNow = performance.now();
let litPrev = -1;
let litSheet = -1;
const cost = {
  frames: [],
  worst: 0,
  over50: 0,
  t0: performance.now(),
  redraws: [],
  workMs: 0,
};

function frame(now) {
  const work0 = performance.now();
  const dtMs = now - lastNow;
  const dt = Math.min(0.1, dtMs / 1000);
  lastNow = now;
  const sec = now / 1000;

  // the viewer
  if (anim) {
    const k = clamp((sec - anim.t0) / anim.dur, 0, 1);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    pose.d =
      anim.from.d + (anim.to.d - anim.from.d) * (anim.from.d > 20 ? k : e);
    pose.ang = anim.from.ang + (anim.to.ang - anim.from.ang) * e;
    pose.yaw = anim.from.yaw + (anim.to.yaw - anim.from.yaw) * e;
    if (k >= 1) {
      anim = null;
    }
  }
  const sway =
    { still: 0, hand: 1, walk: 3 }[cfg.shake] * (reduceMotion ? 0.3 : 1);
  camera.position.set(
    Math.sin(pose.ang) * pose.d,
    EYE_M + Math.sin(sec * 2.1) * 0.003 * sway,
    Math.cos(pose.ang) * pose.d,
  );
  const inRadius = pose.d <= RADIUS_M;
  part.update({
    seconds: sec,
    viewer: camera.position,
    turn: cfg.turn === "on",
    growth: cfg.grow === "on",
  });
  part.object.updateMatrixWorld(true);
  const growth = kind.growthScale(pose.d, cfg.grow === "on");
  const lookAt = tmp
    .set(0, kind.PLATE.cyM * growth + 0.15, 0)
    .sub(camera.position);
  const baseYaw = Math.atan2(-lookAt.x, -lookAt.z);
  const basePitch = Math.atan2(lookAt.y, Math.hypot(lookAt.x, lookAt.z));
  camera.rotation.y =
    baseYaw +
    pose.yaw +
    lookYaw +
    (Math.sin(sec * 0.53) * 0.006 + Math.sin(sec * 1.9) * 0.0025) * sway;
  camera.rotation.x =
    basePitch +
    (Math.sin(sec * 0.71) * 0.004 + Math.sin(sec * 2.3) * 0.002) * sway;
  camera.updateMatrixWorld();

  // leaving the station pauses the voice; coming back carries it on
  if (!inRadius && st.playing) {
    st.playing = false;
    st.pausedByLeaving = true;
  } else if (inRadius && st.pausedByLeaving) {
    st.pausedByLeaving = false;
    st.playing = true;
  }

  // the clock
  if (st.playing && !st.scrub && !st.voiceMissing) {
    st.t = Math.min(total, st.t + dt);
    if (st.t >= total) {
      finish();
    }
  }
  const lit = wordAt(words, st.t - 1e-6);
  const cur = wordAt(words, st.t);
  if (lit !== litPrev) {
    if (
      st.playing &&
      !st.scrub &&
      cfg.sound === "tone" &&
      lit > litPrev &&
      lit >= 0
    ) {
      voice.word(words[lit].end - words[lit].start, lit);
    }
    litPrev = lit;
  }
  const inWord = cur >= 0 && st.t < words[cur].end;
  level +=
    ((st.playing && !st.scrub ? (inWord ? 1 : 0.25) : 0) - level) *
    (1 - Math.exp(-dt * 14));
  part.setLevel(level);

  // where the words are
  measurePlate();
  const [want, why] = wordsPlace(inRadius);
  if (want !== st.where) {
    if (st.pending !== want) {
      st.pending = want;
      st.pendingFor = 0;
    }
    st.pendingFor += dt;
    const immediate =
      want === "sheet" ||
      st.where === "sheet" ||
      !inRadius ||
      st.voiceMissing ||
      st.scrub;
    if (immediate || st.pendingFor >= SWITCH_HOLD_S) {
      st.where = want;
      st.pending = null;
    }
  } else {
    st.pending = null;
  }
  st.why = why;

  // the plate: words while it holds them, faded out before the box comes (never both at once)
  const plateOn = st.where === "plate";
  plateFade = clamp(plateFade + (plateOn ? dt : -dt) / 0.18, 0, 1);
  part.setPlateOpacity(plateFade);
  box.show(st.where === "box" && plateFade === 0);
  if (plateOn || plateFade > 0) {
    if (st.scrub !== "plate") {
      const target = clamp(
        plateLines.lineOf[Math.max(0, cur)] ?? 0,
        0,
        plateMaxScroll,
      );
      plateScroll = reduceMotion
        ? target
        : plateScroll + (target - plateScroll) * (1 - Math.exp(-dt * 8));
      if (Math.abs(target - plateScroll) < 0.003) {
        plateScroll = target;
      }
    }
    if (part.drawPlate(lit, plateScroll, 0.5)) {
      cost.redraws.push(now);
    }
  }
  if (press && press.kind === "plate" && press.moved) {
    const p = plateOnScreen();
    dragDrift = Math.max(
      dragDrift,
      Math.hypot(p.x - press.plate0.x, p.y - press.plate0.y),
    );
  }
  box.frame(dt, st.t, st.playing);

  // the sheet follows the voice too
  if (!sheet.hidden && lit !== litSheet) {
    sheetSpans.forEach((s, i) => s.classList.toggle("on", i <= lit));
    litSheet = lit;
  }

  const [state, hint] = signState(inRadius);
  part.setSign(state, hint);
  coach.classList.toggle(
    "hidden",
    st.started ||
      !inRadius ||
      st.voiceMissing ||
      st.where === "none" ||
      box.shown,
  );

  renderer.render(scene, camera);
  cost.workMs = performance.now() - work0;
  measureCost(now, dtMs);
  requestAnimationFrame(frame);
}

// ---------- the readout: where the words are and why, and what a frame costs ----------
let readoutAt = 0;
function measureCost(now, dtMs) {
  if (!document.hidden && now - cost.t0 > 2000) {
    cost.frames.push(dtMs);
    if (cost.frames.length > 120) {
      cost.frames.shift();
    }
    cost.worst = Math.max(cost.worst, dtMs);
    if (dtMs > 50) {
      cost.over50++;
    }
  }
  while (cost.redraws.length && now - cost.redraws[0] > 1000) {
    cost.redraws.shift();
  }
  if (now - readoutAt < 250) {
    return;
  }
  readoutAt = now;
  const avg = cost.frames.length
    ? cost.frames.reduce((x, y) => x + y, 0) / cost.frames.length
    : 0;
  const info = renderer.info.render;
  const s = part.stats();
  const place = {
    plate: "on the plate",
    box: "in the box",
    sheet: "in the sheet",
    none: "nowhere",
  }[st.where];
  const drift =
    st.scrub === "plate"
      ? ` · plate moved ${dragDrift.toFixed(0)} px under the finger`
      : "";
  readout.querySelector(".r1").textContent =
    `${pose.d.toFixed(1)} m · ${lastLetter.angle.toFixed(0)}° · letters ${lastLetter.px.toFixed(1)} px → words ${place}: ${st.why}${drift}`;
  readout.querySelector(".r2").textContent =
    `frame ${avg.toFixed(1)} ms (work ${cost.workMs.toFixed(1)}) · worst ${cost.worst.toFixed(0)} ms · over 50 ms: ${cost.over50} · ${info.calls} draws · ${(info.triangles / 1000).toFixed(1)}k tris · plate ${cost.redraws.length}/s (${s.plateMs.toFixed(1)} ms) · sign ${s.signDraws} draws`;
}

// ---------- the phone: its size, its camera ----------
function applyDevice() {
  document.body.dataset.orient = cfg.orient;
  if (cfg.orient === "auto") {
    device.style.width = "";
    device.style.height = "";
    device.style.transform = "";
  } else {
    const [w, h] = cfg.orient === "portrait" ? [390, 844] : [844, 390];
    device.style.width = `${w}px`;
    device.style.height = `${h}px`;
    const side = window.innerWidth >= 960 ? 440 : 0;
    const k = Math.min(
      1,
      (window.innerWidth - side - 24) / w,
      (window.innerHeight - 24) / h,
    );
    device.style.transform = k < 1 ? `scale(${k.toFixed(3)})` : "";
  }
}
function resize() {
  const w = device.clientWidth;
  const h = device.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = phoneCamera(w, h).fovDeg;
  camera.updateProjectionMatrix();
  if (box.shown) {
    box.layout();
  }
}
new ResizeObserver(resize).observe(device);
addEventListener("resize", applyDevice);

// ---------- the tester panel ----------
function applyCfg() {
  const root = document.documentElement.style;
  root.setProperty("--fs", `${cfg.fs}px`);
  root.setProperty("--lh", `${Math.round(cfg.fs * 1.375)}px`);
  document.querySelectorAll("[data-cfg]").forEach((b) => {
    b.classList.toggle("on", String(cfg[b.dataset.cfg]) === b.dataset.v);
  });
  $("viewPill").textContent =
    cfg.view === "captions" ? "Captions" : "Reading sign";
  applyDevice();
  if (box.shown) {
    box.layout();
  }
}
function saveCfg() {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(cfg)) {
    q.set(k, String(v));
  }
  history.replaceState(null, "", `?${q}`);
}
document.querySelectorAll("[data-cfg]").forEach((b) => {
  b.addEventListener("click", () => {
    const k = b.dataset.cfg;
    cfg[k] = ["thr", "fs"].includes(k) ? Number(b.dataset.v) : b.dataset.v;
    applyCfg();
    saveCfg();
  });
});
// the visitor's own view menu: their pick wins over the creator's choice
$("viewPill").addEventListener("click", () => {
  $("viewMenu").hidden = !$("viewMenu").hidden;
});
document.querySelectorAll("[data-view]").forEach((b) => {
  b.addEventListener("click", () => {
    cfg.view = b.dataset.view;
    $("viewMenu").hidden = true;
    applyCfg();
    saveCfg();
  });
});
$("menuBtn").addEventListener("click", () => {
  $("demo").hidden = !$("demo").hidden;
});
$("demoClose").addEventListener("click", () => {
  $("demo").hidden = true;
});
$("exitBtn").addEventListener("click", () => {
  coach.textContent = "Exit is not part of this prototype.";
  coach.classList.remove("gone", "hidden");
});

applyCfg();
syncBeatButtons();
resize();
requestAnimationFrame(frame);
