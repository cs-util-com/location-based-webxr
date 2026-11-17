// Calm HUD 5.1 - Scroll box. Throwaway prototype: not wired to the app, linked from nothing in it.
// The narration box at the bottom edge: at most three lines, scrolling the words is scrubbing the
// narration, a tap pauses or plays. A simulated camera view stands in for AR.
import * as THREE from "three";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- settings (URL options and the tester panel) ----------
const params = new URLSearchParams(location.search);
function numParam(key, fallback, lo, hi) {
  if (!params.has(key)) {
    return fallback;
  }
  const v = Number(params.get(key));
  return Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}
const cfg = {
  fs: numParam("fs", 16, 12, 22),
  tint: numParam("tint", 0.72, 0.3, 0.95),
  grey: numParam("grey", 0.55, 0.3, 0.8),
  maxw: numParam("maxw", 80, 50, 95),
  voice: params.get("voice") === "off" ? "off" : "on",
};

// ---------- the story ----------
const SPEAKER = { name: "Greta", color: "#4ade80" };
const STORY =
  "Welcome to the well court! I am Greta, and I drew water here every morning for forty years. " +
  "The old spring dried up in 1611, so forty men dug this well in a single summer. " +
  "They hit water at nineteen metres and lined the shaft with stone from the river. " +
  "The masons left their mark on one stone of the rim, a small hammer in a circle. " +
  "Look closely, and you may still find it.";
const QUIZ = {
  question: "Before you go: what did the masons carve into the rim?",
  answers: [
    { text: "A hammer in a circle", right: true },
    { text: "A fish in a wave", right: false },
  ],
  right: "Exactly, a hammer in a circle. You listened well. Have a look around the court.",
  wrong: "Not quite: it was a hammer in a circle. Look for it on the rim before you go.",
};

const FOLLOW_ROW = 1; // the spoken line sits in the middle of the three rows
const MAX_ROWS = 3;
const TAP_SLOP = 8; // px a finger may move and still count as a tap
const BOX_CAP = 720; // px, the widest the box gets on a big screen

const device = $("device");
const nbox = $("nbox");
const col = $("col");
const win = $("win");
const mid = $("mid");
const thumb = $("thumb");
const sbar = $("sbar");
const nextBtn = $("nextBtn");
const nextLabel = $("nextLabel");
const answersEl = $("answers");
const startCard = $("start");
const stateText = $("stateText");
const measureEl = $("measure");

$("whoName").textContent = SPEAKER.name;
nbox.style.setProperty("--spk", SPEAKER.color);

// ---------- timing: invented from the letters when the voice reports nothing ----------
function fakeTimes(texts) {
  let t = 0;
  return texts.map((w) => {
    const letters = w.replace(/[^\p{L}\p{N}]/gu, "").length;
    const d = clamp(0.11 + 0.052 * letters, 0.17, 0.64);
    const start = t;
    t += d;
    if (/[.!?]["']?$/.test(w)) {
      t += 0.42;
    } else if (/[,;:]$/.test(w)) {
      t += 0.22;
    }
    return { start, end: start + d };
  });
}

// ---------- the narration state of the current step ----------
let words = []; // { text, start, end, el }
let sentences = []; // { first, last }
let sentOf = []; // word index -> sentence index
let lineOf = []; // word index -> line index
let lineStart = []; // line index -> time its first word starts; one extra entry = total
let nLines = 1;
let rows = 1;
let total = 0;
let t = 0;
let s = 0; // displayed scroll, in lines
let playing = false;
let finished = false;
let step = "idle"; // idle | story | quiz | reply | done
let litUpTo = -1;
let lh = 22;

function wordAt(time) {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (words[m].start <= time) {
      found = m;
      lo = m + 1;
    } else {
      hi = m - 1;
    }
  }
  return found;
}
function lineFloatAt(time) {
  if (time >= total) {
    return nLines;
  }
  let k = 0;
  while (k + 1 < nLines && lineStart[k + 1] <= time) {
    k++;
  }
  const span = lineStart[k + 1] - lineStart[k];
  return k + (span > 0 ? clamp((time - lineStart[k]) / span, 0, 1) : 0);
}
function timeAtLine(x) {
  const v = clamp(x, 0, nLines);
  const k = Math.floor(v);
  if (k >= nLines) {
    return total;
  }
  return lineStart[k] + (v - k) * (lineStart[k + 1] - lineStart[k]);
}
const maxScroll = () => Math.max(0, nLines - rows);

