/**
 * The narration circle's look, the "plume": a dashed rim on the ground at
 * the radius with a soft glow at the centre, a slow plume of motes rising
 * from the centre and widening as it climbs (the mark that says "go
 * there"), and a name plate above it. Everything moves on the GPU: a frame
 * writes a few uniforms and never a buffer. The plume hurries while the
 * voice plays, slows when it pauses, dims once heard, and stands still in
 * the editor. Its colours are the sounds' warm glow (`warm-glow.ts`). An
 * invisible column is what a tap is cast against.
 *
 * @see narration-look.ts.md
 */

import {
  CircleGeometry,
  CylinderGeometry,
  GLSL3,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Sphere,
  Vector3,
  type Object3D,
  type Texture,
} from "three";

import { WARM_GLOW } from "./warm-glow.js";

/** What the voice of a circle is doing, as its look shows it. */
export type NarrationState = "idle" | "playing" | "paused" | "away" | "heard";

export interface NarrationLookOptions {
  /** `edit`: still, and its plate says what it is rather than what to do. */
  readonly mode: "play" | "edit";
  /** The plate's first line; no plate without `plate`. */
  readonly title?: string;
  /** The plate's canvas and its texture (the page's `canvasTexture`);
   *  none: no plate (a page without a canvas). */
  readonly plate?: {
    readonly canvas: HTMLCanvasElement;
    readonly texture: Texture;
  };
}

export interface NarrationLook {
  readonly object: Object3D;
  /** What a tap is cast against. */
  readonly tapTarget: Object3D;
  /** The voice's state and whether the visitor stands inside; repaints
   *  the plate only when its line changes. */
  show(state: NarrationState, inside: boolean): void;
  /** Turns the plate toward a viewer `dx`, `dz` metres off the centre in
   *  the look's own frame. */
  face(dx: number, dz: number): void;
  /** One frame at page time `seconds`; writes uniforms only. */
  tick(seconds: number): void;
  dispose(): void;
}

/** The plume: how many motes and how high they rise (m). Its cost. */
export const PLUME = Object.freeze({ count: 200, heightM: 3.4 });
/** The editor's plume stands where it is this far into its rise (s). */
const STILL_SECONDS = 1.7;
/** How fast the plume rises per state code (1 = idle; the editor's 0). */
const RISE_RATE = Object.freeze([1, 1.6, 0.75, 0.55, 0]);
/** The longest step a frame may take (s): a tab left and come back to
 *  does not throw the motes ahead. */
const MAX_STEP_S = 0.1;
const STATE_CODE: Readonly<Record<NarrationState, number>> = {
  idle: 0,
  playing: 1,
  paused: 2,
  away: 2,
  heard: 3,
};
const EDIT_CODE = 4;
const TAP_RADIUS_M = 1.2;
const TAP_HEIGHT_M = 2.8;
const PLATE = Object.freeze({ widthM: 2.4, heightM: 0.6, atM: 3.9 });

/** Each mote's four seeds (angle, spread, phase, pace), made once for every
 *  circle: two circles look alike and a test is repeatable. */
const SEEDS = (() => {
  let s = 17;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(PLUME.count * 4);
  for (let i = 0; i < out.length; i += 1) out[i] = next();
  return out;
})();

