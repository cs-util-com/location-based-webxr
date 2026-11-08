/**
 * A narration sound placed in the world, as one kind module.
 *
 * The `spot` view is a narration: one circle on the ground with rising
 * motes as its mark. Outside the circle nothing is on the screen. Stepping
 * inside opens a player card (title, play or pause, a scrub bar and the
 * current sentence); it plays only on a tap, pauses when the visitor
 * leaves (the card closes) and carries on when they come back. Once
 * stopped it stays off until tapped again.
 *
 * The `zone` view is an ambient sound: a ground glow whose gradient is its
 * loudness, playing by itself within earshot. The host lowers it while a
 * narration plays; the glow turns quieter with it.
 *
 * The seam: `world(block, env)` returns `{ object, tapTarget, update, tap,
 * leave, back, dispose }`. The host places and turns `object`; this module
 * never touches the scene, the camera, the renderer, the frame loop or
 * `document`. Metres, Y up, origin at the item's foot on the ground. Time
 * and the viewer's position come from `update(frame)`. In `env.mode ===
 * "edit"` the same object stands still and silent.
 *
 * The card is screen DOM, built by `card(block, el, player)` inside the
 * element the host gives it, scoped under `[data-kind="audio"]` (see
 * `kind.css`). Words in the world (the name plate of the plume look) are
 * Canvas 2D.
 *
 * Imports: three only, by named import, no addons.
 */
import {
  CircleGeometry,
  Color,
  CylinderGeometry,
  GLSL3,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Sphere,
  Vector3,
} from "three";

export const KIND = "audio";

/** The three looks of the narration circle this prototype compares. */
export const LOOKS = Object.freeze(["motes", "curtain", "plume"]);

const RADIUS = Object.freeze({ min: 3, max: 12, fallback: 6 });
const EARSHOT = Object.freeze({ min: 10, max: 30, fallback: 18 });
const TITLE_MAX = 80;
const LINE_MAX = 400;
/** Edit mode: the motes stand where they are at this moment of their rise. */
const STILL_SECONDS = 1.7;
/** How fast the motes rise, per state (1 = idle). */
const RISE_RATE = Object.freeze([1, 1.6, 0.75, 0.55, 0]);
const NARRATION = "#f2971f";
const AMBIENT = "#36c2b0";
const INK = "#14161c";

/* ----------------------------------------------------------- reading */

function finite(v, fallback, lo, hi) {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return fallback;
  }
  return Math.min(hi, Math.max(lo, v));
}