function setText(text) {
  const texts = text.split(/\s+/).filter(Boolean);
  const times = fakeTimes(texts);
  col.textContent = "";
  words = texts.map((w, i) => {
    const el = document.createElement("span");
    el.className = "w";
    el.textContent = w;
    col.append(el, " ");
    return { text: w, start: times[i].start, end: times[i].end, el };
  });
  total = words.length ? words[words.length - 1].end + 0.3 : 0;
  sentences = [];
  sentOf = [];
  let first = 0;
  words.forEach((w, i) => {
    sentOf[i] = sentences.length;
    if (/[.!?]["']?$/.test(w.text) || i === words.length - 1) {
      sentences.push({ first, last: i });
      first = i + 1;
    }
  });
  t = 0;
  litUpTo = -1;
  finished = false;
}

// ---------- the width rule and the line measure ----------
const meas = document.createElement("span");
meas.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;font-size:var(--fs)";
win.append(meas);

function layout() {
  const devW = device.clientWidth;
  const boxMax = Math.min((devW * cfg.maxw) / 100, BOX_CAP);
  meas.textContent = words.map((w) => w.text).join(" ");
  const natural = meas.getBoundingClientRect().width;
  const chrome = 14 + 10 + 2 + 12; // box padding, border, room for the scrollbar
  const slotW = nextBtn.hidden ? 0 : $("slotR").getBoundingClientRect().width;
  const minW = step === "quiz" ? Math.min(300, boxMax - chrome) : 90;
  const textW = Math.floor(clamp(natural + 2, minW, Math.max(minW, boxMax - chrome - slotW)));
  col.style.width = `${textW}px`;
  mid.style.width = `${textW + 12}px`;

  const tops = [];
  lineOf = words.map((w) => {
    const top = w.el.offsetTop;
    let k = tops.findIndex((x) => Math.abs(x - top) < lh / 2);
    if (k < 0) {
      tops.push(top);
      k = tops.length - 1;
    }
    return k;
  });
  nLines = Math.max(1, tops.length);
  rows = Math.min(MAX_ROWS, nLines);
  nbox.style.setProperty("--rows", String(rows));
  lineStart = [];
  words.forEach((w, i) => {
    if (lineStart[lineOf[i]] === undefined) {
      lineStart[lineOf[i]] = w.start;
    }
  });
  lineStart[nLines] = total;
  s = followTarget();
  sbar.classList.toggle("none", nLines <= rows);
  showMeasure();
}
function followTarget() {
  const cur = Math.max(0, wordAt(t));
  return clamp((lineOf[cur] ?? 0) - FOLLOW_ROW, 0, maxScroll());
}

// ---------- the voice: the browser's text-to-speech, one sentence at a time ----------
const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
let voiceTok = 0;
let voiceSent = -1; // the sentence being spoken, -1 when silent
let lastSpoken = -1;
let voiceFails = 0;
let holdFor = 0;
let speaking = false;
let chosenVoice = null;

function pickVoice() {
  if (!synth) {
    return;
  }
  const all = synth.getVoices();
  const en = all.filter((v) => /^en\b/i.test(v.lang));
  // a local voice reports word boundaries; network voices often do not
  chosenVoice =
    en.find((v) => /^en-GB/i.test(v.lang) && v.localService) ||
    en.find((v) => v.localService) ||
    en.find((v) => /^en-GB/i.test(v.lang)) ||
    en[0] ||
    null;
}
if (synth) {
  pickVoice();
  synth.addEventListener("voiceschanged", pickVoice);
}
const voiceOn = () => cfg.voice === "on" && !!synth && voiceFails < 2;

function stopVoice() {
  voiceTok++;
  voiceSent = -1;
  speaking = false;
  holdFor = 0;
  if (synth && (synth.speaking || synth.pending)) {
    synth.cancel();
  }
}
function speakFrom(i) {
  stopVoice();
  const si = sentOf[i];
  const sent = sentences[si];
  voiceSent = si;
  lastSpoken = si;
  const tok = voiceTok;
  const offsets = [];
  let text = "";
  for (let k = i; k <= sent.last; k++) {
    offsets.push(text.length);
    text += (k > i ? " " : "") + words[k].text;
    if (k > i) {
      offsets[offsets.length - 1] += 1;
    }
  }
  setTimeout(() => {
    if (tok !== voiceTok || !playing) {
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    if (chosenVoice) {
      u.voice = chosenVoice;
      u.lang = chosenVoice.lang;
    } else {
      u.lang = "en-GB";
    }
    let started = false;
    u.onstart = () => {
      started = true;
      if (tok === voiceTok) {
        speaking = true;
        voiceFails = 0;
      }
    };
    u.onboundary = (e) => {
      if (tok !== voiceTok || (e.name && e.name !== "word")) {
        return;
      }
      let k = 0;
      while (k + 1 < offsets.length && offsets[k + 1] <= e.charIndex) {
        k++;
      }
      const w = words[i + k];
      if (w && Math.abs(t - w.start) > 0.2) {
        t = w.start;
      }
    };
    const done = () => {
      if (tok !== voiceTok) {
        return;
      }
      voiceSent = -1;
      speaking = false;
      t = Math.max(t, words[sent.last].end);
    };
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
    // a voice that never starts falls back to the invented times
    setTimeout(() => {
      if (tok === voiceTok && !started) {
        voiceFails++;
        voiceSent = -1;
        if (synth.speaking || synth.pending) {
          synth.cancel();
        }
      }
    }, 1500);
  }, 40);
}

// ---------- playback ----------
function setPlaying(on) {
  playing = on;
  if (!on) {
    stopVoice();
  }
  lastSpoken = -1;
}
function advance(dt) {
  if (!playing || dragging || !words.length) {
    return;
  }
  if (voiceSent >= 0) {
    const holdEnd = words[sentences[voiceSent].last].end;
    if (t >= holdEnd) {
      // the voice is still on this sentence: wait for it, but not forever
      holdFor += dt;
      if (holdFor > 4) {
        stopVoice();
      }
      return;
    }
    t = Math.min(t + dt, holdEnd);
  } else {
    t = Math.min(t + dt, total);
  }
  holdFor = 0;
  maybeSpeak();
  if (t >= total) {
    finish();
  }
}
// the voice takes up the sentence the clock has reached, from the word being said
function maybeSpeak() {
  if (!voiceOn() || voiceSent >= 0) {
    return;
  }
  const cur = wordAt(t);
  if (cur >= 0 && t < words[cur].end && sentOf[cur] !== lastSpoken) {
    speakFrom(cur);
  }
}
function finish() {
  playing = false;
  finished = true;
  stopVoice();
  if (step === "story") {
    showStepButton("Next");
  } else if (step === "reply") {
    showStepButton("Done");
  }
}
function showStepButton(label) {
  nextLabel.textContent = label;
  nextBtn.hidden = false;
  layout();
}

// ---------- steps: the story, then a question with two answers, then the reply ----------
function swapIn() {
  nbox.classList.remove("swap");
  void nbox.offsetWidth;
  nbox.classList.add("swap");
}
function enterStep(name, text, autoplay) {
  step = name;
  stopVoice();
  setText(text);
  nextBtn.hidden = true;
  answersEl.hidden = name !== "quiz";
  answersEl.textContent = "";
  if (name === "quiz") {
    QUIZ.answers.forEach((a) => answersEl.append(answerButton(a)));
  }
  nbox.classList.remove("off");
  swapIn();
  layout();
  setPlaying(autoplay);
}
const ICON_RIGHT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
const ICON_WRONG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
function answerButton(a) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ans";
  b.textContent = a.text;
  b.addEventListener("click", () => {
    [...answersEl.children].forEach((other, i) => {
      other.disabled = true;
      const ans = QUIZ.answers[i];
      if (ans.right) {
        other.dataset.state = "right";
        other.insertAdjacentHTML("afterbegin", ICON_RIGHT);
      } else if (other === b) {
        other.dataset.state = "wrong";
        other.insertAdjacentHTML("afterbegin", ICON_WRONG);
      } else {
        other.dataset.state = "other";
      }
    });
    setTimeout(() => enterStep("reply", a.right ? QUIZ.right : QUIZ.wrong, true), 700);
  });
  return b;
}
nextBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (step === "story") {
    enterStep("quiz", QUIZ.question, true);
  } else {
    step = "done";
    stopVoice();
    nbox.classList.add("off");
    startCard.querySelector("b").textContent = "Tap to hear Greta again.";
    startCard.classList.remove("gone");
  }
});
function startStory() {
  startCard.classList.add("gone");
  enterStep("story", STORY, true);
}
startCard.addEventListener("click", startStory);
startCard.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    startStory();
  }
});