const GROUND_VERTEX = /* glsl */ `
out vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** The rim (dashed), its halo, the centre glow, and a wave running out
 *  while the voice plays; half as strong once heard. */
const GROUND_FRAGMENT = /* glsl */ `
in vec2 vP;
uniform vec3 uColor;
uniform vec3 uGlow;
uniform vec3 uInk;
uniform float uR;
uniform float uTime;
uniform float uState;
out vec4 fragColor;
float band(float r, float at, float w) {
  float px = fwidth(r);
  return 1.0 - smoothstep(w - px, w + px, abs(r - at));
}
void main() {
  float r = length(vP);
  float dash = step(0.42, fract(atan(vP.y, vP.x) * uR / 0.55));
  float rim = band(r, uR, 0.045) * dash;
  float halo = band(r, uR, 0.14) * dash;
  float fill = (1.0 - smoothstep(0.0, 1.5, r)) * 0.24;
  float heard = (uState > 2.5 && uState < 3.5) ? 0.55 : 1.0;
  float wave = 0.0;
  if (uState > 0.5 && uState < 1.5) {
    float ph = fract(uTime / 3.2);
    wave = band(r, ph * uR, 0.05) * (1.0 - ph) * 0.4;
  }
  float a = (max(halo * 0.3, rim * 0.95) + fill) * heard + wave;
  vec3 lit = mix(uGlow, uColor, rim);
  vec3 col = mix(uInk, lit, clamp(rim + (fill + wave) * 6.0, 0.0, 1.0));
  if (a < 0.004) discard;
  fragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

/** One mote per instance: a camera-facing quad on its spiral, rising,
 *  widening and shrinking as it climbs, fading in and out over its life. */
const PLUME_VERTEX = /* glsl */ `
in vec4 aSeed;
uniform float uClock;
uniform float uH;
uniform float uState;
out vec2 vUv;
out float vA;
void main() {
  float a = aSeed.x * 6.2831853;
  float speed = mix(0.55, 1.2, aSeed.w);
  float life = fract(aSeed.z + uClock * speed * 0.42 / uH * 2.4);
  float fade = sin(3.14159 * life);
  float r = aSeed.y * aSeed.y * (0.3 + life * 1.0);
  float turn = a + life * 1.6 + uClock * 0.2;
  vec3 c = vec3(cos(turn) * r, life * uH, sin(turn) * r);
  float size = 0.14 * (1.0 - 0.45 * life);
  float lit = 1.0;
  if (uState > 1.5 && uState < 2.5) lit = 0.8;
  else if (uState > 2.5 && uState < 3.5) lit = 0.45;
  vA = fade * lit;
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size * (0.85 + 0.35 * lit);
  gl_Position = projectionMatrix * mv;
  vUv = position.xy + 0.5;
}`;

const PLUME_FRAGMENT = /* glsl */ `
in vec2 vUv;
in float vA;
uniform vec3 uColor;
uniform vec3 uSpark;
out vec4 fragColor;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float m = 1.0 - smoothstep(0.0, 1.0, d);
  float core = 1.0 - smoothstep(0.0, 0.4, d);
  float a = m * m * vA;
  if (a < 0.01) discard;
  fragColor = vec4(mix(uColor, uSpark, core), a);
}`;

const rgb = (c: readonly [number, number, number]) => new Vector3(...c);

function shader(
  vertexShader: string,
  fragmentShader: string,
  uniforms: ShaderMaterial["uniforms"],
): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader,
    fragmentShader,
  });
}

