// The shared stage for the "quiz in the world" prototypes. Throwaway; not wired to the app.
//
// A variant's page calls runStage({ kind, samples, title }). The stage owns the scene, camera,
// renderer, frame loop, lights, all input and the story card. A kind gets the seam only:
// kind.world(block, env) and kind.card?.(block, el, env). See README.md.
//
// Reused ideas, all rewritten here: the eye-height camera, drag gain and pitch clamp of
// editor3d-2-walk-it-r2; the walk sheet, tokens, portrait and answer tiles of
// quiz-visitor-1-story-card; the import map of the gallery's three.js pages.
import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

/* ---------- what the feel rests on: tune here ---------- */
const EYE = 1.6; // metres
const WALK_SPEED = 1.4; // metres per second
const RUN_SPEED = 2.8; // desktop, Shift
const EDGE = 20; // half the 40 m place
const RING = 12; // the station's ring
const RING_BACK = 11.6; // coming back: a little inside, so the edge does not flicker
const DPR_CAP = 2;
const LOOK_GAIN = 0.0042; // radians per CSS pixel
const LOOK_INERTIA_TAU = 0.14; // seconds
const MOVE_TAU = 0.14; // seconds to reach walking speed
const TAP_WALK_TURN_TAU = 0.9; // seconds: a tap-walk turns the view gently along its way
const STICK_REACH = 44; // CSS pixels
const STICK_DEAD = 0.12;
const STICK_TURN = 0.8; // radians per second at full sideways: one thumb can steer
const STICK_STRAFE = 0.5;
const BOB = 0.012; // metres, a step's rise
const STEP_LENGTH = 0.7; // metres
const TAP_MOVE_PX = 10;
const TAP_MS = 400;
const HIT_MIN_PX = 26; // a hit area is never smaller than a thumb on screen
const HANDLE_PX = 44;

const LOOKS = {
  bright: {
    sky: ["#8fc0e8", "#dbe8f0", "#efe9dd"],
    fog: "#dfe7ea",
    hemi: [0xffffff, 0xbfb6a4, 1.75],
    sun: [0xfff4e6, 1.5],
    outer: "#b7b09f",
  },
  dark: {
    sky: ["#070b16", "#141b2d", "#1e2536"],
    fog: "#141b2a",
    hemi: [0x8fa4c8, 0x1a1c24, 0.5],
    sun: [0xbcd0ff, 0.3],
    outer: "#3a3d45",
  },
};

const FONT =
  'Corbel, "Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const DEFAULT_STORY = {
  speaker: "Greta, the guide",
  station: "The Old Square",
  before:
    "This square has heard more gossip than any town hall. Stay with me a moment, I want to show you something.",
  after: "Good. The next stop is through the gate. Mind the step.",
};

const PORTRAIT = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <rect width="64" height="64" fill="#3a4a5a"/>
  <path d="M8 64c2-14 12-19 24-19s22 5 24 19z" fill="#8c6a48"/>
  <path d="M24 45c4 3 12 3 16 0l2 19H22z" fill="#efe7d8"/>
  <rect x="27" y="35" width="10" height="12" rx="4" fill="#d9a67c"/>
  <ellipse cx="32" cy="27" rx="13.5" ry="15" fill="#ecbf98"/>
  <path d="M17 24c0-11 7-17 15-17s15 6 15 17c-3-5-9-7-15-7s-12 2-15 7z" fill="#f4efe6"/>
  <circle cx="26.5" cy="28" r="1.8" fill="#26211c"/><circle cx="37.5" cy="28" r="1.8" fill="#26211c"/>
  <g class="m m-calm" fill="none" stroke="#6b4a33" stroke-width="1.8" stroke-linecap="round"><path d="M23 23.5q3.5-1.6 6.5 0M34.5 23.5q3.5-1.6 6.5 0"/><path d="M28 36.5q4 2 8 0"/></g>
  <g class="m m-happy" fill="none" stroke="#6b4a33" stroke-width="1.8" stroke-linecap="round"><path d="M23 22q3.5-2.6 6.5-.4M34.5 21.6q3-2.2 6.5.4"/><path d="M26.5 34.5q5.5 6.5 11 0z" fill="#fff"/></g>
  <g class="m m-doubt" fill="none" stroke="#6b4a33" stroke-width="1.8" stroke-linecap="round"><path d="M23 23q3.5-1.2 6.5 0M34.5 21.6q3-2.6 6.5-1.4"/><path d="M29 37.4l6.4-1"/></g>
</svg>`;

const CSS = `
:root {
  --walk-accent: #fb923c;
  --walk-accent-ink: #1f1105;
  --walk-found: #2dd4bf;
  --walk-found-ink: #04201c;
  --walk-ink: #f3f5f7;
  --walk-muted: #b3bcc6;
  --walk-surface: rgb(12 16 21 / 80%);
  --walk-surface-2: rgb(255 255 255 / 7%);
  --walk-line: rgb(255 255 255 / 15%);
  --walk-danger: #f87171;
  --gold: #e5ab3e;
  --tap: 44px;
  --font: ${FONT};
}
html, body { height: 100%; margin: 0; overflow: hidden; background: #14171d; }
.qs, .qs * { box-sizing: border-box; }
.qs [hidden] { display: none !important; }
.qs p { margin: 0; }
.qs {
  position: fixed; inset: 0; overflow: hidden; color: var(--walk-ink);
  font: 15px/1.4 var(--font); font-variant-numeric: lining-nums;
  -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent;
  -webkit-user-select: none; user-select: none;
  --card-h: 0px; --kbd: 0px;
}
.qs button, .qs input, .qs textarea, .qs select { font: inherit; color: inherit; }
.qs button { cursor: pointer; }
.qs input, .qs textarea { -webkit-user-select: text; user-select: text; }
.qs .gl { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: 0; cursor: grab; }
.qs .gl:active { cursor: grabbing; }

.qs .top {
  position: absolute; z-index: 6; top: calc(10px + env(safe-area-inset-top));
  left: 12px; right: 12px; display: flex; align-items: flex-start; gap: 8px; pointer-events: none;
}
.qs .top .sp { flex: 1; }
.qs .seg {
  pointer-events: auto; display: flex; height: var(--tap); padding: 3px; border-radius: 22px;
  border: 1px solid rgb(255 255 255 / 34%); background: rgb(10 14 18 / 55%);
}
.qs .seg button {
  min-width: 54px; padding: 0 10px; border: 0; border-radius: 19px; background: transparent;
  color: #fff; font-size: 13px; font-weight: 600;
}
.qs .seg button[aria-pressed="true"] { background: #fff; color: #14171d; }
.qs .pillbtn {
  pointer-events: auto; min-height: var(--tap); padding: 0 12px; border-radius: 22px;
  border: 1px solid rgb(255 255 255 / 34%); background: rgb(10 14 18 / 55%); color: #fff;
  font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums;
}
.qs .hint {
  position: absolute; z-index: 5; top: calc(62px + env(safe-area-inset-top)); left: 50%;
  transform: translateX(-50%); max-width: calc(100% - 24px); padding: 5px 12px; border-radius: 12px;
  background: rgb(10 14 18 / 55%); color: #fff; font-size: 13px; line-height: 1.3; text-align: center;
  pointer-events: none; transition: opacity 0.8s;
}
.qs .hint.gone { opacity: 0; }
.qs .toast {
  position: absolute; z-index: 9; top: calc(100px + env(safe-area-inset-top)); left: 50%;
  transform: translateX(-50%); max-width: min(320px, 80%); padding: 9px 14px; border-radius: 12px;
  background: rgb(255 255 255 / 92%); color: #111; font-size: 14px; font-weight: 600; text-align: center;
  box-shadow: 0 8px 24px rgb(0 0 0 / 30%);
}

/* the walking stick: above the card, on the right thumb's side */
.qs .stick {
  position: absolute; z-index: 7; right: 14px;
  bottom: min(calc(max(var(--card-h), 30%) + 14px), calc(100% - 190px));
  transition: bottom 0.2s ease;
  width: 124px; height: 124px; touch-action: none; display: none;
}
.qs .stick::before {
  content: ""; position: absolute; inset: 14px; border-radius: 50%;
  border: 1.5px solid rgb(255 255 255 / 55%); background: rgb(10 14 18 / 34%);
}
.qs .stick i {
  position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px;
  border-radius: 50%; background: rgb(255 255 255 / 82%); box-shadow: 0 2px 10px rgb(0 0 0 / 35%);
  pointer-events: none;
}
.qs .stick.on::before { border-color: var(--walk-found); }
@media (pointer: coarse) { .qs .stick { display: block; } }

/* the tools panel: the cost readout, ten rounds, the samples */
.qs .tools {
  position: absolute; z-index: 8; top: calc(62px + env(safe-area-inset-top)); right: 12px;
  width: min(300px, calc(100% - 24px)); max-height: calc(100% - 84px); overflow: auto;
  padding: 10px 12px 12px; border-radius: 16px; border: 1px solid var(--walk-line);
  background: rgb(12 16 21 / 90%); font-size: 13px;
}
.qs .tools h2 {
  margin: 8px 0 3px; font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--walk-muted);
}
.qs .tools h2:first-child { margin-top: 0; }
.qs .tools pre {
  margin: 0; font: 11.5px/1.45 ui-monospace, Consolas, monospace; white-space: pre-wrap;
  font-variant-numeric: tabular-nums;
}
.qs .tools .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.qs .tools .row .btn { min-height: 38px; padding: 6px 10px; font-size: 13px; }
.qs .tools .row .btn[aria-pressed="true"] { border-color: var(--walk-found); color: var(--walk-found); }

/* ---------- the story card: the walk sheet, as in the app ---------- */
.qs .sheet {
  position: absolute; z-index: 8; left: 0; right: 0; bottom: var(--kbd); max-height: 66%;
  margin: 0 auto; max-width: 520px; display: flex; flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom); border-top: 1px solid var(--walk-line);
  border-radius: 22px 22px 0 0; background: var(--walk-surface);
  box-shadow: 0 -10px 30px rgb(0 0 0 / 25%);
  -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2);
}
.qs[data-mode="edit"] .sheet { max-height: 36%; }
@media (min-width: 900px) and (min-height: 600px) {
  .qs[data-mode="edit"] .sheet {
    left: auto; right: 12px; bottom: 12px; width: 340px; max-height: calc(100% - 84px);
    border: 1px solid var(--walk-line); border-radius: 20px;
  }
}
.qs .grab { position: relative; flex: none; display: block; width: 100%; height: 22px; padding: 0; border: 0; background: transparent; }
.qs .grab::before { content: ""; position: absolute; inset: -11px 0; }
.qs .grab i { display: block; width: 40px; height: 5px; margin: 8px auto 0; border-radius: 3px; background: rgb(255 255 255 / 40%); }
.qs .body { flex: 1 1 auto; min-height: 0; padding: 0 16px 14px; overflow-y: auto; overscroll-behavior: contain; }