// ---------- the box's gestures: a vertical drag scrubs, a tap pauses or plays ----------
let dragging = false;
let press = null; // { id, x, y, s0, line0 }

nbox.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button") || step === "idle" || step === "done") {
    return;
  }
  press = { id: e.pointerId, x: e.clientX, y: e.clientY, s0: s, line0: lineFloatAt(t) };
  nbox.setPointerCapture(e.pointerId);
});
nbox.addEventListener("pointermove", (e) => {
  if (!press || e.pointerId !== press.id) {
    return;
  }
  const dy = press.y - e.clientY; // finger up = text up = ahead
  if (!dragging && Math.hypot(e.clientX - press.x, dy) > TAP_SLOP) {
    dragging = true;
    stopVoice();
    col.classList.add("scrub");
    nbox.classList.add("dragging");
  }
  if (!dragging) {
    return;
  }
  const lines = dy / lh;
  t = timeAtLine(press.line0 + lines);
  finished = false;
  const raw = press.s0 + lines;
  const top = maxScroll();
  s = raw < 0 ? raw * 0.3 : raw > top ? top + (raw - top) * 0.3 : raw;
});
function endPress(e) {
  if (!press || e.pointerId !== press.id) {
    return;
  }
  const wasDrag = dragging;
  press = null;
  dragging = false;
  col.classList.remove("scrub");
  nbox.classList.remove("dragging");
  if (wasDrag) {
    lastSpoken = -1;
    if (t >= total && !finished) {
      finish();
    }
    return;
  }
  if (e.type === "pointercancel") {
    return;
  }
  togglePlay(e.clientX, e.clientY);
}
nbox.addEventListener("pointerup", endPress);
nbox.addEventListener("pointercancel", endPress);

