// Sign speaks 6.3 - the creator's side. Throwaway prototype. The narration section of a station
// in the desktop editor gains one choice, "Words while the voice plays: On screen / On the sign",
// a preview of the plate from where visitors usually stand, and a warning when the plate cannot
// be read from there. The preview draws the same kind module the visitor page draws.
import * as THREE from "three";
import * as kind from "./kind.js";
import { buildLane, canvasTexture, phoneCamera } from "./scene.js";
import { createBox } from "./box.js";
import {
  SPEAKER,
  STORY,
  SYNTHETIC,
  TITLE,
  makeTimeline,
  wordAt,
} from "./story.js";

const $ = (id) => document.getElementById(id);
const STATION_RADIUS_M = 20;
const EYE_M = 1.6;
const PHONES = {
  portrait: { w: 390, h: 844 },
  landscape: { w: 844, h: 390 },
};
// the preview pauses the voice here, so lit and unlit words both show
const PREVIEW_AT = 0.3;

const q = new URLSearchParams(location.search);
const pick = (key, allowed, dflt) =>
  allowed.includes(q.get(key)) ? q.get(key) : dflt;
const cfg = {
  words: pick("words", ["screen", "sign"], "sign"),
  d: Number(pick("d", ["3", "5", "7", "9", "12", "16"], "7")),
  thr: Number(pick("thr", ["10", "12", "14", "16"], "12")),
  grow: pick("grow", ["on", "off"], "on"),
  orient: pick("orient", ["portrait", "landscape"], "portrait"),
  voice: pick("voice", ["yes", "no"], "yes"),
};

const record = () => ({
  title: TITLE,
  text: STORY,
  speaker: SPEAKER,
  synthetic: SYNTHETIC,
  voice: cfg.voice === "yes" ? "pump-house-voice.ogg" : "",
  words: cfg.words,
});

/** The plate's letters on a phone at `d` metres, facing it: one em, in CSS px. */
function lettersPx(d, orient) {
  const { w, h } = PHONES[orient];
  const f = phoneCamera(w, h).focalPx;
  return (kind.PLATE.emM * kind.growthScale(d, cfg.grow === "on") * f) / d;
}
/** The farthest distance whose letters are still at least `thr` px (letters shrink with distance). */
function legibleUpTo(orient) {
  let lo = 0.5;
  let hi = 60;
  if (lettersPx(hi, orient) >= cfg.thr) {
    return hi;
  }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (lettersPx(mid, orient) >= cfg.thr) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}
const m1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

// ---------- the preview: the same kind world, seen from the usual distance ----------
const cdev = $("cdev");
const canvas = $("pcam");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
buildLane(scene);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
const timeline = makeTimeline(STORY);
const textsOf = timeline.words.map((w) => w.text);
const tNow = timeline.total * PREVIEW_AT;
let block = kind.read(record()).block;
let part = null;
let plateLines = { lineOf: [], nLines: 1 };

function buildPart() {
  part?.dispose();
  block = kind.read(record()).block;
  part = kind.world(block, { canvasTexture, mode: "play" });
  scene.add(part.object);
  plateLines = part.setPlateWords(textsOf);
}

const box = createBox({
  host: cdev,
  speaker: SPEAKER,
  synthetic: SYNTHETIC,
  timeline,
  interactive: false,
});

function layoutPhone() {
  const { w, h } = PHONES[cfg.orient];
  const wrap = $("phoneWrap");
  const k = Math.min(1, wrap.clientWidth / w, (innerHeight * 0.72) / h);
  cdev.style.width = `${w}px`;
  cdev.style.height = `${h}px`;
  cdev.style.transform = `scale(${k})`;
  wrap.style.height = `${h * k}px`;
  renderer.setPixelRatio(
    Math.min(2, (devicePixelRatio || 1) * Math.max(k, 0.5)),
  );
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = phoneCamera(w, h).fovDeg;
  camera.updateProjectionMatrix();
}

function render() {
  const t0 = performance.now();
  const voice = cfg.voice === "yes";
  const legible = lettersPx(cfg.d, cfg.orient) >= cfg.thr;
  const onPlate = voice && cfg.words === "sign" && legible;
  camera.position.set(0, EYE_M, cfg.d);
  camera.lookAt(0, (kind.SIGN.cyM + kind.PLATE.cyM) / 2 - 0.15, 0);
  part.update({
    seconds: 1.2,
    viewer: camera.position,
    turn: true,
    growth: cfg.grow === "on",
  });
  if (!voice) {
    part.setSign("novoice", "Tap the sign to read");
  } else {
    part.setSign("speaking", onPlate ? "Tap the words to pause" : "");
  }
  part.setLevel(0.6);
  const lit = wordAt(timeline.words, tNow);
  const line = plateLines.lineOf[Math.max(0, lit)] ?? 0;
  part.drawPlate(lit, Math.max(0, line), 0.5);
  part.setPlateOpacity(onPlate ? 1 : 0);
  box.show(voice && !onPlate);
  box.frame(1, tNow, true);
  renderer.render(scene, camera);
  $("cost").textContent =
    `preview drawn in ${(performance.now() - t0).toFixed(1)} ms · ${renderer.info.render.calls} draws · drawn only when a setting changes`;
}

// ---------- the editor side: the choice, the warning, the top view ----------
function setOn(sel, test) {
  document.querySelectorAll(sel).forEach((b) => {
    const on = test(b);
    b.classList.toggle("on", on);
    if (b.getAttribute("role") === "radio") {
      b.setAttribute("aria-checked", String(on));
    }
  });
}