.qs .eyerow { display: flex; align-items: center; gap: 10px; min-height: 20px; margin-bottom: 6px; }
.qs .eyebrow {
  flex: 1; min-width: 0; color: var(--walk-found); font-size: 11.5px; font-weight: 700;
  letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.qs .eyebrow.done { color: var(--walk-muted); }
.qs .who { display: flow-root; min-height: 70px; }
.qs .portrait {
  float: left; display: block; width: 64px; height: 64px; margin: 2px 12px 4px 0; border-radius: 50%;
  background: #1b2232; overflow: hidden; box-shadow: 0 0 0 3px var(--gold), 0 6px 18px rgb(0 0 0 / 30%);
}
.qs .portrait svg { display: block; width: 100%; height: 100%; }
.qs .portrait .m { display: none; }
.qs .portrait[data-mood="calm"] .m-calm,
.qs .portrait[data-mood="happy"] .m-happy,
.qs .portrait[data-mood="doubt"] .m-doubt { display: inline; }
.qs .portrait[data-mood="happy"] { animation: qs-hop 0.55s cubic-bezier(0.3, 1.6, 0.5, 1); }
.qs .portrait[data-mood="doubt"] { animation: qs-tilt 0.6s ease; }
@keyframes qs-hop { 35% { transform: translateY(-9px); } }
@keyframes qs-tilt { 30% { transform: rotate(-11deg); } 65% { transform: rotate(7deg); } }
.qs .speaker { font-weight: 600; color: var(--walk-muted); font-size: 13.5px; line-height: 1.3; }
.qs .line { font-size: 17px; line-height: 1.38; font-weight: 500; }
.qs .line.ask { font-weight: 600; }
.qs .echo { font-size: 13px; line-height: 1.3; color: var(--walk-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qs .in { animation: qs-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1); }
@keyframes qs-in { from { opacity: 0; transform: translateY(7px); } }
.qs .plus { display: inline-block; margin-left: 6px; padding: 0 8px; border-radius: 999px; background: #ffd391; color: #2a1a04; font-size: 14px; font-weight: 700; line-height: 1.5; }
.qs .plus.none { background: rgb(255 255 255 / 14%); color: var(--walk-ink); }

/* the answer tiles, for a kind's card */
.qs .answers { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.qs .a {
  position: relative; display: flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 64px; padding: 8px 10px; border: 1.5px solid rgb(255 255 255 / 42%); border-radius: 14px;
  background: rgb(255 255 255 / 11%); color: #fff; font-size: 22px; font-weight: 700; line-height: 1.15;
  touch-action: manipulation; transition: background 0.15s, opacity 0.25s;
}
.qs .answers.small .a { font-size: 16px; font-weight: 600; min-height: 60px; }
.qs .a:active:not(:disabled) { background: rgb(255 255 255 / 24%); }
.qs .a:disabled { cursor: default; }
.qs .a.on { border-color: var(--walk-accent); background: rgb(251 146 60 / 22%); }
.qs .a.right { border-color: var(--walk-found); background: var(--walk-found); color: var(--walk-found-ink); animation: qs-pop 0.3s cubic-bezier(0.3, 1.6, 0.5, 1); }
.qs .a.wrong { border-color: var(--walk-danger); background: rgb(248 113 113 / 18%); color: #fecaca; text-decoration: line-through; text-decoration-thickness: 2px; animation: qs-shake 0.35s ease; }
.qs .a.was { border-color: var(--walk-found); color: #a7f3e6; background: transparent; }
.qs .a.dim { opacity: 0.42; }
@keyframes qs-pop { 50% { transform: scale(1.04); } }
@keyframes qs-shake { 25% { transform: translateX(-5px); } 60% { transform: translateX(4px); } }
.qs .typed { display: flex; gap: 8px; margin-top: 12px; }
.qs .field { flex: 1; min-width: 0; height: 60px; padding: 0 14px; border: 1.5px solid rgb(255 255 255 / 55%); border-radius: 14px; background: rgb(255 255 255 / 12%); color: #fff; font-size: 21px; font-weight: 600; outline: 0; }
.qs .field:focus { border-color: var(--walk-found); }
.qs .field::placeholder { color: #c6cdd5; font-weight: 500; font-size: 17px; }
.qs .field.wrong { border-color: var(--walk-danger); color: #fecaca; animation: qs-shake 0.35s ease; }
.qs .field.right { border-color: var(--walk-found); background: var(--walk-found); color: var(--walk-found-ink); }
.qs .check { flex: none; min-width: 92px; height: 60px; border: 0; border-radius: 14px; background: var(--walk-found); color: var(--walk-found-ink); font-size: 17px; font-weight: 700; }
.qs .check:disabled { background: rgb(255 255 255 / 12%); color: var(--walk-muted); cursor: default; }
.qs .stamp { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 5px 10px; border-radius: 9px; background: rgb(255 255 255 / 12%); font-size: 14px; font-weight: 600; }

.qs .dots { display: flex; gap: 5px; margin: 12px 0 10px; }
.qs .dots i { width: 22px; height: 4px; border-radius: 2px; background: rgb(255 255 255 / 22%); }
.qs .dots i.on, .qs .dots i.now { background: var(--walk-found); }
.qs .acts { display: flex; flex-wrap: wrap; gap: 8px; }
.qs .btn {
  min-height: var(--tap); padding: 10px 16px; border: 1px solid rgb(255 255 255 / 28%); border-radius: 14px;
  background: var(--walk-surface-2); color: var(--walk-ink); font-size: 14px; font-weight: 600; line-height: 1.2;
}
.qs .btn.primary { flex: 1; border-color: var(--walk-found); background: var(--walk-found); color: var(--walk-found-ink); font-size: 16px; }
.qs .btn.primary:disabled { opacity: 0.55; cursor: default; }

.qs .fold { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 60px; padding: 0; border: 0; background: transparent; text-align: left; }
.qs .fold .mark { flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: #ffd391; color: #2a1a04; font-size: 24px; font-weight: 700; }
.qs .fold b { display: block; font-size: 17px; font-weight: 700; line-height: 1.2; }
.qs .fold small { display: block; margin-top: 2px; font-size: 13.5px; color: var(--walk-muted); line-height: 1.3; }

/* the edit panel: a kind's FieldSpec */
.qs .f { display: block; margin-top: 10px; font-size: 12.5px; font-weight: 600; color: var(--walk-muted); }
.qs .f.check-row { display: flex; align-items: center; gap: 10px; min-height: var(--tap); margin-top: 4px; }
.qs .f.check-row input { width: 22px; height: 22px; margin: 0; accent-color: var(--walk-found); }
.qs .f input[type="text"], .qs .f input[type="number"], .qs .f textarea, .qs .f select {
  display: block; width: 100%; min-height: var(--tap); margin-top: 3px; padding: 8px 10px;
  border: 1px solid rgb(255 255 255 / 34%); border-radius: 10px; background: rgb(255 255 255 / 9%);
  color: #fff; font-size: 16px; font-weight: 500; outline: 0;
}
.qs .f select option { color: #111; }
.qs .f textarea { min-height: 72px; resize: vertical; }
.qs .f input:focus, .qs .f textarea:focus, .qs .f select:focus { border-color: var(--walk-found); }
.qs .f input[type="range"] { display: block; width: 100%; height: var(--tap); margin: 0; accent-color: var(--walk-found); }
.qs .f .where { display: block; margin-top: 3px; font-size: 14px; color: var(--walk-ink); font-weight: 500; font-variant-numeric: tabular-nums; }

/* a phone held sideways: the card at the bottom left, the stick at the bottom right */
@media (orientation: landscape) and (max-height: 520px) {
  .qs .sheet, .qs[data-mode="edit"] .sheet {
    left: 10px; right: auto; bottom: calc(10px + var(--kbd)); width: min(370px, 48%);
    max-height: calc(100% - 74px); margin: 0; padding-bottom: 0; border: 1px solid var(--walk-line); border-radius: 20px;
  }
  .qs[data-mode="edit"] .sheet { width: min(320px, 40%); }
  .qs .body { padding-bottom: 10px; }
  .qs .who { min-height: 48px; }
  .qs .portrait { width: 44px; height: 44px; margin-right: 10px; }
  .qs .line { font-size: 15.5px; line-height: 1.3; }
  .qs .answers { margin-top: 8px; gap: 6px; }
  .qs .a { min-height: 50px; font-size: 19px; }
  .qs .answers.small .a { min-height: 50px; font-size: 14.5px; }
  .qs .typed { margin-top: 8px; }
  .qs .field, .qs .check { height: 50px; }
  .qs .dots { margin: 8px 0 6px; }
  .qs .acts .btn { min-height: 40px; padding: 7px 12px; }
  .qs .fold { min-height: 48px; }
  .qs .stick { bottom: 10px; right: 10px; }
  .qs .hint { left: auto; right: 12px; transform: none; max-width: 44%; }
}
@media (prefers-reduced-motion: reduce) {
  .qs *, .qs *::before, .qs *::after { animation: none !important; transition: none !important; }
}
`;

/* ---------- small helpers ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (dt, tau) => 1 - Math.exp(-dt / tau);
const angDiff = (a, b) => {
  const d = (b - a) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
};
const getPath = (o, path) =>
  path.split(".").reduce((v, k) => (v == null ? v : v[k]), o);
const setPath = (o, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  const at = keys.reduce((v, k) => (v[k] ??= {}), o);
  at[last] = value;
};
const shown = (o, root) => {
  for (let n = o; n; n = n.parent) {
    if (!n.visible) return false;
    if (n === root) return true;
  }
  return true;
};
const nameOf = (o, root) => {
  for (let n = o; n; n = n.parent) {
    if (n.name) return n.name;
    if (n === root) break;
  }
  return "";
};

/* The format's toolkit as a kind's read() gets it. */
const READ_TOOLS = {
  requiredText(v, field, rule = {}) {
    const value = v?.[field];
    if (typeof value !== "string" || !value.trim())
      throw new Error(`"${field}" is required`);
    if (rule.max && [...value].length > rule.max)
      throw new Error(`"${field}" is over ${rule.max}`);
    return value;
  },
  optionalText(v, field, rule = {}) {
    const value = v?.[field];
    if (typeof value !== "string" || !value.trim()) return {};
    if (rule.max && [...value].length > rule.max) return {};
    return { [field]: value };
  },
  metres(value, at, [min, max]) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    ) {
      throw new Error(
        `"${at}" must be a number of metres from ${min} to ${max}`,
      );
    }
    return value;
  },
};

/* ---------- the place: one merged mesh, one ground texture, nothing loaded ---------- */
function roofGeometry(w, d, h) {
  const a = [-w / 2, 0, -d / 2];
  const b = [w / 2, 0, -d / 2];
  const c = [w / 2, 0, d / 2];
  const e = [-w / 2, 0, d / 2];
  const f = [-w / 2, h, 0];
  const g = [w / 2, h, 0];
  const g0 = new BufferGeometry();
  g0.setAttribute(
    "position",
    new Float32BufferAttribute(
      [e, c, g, e, g, f, b, a, f, b, f, g, a, e, f, c, b, g].flat(),
      3,
    ),
  );
  g0.computeVertexNormals();
  return g0;
}

function buildPlaceMesh(renderer) {
  const pos = [];
  const nor = [];
  const col = [];
  const tint = new Color();
  const add = (geo, color, x = 0, y = 0, z = 0, ry = 0) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    tint.set(color);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(tint.r, tint.g, tint.b);
    }
    geo.dispose();
    g.dispose();
  };
  const box = (w, h, d) => new BoxGeometry(w, h, d);
  const cyl = (r0, r1, h, n = 12) => new CylinderGeometry(r0, r1, h, n);

  const house = (x, z, w, d, h, color, facing, roof = "#a65f46") => {
    const c = Math.cos(facing);
    const s = Math.sin(facing);
    const local = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    add(box(w, h, d), color, x, h / 2, z, facing);
    add(roofGeometry(w + 0.6, d + 0.8, 2.2), roof, x, h, z, facing);
    const floors = Math.floor(h / 3);
    const cols = Math.floor(w / 3);
    for (let fl = 0; fl < floors; fl++) {
      for (let i = 0; i < cols; i++) {
        const lx = (i - (cols - 1) / 2) * 3;
        const isDoor = fl === 0 && i === Math.floor(cols / 2);
        const [wx, wz] = local(lx, d / 2 + 0.03);
        if (isDoor) add(box(1.3, 2.3, 0.08), "#5a3d2c", wx, 1.15, wz, facing);
        else add(box(1, 1.4, 0.08), "#5d6d7e", wx, 1.7 + fl * 3, wz, facing);
      }
    }
  };

  // the edges of the square: everything solid stands just outside the walkable 40 m
  house(-25, -12, 11, 8, 9, "#e7dcc8", Math.PI / 2);
  house(-25, 0, 10, 8, 12, "#d9e2e6", Math.PI / 2, "#7c6a5c");
  house(-25, 11, 10, 8, 7, "#efd9c6", Math.PI / 2);
  house(25, -11, 13, 8, 10, "#e6e2d2", -Math.PI / 2, "#7c6a5c");
  house(25, 3, 11, 8, 7, "#dcc9b6", -Math.PI / 2);
  house(8, -24.5, 20, 8, 9, "#f0e8d8", 0, "#6f7b84"); // the hall
  house(-18, -25, 8, 8, 8, "#e3d3c8", 0);

  // the tower: 25 m from the item's foot, too far to walk to, seen from everywhere
  add(box(5, 15, 5), "#cbb9a0", -10, 7.5, -23);
  add(box(5.6, 3, 5.6), "#e0d2bb", -10, 16.5, -23);
  add(
    new ConeGeometry(4.2, 5, 4).rotateY(Math.PI / 4),
    "#5e6f7d",
    -10,
    20.5,
    -23,
  );
  add(
    new CylinderGeometry(1.5, 1.5, 0.12, 24).rotateX(Math.PI / 2),
    "#fbf8f0",
    -10,
    12.6,
    -20.44,
  );
  add(box(0.14, 1.1, 0.05), "#23282e", -10, 13.1, -20.36);
  add(box(0.8, 0.14, 0.05), "#23282e", -9.65, 12.6, -20.36);
  add(box(1.6, 2.6, 0.1), "#5a3d2c", -10, 1.3, -20.46);

  // the fountain
  add(cyl(2.3, 2.5, 0.55, 20), "#b9b2a4", -8, 0.27, -6);
  add(cyl(2.05, 2.05, 0.04, 20), "#6fb2d6", -8, 0.56, -6);
  add(cyl(0.28, 0.4, 1.7, 10), "#b9b2a4", -8, 1.1, -6);
  add(cyl(0.95, 0.3, 0.25, 14), "#c6bfb1", -8, 2, -6);
  add(new IcosahedronGeometry(0.22, 1), "#c6bfb1", -8, 2.3, -6);

  // the statue
  add(box(1.5, 1.5, 1.5), "#a9a294", 9, 0.75, -7);
  add(box(1.9, 0.2, 1.9), "#928b7e", 9, 0.1, -7);
  add(cyl(0.3, 0.42, 1.5, 10), "#4c6a5e", 9, 2.25, -7);
  add(new IcosahedronGeometry(0.24, 1), "#4c6a5e", 9, 3.2, -7);
  add(box(0.16, 0.16, 1), "#4c6a5e", 9, 2.7, -6.55);

  // trees and a bench
  const tree = (x, z, s = 1) => {
    add(cyl(0.16 * s, 0.26 * s, 3 * s, 8), "#7d6650", x, 1.5 * s, z);
    add(new IcosahedronGeometry(2.1 * s, 1), "#6f9e62", x, 3.9 * s, z);
    add(
      new IcosahedronGeometry(1.5 * s, 1),
      "#7fae6e",
      x + 1.1 * s,
      3.3 * s,
      z + 0.5 * s,
    );
    add(
      new IcosahedronGeometry(1.4 * s, 1),
      "#65945a",
      x - 1 * s,
      3.5 * s,
      z - 0.6 * s,
    );
  };
  tree(10, 7.5);
  tree(-14, 30, 1.5);
  tree(15, 33, 1.3);
  add(box(1.8, 0.08, 0.5), "#8a6a4e", -7, 0.46, 8);
  add(box(1.8, 0.5, 0.07), "#8a6a4e", -7, 0.74, 7.76);
  add(box(0.08, 0.44, 0.45), "#3c4044", -7.8, 0.22, 8);
  add(box(0.08, 0.44, 0.45), "#3c4044", -6.2, 0.22, 8);

  // lamps, the low walls, the gate
  for (const [x, z] of [
    [-15, -15],
    [15, -15],
    [-15, 15],
    [15, 13],
  ]) {
    add(cyl(0.05, 0.08, 3.4, 6), "#3c4044", x, 1.7, z);
    add(new IcosahedronGeometry(0.2, 0), "#fff1cf", x, 3.5, z);
  }
  add(box(18.5, 1.2, 0.5), "#b5a68f", -11.75, 0.6, 21);
  add(box(18.5, 1.2, 0.5), "#b5a68f", 11.75, 0.6, 21);
  add(box(0.5, 1.2, 12), "#b5a68f", 21, 0.6, 15);
  add(box(0.8, 3.2, 0.8), "#a99a84", -2.6, 1.6, 21);
  add(box(0.8, 3.2, 0.8), "#a99a84", 2.6, 1.6, 21);
  add(box(6.2, 0.6, 0.9), "#a99a84", 0, 3.5, 21);

  // a far skyline, so the walls are not the end of the world
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const r = 58 + ((i * 37) % 24);
    add(
      box(16, 8 + ((i * 53) % 14), 14),
      "#b4bcc2",
      Math.cos(a) * r,
      8,
      Math.sin(a) * r,
      a,
    );
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  geo.setAttribute("color", new Float32BufferAttribute(col, 3));
  const solid = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true }));

  const group = new Group();
  group.add(solid);

  const tex = new CanvasTexture(paintGround());
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const ground = new Mesh(
    new PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2),
    new MeshLambertMaterial({ map: tex }),
  );
  group.add(ground);
  const outerMaterial = new MeshLambertMaterial({ color: LOOKS.bright.outer });
  const outer = new Mesh(
    new PlaneGeometry(500, 500).rotateX(-Math.PI / 2),
    outerMaterial,
  );
  outer.position.y = -0.04;
  group.add(outer);
  return { group, solid, outerMaterial };
}

const GROUND_SIZE = 46;

function paintGround() {
  const S = 1024;
  const k = S / GROUND_SIZE;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  g.setTransform(k, 0, 0, k, S / 2, S / 2);
  const half = GROUND_SIZE / 2;
  g.fillStyle = "#b7b09f";
  g.fillRect(-half, -half, GROUND_SIZE, GROUND_SIZE);
  g.fillStyle = "#d8d0bf";
  g.fillRect(-EDGE, -EDGE, EDGE * 2, EDGE * 2);

  // paving, deterministic so every screenshot is the same
  let s = 7;
  const rnd = () =>
    (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let x = -EDGE; x < EDGE; x += 1.2) {
    for (let z = -EDGE; z < EDGE; z += 1.2) {
      const v = 200 + rnd() * 18;
      g.fillStyle = `rgb(${v} ${v - 8} ${v - 22})`;
      g.fillRect(x + 0.03, z + 0.03, 1.14, 1.14);
    }
  }
  // the paved circle at the square's middle and the path to the gate
  g.strokeStyle = "rgb(150 140 120 / 45%)";
  g.lineWidth = 0.14;
  for (const r of [3, 5]) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = "rgb(120 112 96 / 18%)";
  g.fillRect(-1.6, 5, 3.2, EDGE - 5 + 2);

  // grass under the tree, baked soft shadows
  const blob = (x, z, r, color) => {
    const gr = g.createRadialGradient(x, z, r * 0.2, x, z, r);
    gr.addColorStop(0, color);
    gr.addColorStop(1, color.replace(/[\d.]+%\)$/, "0%)"));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, z, r, 0, Math.PI * 2);
    g.fill();
  };
  g.fillStyle = "#93ad78";
  g.beginPath();
  g.ellipse(10, 7.5, 5, 4.2, 0.2, 0, Math.PI * 2);
  g.fill();
  blob(10.6, 8, 3.8, "rgb(30 40 25 / 42%)");
  blob(-8, -6, 3.6, "rgb(30 30 30 / 34%)");
  blob(9.2, -6.8, 1.9, "rgb(30 30 30 / 40%)");
  blob(-7, 8.1, 1.4, "rgb(30 30 30 / 30%)");
  // the shade along the walls
  const edgeShade = (x, z, w, h, x1, z1, x2, z2) => {
    const gr = g.createLinearGradient(x1, z1, x2, z2);
    gr.addColorStop(0, "rgb(30 30 30 / 32%)");
    gr.addColorStop(1, "rgb(30 30 30 / 0%)");
    g.fillStyle = gr;
    g.fillRect(x, z, w, h);
  };
  edgeShade(-EDGE, -EDGE, 3, EDGE * 2, -EDGE, 0, -EDGE + 3, 0);
  edgeShade(-EDGE, -EDGE, EDGE * 2, 3, 0, -EDGE, 0, -EDGE + 3);
  edgeShade(EDGE - 3, -EDGE, 3, EDGE * 2, EDGE, 0, EDGE - 3, 0);
  return cv;
}

/** Where a quiz can point: world positions, aimed at the thing's readable part. */
const ANCHORS = {
  fountain: [-8, 1.6, -6],
  statue: [9, 2.6, -7],
  tree: [10, 3.6, 7.5],
  bench: [-7, 0.6, 8],
  gate: [0, 2, 21],
  hall: [8, 2, -20.5],
  tower: [-10, 13, -23],
};

function buildSky() {
  const geo = new SphereGeometry(280, 16, 10);
  geo.setAttribute(
    "color",
    new Float32BufferAttribute(
      new Float32Array(geo.attributes.position.count * 3),
      3,
    ),
  );
  const sky = new Mesh(
    geo,
    new MeshBasicMaterial({
      vertexColors: true,
      side: BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  sky.renderOrder = -10;
  return sky;
}

function paintSky(sky, [top, mid, low]) {
  const p = sky.geometry.attributes.position;
  const c = sky.geometry.attributes.color;
  const a = new Color(top);
  const b = new Color(mid);
  const d = new Color(low);
  const out = new Color();
  for (let i = 0; i < p.count; i++) {
    const h = p.getY(i) / 280;
    if (h >= 0) out.lerpColors(b, a, Math.min(1, h / 0.55));
    else out.lerpColors(b, d, Math.min(1, -h / 0.15));
    c.setXYZ(i, out.r, out.g, out.b);
  }
  c.needsUpdate = true;
}

/* ---------- a tone for env.sound, no files ---------- */
const TONES = {
  tap: [[660, 0.06]],
  right: [
    [660, 0.09],
    [880, 0.14],
  ],
  wrong: [[220, 0.2]],
  done: [
    [523, 0.1],
    [659, 0.1],
    [784, 0.2],
  ],
};

/* ---------- the stage ---------- */
export function runStage(options) {
  const {
    kind,
    block,
    samples,
    title = "Quiz in the world",
    story,
    at,
    heading = 0,
  } = options ?? {};
  if (
    !kind ||
    typeof kind.name !== "string" ||
    typeof kind.world !== "function"
  ) {
    throw new Error(
      "runStage needs a kind with a name and a world(block, env)",
    );
  }
  const sampleMap = samples ?? { normal: block ?? {} };
  const sampleNames = Object.keys(sampleMap);
  if (!sampleNames.length)
    throw new Error("runStage needs a block or at least one sample");
  const tale = { ...DEFAULT_STORY, ...story };
  const foot = { x: at?.x ?? 0, z: at?.z ?? 0 };

  document.title = title;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const root = document.createElement("main");
  root.className = "qs";
  root.dataset.mode = "play";
  root.dataset.look = "bright";
  root.innerHTML = `
    <canvas class="gl" tabindex="0" aria-label="The place, in 3D"></canvas>
    <div class="top">
      <div class="seg" role="group" aria-label="Mode">
        <button type="button" data-mode="play" aria-pressed="true">Play</button>
        <button type="button" data-mode="edit" aria-pressed="false">Edit</button>
      </div>
      <div class="seg" role="group" aria-label="Backdrop">
        <button type="button" data-look="bright" aria-pressed="true">Bright</button>
        <button type="button" data-look="dark" aria-pressed="false">Dark</button>
      </div>
      <span class="sp"></span>
      <button type="button" class="pillbtn" id="qsCost" aria-expanded="false">Cost</button>
    </div>
    <p class="hint"></p>
    <div class="toast" hidden></div>
    <div class="stick" role="img" aria-label="Walk: push the stick"><i></i></div>
    <aside class="tools" hidden>
      <h2 id="qsTitle"></h2>
      <pre id="qsNow"></pre>
      <h2>After ten open and close rounds</h2>
      <pre id="qsAfter">Not run yet.</pre>
      <div class="row"><button type="button" class="btn" id="qsTen">Run ten rounds</button></div>
      <h2>Sample</h2>
      <div class="row" id="qsSamples"></div>
    </aside>
    <section class="sheet" aria-label="Story">
      <button type="button" class="grab" aria-label="Fold the card"><i></i></button>
      <div class="body" aria-live="polite">
        <div class="story">
          <div class="eyerow"><p class="eyebrow"></p></div>
          <div class="who">
            <span class="portrait" data-mood="calm">${PORTRAIT}</span>
            <p class="speaker"></p>
            <p class="line"></p>
          </div>
          <div class="slot"></div>
          <div class="dots" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="acts"></div>
        </div>
        <button type="button" class="fold" hidden>
          <span class="mark" aria-hidden="true">?</span>
          <span><b></b><small></small></span>
        </button>
        <div class="edit" hidden></div>
      </div>
    </section>`;
  document.body.append(root);

  const $ = (s) => root.querySelector(s);
  const ui = {
    canvas: $(".gl"),
    hint: $(".hint"),
    toast: $(".toast"),
    stick: $(".stick"),
    knob: $(".stick i"),
    tools: $(".tools"),
    costBtn: $("#qsCost"),
    now: $("#qsNow"),
    after: $("#qsAfter"),
    sheet: $(".sheet"),
    grab: $(".grab"),
    story: $(".story"),
    fold: $(".fold"),
    edit: $(".edit"),
    eyebrow: $(".eyebrow"),
    who: $(".who"),
    portrait: $(".portrait"),
    speaker: $(".speaker"),
    line: $(".line"),
    slot: $(".slot"),
    dots: $(".dots"),
    acts: $(".acts"),
  };
  $("#qsTitle").textContent = title;
  ui.slot.dataset.kind = kind.name;
  ui.edit.dataset.kind = kind.name;
  ui.speaker.textContent = tale.speaker;

  let toastTimer = 0;
  const toast = (text) => {
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (ui.toast.hidden = true), 4000);
  };

  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas: ui.canvas, antialias: true });
  } catch (err) {
    toast("This browser could not start WebGL, so the stage cannot run here.");
    console.error(err);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));

  /* ---------- scene ---------- */
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.05, 400);
  camera.rotation.order = "YXZ";
  scene.fog = new Fog(0xffffff, 40, 150);
  const hemi = new HemisphereLight();
  const sun = new DirectionalLight();
  sun.position.set(-30, 50, 20);
  scene.add(hemi, sun);
  const sky = buildSky();
  scene.add(sky);
  const place = buildPlaceMesh(renderer);
  scene.add(place.group);

  const ringMat = new MeshBasicMaterial({
    color: "#fb923c",
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const ring = new Mesh(
    new RingGeometry(RING - 0.2, RING + 0.2, 96).rotateX(-Math.PI / 2),
    ringMat,
  );
  ring.position.set(foot.x, 0.02, foot.z);
  ring.renderOrder = 1;
  scene.add(ring);

  const marker = new Mesh(
    new RingGeometry(0.26, 0.36, 32).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  marker.position.y = 0.03;
  marker.visible = false;
  scene.add(marker);

  // A kind's object hangs from this: the stage sets position and heading, a kind never does.
  const holder = new Group();
  holder.position.set(foot.x, 0, foot.z);
  holder.rotation.y = heading;
  scene.add(holder);
  const cosH = Math.cos(heading);
  const sinH = Math.sin(heading);
  const toLocal = (out, wx, wy, wz) => {
    const dx = wx - foot.x;
    const dz = wz - foot.z;
    return out.set(dx * cosH - dz * sinH, wy, dx * sinH + dz * cosH);
  };

  const applyLook = (name) => {
    const l = LOOKS[name];
    paintSky(sky, l.sky);
    scene.fog.color.set(l.fog);
    hemi.color.set(l.hemi[0]);
    hemi.groundColor.set(l.hemi[1]);
    hemi.intensity = l.hemi[2];
    sun.color.set(l.sun[0]);
    sun.intensity = l.sun[1];
    place.outerMaterial.color.set(l.outer);
    root.dataset.look = name;
    root.querySelectorAll(".seg [data-look]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.look === name));
    });
  };

  /* ---------- the viewer ---------- */
  const START = { x: foot.x, z: foot.z + 7.5, yaw: 0, pitch: -0.1 };
  const me = {
    x: START.x,
    z: START.z,
    yaw: START.yaw,
    pitch: START.pitch,
    vx: 0,
    vz: 0,
    phase: 0,
  };
  let walkTo = null;
  let spinYaw = 0;
  let spinPitch = 0;
  const keys = new Set();
  const stick = { id: null, cx: 0, cy: 0, x: 0, y: 0 };
  const stillBody = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const stepViewer = (dt) => {
    let forward = 0;
    let side = 0;
    let top = WALK_SPEED;
    if (keys.has("KeyW") || keys.has("ArrowUp")) forward += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) forward -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) side += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) side -= 1;
    if (keys.has("ShiftLeft") || keys.has("ShiftRight")) top = RUN_SPEED;
    if (stick.id !== null) {
      forward -= stick.y;
      side += stick.x * STICK_STRAFE;
      me.yaw -= stick.x * STICK_TURN * dt;
    }
    if (forward || side) walkTo = null;

    let wantX = 0;
    let wantZ = 0;
    if (walkTo) {
      const dx = walkTo.x - me.x;
      const dz = walkTo.z - me.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.06) {
        walkTo = null;
      } else {
        const speed = Math.min(WALK_SPEED, d * 1.8 + 0.15);
        wantX = (dx / d) * speed;
        wantZ = (dz / d) * speed;
        if (look === null)
          me.yaw +=
            angDiff(me.yaw, Math.atan2(-dx, -dz)) * damp(dt, TAP_WALK_TURN_TAU);
      }
    } else if (forward || side) {
      const mag =
        Math.min(1, Math.hypot(forward, side)) /
        (Math.hypot(forward, side) || 1);
      const f = forward * mag * top;
      const s = side * mag * top;
      const sin = Math.sin(me.yaw);
      const cos = Math.cos(me.yaw);
      wantX = -sin * f + cos * s;
      wantZ = -cos * f - sin * s;
    }
    marker.visible = walkTo !== null;
    if (walkTo) marker.position.set(walkTo.x, 0.03, walkTo.z);

    const k = damp(dt, MOVE_TAU);
    me.vx += (wantX - me.vx) * k;
    me.vz += (wantZ - me.vz) * k;
    me.x += me.vx * dt;
    me.z += me.vz * dt;
    if (me.x < -EDGE || me.x > EDGE) {
      me.x = clamp(me.x, -EDGE, EDGE);
      me.vx = 0;
    }
    if (me.z < -EDGE || me.z > EDGE) {
      me.z = clamp(me.z, -EDGE, EDGE);
      me.vz = 0;
    }

    if (spinYaw || spinPitch) {
      me.yaw += spinYaw * dt;
      me.pitch = clamp(me.pitch + spinPitch * dt, -1.35, 1.35);
      const decay = Math.exp(-dt / LOOK_INERTIA_TAU);
      spinYaw = Math.abs(spinYaw) < 0.01 ? 0 : spinYaw * decay;
      spinPitch = Math.abs(spinPitch) < 0.01 ? 0 : spinPitch * decay;
    }

    const speed = Math.hypot(me.vx, me.vz);
    me.phase += ((speed * dt) / STEP_LENGTH) * Math.PI;
    const bob = stillBody
      ? 0
      : Math.sin(me.phase * 2) * BOB * Math.min(1, speed / WALK_SPEED);
    camera.position.set(me.x, EYE + bob, me.z);
    camera.rotation.set(me.pitch, me.yaw, 0);
  };

  /* ---------- what a kind gets ---------- */
  const frame = {
    time: 0,
    dt: 0,
    viewer: new Vector3(),
    viewerWorld: new Vector3(),
  };
  const anchors = {};
  for (const [name, p] of Object.entries(ANCHORS))
    anchors[name] = toLocal(new Vector3(), p[0], p[1], p[2]);

  const hitGeometry = new SphereGeometry(1, 8, 6);
  const hitMaterial = new MeshBasicMaterial();
  const hitArea = ({ radius = 0.6, at: where, name = "" } = {}) => {
    const m = new Mesh(hitGeometry, hitMaterial);
    m.visible = false; // never drawn; a Raycaster ignores `visible`, the stage measures it itself
    m.scale.setScalar(radius);
    if (where) m.position.copy(where);
    m.name = name;
    m.userData.hitArea = true;
    return m;
  };

  const painted = new Set();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const paintText = (spec) => {
    const isCanvas = spec instanceof HTMLCanvasElement;
    const scale = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const width = isCanvas ? spec.width : spec?.width;
    const height = isCanvas ? spec.height : spec?.height;
    if (!(width > 0) || !(height > 0))
      throw new Error("paintText needs a width and a height");
    const canvas = isCanvas ? spec : document.createElement("canvas");
    if (!isCanvas) {
      canvas.width = Math.min(2048, Math.ceil(width * scale));
      canvas.height = Math.min(2048, Math.ceil(height * scale));
    }
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = maxAniso;
    const g = canvas.getContext("2d");
    let draw = spec?.draw;
    tex.repaint = (next) => {
      draw = next ?? draw;
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (!isCanvas) g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      draw?.(g, width, height);
      tex.needsUpdate = true;
    };
    tex.repaint();
    painted.add(tex);
    tex.addEventListener("dispose", () => painted.delete(tex));
    return tex;
  };

  let audio = null;
  const startAudio = () => {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  };
  const sound = (id) => ({
    play() {
      if (mode !== "play" || !audio) return;
      let t = audio.currentTime;
      for (const [freq, len] of TONES[id] ?? []) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
        osc.connect(gain).connect(audio.destination);
        osc.start(t);
        osc.stop(t + len + 0.02);
        t += len * 0.8;
      }
    },
    stop() {},
  });

  const say = (text, opts = {}) => {
    if (mode !== "play") return;
    said = {
      text: String(text ?? ""),
      mood: opts.mood ?? "calm",
      ask: !!opts.ask,
      eyebrow: opts.eyebrow ?? said.eyebrow,
    };
    if (step === "kind") renderStory(true);
  };
  const done = () => {
    if (mode !== "play" || finished) return;
    finished = true;
    if (step === "kind") {
      renderStory(false);
      // The thumb is still on the answer: Continue wakes a moment later.
      const next = ui.acts.querySelector('[data-act="next"]');
      if (next) {
        next.disabled = true;
        setTimeout(() => (next.disabled = false), 450);
      }
    }
  };

  const env = {
    mode: "play",
    frame,
    place: { size: EDGE * 2, edge: EDGE, ring: RING, anchors },
    paintText,
    hitArea,
    sound,
    say,
    done,
    loadAsset: () => Promise.reject(new Error("This stage has no asset files")),
  };

  /* ---------- open and close: one world part, one card ---------- */
  let mode = "play";
  let step = "before"; // before | kind | after
  let part = null;
  let cardHandle = null;
  let panelHandle = null;
  let finished = false;
  let said = { text: "", mood: "calm", ask: false, eyebrow: "A question" };
  let outside = false;
  let sampleName = sampleNames[0];
  let raw = structuredClone(sampleMap[sampleName]);
  let notFreed = 0;
  let updateBroken = false;
  const counts = { open: 0, close: 0, tap: 0, leave: 0, back: 0 };

  const currentBlock = () =>
    kind.read
      ? kind.read(structuredClone(raw), null, READ_TOOLS)
      : structuredClone(raw);

  const watchFreed = (object) => {
    const pending = new Set();
    const watch = (r) => {
      if (!r || pending.has(r)) return;
      pending.add(r);
      r.addEventListener("dispose", () => pending.delete(r));
    };
    object.traverse((o) => {
      if (o.userData.hitArea) return;
      watch(o.geometry);
      for (const m of [o.material].flat()) {
        if (!m) continue;
        watch(m);
        for (const v of Object.values(m)) if (v?.isTexture) watch(v);
      }
    });
    painted.forEach(watch);
    return pending;
  };

  const openWorld = () => {
    if (part) closeWorld();
    frame.time = 0;
    frame.dt = 0;
    updateBroken = false;
    finished = false;
    said = { text: "", mood: "calm", ask: false, eyebrow: "A question" };
    env.mode = mode;
    fillFrame();
    let b;
    try {
      b = currentBlock();
      const made = kind.world(b, env);
      if (!made?.object) throw new Error("world() must return { object }");
      part = made;
      holder.add(part.object);
      counts.open += 1;
    } catch (err) {
      console.error(err);
      toast(`The kind failed to open: ${err.message}`);
      return;
    }
    if (mode === "play" && kind.card) {
      try {
        cardHandle = kind.card(b, ui.slot, env) ?? null;
      } catch (err) {
        console.error(err);
        toast(`The card failed to open: ${err.message}`);
      }
    }
    if (outside && mode === "play") part.leave?.();
  };

  function closeWorld() {
    if (!part) return;
    const pending = watchFreed(part.object);
    try {
      part.dispose?.();
    } catch (err) {
      console.error(err);
      toast(`dispose() failed: ${err.message}`);
    }
    cardHandle?.dispose?.();
    cardHandle = null;
    ui.slot.replaceChildren();
    holder.remove(part.object);
    notFreed = pending.size;
    painted.clear();
    part = null;
    counts.close += 1;
  }

  function fillFrame() {
    frame.viewerWorld.set(me.x, EYE, me.z);
    toLocal(frame.viewer, me.x, EYE, me.z);
  }
  const viewerDistance = () => Math.hypot(me.x - foot.x, me.z - foot.z);

  const stepRing = () => {
    const d = viewerDistance();
    if (!outside && d > RING) {
      outside = true;
      ringMat.color.set("#ffffff");
      if (mode === "play" && part) {
        counts.leave += 1;
        part.leave?.();
        if (step === "kind" && !finished) setFold("auto");
      }
    } else if (outside && d < RING_BACK) {
      outside = false;
      ringMat.color.set("#fb923c");
      if (mode === "play" && part) {
        counts.back += 1;
        part.back?.();
        if (folded === "auto") setFold(null);
      }
    }
  };

  /* ---------- the story card ---------- */
  let folded = null; // null | "auto" | "hand"
  function setFold(state) {
    folded = state;
    const on = state !== null;
    ui.fold.hidden = !on;
    ui.story.hidden = on || mode !== "play";
    ui.edit.hidden = on || mode !== "edit";
    ui.grab.setAttribute("aria-label", on ? "Open the card" : "Fold the card");
    if (!on) return;
    const [head, sub] = ui.fold.querySelectorAll("b, small");
    const metres = Math.round(viewerDistance());
    if (mode === "edit") {
      head.textContent = "Edit panel";
      sub.textContent = "Tap to open it again.";
    } else if (step === "kind" && !finished) {
      head.textContent = "Question waiting";
      sub.textContent = outside
        ? `At ${tale.station}, ${metres} m behind you`
        : "Have a good look. Tap when you are ready.";
    } else {
      head.textContent = tale.station;
      sub.textContent = "Tap to open the story.";
    }
  }

  function renderStory(fresh) {
    const idx = ["before", "kind", "after"].indexOf(step);
    ui.dots.querySelectorAll("i").forEach((d, i) => {
      d.className = i < idx ? "on" : i === idx ? "now" : "";
    });
    let text;
    let eyebrow;
    let mood = "calm";
    let ask = false;
    if (step === "before") {
      text = tale.before;
      eyebrow = "Station found - its story is playing.";
    } else if (step === "after") {
      text = tale.after;
      eyebrow = "Story finished";
    } else {
      text = said.text || (kind.card ? "" : "Take a look around.");
      eyebrow = finished ? "Question done" : said.eyebrow;
      mood = said.mood;
      ask = said.ask;
    }
    ui.eyebrow.textContent = eyebrow;
    ui.eyebrow.classList.toggle("done", step === "after" || finished);
    ui.who.hidden = !text;
    ui.slot.hidden = step !== "kind";
    ui.portrait.dataset.mood = mood;
    ui.line.textContent = text;
    ui.line.className = `line${ask ? " ask" : ""}${fresh ? " in" : ""}`;
    if (step === "before")
      ui.acts.innerHTML =
        '<button type="button" class="btn primary" data-act="next">Continue</button>';
    else if (step === "after")
      ui.acts.innerHTML =
        '<button type="button" class="btn primary" data-act="restart">Restart</button>';
    else if (finished)
      ui.acts.innerHTML =
        '<button type="button" class="btn primary" data-act="next">Continue</button>';
    else
      ui.acts.innerHTML =
        '<button type="button" class="btn" data-act="next">Skip this question</button>';
  }

  function restart() {
    closeWorld();
    step = "before";
    finished = false;
    Object.assign(me, START, { vx: 0, vz: 0 });
    walkTo = null;
    setFold(null);
    outside = false;
    ringMat.color.set("#fb923c");
    renderStory(true);
  }

  ui.acts.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "restart") restart();
    if (act !== "next") return;
    if (step === "before") {
      step = "kind";
      openWorld();
      renderStory(true);
    } else if (step === "kind") {
      step = "after";
      renderStory(true);
    }
  });
  ui.grab.addEventListener("click", () => setFold(folded ? null : "hand"));
  ui.fold.addEventListener("click", () => setFold(null));

  /* ---------- the edit panel: FieldSpec as data ---------- */
  const fieldsOf = () => {
    const f =
      typeof kind.fields === "function" ? kind.fields(raw) : kind.fields;
    return Array.isArray(f) ? f : [];
  };
  let rebuildTimer = 0;
  const rebuildSoon = (ms = 140) => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      if (mode === "edit") openWorld();
    }, ms);
  };

  function renderEditPanel() {
    panelHandle?.dispose?.();
    panelHandle = null;
    ui.edit.replaceChildren();
    const head = document.createElement("div");
    head.className = "eyerow";
    head.innerHTML =
      '<p class="eyebrow">Edit - the same object, still and silent</p>';
    ui.edit.append(head);
    const fields = fieldsOf();
    for (const f of fields) {
      const type = f.type ?? (f.prose ? "prose" : "text");
      const label = document.createElement("label");
      label.className = type === "toggle" ? "f check-row" : "f";
      label.textContent = f.label ?? f.name;
      const value = getPath(raw, f.name);
      const onValue = (v) => {
        setPath(raw, f.name, v);
        rebuildSoon();
      };
      let input;
      if (type === "prose") {
        input = document.createElement("textarea");
        input.value = value ?? "";
        input.addEventListener("input", () => onValue(input.value));
      } else if (type === "number" || type === "range") {
        input = document.createElement("input");
        input.type = type;
        if (f.min !== undefined) input.min = f.min;
        if (f.max !== undefined) input.max = f.max;
        input.step = f.step ?? "any";
        input.value = value ?? f.min ?? 0;
        input.addEventListener("input", () => onValue(Number(input.value)));
      } else if (type === "toggle") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!value;
        input.addEventListener("change", () => onValue(input.checked));
        label.prepend(input);
        input = null;
      } else if (type === "choice") {
        input = document.createElement("select");
        for (const o of f.options ?? []) {
          const [v, text] = Array.isArray(o) ? o : [o, o];
          input.append(new Option(text, v));
        }
        input.value = value ?? "";
        input.addEventListener("change", () => onValue(input.value));
      } else if (type === "place") {
        input = document.createElement("span");
        input.className = "where";
        input.dataset.place = f.name;
        input.textContent = whereText(value);
      } else {
        input = document.createElement("input");
        input.type = "text";
        input.value = value ?? "";
        if (f.max) input.maxLength = f.max;
        input.addEventListener("input", () => onValue(input.value));
      }
      if (input) label.append(input);
      ui.edit.append(label);
    }
    if (!fields.length) {
      const none = document.createElement("p");
      none.className = "speaker";
      none.textContent = "This kind declares no fields.";
      ui.edit.append(none);
    }
    if (kind.panel) {
      const el = document.createElement("div");
      ui.edit.append(el);
      try {
        panelHandle = kind.panel(raw, el, env) ?? null;
      } catch (err) {
        console.error(err);
        toast(`The panel failed to open: ${err.message}`);
      }
    }
  }
  const whereText = (v) =>
    `${(v?.x ?? 0).toFixed(1)} m across, ${(v?.z ?? 0).toFixed(1)} m ahead. Drag its ring.`;

  /* ---------- placement handles: only in edit, only for declared fields ---------- */
  const handles = [];
  const handleGeo = new RingGeometry(0.42, 0.62, 32).rotateX(-Math.PI / 2);
  const handleDisc = new RingGeometry(0, 0.16, 16).rotateX(-Math.PI / 2);
  const handleMat = new MeshBasicMaterial({
    color: "#2dd4bf",
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const clearHandles = () => {
    for (const h of handles) {
      scene.remove(h.group);
      h.tex.dispose();
      h.label.material.dispose();
    }
    handles.length = 0;
  };
  const worldOf = (v) => {
    const x = v?.x ?? 0;
    const z = v?.z ?? 0;
    return [foot.x + x * cosH + z * sinH, foot.z - x * sinH + z * cosH];
  };
  function buildHandles() {
    clearHandles();
    for (const f of fieldsOf()) {
      if (f.type !== "place") continue;
      const group = new Group();
      const ringPart = new Mesh(handleGeo, handleMat);
      const disc = new Mesh(handleDisc, handleMat);
      ringPart.renderOrder = disc.renderOrder = 3;
      const tex = paintText({
        width: 240,
        height: 56,
        draw(g, w, h) {
          g.fillStyle = "rgb(4 32 28 / 86%)";
          g.beginPath();
          g.roundRect(0, 0, w, h, 16);
          g.fill();
          g.fillStyle = "#fff";
          g.font = `600 30px ${FONT}`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(f.label ?? f.name, w / 2, h / 2 + 1, w - 20);
        },
      });
      painted.delete(tex);
      const label = new Sprite(
        new SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
      );
      label.scale.set(1.3, 0.3, 1);
      label.position.y = 0.55;
      label.renderOrder = 4;
      group.add(ringPart, disc, label);
      const [wx, wz] = worldOf(getPath(raw, f.name));
      group.position.set(wx, 0.04, wz);
      scene.add(group);
      handles.push({ field: f, group, tex, label });
    }
  }

  const v2 = new Vector2();
  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const raycaster = new Raycaster();
  raycaster.camera = camera;
  const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  const size = { w: 1, h: 1 };
  const setRay = (x, y) => {
    v2.set((x / size.w) * 2 - 1, 1 - (y / size.h) * 2);
    raycaster.setFromCamera(v2, camera);
  };
  const handleAt = (x, y) => {
    let best = null;
    let bestPx = HANDLE_PX;
    for (const h of handles) {
      tmpA.copy(h.group.position).project(camera);
      if (tmpA.z > 1) continue;
      const px = Math.hypot(
        ((tmpA.x + 1) / 2) * size.w - x,
        ((1 - tmpA.y) / 2) * size.h - y,
      );
      if (px < bestPx) {
        bestPx = px;
        best = h;
      }
    }
    return best;
  };
  const moveHandle = (h, x, y) => {
    setRay(x, y);
    if (!raycaster.ray.intersectPlane(groundPlane, tmpA)) return;
    const wx = clamp(tmpA.x, -EDGE, EDGE);
    const wz = clamp(tmpA.z, -EDGE, EDGE);
    h.group.position.set(wx, 0.04, wz);
    toLocal(tmpB, wx, 0, wz);
    const value = {
      x: Math.round(tmpB.x * 10) / 10,
      z: Math.round(tmpB.z * 10) / 10,
    };
    setPath(raw, h.field.name, value);
    const row = ui.edit.querySelector(`[data-place="${h.field.name}"]`);
    if (row) row.textContent = whereText(value);
    rebuildSoon(160);
  };

  function setMode(next) {
    if (next === mode) return;
    clearTimeout(rebuildTimer);
    closeWorld();
    mode = next;
    env.mode = next;
    root.dataset.mode = next;
    root
      .querySelectorAll(".seg [data-mode]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.mode === next)),
      );
    setFold(null);
    if (next === "edit") {
      renderEditPanel();
      buildHandles();
      openWorld();
    } else {
      clearHandles();
      panelHandle?.dispose?.();
      panelHandle = null;
      if (step !== "before") openWorld();
      renderStory(true);
    }
  }

  /* ---------- tapping ---------- */
  function pick(x, y) {
    const obj = part.object;
    setRay(x, y);
    obj.updateWorldMatrix(true, true);
    let best = null;
    let bestScore = Infinity;
    obj.traverse((o) => {
      if (!o.userData.hitArea || !shown(o.parent, obj)) return;
      o.getWorldPosition(tmpA);
      tmpB.copy(tmpA).project(camera);
      if (tmpB.z > 1) return;
      const px = Math.hypot(
        ((tmpB.x + 1) / 2) * size.w - x,
        ((1 - tmpB.y) / 2) * size.h - y,
      );
      const miss = raycaster.ray.distanceToPoint(tmpA);
      const radius = o.scale.x;
      if (miss > radius && px > HIT_MIN_PX) return;
      const score = miss <= radius ? miss / radius : 1 + px / HIT_MIN_PX;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    });
    if (best) {
      best.getWorldPosition(tmpA);
      return {
        object: best,
        point: tmpA.clone(),
        distance: tmpA.distanceTo(camera.position),
        name: best.name,
      };
    }
    for (const hit of raycaster.intersectObject(obj, true)) {
      if (hit.object.userData.hitArea || !shown(hit.object, obj)) continue;
      hit.name = nameOf(hit.object, obj);
      return hit;
    }
    return null;
  }

  function groundAt(x, y) {
    setRay(x, y);
    const [hit] = raycaster.intersectObject(place.solid, false);
    if (hit && hit.point.y >= 0)
      return {
        x: clamp(hit.point.x, -EDGE, EDGE),
        z: clamp(hit.point.z, -EDGE, EDGE),
      };
    if (!raycaster.ray.intersectPlane(groundPlane, tmpA)) return null;
    return { x: clamp(tmpA.x, -EDGE, EDGE), z: clamp(tmpA.z, -EDGE, EDGE) };
  }

  function onTap(x, y) {
    if (mode === "play" && part?.tap) {
      const hit = pick(x, y);
      if (hit) {
        counts.tap += 1;
        try {
          part.tap(hit);
        } catch (err) {
          console.error(err);
          toast(`tap() failed: ${err.message}`);
        }
        return;
      }
    }
    const to = groundAt(x, y);
    if (!to || Math.hypot(to.x - me.x, to.z - me.z) < 0.3) return;
    walkTo = to;
    walked();
  }

  /* ---------- input: pointers ---------- */
  let look = null; // the one finger that looks; a second finger on the view does nothing
  const local = (e) => {
    const r = ui.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  ui.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  ui.canvas.addEventListener("pointerdown", (e) => {
    startAudio();
    if (look) return;
    ui.canvas.setPointerCapture(e.pointerId);
    const [x, y] = local(e);
    spinYaw = spinPitch = 0;
    look = {
      id: e.pointerId,
      x0: x,
      y0: y,
      x,
      y,
      t0: performance.now(),
      t: performance.now(),
      far: false,
      vx: 0,
      vy: 0,
      button: e.button,
      handle: mode === "edit" ? handleAt(x, y) : null,
    };
  });
  ui.canvas.addEventListener("pointermove", (e) => {
    if (!look || e.pointerId !== look.id) return;
    const [x, y] = local(e);
    const dx = x - look.x;
    const dy = y - look.y;
    look.x = x;
    look.y = y;
    if (Math.hypot(x - look.x0, y - look.y0) > TAP_MOVE_PX) look.far = true;
    if (look.handle) {
      if (look.far) moveHandle(look.handle, x, y);
      return;
    }
    me.yaw += dx * LOOK_GAIN;
    me.pitch = clamp(me.pitch + dy * LOOK_GAIN, -1.35, 1.35);
    const now = performance.now();
    const secs = Math.max(0.004, (now - look.t) / 1000);
    look.t = now;
    look.vx += ((dx * LOOK_GAIN) / secs - look.vx) * 0.4;
    look.vy += ((dy * LOOK_GAIN) / secs - look.vy) * 0.4;
  });
  const endLook = (e, cancelled) => {
    if (!look || e.pointerId !== look.id) return;
    const l = look;
    look = null;
    const now = performance.now();
    if (cancelled) return;
    if (!l.far && now - l.t0 < TAP_MS && l.button === 0 && !l.handle) {
      onTap(l.x, l.y);
    } else if (l.far && !l.handle && !stillBody && now - l.t < 60) {
      spinYaw = clamp(l.vx, -3, 3);
      spinPitch = clamp(l.vy, -3, 3);
    }
  };
  ui.canvas.addEventListener("pointerup", (e) => endLook(e, false));
  ui.canvas.addEventListener("pointercancel", (e) => endLook(e, true));

  /* the stick: it never moves away under a held thumb, even when the card folds */
  function syncCardHeight() {
    if (stick.id === null)
      root.style.setProperty("--card-h", `${ui.sheet.offsetHeight}px`);
  }
  const moveStick = (e) => {
    let dx = (e.clientX - stick.cx) / STICK_REACH;
    let dy = (e.clientY - stick.cy) / STICK_REACH;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    ui.knob.style.transform = `translate(${dx * STICK_REACH}px, ${dy * STICK_REACH}px)`;
    const reach = Math.min(1, len);
    const strength =
      reach < STICK_DEAD ? 0 : ((reach - STICK_DEAD) / (1 - STICK_DEAD)) ** 1.3;
    const unit = reach > 0 ? strength / reach : 0;
    stick.x = dx * unit;
    stick.y = dy * unit;
  };
  ui.stick.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startAudio();
    if (stick.id !== null) return;
    ui.stick.setPointerCapture(e.pointerId);
    const r = ui.stick.getBoundingClientRect();
    stick.id = e.pointerId;
    stick.cx = r.left + r.width / 2;
    stick.cy = r.top + r.height / 2;
    ui.stick.classList.add("on");
    walkTo = null;
    moveStick(e);
    walked();
  });
  ui.stick.addEventListener("pointermove", (e) => {
    if (e.pointerId === stick.id) moveStick(e);
  });
  const endStick = (e) => {
    if (e.pointerId !== stick.id) return;
    stick.id = null;
    stick.x = stick.y = 0;
    ui.knob.style.transform = "";
    ui.stick.classList.remove("on");
    syncCardHeight();
  };
  ui.stick.addEventListener("pointerup", endStick);
  ui.stick.addEventListener("pointercancel", endStick);

  /* the keys */
  const typing = (t) =>
    t instanceof HTMLElement &&
    (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  window.addEventListener("keydown", (e) => {
    if (typing(e.target)) return;
    if (/^(Key[WASD]|Arrow\w+|Shift\w+)$/.test(e.code)) {
      keys.add(e.code);
      if (e.code.startsWith("Arrow")) e.preventDefault();
      if (!e.code.startsWith("Shift")) walked();
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());

  /* the phone's keyboard lifts the card */
  window.visualViewport?.addEventListener("resize", () => {
    const v = window.visualViewport;
    const px = Math.round(window.innerHeight - v.height - v.offsetTop);
    root.style.setProperty(
      "--kbd",
      `${v.scale <= 1.01 && px >= 80 ? px : 0}px`,
    );
  });

  /* the hint goes once the first step is taken */
  const coarse = matchMedia("(pointer: coarse)").matches;
  ui.hint.textContent = coarse
    ? "Drag to look. Walk with the stick, or tap the ground."
    : "Drag to look. W A S D to walk, or click the ground.";
  const hideHint = () => ui.hint.classList.add("gone");
  const hintTimer = setTimeout(hideHint, 9000);
  let hasWalked = false;
  function walked() {
    if (hasWalked) return;
    hasWalked = true;
    clearTimeout(hintTimer);
    hideHint();
  }

  /* ---------- the top controls ---------- */
  root
    .querySelectorAll(".seg [data-mode]")
    .forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  root
    .querySelectorAll(".seg [data-look]")
    .forEach((b) =>
      b.addEventListener("click", () => applyLook(b.dataset.look)),
    );
  ui.costBtn.addEventListener("click", () => {
    ui.tools.hidden = !ui.tools.hidden;
    ui.costBtn.setAttribute("aria-expanded", String(!ui.tools.hidden));
  });
  const sampleRow = $("#qsSamples");
  for (const name of sampleNames) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = name;
    b.setAttribute("aria-pressed", String(name === sampleName));
    b.addEventListener("click", () => {
      sampleName = name;
      raw = structuredClone(sampleMap[name]);
      sampleRow
        .querySelectorAll("button")
        .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (mode === "edit") {
        renderEditPanel();
        buildHandles();
        openWorld();
      } else if (step !== "before") {
        openWorld();
        renderStory(true);
      }
    });
    sampleRow.append(b);
  }

  /* ---------- cost ---------- */
  const meter = {
    frames: 0,
    total: 0,
    work: 0,
    update: 0,
    next: 0,
    ms: 0,
    workMs: 0,
    updateMs: 0,
  };
  const costNumbers = () => {
    const r = renderer.info.render;
    const m = renderer.info.memory;
    return {
      calls: r.calls,
      tris: r.triangles,
      tex: m.textures,
      geo: m.geometries,
      programs: renderer.info.programs.length,
    };
  };
  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(resolve));
  const k = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const costLine = (c) =>
    `calls ${c.calls} tris ${k(c.tris)} tex ${c.tex} geo ${c.geo}`;

  let baseline = null; // the stage alone, measured before any kind opens
  let tenRunning = false;
  async function tenRounds() {
    if (tenRunning) return;
    tenRunning = true;
    ui.after.textContent = "Running...";
    const wasOpen = part !== null;
    if (!wasOpen) openWorld();
    await nextFrame();
    await nextFrame();
    const before = costNumbers();
    let notFreedTotal = 0;
    for (let i = 0; i < 10; i++) {
      closeWorld();
      notFreedTotal += notFreed;
      openWorld();
      await nextFrame();
    }
    await nextFrame();
    const after = costNumbers();
    const grew =
      after.geo -
      before.geo +
      (after.tex - before.tex) +
      (after.programs - before.programs);
    ui.after.textContent =
      `before ${costLine(before)}\nafter  ${costLine(after)}\n` +
      `frame ${meter.ms.toFixed(1)} ms\n` +
      (grew > 0 || notFreedTotal > 0
        ? `LEAK: grew by ${grew}, ${notFreedTotal} not freed by dispose()`
        : "No leak: nothing grew, dispose() freed everything.");
    lastTen = { before, after, grew, notFreed: notFreedTotal };
    if (!wasOpen) closeWorld();
    if (mode === "play") renderStory(false);
    tenRunning = false;
  }
  let lastTen = null;
  $("#qsTen").addEventListener("click", tenRounds);

  const paintCost = (now) => {
    meter.next = now + 500;
    meter.ms = meter.total / Math.max(1, meter.frames);
    meter.workMs = meter.work / Math.max(1, meter.frames);
    meter.updateMs = meter.update / Math.max(1, meter.frames);
    meter.frames = meter.total = meter.work = meter.update = 0;
    ui.costBtn.textContent = `${meter.ms.toFixed(0)} ms`;
    if (ui.tools.hidden) return;
    const c = costNumbers();
    const ofStage = baseline
      ? `\nstage alone: calls ${baseline.calls}, tris ${k(baseline.tris)}`
      : "";
    ui.now.textContent =
      `frame ${meter.ms.toFixed(1)} ms  js ${meter.workMs.toFixed(1)} ms\n` +
      `kind update ${meter.updateMs.toFixed(2)} ms\n${costLine(c)}${ofStage}`;
  };

  /* ---------- the loop ---------- */
  function resize() {
    size.w = root.clientWidth || 1;
    size.h = root.clientHeight || 1;
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    camera.fov = size.w < size.h ? 72 : 50;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(root);
  new ResizeObserver(syncCardHeight).observe(ui.sheet);
  resize();

  let last = performance.now();
  let rendered = 0;
  function tick(now) {
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    meter.total += now - last;
    last = now;
    stepViewer(dt);
    stepRing();
    let spent = 0;
    if (part) {
      if (mode === "play") frame.time += dt;
      frame.dt = mode === "play" ? dt : 0;
      fillFrame();
      if (part.update && !updateBroken) {
        const u0 = performance.now();
        try {
          part.update(frame);
        } catch (err) {
          updateBroken = true;
          console.error(err);
          toast(`update() failed: ${err.message}`);
        }
        spent = performance.now() - u0;
      }
    }
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
    rendered += 1;
    if (baseline === null && rendered === 2) baseline = costNumbers();
    meter.frames += 1;
    meter.update += spent;
    meter.work += performance.now() - t0;
    if (now >= meter.next) paintCost(now);
  }

  applyLook("bright");
  stepViewer(0);
  renderStory(true);
  renderer.setAnimationLoop(tick);

  const stage = {
    /** For checks and screenshots: a plain snapshot, read-only. */
    state: () => ({
      x: me.x,
      z: me.z,
      yaw: me.yaw,
      pitch: me.pitch,
      walkTo,
      looking: look !== null,
      stickHeld: stick.id !== null,
      mode,
      step,
      finished,
      outside,
      folded,
      counts: { ...counts },
      raw: structuredClone(raw),
      cost: costNumbers(),
      baseline,
      frameMs: meter.ms,
      ten: lastTen,
    }),
    /** Where an anchor or a world point lands on screen, for driving a tap in a check. */
    screenOf(x, y, z) {
      tmpA.set(x, y, z).project(camera);
      return [((tmpA.x + 1) / 2) * size.w, ((1 - tmpA.y) / 2) * size.h];
    },
    tenRounds,
    setMode,
  };
  window.__stage = stage;
  return stage;
}