function togglePlay(x, y) {
  if (finished || t >= total) {
    t = 0;
    finished = false;
    setPlaying(true);
  } else {
    setPlaying(!playing);
  }
  tapSign(x, y, playing);
}
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
function tapSign(x, y, nowPlaying) {
  const r = device.getBoundingClientRect();
  const fx = document.createElement("div");
  fx.className = "tapfx";
  fx.style.left = `${x - r.left}px`;
  fx.style.top = `${y - r.top}px`;
  fx.innerHTML = nowPlaying ? ICON_PLAY : ICON_PAUSE;
  device.append(fx);
  fx.addEventListener("animationend", () => fx.remove());
  setTimeout(() => fx.remove(), 1500);
}
nbox.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    const r = nbox.getBoundingClientRect();
    togglePlay(r.left + r.width / 2, r.top + r.height / 2);
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    stopVoice();
    lastSpoken = -1;
    t = timeAtLine(lineFloatAt(t) + (e.key === "ArrowDown" ? 1 : -1));
    finished = false;
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing) {
    setPlaying(false);
  }
});
addEventListener("pagehide", () => stopVoice());

// ---------- the box, every frame ----------
function updateBox(dt) {
  if (!words.length) {
    return;
  }
  const lit = wordAt(t - 1e-6);
  if (lit !== litUpTo) {
    const lo = Math.min(lit, litUpTo);
    const hi = Math.max(lit, litUpTo);
    for (let i = Math.max(0, lo + 1); i <= hi; i++) {
      words[i].el.classList.toggle("on", i <= lit);
    }
    litUpTo = lit;
  }
  if (!dragging) {
    const target = followTarget();
    s = reduceMotion ? target : s + (target - s) * (1 - Math.exp(-dt * 9));
    if (Math.abs(target - s) < 0.002) {
      s = target;
    }
  }
  col.style.transform = `translateY(${(-s * lh).toFixed(2)}px)`;
  const winH = rows * lh - 4;
  const thumbH = Math.max(14, (winH * rows) / nLines);
  const pos = clamp(s / Math.max(1, maxScroll()), 0, 1) * (winH - thumbH);
  thumb.style.height = `${thumbH.toFixed(1)}px`;
  thumb.style.transform = `translateY(${pos.toFixed(1)}px)`;
  const talk = playing && !dragging ? "yes" : "no";
  if (nbox.dataset.speaking !== talk) {
    nbox.dataset.speaking = talk;
  }
}
function fmt(sec) {
  const v = Math.max(0, Math.floor(sec));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}