function circle(r, cls, extra = "") {
  return `<circle cx="0" cy="0" r="${r.toFixed(1)}" class="${cls}" ${extra}/>`;
}

function updateEditor() {
  const voice = cfg.voice === "yes";
  setOn("[data-words]", (b) => b.dataset.words === cfg.words);
  setOn("[data-d]", (b) => Number(b.dataset.d) === cfg.d);
  setOn("[data-cfg]", (b) => String(cfg[b.dataset.cfg]) === b.dataset.v);
  $("wordsField").hidden = !voice;
  $("noVoiceHelp").hidden = voice;
  $("voiceBtn").textContent = voice ? "Remove voice" : "Add a voice";
  $("voiceName").textContent = voice
    ? "pump-house-voice.ogg · 0:58"
    : "No voice yet";
  $("who").style.color = SPEAKER.color;
  $("wordsHelp").textContent =
    cfg.words === "sign"
      ? "The words hang on a plate under the sign while a visitor can read it. Too far, too steep or turned away, they move to the box at the bottom; never in both places."
      : "The words show in the box at the bottom of the phone. The sign says who speaks; its plate stays empty.";

  const upUp = legibleUpTo("portrait");
  const upSide = legibleUpTo("landscape");
  const px = lettersPx(cfg.d, cfg.orient);
  const pxUp = lettersPx(cfg.d, "portrait");
  const pxSide = lettersPx(cfg.d, "landscape");
  const msg = $("msg");
  let cls = "holds";
  let text;
  if (!voice) {
    text = "Without a voice there are no words to place.";
    cls = "info";
  } else if (cfg.words === "screen") {
    text = `On screen: every visitor reads the box. The plate would be legible from up to ${m1(upUp)} m upright, ${m1(upSide)} m sideways.`;
    cls = "info";
  } else if (cfg.d > STATION_RADIUS_M) {
    text = `${cfg.d} m is outside the station's ${STATION_RADIUS_M} m circle: the voice does not play there.`;
    cls = "warn";
  } else if (pxUp < cfg.thr) {
    text = `Too far to read the sign: at ${cfg.d} m its letters are ${m1(pxUp)} px on an upright phone, under the ${cfg.thr} px a phone shows legibly. Visitors who stand there read the words in the box. The plate is legible up to ${m1(upUp)} m: put the sign nearer to where people stand, or choose On screen.`;
    cls = "warn";
  } else if (pxSide < cfg.thr) {
    text = `Legible upright (${m1(pxUp)} px), not sideways (${m1(pxSide)} px): a visitor holding the phone sideways at ${cfg.d} m reads the box. Upright up to ${m1(upUp)} m, sideways up to ${m1(upSide)} m.`;
    cls = "warn soft";
  } else {
    text = `Legible from ${cfg.d} m: letters ${m1(pxUp)} px upright, ${m1(pxSide)} px sideways. Up to ${m1(upUp)} m upright, ${m1(upSide)} m sideways.`;
  }
  msg.className = `cmsg ${cls}`;
  msg.textContent = text;

  // top view: 100 px for the 20 m station radius; the sign at the centre faces the visitor
  const s = 100 / STATION_RADIUS_M;
  const showRings = voice && cfg.words === "sign";
  $("plan").innerHTML = [
    circle(STATION_RADIUS_M * s, "pl-st"),
    showRings ? circle(Math.min(upUp, 21) * s, "pl-up") : "",
    showRings ? circle(Math.min(upSide, 21) * s, "pl-sd") : "",
    `<rect x="${(-0.9 * s).toFixed(1)}" y="-2" width="${(1.8 * s).toFixed(1)}" height="4" rx="1.5" class="pl-sign"/>`,
    `<circle cx="0" cy="${(cfg.d * s).toFixed(1)}" r="4.5" class="pl-me"/>`,
    `<text x="7" y="${(cfg.d * s + 4).toFixed(1)}" class="pl-t">${cfg.d} m</text>`,
  ].join("");

  $("cap").textContent =
    `Preview: the phone ${cfg.orient === "portrait" ? "upright" : "sideways"} at ${cfg.d} m · letters ${m1(px)} px · ${!voice ? "no words" : cfg.words === "screen" ? "words in the box (On screen)" : px >= cfg.thr ? "words on the plate" : "words in the box (too small to read)"}`;
}

function refresh(rebuild = false) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(cfg)) {
    url.searchParams.set(k, String(v));
  }
  history.replaceState(null, "", url);
  if (rebuild) {
    buildPart();
  }
  updateEditor();
  layoutPhone();
  render();
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) {
    return;
  }
  if (b.dataset.words) {
    cfg.words = b.dataset.words;
    refresh(true);
  } else if (b.dataset.d) {
    cfg.d = Number(b.dataset.d);
    refresh();
  } else if (b.dataset.cfg) {
    const k = b.dataset.cfg;
    cfg[k] = k === "thr" ? Number(b.dataset.v) : b.dataset.v;
    refresh();
  } else if (b.id === "voiceBtn") {
    cfg.voice = cfg.voice === "yes" ? "no" : "yes";
    refresh(true);
  }
});
addEventListener("resize", () => {
  layoutPhone();
  render();
});

buildPart();
refresh();
// fonts arrive after the first draw: redraw the canvases once they are in
document.fonts?.ready.then(() => refresh(true));