function ground(radiusM: number) {
  const uniforms = {
    uColor: { value: rgb(WARM_GLOW.rim) },
    uGlow: { value: rgb(WARM_GLOW.glow) },
    uInk: { value: rgb(WARM_GLOW.ink) },
    uR: { value: radiusM },
    uTime: { value: STILL_SECONDS },
    uState: { value: 0 },
  };
  const mesh = new Mesh(
    new CircleGeometry(radiusM + 0.5, 128),
    shader(GROUND_VERTEX, GROUND_FRAGMENT, uniforms),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.014;
  mesh.renderOrder = 2;
  return { mesh, uniforms };
}

function plume(radiusM: number) {
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(quad.getIndex());
  geometry.setAttribute("position", quad.getAttribute("position"));
  geometry.setAttribute("aSeed", new InstancedBufferAttribute(SEEDS, 4));
  geometry.instanceCount = PLUME.count;
  geometry.boundingSphere = new Sphere(
    new Vector3(0, PLUME.heightM / 2, 0),
    Math.max(radiusM, 1.5) + PLUME.heightM,
  );
  quad.dispose();
  const uniforms = {
    uClock: { value: STILL_SECONDS },
    uH: { value: PLUME.heightM },
    uState: { value: 0 },
    uColor: { value: rgb(WARM_GLOW.glow) },
    uSpark: { value: rgb(WARM_GLOW.spark) },
  };
  const mesh = new Mesh(
    geometry,
    shader(PLUME_VERTEX, PLUME_FRAGMENT, uniforms),
  );
  mesh.renderOrder = 3;
  return { mesh, uniforms };
}

const PLATE_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function speakerGlyph(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  stroke: string,
): void {
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
  g.strokeStyle = stroke;
  g.lineCap = "round";
  g.lineWidth = s * 0.17;
  for (let i = 1; i <= 2; i += 1) {
    g.beginPath();
    g.arc(cx + s * 0.1, cy, s * (0.32 + i * 0.36), -0.85, 0.85);
    g.stroke();
  }
}

/** The longest start of `text` that fits `width` at the current font. */
function fitted(g: CanvasRenderingContext2D, text: string, width: number) {
  if (g.measureText(text).width <= width) return text;
  let cut = text.length;
  while (cut > 1 && g.measureText(`${text.slice(0, cut)}...`).width > width) {
    cut -= 1;
  }
  return `${text.slice(0, cut).trimEnd()}...`;
}

const css = (c: readonly [number, number, number]) =>
  `rgb(${c.map((v) => String(Math.round(v * 255))).join(" ")})`;

function paintPlate(canvas: HTMLCanvasElement, title: string, sub: string) {
  const g = canvas.getContext("2d");
  if (g === null) return;
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);
  roundRect(g, 6, 6, W - 12, H - 12, 44);
  g.fillStyle = "rgba(20, 24, 36, 0.86)";
  g.fill();
  g.strokeStyle = "rgba(255, 255, 255, 0.14)";
  g.lineWidth = 3;
  g.stroke();
  speakerGlyph(g, 92, H / 2, 46, css(WARM_GLOW.rim));
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

/** The plate's second line: what to do, or what is happening. */
function plateLine(state: NarrationState, inside: boolean): string {
  if (state === "heard") return "Heard";
  if (!inside) {
    return state === "away" ? "Paused, step back in" : "Step into the circle";
  }
  if (state === "playing") return "Playing";
  if (state === "idle") return "Tap play on the card";
  return "Paused";
}

function namePlate(
  title: string,
  plate: NonNullable<NarrationLookOptions["plate"]>,
) {
  const { canvas, texture } = plate;
  canvas.width = 1024;
  canvas.height = 256;
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(
    new PlaneGeometry(PLATE.widthM, PLATE.heightM),
    material,
  );
  mesh.position.y = PLATE.atM;
  mesh.renderOrder = 4;
  let painted: string | null = null;
  return {
    mesh,
    say(sub: string) {
      if (sub === painted) return;
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

export function narrationLook(
  radiusM: number,
  options: NarrationLookOptions,
): NarrationLook {
  const edit = options.mode === "edit";
  const object = new Group();
  const disc = ground(radiusM);
  const rise = plume(radiusM);
  const tapGeometry = new CylinderGeometry(
    TAP_RADIUS_M,
    TAP_RADIUS_M,
    TAP_HEIGHT_M,
    12,
    1,
    true,
  );
  const tapMaterial = new MeshBasicMaterial({ visible: false });
  const tapTarget = new Mesh(tapGeometry, tapMaterial);
  tapTarget.position.y = TAP_HEIGHT_M / 2;
  object.add(disc.mesh, rise.mesh, tapTarget);
  const plate =
    options.plate === undefined
      ? null
      : namePlate(options.title ?? "", options.plate);
  if (plate !== null) object.add(plate.mesh);

  let code = edit ? EDIT_CODE : STATE_CODE.idle;
  let rate = RISE_RATE[code] ?? 1;
  let clock = STILL_SECONDS;
  let lastSeconds = Number.NaN;
  disc.uniforms.uState.value = code;
  rise.uniforms.uState.value = code;
  if (edit) plate?.say(`Narration, circle ${String(radiusM)} m`);

  return {
    object,
    tapTarget,
    show(state, inside) {
      if (edit) return;
      code = STATE_CODE[state];
      disc.uniforms.uState.value = code;
      rise.uniforms.uState.value = code;
      plate?.say(plateLine(state, inside));
    },
    face(dx, dz) {
      if (plate !== null) plate.mesh.rotation.y = Math.atan2(dx, dz);
    },
    tick(seconds) {
      if (edit || !Number.isFinite(seconds)) return;
      const dt = Number.isNaN(lastSeconds)
        ? 0
        : Math.min(MAX_STEP_S, Math.max(0, seconds - lastSeconds));
      lastSeconds = seconds;
      const target = RISE_RATE[code] ?? 1;
      rate += (target - rate) * Math.min(1, dt * 2);
      clock += dt * rate;
      rise.uniforms.uClock.value = clock;
      disc.uniforms.uTime.value = seconds;
    },
    dispose() {
      disc.mesh.geometry.dispose();
      disc.mesh.material.dispose();
      rise.mesh.geometry.dispose();
      rise.mesh.material.dispose();
      tapGeometry.dispose();
      tapMaterial.dispose();
      plate?.dispose();
    },
  };
}