let stateShown = "";
function updateState() {
  let txt = "-";
  if (step !== "idle") {
    const mode = !voiceOn() ? "timed text" : speaking ? "voice" : "voice idle";
    const st = dragging ? "scrubbing" : playing ? "playing" : finished ? "ended" : "paused";
    txt = `${step} ${fmt(t)}/${fmt(total)} ${st} - ${mode}`;
  }
  if (txt !== stateShown) {
    stateText.textContent = txt;
    stateShown = txt;
  }
}
function showMeasure() {
  if (!params.has("measure")) {
    return;
  }
  measureEl.hidden = false;
  const r = nbox.getBoundingClientRect();
  const d = device.getBoundingClientRect();
  measureEl.textContent = `box ${Math.round(r.width)}x${Math.round(r.height)} (${Math.round((r.width / d.width) * 100)} % of ${Math.round(d.width)}) - text ${col.style.width} - lines ${nLines}, rows ${rows}`;
}

// ---------- settings ----------
function applyCfg() {
  lh = Math.round(cfg.fs * 1.375);
  const root = document.documentElement.style;
  root.setProperty("--fs", `${cfg.fs}px`);
  root.setProperty("--lh", `${lh}px`);
  root.setProperty("--tint", String(cfg.tint));
  root.setProperty("--grey", String(cfg.grey));
  document.querySelectorAll("[data-cfg]").forEach((b) => {
    b.classList.toggle("on", String(cfg[b.dataset.cfg]) === b.dataset.v);
  });
  $("voiceBtn").setAttribute("aria-pressed", String(cfg.voice === "on"));
  if (cfg.voice !== "on") {
    stopVoice();
  }
  if (words.length) {
    layout();
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
    cfg[k] = k === "voice" ? b.dataset.v : Number(b.dataset.v);
    lastSpoken = -1;
    applyCfg();
    saveCfg();
  });
});
$("voiceBtn").addEventListener("click", () => {
  cfg.voice = cfg.voice === "on" ? "off" : "on";
  voiceFails = 0;
  lastSpoken = -1;
  applyCfg();
  saveCfg();
});
$("menuBtn").addEventListener("click", () => {
  $("demo").hidden = !$("demo").hidden;
});
$("demoClose").addEventListener("click", () => {
  $("demo").hidden = true;
});
document.querySelectorAll("[data-jump]").forEach((b) => {
  b.addEventListener("click", () => {
    startCard.classList.add("gone");
    const where = b.dataset.jump;
    if (where === "quiz") {
      enterStep("quiz", QUIZ.question, true);
      return;
    }
    enterStep("story", STORY, true);
    if (where === "end") {
      t = words[sentences[sentences.length - 1].first].start;
      s = followTarget();
    }
  });
});
$("exitBtn").addEventListener("click", () => {
  stateText.textContent = "Exit is not part of this prototype.";
  stateShown = "";
});