function words(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function clamped(problems, name, given, used, unit) {
  if (given !== undefined && given !== used) {
    problems.push(`${name} ${String(given)} read as ${String(used)} ${unit}`);
  }
}

function readLine(line) {
  if (line === null || typeof line !== "object") {
    return null;
  }
  const at = finite(line.at, -1, -1, 86400);
  const text = words(line.text, LINE_MAX);
  return at < 0 || text === "" ? null : Object.freeze({ at, text });
}

function readLines(v, problems) {
  if (v === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(v)) {
    problems.push("lines is not a list, read as none");
    return Object.freeze([]);
  }
  const out = [];
  for (const raw of v) {
    const line = readLine(raw);
    if (line === null) {
      problems.push("a line without a time or words was dropped");
    } else {
      out.push(line);
    }
  }
  out.sort((a, b) => a.at - b.at);
  return Object.freeze(out);
}

function readSpot(raw, problems) {
  const radiusM = finite(raw.radiusM, RADIUS.fallback, RADIUS.min, RADIUS.max);
  clamped(problems, "radius", raw.radiusM, radiusM, "m");
  return { radiusM, lines: readLines(raw.lines, problems) };
}

function readZone(raw, problems) {
  const maxM = finite(raw.maxM, EARSHOT.fallback, EARSHOT.min, EARSHOT.max);
  clamped(problems, "earshot", raw.maxM, maxM, "m");
  const minM = finite(raw.minM, Math.round(maxM * 0.3), 0.5, maxM - 1);
  clamped(problems, "full volume within", raw.minM, minM, "m");
  const volume = finite(raw.volume, 0.6, 0, 1);
  clamped(problems, "volume", raw.volume, volume, "");
  return { maxM, minM, volume };
}

function readCommon(raw, problems) {
  const title = words(raw.title, TITLE_MAX);
  if (title === "") {
    problems.push("no title");
  }
  const audio =
    typeof raw.audio === "string" && raw.audio !== "" ? raw.audio : null;
  if (audio === null) {
    problems.push("no sound file");
  }
  return { title, audio };
}

/**
 * One raw record as a block the rest of the module trusts. Never throws:
 * every field it cannot use is replaced by its default and named in
 * `problems`.
 */
export function read(v) {
  const problems = [];
  const raw = v !== null && typeof v === "object" ? v : {};
  if (raw.kind !== KIND) {
    problems.push(`kind "${String(raw.kind)}" read as "${KIND}"`);
  }
  const view = raw.view === "zone" ? "zone" : "spot";
  if (raw.view !== view) {
    problems.push(`view "${String(raw.view)}" read as "${view}"`);
  }
  const { title, audio } = readCommon(raw, problems);
  const own =
    view === "zone" ? readZone(raw, problems) : readSpot(raw, problems);
  const block = {
    kind: KIND,
    view,
    title: title || "Untitled sound",
    audio,
    ...own,
  };
  return { block: Object.freeze(block), problems };
}

/** Every file the block may read. */
export function assets(block) {
  return block.audio === null ? [] : [block.audio];
}

const SPOT_FIELDS = Object.freeze([
  { key: "title", label: "Title", type: "text", max: TITLE_MAX },
  {
    key: "radiusM",
    label: "Circle radius",
    type: "number",
    min: RADIUS.min,
    max: RADIUS.max,
    step: 0.5,
    unit: "m",
    hint: "The card opens inside this circle.",
  },
]);

const ZONE_FIELDS = Object.freeze([
  { key: "title", label: "Title", type: "text", max: TITLE_MAX },
  {
    key: "maxM",
    label: "Heard up to",
    type: "number",
    min: EARSHOT.min,
    max: EARSHOT.max,
    step: 1,
    unit: "m",
  },
  {
    key: "minM",
    label: "Full volume within",
    type: "number",
    min: 0.5,
    max: EARSHOT.max - 1,
    step: 0.5,
    unit: "m",
    optional: true,
  },
  {
    key: "volume",
    label: "Volume",
    type: "number",
    min: 0,
    max: 1,
    step: 0.05,
  },
]);

/** The inspector's fields for a view, as data. */
export function fields(view) {
  return view === "zone" ? ZONE_FIELDS : SPOT_FIELDS;
}

/* ------------------------------------------------------------ shared */

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Loudness of an ambient sound at `d` metres; its glow draws the same curve. */
export function loudness(d, block) {
  if (d <= block.minM) {
    return 1;
  }
  if (d >= block.maxM) {
    return 0;
  }
  const u = (d - block.minM) / (block.maxM - block.minM);
  return 1 - u * u * (3 - 2 * u);
}

/** The sentence spoken at `seconds`, or -1 before the first. */
export function lineAt(lines, seconds) {
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].at <= seconds) {
      at = i;
    }
  }
  return at;
}

function lookOf(env) {
  const look = env.proto?.look;
  return LOOKS.includes(look) ? look : "motes";
}

/**
 * The viewer's distance on the ground from the item's foot. `frame.viewer`
 * is in the part's parent frame; it is brought into the part's own frame
 * (no allocation: `scratch` holds a matrix and a vector).
 */
function groundDistance(object, frame, scratch) {
  object.updateMatrix();
  scratch.m.copy(object.matrix).invert();
  const [x, y, z] = frame.viewer;
  scratch.v.set(x, y, z).applyMatrix4(scratch.m);
  return Math.hypot(scratch.v.x, scratch.v.z);
}

function seeds(count, seed) {
  let s = seed;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(count * 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = next();
  }
  return out;
}

/* ----------------------------------------------------------- shaders */