// ---------- the camera stand-in: an old town square ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function skyTexture() {
  return canvasTexture(4, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#7fa6c9");
    grad.addColorStop(0.55, "#c4d6e3");
    grad.addColorStop(1, "#e3e9ec");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}
function cobbleTexture() {
  const rand = rng(7);
  const tex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = "#6f6a62";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      for (let x = (y / 16) % 2 ? -8 : 0; x < w; x += 16) {
        const v = 120 + Math.floor(rand() * 40);
        g.fillStyle = `rgb(${v} ${v - 6} ${v - 14})`;
        g.beginPath();
        g.roundRect(x + 1.5, y + 1.5, 13, 13, 4);
        g.fill();
      }
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(70, 70);
  tex.anisotropy = 4;
  return tex;
}

const canvas = $("cam");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = skyTexture();
scene.fog = new THREE.Fog(0xd5dfe6, 45, 240);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);
camera.rotation.order = "YXZ";
scene.add(new THREE.HemisphereLight(0xdfe9f2, 0x6b5e50, 1.5));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
sun.position.set(40, 80, 20);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ map: cobbleTexture() }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// houses around the square: a plastered facade with windows, a hipped roof
function facadeTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = "#f4efe6";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#3b3f45";
    for (let y = 14; y < h - 30; y += 30) {
      for (let x = 14; x < w - 10; x += 28) {
        g.fillRect(x, y, 14, 18);
      }
    }
    g.fillStyle = "#5a4330";
    g.fillRect(52, h - 26, 22, 26);
  });
}
(function houses() {
  const rand = rng(11);
  const spots = [];
  for (let z = -16; z > -128; z -= 9) {
    spots.push([-30, z], [30, z]);
  }
  for (let x = -21; x <= 21; x += 9) {
    spots.push([x, -126]);
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  const walls = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ map: facadeTexture() }), spots.length);
  const roofGeo = new THREE.ConeGeometry(0.75, 1, 4);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0xa04a30 }), spots.length);
  const m = new THREE.Matrix4();
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  const colors = [0xffffff, 0xf0dcc0, 0xe6cfb0, 0xdfe3e0, 0xf3d9c6, 0xe9e0cf];
  const c = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const h = 9 + rand() * 7;
    m.compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion(), new THREE.Vector3(8.4, h, 8.4));
    walls.setMatrixAt(i, m);
    walls.setColorAt(i, c.setHex(colors[Math.floor(rand() * colors.length)]));
    m.compose(new THREE.Vector3(x, h + 1.6, z), turn, new THREE.Vector3(8.4, 3.2, 8.4));
    roofs.setMatrixAt(i, m);
  });
  scene.add(walls, roofs);
})();

// the well at station A
const stone = new THREE.MeshLambertMaterial({ color: 0x8d8a83 });
const wood = new THREE.MeshLambertMaterial({ color: 0x5a4330 });
const well = new THREE.Group();
well.position.set(0, 0, -60);
const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.25, 0.85, 24, 1, true), stone);
rim.position.y = 0.42;
rim.material.side = THREE.DoubleSide;
well.add(rim);
for (const x of [-1.05, 1.05]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.3, 0.14), wood);
  post.position.set(x, 1.15, 0);
  well.add(post);
}
const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.9, 4), new THREE.MeshLambertMaterial({ color: 0x7b3f2a }));
roof.position.y = 2.7;
roof.rotation.y = Math.PI / 4;
well.add(roof);
scene.add(well);

// Greta, the speaker
const greta = new THREE.Group();
greta.position.set(0, 0, -51);
const coat = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.95, 6, 14), new THREE.MeshLambertMaterial({ color: 0x0f766e }));
coat.position.y = 0.78;
greta.add(coat);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 14), new THREE.MeshLambertMaterial({ color: 0xe8c4a8 }));
head.position.y = 1.52;
greta.add(head);
const kerchief = new THREE.Mesh(
  new THREE.SphereGeometry(0.18, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0xe5e1d6 }),
);
kerchief.position.y = 1.55;
greta.add(kerchief);
scene.add(greta);

// station B in the distance: an orange beam above the roofs
const STATION_B = new THREE.Vector3(55, 0, -122);
const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.5, 0.5, 46, 12, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xf2971f, transparent: true, opacity: 0.55, depthWrite: false }),
);
beam.position.set(STATION_B.x, 23, STATION_B.z);
scene.add(beam);
const ITEMS = [new THREE.Vector3(-14, 0, -74), new THREE.Vector3(16, 0, -88), new THREE.Vector3(-22, 0, -40)];

// the viewer: standing in front of Greta, a slight hand sway; a sideways drag turns the view
camera.position.set(2.2, 1.6, -40);
const look = new THREE.Vector3(0, 1.45, -51).sub(camera.position);
const baseYaw = Math.atan2(-look.x, -look.z);
const basePitch = Math.atan2(look.y, Math.hypot(look.x, look.z));
let userYaw = 0;
let camDrag = null;
canvas.addEventListener("pointerdown", (e) => {
  camDrag = { id: e.pointerId, x: e.clientX, yaw: userYaw };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (camDrag && e.pointerId === camDrag.id) {
    userYaw = camDrag.yaw + (e.clientX - camDrag.x) * 0.005;
  }
});
const endCam = () => {
  camDrag = null;
};
canvas.addEventListener("pointerup", endCam);
canvas.addEventListener("pointercancel", endCam);

function resize() {
  const w = device.clientWidth;
  const h = device.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (words.length) {
    layout();
  }
}
new ResizeObserver(resize).observe(device);

// ---------- the compass band: 180 degrees, station B, items, the speaker's notch ----------
const marksEl = $("marks");
function mark(cls, color) {
  const el = document.createElement("i");
  el.className = `mk ${cls}`;
  if (color) {
    el.style.color = color;
  }
  marksEl.append(el);
  return el;
}
const compass = [
  { el: mark("north"), at: null },
  { el: mark("hollow", "#f2971f"), at: STATION_B },
  ...ITEMS.map((p) => ({ el: mark(""), at: p })),
  { el: mark("notch", SPEAKER.color), at: greta.position, speakerOnly: true },
];
function updateCompass() {
  const heading = -camera.rotation.y;
  const half = $("band").clientWidth / 2 - 10;
  for (const m of compass) {
    const bearing = m.at ? Math.atan2(m.at.x - camera.position.x, -(m.at.z - camera.position.z)) : 0;
    let rel = bearing - heading;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const hide = Math.abs(rel) > Math.PI / 2 || (m.speakerOnly && !(playing && !dragging));
    m.el.style.opacity = hide ? "0" : "1";
    m.el.style.transform = `translateX(${((rel / (Math.PI / 2)) * half).toFixed(1)}px)`;
  }
}

// ---------- the frame loop ----------
let lastNow = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  advance(dt);
  updateBox(dt);
  updateState();
  const sec = now / 1000;
  const sway = reduceMotion ? 0 : 1;
  camera.rotation.y = baseYaw + userYaw + Math.sin(sec * 0.53) * 0.012 * sway;
  camera.rotation.x = basePitch + Math.sin(sec * 0.71) * 0.006 * sway;
  const talking = playing && !dragging;
  head.position.y = 1.52 + (talking ? Math.abs(Math.sin(sec * 7)) * 0.012 : 0);
  kerchief.position.y = head.position.y + 0.03;
  greta.rotation.y = Math.atan2(camera.position.x - greta.position.x, camera.position.z - greta.position.z);
  updateCompass();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

applyCfg();
resize();
requestAnimationFrame(frame);
if (params.has("autostart")) {
  startStory();
}