const GROUND_VERTEX = /* glsl */ `
out vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BAND = /* glsl */ `
float band(float r, float at, float w) {
  float px = fwidth(r);
  return 1.0 - smoothstep(w - px, w + px, abs(r - at));
}`;

const SPOT_FRAGMENT = /* glsl */ `
in vec2 vP;
uniform vec3 uColor;
uniform vec3 uInk;
uniform float uR;
uniform float uTime;
uniform float uState;
uniform float uLook;
uniform float uLevel;
out vec4 fragColor;
${BAND}
void main() {
  float r = length(vP);
  float rim = band(r, uR, 0.045);
  float halo = band(r, uR, 0.14);
  if (uLook > 1.5) {
    float dash = step(0.42, fract(atan(vP.y, vP.x) * uR / 0.55));
    rim *= dash;
    halo *= dash;
  }
  float inner = 1.0 - smoothstep(uR - 0.03, uR, r);
  float fill = inner * 0.04;
  if (uLook < 0.5) {
    fill = inner * (0.04 + 0.12 * smoothstep(uR * 0.45, uR, r));
  } else if (uLook > 1.5) {
    fill = (1.0 - smoothstep(0.0, 1.5, r)) * 0.24;
  }
  float heard = (uState > 2.5 && uState < 3.5) ? 0.55 : 1.0;
  float wave = 0.0;
  if (uState > 0.5 && uState < 1.5) {
    float ph = fract(uTime / 3.2);
    wave = band(r, ph * uR, 0.05 + 0.12 * uLevel) * (1.0 - ph) * 0.4;
  }
  float a = (max(halo * 0.3, rim * 0.95) + fill) * heard + wave;
  vec3 col = mix(uInk, uColor, clamp(rim + (fill + wave) * 6.0, 0.0, 1.0));
  if (a < 0.004) discard;
  fragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

const MOTE_VERTEX = /* glsl */ `
in vec4 aSeed;
uniform float uClock;
uniform float uR;
uniform float uH;
uniform float uLook;
uniform float uState;
uniform float uLevel;
out vec2 vUv;
out float vA;
void main() {
  float a = aSeed.x * 6.2831853;
  float speed = mix(0.55, 1.2, aSeed.w);
  float life = fract(aSeed.z + uClock * speed * 0.42 / uH * 2.4);
  vec3 c;
  float size;
  float fade = sin(3.14159 * life);
  if (uLook < 0.5) {
    float r = sqrt(aSeed.y) * uR * 0.96;
    c = vec3(cos(a) * r, life * uH, sin(a) * r);
    c.x += sin(uClock * 0.7 + aSeed.z * 20.0) * 0.18 * life;
    size = 0.11;
  } else if (uLook < 1.5) {
    float r = uR + (aSeed.y - 0.5) * 0.16;
    float turn = a + life * 0.22;
    c = vec3(cos(turn) * r, life * uH, sin(turn) * r);
    size = 0.085;
    fade *= 1.0 - life * 0.6;
  } else {
    float r = aSeed.y * aSeed.y * (0.3 + life * 1.0);
    float turn = a + life * 1.6 + uClock * 0.2;
    c = vec3(cos(turn) * r, life * uH, sin(turn) * r);
    size = 0.14 * (1.0 - 0.45 * life);
  }
  float lit = 1.0;
  if (uState > 0.5 && uState < 1.5) lit = 1.0 + 0.6 * uLevel;
  else if (uState > 1.5 && uState < 2.5) lit = 0.8;
  else if (uState > 2.5 && uState < 3.5) lit = 0.45;
  vA = fade * min(lit, 1.0);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size * (0.85 + 0.35 * lit);
  gl_Position = projectionMatrix * mv;
  vUv = position.xy + 0.5;
}`;

const MOTE_FRAGMENT = /* glsl */ `
in vec2 vUv;
in float vA;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float m = 1.0 - smoothstep(0.0, 1.0, d);
  float core = 1.0 - smoothstep(0.0, 0.4, d);
  float a = m * m * vA;
  if (a < 0.01) discard;
  fragColor = vec4(mix(uColor, vec3(1.0, 0.96, 0.86), core), a);
}`;

const ZONE_FRAGMENT = /* glsl */ `
in vec2 vP;
uniform vec3 uColor;
uniform vec3 uInk;
uniform float uMin;
uniform float uMax;
uniform float uTime;
uniform float uLow;
uniform float uGain;
uniform float uEdit;
out vec4 fragColor;
${BAND}
void main() {
  float r = length(vP);
  float u = clamp((r - uMin) / (uMax - uMin), 0.0, 1.0);
  float g = 1.0 - u * u * (3.0 - 2.0 * u);
  float rip = pow(0.5 + 0.5 * sin(r * 1.7 - uTime * 1.3), 12.0) * g;
  float dash = step(0.5, fract(atan(vP.y, vP.x) * uMax / 0.9));
  float edge = band(r, uMax, 0.05) * dash;
  float edgeHalo = band(r, uMax, 0.13) * dash;
  float inner = uEdit * band(r, uMin, 0.04);
  float quiet = 1.0 - 0.6 * uLow;
  float near = 0.7 + 0.3 * uGain;
  float glow = (g * g * 0.26 + rip * 0.3) * quiet * near;
  float a = glow + max(edgeHalo * 0.25, edge * 0.5) + inner * 0.7;
  vec3 col = mix(uColor, vec3(1.0), rip * 0.35 * quiet);
  col = mix(uInk, col, clamp(glow * 8.0 + edge + inner, 0.0, 1.0));
  if (a < 0.004) discard;
  fragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

function groundMaterial(fragmentShader, uniforms) {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: GROUND_VERTEX,
    fragmentShader,
  });
}

function flatDisc(radius, material) {
  const mesh = new Mesh(new CircleGeometry(radius, 128), material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/* ------------------------------------------------------- spot parts */

const MOTES = Object.freeze({
  motes: { count: 220, height: 2.4 },
  curtain: { count: 520, height: 1.8 },
  plume: { count: 200, height: 3.4 },
});

function risingMotes(radius, look) {
  const spec = MOTES[look];
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(quad.getIndex());
  geometry.setAttribute("position", quad.getAttribute("position"));
  geometry.setAttribute(
    "aSeed",
    new InstancedBufferAttribute(seeds(spec.count, 17), 4),
  );
  geometry.instanceCount = spec.count;
  geometry.boundingSphere = new Sphere(
    new Vector3(0, spec.height / 2, 0),
    radius + spec.height,
  );
  quad.dispose();
  const uniforms = {
    uClock: { value: 0 },
    uR: { value: radius },
    uH: { value: spec.height },
    uLook: { value: LOOKS.indexOf(look) },
    uState: { value: 0 },
    uLevel: { value: 0 },
    uColor: { value: new Color(NARRATION) },
  };
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: MOTE_VERTEX,
    fragmentShader: MOTE_FRAGMENT,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 3;
  return {
    mesh,
    set(clock, state, level) {
      uniforms.uClock.value = clock;
      uniforms.uState.value = state;
      uniforms.uLevel.value = level;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function spotGround(radius, look) {
  const uniforms = {
    uColor: { value: new Color(NARRATION) },
    uInk: { value: new Color(INK) },
    uR: { value: radius },
    uTime: { value: 0 },
    uState: { value: 0 },
    uLook: { value: LOOKS.indexOf(look) },
    uLevel: { value: 0 },
  };
  const mesh = flatDisc(radius + 0.5, groundMaterial(SPOT_FRAGMENT, uniforms));
  mesh.position.y = 0.014;
  mesh.renderOrder = 2;
  return {
    mesh,
    set(seconds, state, level) {
      uniforms.uTime.value = seconds;
      uniforms.uState.value = state;
      uniforms.uLevel.value = level;
    },
    dispose() {
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function speakerGlyph(g, cx, cy, s) {
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.moveTo(cx - s * 0.9, cy - s * 0.32);
  g.lineTo(cx - s * 0.45, cy - s * 0.32);
  g.lineTo(cx, cy - s * 0.78);
  g.lineTo(cx, cy + s * 0.78);
  g.lineTo(cx - s * 0.45, cy + s * 0.32);
  g.lineTo(cx - s * 0.9, cy + s * 0.32);
  g.closePath();
  g.fill();
  g.strokeStyle = NARRATION;
  g.lineCap = "round";
  g.lineWidth = s * 0.17;
  for (let i = 1; i <= 2; i++) {
    g.beginPath();
    g.arc(cx + s * 0.1, cy, s * (0.32 + i * 0.36), -0.85, 0.85);
    g.stroke();
  }
}

/** The longest start of `text` that fits `width` at the current font. */
function fitted(g, text, width) {
  if (g.measureText(text).width <= width) {
    return text;
  }
  let cut = text.length;
  while (cut > 1 && g.measureText(`${text.slice(0, cut)}...`).width > width) {
    cut -= 1;
  }
  return `${text.slice(0, cut).trimEnd()}...`;
}

const PLATE_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function paintPlate(canvas, title, sub) {
  const g = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);
  roundRect(g, 6, 6, W - 12, H - 12, 44);
  g.fillStyle = "rgba(20, 24, 36, 0.86)";
  g.fill();
  g.strokeStyle = "rgba(255, 255, 255, 0.14)";
  g.lineWidth = 3;
  g.stroke();
  speakerGlyph(g, 92, H / 2, 46);
  g.textBaseline = "alphabetic";
  g.fillStyle = "#ffffff";
  g.font = `600 70px ${PLATE_FONT}`;
  g.fillText(fitted(g, title, W - 210), 170, sub === "" ? H / 2 + 24 : 122);
  if (sub !== "") {
    g.fillStyle = "#c9cdd8";
    g.font = `500 44px ${PLATE_FONT}`;
    g.fillText(fitted(g, sub, W - 210), 170, 196);
  }
}

/** Words in the world: a name plate over the plume, Canvas 2D. */
function namePlate(title, env) {
  const canvas = new OffscreenCanvas(1024, 256);
  const texture = env.canvasTexture(canvas);
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(2.4, 0.6), material);
  mesh.renderOrder = 4;
  let painted = null;
  return {
    mesh,
    face(local) {
      mesh.rotation.y = Math.atan2(local.x, local.z);
    },
    say(sub) {
      if (sub === painted) {
        return;
      }
      painted = sub;
      paintPlate(canvas, title, sub);
      texture.needsUpdate = true;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/* ------------------------------------------------------- the player */

/**
 * What the card shows and asks: a narration's state, shared by the world
 * part (which opens and closes it by where the visitor stands) and the
 * card (which plays, pauses and scrubs it).
 *
 * States: `idle` (never played), `playing`, `away` (paused because the
 * visitor left; carries on at return), `paused` (stopped by a tap; stays
 * off until tapped), `ended`.
 */
class NarrationPlayer {
  constructor(block) {
    this.title = block.title;
    this.lines = block.lines;
    this.state = "idle";
    this.open = false;
    this.ready = false;
    this.problem = null;
    this.time = 0;
    this.duration = 0;
    this.line = -1;
    this.level = 0;
    this.voice = null;
    this.listeners = [];
  }

  /** `fn(player)` now and on every change; returns the unsubscribe. */
  subscribe(fn) {
    this.listeners.push(fn);
    fn(this);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) {
        this.listeners.splice(i, 1);
      }
    };
  }

  notify() {
    for (let i = 0; i < this.listeners.length; i++) {
      this.listeners[i](this);
    }
  }

  attach(voice) {
    this.voice = voice;
    this.duration = voice.duration;
    this.ready = true;
    voice.onEnded(() => this.ended());
    this.notify();
  }

  fail(problem) {
    this.problem = problem;
    this.notify();
  }

  /** The visitor's tap: play, pause, or play again. False when nothing happened. */
  toggle() {
    if (!this.ready || !this.open) {
      return false;
    }
    if (this.state === "playing") {
      this.time = this.voice.pause();
      this.state = "paused";
    } else {
      if (this.state === "ended") {
        this.time = 0;
      }
      this.voice.play(this.time);
      this.state = "playing";
    }
    this.notify();
    return true;
  }

  seek(seconds) {
    if (!this.ready || !Number.isFinite(seconds)) {
      return;
    }
    this.time = clamp(seconds, 0, this.duration);
    if (this.state === "playing") {
      this.voice.play(this.time);
    } else {
      this.voice.cue(this.time);
      this.state = this.time > 0 ? "paused" : "idle";
    }
    this.line = lineAt(this.lines, this.time);
    this.notify();
  }

  setOpen(open) {
    if (open === this.open) {
      return;
    }
    this.open = open;
    if (!open && this.state === "playing") {
      this.time = this.voice.pause();
      this.state = "away";
    } else if (open && this.state === "away") {
      this.voice.play(this.time);
      this.state = "playing";
    }
    this.notify();
  }

  ended() {
    this.state = "ended";
    this.time = this.duration;
    this.level = 0;
    this.notify();
  }

  tick() {
    if (this.state !== "playing") {
      this.level *= 0.9;
      return;
    }
    this.time = this.voice.time();
    this.level = this.voice.level();
    this.line = lineAt(this.lines, this.time);
    this.notify();
  }

  dispose() {
    this.listeners.length = 0;
    this.voice?.dispose();
    this.voice = null;
    this.ready = false;
  }
}

const STATE_CODE = Object.freeze({
  idle: 0,
  playing: 1,
  away: 2,
  paused: 2,
  ended: 3,
});

function plateLine(player, radius) {
  if (player === null) {
    return `Narration, circle ${String(radius)} m`;
  }
  if (player.state === "ended") {
    return "Heard";
  }
  if (!player.open) {
    return player.state === "away"
      ? "Paused, step back in"
      : "Step into the circle";
  }
  return { idle: "Tap play on the card", playing: "Playing", paused: "Paused" }[
    player.state
  ];
}

function loadVoice(block, env, player, gone) {
  if (block.audio === null) {
    player.fail("No sound file");
    return;
  }
  if (!env.sound) {
    player.fail("Sound is not available here");
    return;
  }
  env
    .loadAsset(block.audio)
    .then((blob) => env.sound.voice(blob))
    .then((voice) => {
      if (gone()) {
        voice.dispose();
      } else {
        player.attach(voice);
      }
    })
    .catch(() => {
      if (!gone()) {
        player.fail("The sound could not be loaded");
      }
    });
}

function spotPart(block, env) {
  const edit = env.mode === "edit";
  const look = lookOf(env);
  const margin = finite(env.proto?.marginM, 1, 0, 3);
  const radius = block.radiusM;
  const object = new Group();
  object.name = `audio-spot ${block.title}`;
  const ground = spotGround(radius, look);
  const motes = risingMotes(radius, look);
  object.add(ground.mesh, motes.mesh);
  const tapTarget = new Mesh(
    new CylinderGeometry(1.2, 1.2, 2.8, 12, 1, true),
    new MeshBasicMaterial({ visible: false }),
  );
  tapTarget.position.y = 1.4;
  object.add(tapTarget);
  const plate = look === "plume" ? namePlate(block.title, env) : null;
  if (plate !== null) {
    plate.mesh.position.y = 3.9;
    object.add(plate.mesh);
  }
  const player = edit ? null : new NarrationPlayer(block);
  const scratch = { m: new Matrix4(), v: new Vector3() };
  let disposed = false;
  let hidden = false;
  let clock = STILL_SECONDS;
  let rate = 1;
  let lastSeconds = -1;
  if (player !== null) {
    loadVoice(block, env, player, () => disposed);
  }

  function advance(seconds, state) {
    const dt = lastSeconds < 0 ? 0 : clamp(seconds - lastSeconds, 0, 0.1);
    lastSeconds = seconds;
    rate += (RISE_RATE[state] - rate) * Math.min(1, dt * 2);
    clock += dt * rate;
  }

  return {
    object,
    tapTarget,
    player,
    update(frame) {
      const d = groundDistance(object, frame, scratch);
      if (player !== null) {
        const edge = player.open ? radius + margin : radius;
        player.setOpen(!hidden && d <= edge);
        player.tick();
      }
      const state = player === null ? 4 : STATE_CODE[player.state];
      if (!edit) {
        advance(frame.seconds, state);
      }
      const level = player === null ? 0 : player.level;
      motes.set(clock, state, level);
      ground.set(edit ? STILL_SECONDS : frame.seconds, state, level);
      if (plate !== null) {
        plate.face(scratch.v);
        plate.say(plateLine(player, radius));
      }
    },
    tap() {
      if (player === null) {
        return;
      }
      if (!player.open) {
        env.notice?.("Step into the circle to listen");
        return;
      }
      player.toggle();
    },
    leave() {
      hidden = true;
    },
    back() {
      hidden = false;
    },
    dispose() {
      disposed = true;
      player?.dispose();
      ground.dispose();
      motes.dispose();
      plate?.dispose();
      tapTarget.geometry.dispose();
      tapTarget.material.dispose();
      object.clear();
    },
  };
}

/* ------------------------------------------------------- zone parts */

function zonePart(block, env) {
  const edit = env.mode === "edit";
  const uniforms = {
    uColor: { value: new Color(AMBIENT) },
    uInk: { value: new Color(INK) },
    uMin: { value: block.minM },
    uMax: { value: block.maxM },
    uTime: { value: STILL_SECONDS },
    uLow: { value: 0 },
    uGain: { value: 0 },
    uEdit: { value: edit ? 1 : 0 },
  };
  const object = new Group();
  object.name = `audio-zone ${block.title}`;
  const mesh = flatDisc(
    block.maxM + 0.3,
    groundMaterial(ZONE_FRAGMENT, uniforms),
  );
  mesh.position.y = 0.01;
  mesh.renderOrder = 1;
  object.add(mesh);
  const scratch = { m: new Matrix4(), v: new Vector3() };
  let bed = null;
  let disposed = false;
  let hidden = false;
  let lastGain = -1;
  if (!edit && env.sound && block.audio !== null) {
    env
      .loadAsset(block.audio)
      .then((blob) => env.sound.bed(blob))
      .then((handle) => {
        if (disposed) {
          handle.dispose();
        } else {
          bed = handle;
        }
      })
      .catch(() => env.notice?.(`"${block.title}" could not be loaded`));
  }

  return {
    object,
    update(frame) {
      if (edit) {
        return;
      }
      uniforms.uTime.value = frame.seconds;
      const d = groundDistance(object, frame, scratch);
      const gain = hidden ? 0 : loudness(d, block) * block.volume;
      if (bed !== null && Math.abs(gain - lastGain) > 0.004) {
        bed.setGain(gain);
        lastGain = gain;
      }
      uniforms.uGain.value = block.volume > 0 ? gain / block.volume : 0;
      uniforms.uLow.value = env.sound ? env.sound.lowered() : 0;
    },
    leave() {
      hidden = true;
    },
    back() {
      hidden = false;
    },
    dispose() {
      disposed = true;
      bed?.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
      object.clear();
    },
  };
}

/**
 * The kind's part in the world. The host places `object`, calls `update`
 * once per frame with `{ seconds, viewer }`, `tap` when `tapTarget` was
 * tapped, `leave` and `back` when the station's content stops and starts
 * showing, and `dispose` once. A `spot` part also carries `player`, which
 * the host hands to `card` while `player.open` is true.
 */
export function world(block, env) {
  return block.view === "zone" ? zonePart(block, env) : spotPart(block, env);
}

/* --------------------------------------------------------- the card */

const ICON = Object.freeze({
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor"/></svg>',
  again:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>',
});

function mmss(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
}

function cardWords(p) {
  if (p.problem !== null) {
    return { state: p.problem, button: "play", label: "Play", disabled: true };
  }
  if (!p.ready) {
    return {
      state: "Loading...",
      button: "play",
      label: "Play",
      disabled: true,
    };
  }
  if (p.state === "playing") {
    return {
      state: "Playing",
      button: "pause",
      label: "Pause",
      disabled: false,
    };
  }
  if (p.state === "ended") {
    return {
      state: "Heard. Play again?",
      button: "again",
      label: "Play again",
      disabled: false,
    };
  }
  const state = p.state === "idle" ? "Tap play to listen" : "Paused";
  return { state, button: "play", label: "Play", disabled: false };
}

function make(doc, tag, className, parent) {
  const el = doc.createElement(tag);
  el.className = className;
  parent?.append(el);
  return el;
}

function cardDom(doc, el, title) {
  const root = make(doc, "section", "ak-card", el);
  root.setAttribute("aria-label", `Narration: ${title}`);
  const head = make(doc, "div", "ak-head", root);
  make(doc, "span", "ak-dot", head);
  make(doc, "span", "ak-kicker", head).textContent = "Narration";
  const state = make(doc, "span", "ak-state", head);
  make(doc, "h2", "ak-title", root).textContent = title;
  const row = make(doc, "div", "ak-row", root);
  const button = make(doc, "button", "ak-play", row);
  button.type = "button";
  const scrub = make(doc, "div", "ak-scrub", row);
  scrub.setAttribute("role", "slider");
  scrub.setAttribute("tabindex", "0");
  scrub.setAttribute("aria-label", "Position");
  const track = make(doc, "div", "ak-track", scrub);
  const fill = make(doc, "div", "ak-fill", track);
  const thumb = make(doc, "div", "ak-thumb", track);
  const time = make(doc, "span", "ak-time", row);
  const line = make(doc, "p", "ak-line", root);
  return { root, state, button, scrub, track, fill, thumb, time, line };
}

function shownLine(p) {
  if (p.lines.length === 0) {
    return { text: "", ahead: false };
  }
  const i = p.line >= 0 ? p.line : lineAt(p.lines, p.time);
  return i >= 0
    ? { text: p.lines[i].text, ahead: false }
    : { text: p.lines[0].text, ahead: true };
}

function scrubBy(dom, player) {
  let dragging = false;
  let preview = 0;
  const fractionAt = (event) => {
    const box = dom.track.getBoundingClientRect();
    return box.width > 0
      ? clamp((event.clientX - box.left) / box.width, 0, 1)
      : 0;
  };
  const show = (f) => {
    dom.fill.style.transform = `scaleX(${String(f)})`;
    dom.thumb.style.left = `${String(f * 100)}%`;
  };
  const down = (event) => {
    if (!player.ready) {
      return;
    }
    dragging = true;
    dom.scrub.setPointerCapture(event.pointerId);
    preview = fractionAt(event);
    show(preview);
  };
  const move = (event) => {
    if (dragging) {
      preview = fractionAt(event);
      show(preview);
    }
  };
  const up = () => {
    if (dragging) {
      dragging = false;
      player.seek(preview * player.duration);
    }
  };
  const key = (event) => {
    const step = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5 }[
      event.key
    ];
    if (step !== undefined) {
      event.preventDefault();
      player.seek(player.time + step);
    }
  };
  dom.scrub.addEventListener("pointerdown", down);
  dom.scrub.addEventListener("pointermove", move);
  dom.scrub.addEventListener("pointerup", up);
  dom.scrub.addEventListener("pointercancel", up);
  dom.scrub.addEventListener("keydown", key);
  return { show, dragging: () => dragging };
}

/**
 * The player card, built inside `el` (which the host scopes with
 * `data-kind="audio"`). Returns `{ dispose }`; the host disposes it when
 * `player.open` turns false.
 */
export function card(block, el, player) {
  const dom = cardDom(el.ownerDocument, el, block.title);
  const scrub = scrubBy(dom, player);
  const last = {
    state: "",
    button: "",
    disabled: null,
    second: -1,
    duration: -1,
    line: null,
  };
  dom.button.addEventListener("click", () => player.toggle());

  const render = (p) => {
    const w = cardWords(p);
    if (w.state !== last.state) {
      dom.state.textContent = w.state;
      last.state = w.state;
    }
    if (w.button !== last.button) {
      dom.button.innerHTML = ICON[w.button];
      dom.button.setAttribute("aria-label", w.label);
      last.button = w.button;
    }
    if (w.disabled !== last.disabled) {
      dom.button.disabled = w.disabled;
      last.disabled = w.disabled;
    }
    if (!scrub.dragging()) {
      scrub.show(p.duration > 0 ? clamp(p.time / p.duration, 0, 1) : 0);
    }
    const second = Math.floor(p.time);
    if (second !== last.second || p.duration !== last.duration) {
      dom.time.textContent = `${mmss(p.time)} / ${mmss(p.duration)}`;
      dom.scrub.setAttribute("aria-valuemin", "0");
      dom.scrub.setAttribute("aria-valuemax", String(Math.round(p.duration)));
      dom.scrub.setAttribute("aria-valuenow", String(second));
      dom.scrub.setAttribute(
        "aria-valuetext",
        `${mmss(p.time)} of ${mmss(p.duration)}`,
      );
      last.second = second;
      last.duration = p.duration;
    }
    const line = shownLine(p);
    if (line.text !== last.line) {
      dom.line.textContent = line.text;
      dom.line.hidden = line.text === "";
      last.line = line.text;
    }
    dom.line.classList.toggle("ak-ahead", line.ahead);
  };

  const unsubscribe = player.subscribe(render);
  return {
    dispose() {
      unsubscribe();
      dom.root.remove();
    },
  };
}
