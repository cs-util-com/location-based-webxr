/**
 * A free video's look in the world, one per view: a screen (a dark slab
 * standing in the air with its picture, a play glyph while it waits and a
 * control bar), a cutout (the figure standing on the ground below its
 * pose, turning at most 30 degrees toward the visitor) and a porthole (a
 * round medallion with a bronze bezel, a progress ring and a "Watch"
 * label), a window (the clip deep in an opening of a stone wall, its
 * reveals lit at the front, a timber frame round its edge, a keystone, a
 * sill and a warm spill of light on the ground) and a stand-here
 * projection (a soft-edged ellipse on the wall, shaded by how far it has
 * developed, `stand-here.ts`; its footprints at the viewpoint are
 * `standHereSpot`, which the part stands in the station's frame). Built
 * from the chosen prototype's measures at its 1.6 m width
 * and scaled as a whole to the block's width, so a drawing twice as wide
 * is exactly twice as large; marked with that width for the editor's
 * size preview (`placement/place-scale.ts`). Pure drawing: the part
 * (`video-world.ts`) hands it the clip's texture and its state each
 * frame. Without a page (Node) its painted parts stay unpainted, the same
 * size.
 *
 * Its frame: metres, Y up, the pose at the origin, front +Z
 * (`world-part.ts`).
 *
 * @see video-look.ts.md
 */

import type { TourPictureViewpoint } from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Path,
  PlaneGeometry,
  ShaderMaterial,
  Shape,
  TorusGeometry,
  Vector4,
  type CanvasTexture,
  type Material,
  type Object3D,
  type Texture,
} from "three";

import { markPlaceScale } from "../../placement/place-scale.js";
import { viewpointYaw } from "../picture/viewpoint-looks.js";
import { standHereShade } from "./stand-here.js";

/** The prototype's width, at which its measures hold (m). */
const LOOK_REFERENCE_WIDTH_M = 1.6;

/** The clip's height over its width until its own is known: the
 *  prototype's 512 x 640 clip. */
export const VIDEO_DEFAULT_ASPECT = 1.25;

/** How far a cutout turns toward the visitor at most (radians). */
export const CUTOUT_MAX_TURN = (30 * Math.PI) / 180;

/** The views a free video stands in. */
export type VideoWorldView =
  "screen" | "cutout" | "porthole" | "window" | "standHere";

/** What the part tells its look each frame. */
export interface LookState {
  /** The clip's frames; null until it can show one. */
  readonly clip: Texture | null;
  /** The poster, shown until the clip first plays; null: none. */
  readonly poster: Texture | null;
  /** The clip has played (the poster gives way to its frames). */
  readonly started: boolean;
  readonly playing: boolean;
  /** How far it has played, 0 to 1. */
  readonly progress: number;
  /** "0:04 / 0:12" (the screen's bar, the porthole's label). */
  readonly time: string;
  readonly sound: boolean;
  /** The page clock (s), for a smooth turn and a pulse. */
  readonly seconds: number;
  /** The viewer in the look's parent frame (the part's object), or none:
   *  a cutout then stands as posed. */
  readonly viewer: readonly [number, number, number] | null;
  /** How far a stand-here projection has developed, 0 to 1; absent:
   *  whole (the editor, and every other view). */
  readonly develop?: number;
}

/** A view's drawing. */
export interface VideoLook {
  /** Scaled to the width and marked for the size preview. */
  readonly object: Object3D;
  /** What a tap is cast against: the picture and its frame, never the
   *  shadow on the ground. */
  readonly tapTarget: Object3D;
  show(state: LookState): void;
  /** Stands the shadow and a cutout's foot `liftM` (in the part's own
   *  metres) below the object, where the ground is now: a folder drawing
   *  the part at another scale moves it. A value that is no finite
   *  number, and the porthole (no ground), change nothing. */
  ground(liftM: number): void;
  dispose(): void;
}

/** What a look is built with. */
export interface LookOptions {
  readonly view: VideoWorldView;
  readonly widthM: number;
  /** The clip's height over its width. */
  readonly aspect: number;
  /** The clip carries its matte below its colour (`alpha: stacked`). */
  readonly stacked: boolean;
  /** The pose's height above the ground (m), so a shadow and a cutout
   *  stand on it. */
  readonly liftM: number;
  /** The editor's drawing: notes only a creator needs. */
  readonly edit: boolean;
  /** A canvas as a texture (`WorldEnv.canvasTexture`). */
  canvasTexture(canvas: HTMLCanvasElement): CanvasTexture;
}

const CLIP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The clip: its colour (the upper half of a stacked frame), the poster
// over it until it plays, its matte (the lower half) or a feathered
// ellipse as its alpha, a circle for the porthole, a crop, its edge
// darkened inward (a window's reveal), and a sepia tone and a warm gain (a
// stand-here projection not yet developed).
const CLIP_FRAG = /* glsl */ `
uniform sampler2D map;
uniform sampler2D poster;
uniform float hasMap, hasPoster, posterMix, stacked, ellipse, feather, circle, opacity, inner, tone, tint;
uniform vec3 blank;
uniform vec4 crop;
varying vec2 vUv;
void main() {
  vec2 uv = crop.xy + vUv * crop.zw;
  vec2 cu = stacked > 0.5 ? vec2(uv.x, 0.5 + uv.y * 0.5) : uv;
  vec3 col = hasMap > 0.5 ? texture2D(map, cu).rgb : blank;
  if (hasPoster > 0.5) col = mix(col, texture2D(poster, uv).rgb, posterMix);
  float a = 1.0;
  if (stacked > 0.5 && hasMap > 0.5) a = texture2D(map, vec2(uv.x, uv.y * 0.5)).r;
  vec2 d = vUv - 0.5;
  if (ellipse > 0.5) a *= 1.0 - smoothstep(1.0 - feather, 1.0, length(d * 2.0));
  if (circle > 0.5) {
    float r = length(d) * 2.0;
    a *= 1.0 - smoothstep(0.98, 1.0, r);
    col *= mix(0.55, 1.0, smoothstep(1.0, 0.55, r));
  }
  if (inner > 0.0) {
    vec2 e = smoothstep(vec2(0.0), vec2(0.2), vUv) * smoothstep(vec2(0.0), vec2(0.2), 1.0 - vUv);
    col *= mix(1.0 - inner, 1.0, e.x * e.y);
  }
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(l) * vec3(1.1, 0.97, 0.8), tone) * tint;
  gl_FragColor = vec4(col, a * opacity);
  #include <colorspace_fragment>
}`;

const RING_FRAG = /* glsl */ `
uniform float p;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float u = fract(atan(d.x, d.y) / 6.2831853 + 1.0);
  float r = length(d) * 2.0;
  float ring = smoothstep(0.9, 0.92, r) * (1.0 - smoothstep(0.96, 0.98, r));
  vec3 c = u <= p ? vec3(0.945, 0.706, 0.361) : vec3(1.0);
  gl_FragColor = vec4(c, ring * (u <= p ? 1.0 : 0.25));
  #include <colorspace_fragment>
}`;

/** The slab's and the back's colour, the bezel's, the progress accent. */
const SLAB = "#17191d";
const BEZEL = "#8d6c42";
const ACCENT = "#f1b45c";
const INK = "#f6f2ea";
/** A window's timber frame and its stone surround. */
const TIMBER = "#3b2d23";
const STONE = "#d9d3c6";

/** A porthole glows while the visitor is this near (m). */
const HALO_NEAR_M = 12;

function clipMaterial(o: {
  stacked?: boolean;
  ellipse?: boolean;
  feather?: number;
  circle?: boolean;
  inner?: number;
  depthWrite?: boolean;
  crop?: readonly [number, number, number, number];
}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      map: { value: null },
      poster: { value: null },
      hasMap: { value: 0 },
      hasPoster: { value: 0 },
      posterMix: { value: 1 },
      stacked: { value: o.stacked === true ? 1 : 0 },
      ellipse: { value: o.ellipse === true ? 1 : 0 },
      feather: { value: o.feather ?? 0.35 },
      circle: { value: o.circle === true ? 1 : 0 },
      opacity: { value: 1 },
      inner: { value: o.inner ?? 0 },
      tone: { value: 0 },
      tint: { value: 1 },
      blank: { value: [0.02, 0.022, 0.026] },
      crop: { value: new Vector4(...(o.crop ?? [0, 0, 1, 1])) },
    },
    vertexShader: CLIP_VERT,
    fragmentShader: CLIP_FRAG,
    transparent: true,
    ...(o.depthWrite === true ? { depthWrite: true } : {}),
  });
}

/** Sets a material's uniform `name`, if it has one. */
function setUniform(
  material: ShaderMaterial,
  name: string,
  value: unknown,
): void {
  const uniform = material.uniforms[name];
  if (uniform !== undefined) uniform.value = value;
}

/** Hand the clip and the poster to a clip material. */
function feedClip(material: ShaderMaterial, state: LookState): void {
  const set = (name: string, value: unknown): void => {
    setUniform(material, name, value);
  };
  set("map", state.clip);
  set("hasMap", state.clip === null ? 0 : 1);
  set("poster", state.poster);
  set("hasPoster", state.poster === null ? 0 : 1);
  set("posterMix", state.started || state.poster === null ? 0 : 1);
}

/** A canvas of `w` x `h` px and its 2D context; null without a page. */
function canvasOf(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  const doc = (globalThis as { document?: Document }).document;
  const canvas = doc?.createElement("canvas");
  if (canvas === undefined) return null;
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const g = canvas.getContext("2d");
  return g === null ? null : { canvas, g };
}

type Icon = "play" | "pause" | "sound" | "muted";

/** The prototype's glyphs, `s` px across at (`x`, `y`). */
function drawIcon(
  g: CanvasRenderingContext2D,
  icon: Icon,
  x: number,
  y: number,
  s: number,
  color: string,
): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  if (icon === "play") {
    g.moveTo(-s * 0.32, -s * 0.42);
    g.lineTo(s * 0.48, 0);
    g.lineTo(-s * 0.32, s * 0.42);
    g.closePath();
    g.fill();
  } else if (icon === "pause") {
    g.rect(-s * 0.36, -s * 0.4, s * 0.24, s * 0.8);
    g.rect(s * 0.12, -s * 0.4, s * 0.24, s * 0.8);
    g.fill();
  } else {
    g.moveTo(-s * 0.5, -s * 0.17);
    g.lineTo(-s * 0.25, -s * 0.17);
    g.lineTo(s * 0.05, -s * 0.42);
    g.lineTo(s * 0.05, s * 0.42);
    g.lineTo(-s * 0.25, s * 0.17);
    g.lineTo(-s * 0.5, s * 0.17);
    g.closePath();
    g.fill();
    g.lineWidth = s * 0.1;
    g.beginPath();
    if (icon === "sound") {
      g.arc(s * 0.08, 0, s * 0.25, -0.8, 0.8);
      g.moveTo(s * 0.08 + s * 0.42 * Math.cos(-0.8), s * 0.42 * Math.sin(-0.8));
      g.arc(s * 0.08, 0, s * 0.42, -0.8, 0.8);
    } else {
      g.moveTo(s * 0.2, -s * 0.18);
      g.lineTo(s * 0.52, s * 0.18);
      g.moveTo(s * 0.52, -s * 0.18);
      g.lineTo(s * 0.2, s * 0.18);
    }
    g.stroke();
  }
  g.restore();
}

/** Everything a look made, freed together. */
class Owned {
  readonly geometries: { dispose(): void }[] = [];
  readonly materials: Material[] = [];
  readonly textures: Texture[] = [];
  mesh<M extends Material>(
    geometry: { dispose(): void } & ConstructorParameters<typeof Mesh>[0],
    material: M,
  ): Mesh {
    this.geometries.push(geometry);
    this.materials.push(material);
    return new Mesh(geometry, material);
  }
  texture(
    options: LookOptions,
    painted: { canvas: HTMLCanvasElement } | null,
  ): CanvasTexture | null {
    if (painted === null) return null;
    const t = options.canvasTexture(painted.canvas);
    this.textures.push(t);
    return t;
  }
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}

/** A flat plane with `map` (or none), drawn over what is behind it. */
function uiMaterial(
  map: Texture | null,
  extra: object = {},
): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    // Unpainted (no page): nothing to see, the same size.
    ...(map === null ? { opacity: 0 } : {}),
    ...extra,
  });
}

/** A soft round blob, painted once: a shadow or a glow. */
function radialCanvas(
  stops: readonly (readonly [number, string])[],
): { canvas: HTMLCanvasElement } | null {
  const c = canvasOf(128, 128);
  if (c === null) return null;
  const gradient = c.g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  c.g.fillStyle = gradient;
  c.g.fillRect(0, 0, 128, 128);
  return c;
}

const SHADOW_STOPS = [
  [0, "rgba(20,18,16,.62)"],
  [0.55, "rgba(20,18,16,.3)"],
  [1, "rgba(20,18,16,0)"],
] as const;
const GLOW_STOPS = [
  [0, "rgba(255,214,150,1)"],
  [0.5, "rgba(255,200,130,.35)"],
  [1, "rgba(255,200,130,0)"],
] as const;

/** A shadow lying on the ground `groundY` below, `w` x `d`. */
function groundShadow(
  owned: Owned,
  options: LookOptions,
  w: number,
  d: number,
  opacity: number,
): Mesh {
  const map = owned.texture(options, radialCanvas(SHADOW_STOPS));
  const shadow = owned.mesh(
    new PlaneGeometry(w, d),
    uiMaterial(map, map === null ? {} : { opacity }),
  );
  shadow.rotation.x = -Math.PI / 2;
  // A shadow takes no tap and is no part of what the picture shows.
  shadow.raycast = () => undefined;
  return shadow;
}

/** The screen: the prototype's `buildScreen` at its reference width. */
function screenLook(owned: Owned, o: LookOptions, ground: number) {
  const w = LOOK_REFERENCE_WIDTH_M;
  const h = w * o.aspect;
  const bar = Math.max(0.17, w * 0.13);
  const pad = Math.max(0.035, w * 0.028);
  const root = new Group();
  const front = new Group();
  front.position.z = 0.12;
  root.add(front);
  const sw = w + 2 * pad;
  const sh = h + bar + 2 * pad;
  const shape = new Shape();
  {
    const x = -sw / 2;
    const y = -h / 2 - bar - pad;
    const r = pad * 1.6;
    shape.moveTo(x + r, y);
    shape.lineTo(x + sw - r, y);
    shape.quadraticCurveTo(x + sw, y, x + sw, y + r);
    shape.lineTo(x + sw, y + sh - r);
    shape.quadraticCurveTo(x + sw, y + sh, x + sw - r, y + sh);
    shape.lineTo(x + r, y + sh);
    shape.quadraticCurveTo(x, y + sh, x, y + sh - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
  }
  const slab = owned.mesh(
    new ExtrudeGeometry(shape, {
      depth: 0.03,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 2,
      curveSegments: 6,
    }),
    new MeshLambertMaterial({ color: SLAB }),
  );
  slab.position.z = -0.03;
  front.add(slab);
  const clip = clipMaterial({});
  const picture = owned.mesh(new PlaneGeometry(w, h), clip);
  picture.position.z = 0.009;
  front.add(picture);
  // The big play glyph while it does not play.
  const glyphPaint = canvasOf(256, 256);
  if (glyphPaint !== null) {
    const g = glyphPaint.g;
    g.fillStyle = "rgba(15,17,21,.72)";
    g.beginPath();
    g.arc(128, 128, 118, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,.5)";
    g.lineWidth = 4;
    g.stroke();
    drawIcon(g, "play", 136, 128, 120, INK);
  }
  const glyphMaterial = uiMaterial(owned.texture(o, glyphPaint));
  const glyph = owned.mesh(
    new PlaneGeometry(w * 0.28, w * 0.28),
    glyphMaterial,
  );
  glyph.position.z = 0.014;
  front.add(glyph);
  // The control bar: play state, progress, time, sound.
  const barPaint = canvasOf(1024, (1024 * bar) / w);
  const barTexture = owned.texture(o, barPaint);
  const barMesh = owned.mesh(new PlaneGeometry(w, bar), uiMaterial(barTexture));
  barMesh.position.set(0, -h / 2 - bar / 2 - pad * 0.3, 0.009);
  front.add(barMesh);
  let lastBar = "";
  const drawBar = (s: LookState): void => {
    if (barPaint === null || barTexture === null) return;
    const key = [
      s.playing,
      Math.floor(s.progress * 400),
      s.time,
      s.sound,
    ].join();
    if (key === lastBar) return;
    lastBar = key;
    const { g, canvas } = barPaint;
    const W = canvas.width;
    const H = canvas.height;
    const cy = H / 2;
    g.clearRect(0, 0, W, H);
    g.fillStyle = INK;
    g.beginPath();
    g.arc(W * 0.055, cy, H * 0.33, 0, Math.PI * 2);
    g.fill();
    drawIcon(
      g,
      s.playing ? "pause" : "play",
      W * 0.055 + (s.playing ? 0 : H * 0.03),
      cy,
      H * 0.36,
      "#16181c",
    );
    const x0 = W * 0.14;
    const x1 = W * 0.62;
    const p = Math.min(1, Math.max(0, s.progress));
    g.fillStyle = "rgba(255,255,255,.22)";
    g.fillRect(x0, cy - H * 0.045, x1 - x0, H * 0.09);
    g.fillStyle = ACCENT;
    g.fillRect(x0, cy - H * 0.045, (x1 - x0) * p, H * 0.09);
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(x0 + (x1 - x0) * p, cy, H * 0.13, 0, Math.PI * 2);
    g.fill();
    g.font = `600 ${String(H * 0.21)}px ui-monospace, Consolas, monospace`;
    g.fillStyle = "#d9d4ca";
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillText(s.time, W * 0.645, cy);
    drawIcon(g, s.sound ? "sound" : "muted", W * 0.955, cy, H * 0.44, INK);
    barTexture.needsUpdate = true;
  };
  const shadow = groundShadow(owned, o, w * 1.1, 0.7, 0.32);
  shadow.position.set(0, ground + 0.012, 0);
  root.add(shadow);
  return {
    root,
    tapTarget: front,
    ground(y: number) {
      shadow.position.y = y + 0.012;
    },
    show(s: LookState) {
      feedClip(clip, s);
      glyph.visible = !s.playing && glyphPaint !== null;
      drawBar(s);
    },
  };
}

/** The cutout: the prototype's `buildCutout` at its reference width. */
function cutoutLook(owned: Owned, o: LookOptions, ground: number) {
  const w = LOOK_REFERENCE_WIDTH_M;
  const h = w * o.aspect;
  const root = new Group();
  const foot = new Group();
  foot.position.set(0, ground, 0.5);
  root.add(foot);
  const pivot = new Group();
  foot.add(pivot);
  const clip = clipMaterial(o.stacked ? { stacked: true } : { ellipse: true });
  const figure = owned.mesh(new PlaneGeometry(w, h), clip);
  figure.position.y = h / 2;
  pivot.add(figure);
  const shadow = groundShadow(owned, o, w * 1.05, 0.62, 0.5);
  shadow.position.set(0, 0.012, 0.02);
  foot.add(shadow);
  // A clip with no matte stands as a feathered ellipse; the editor says
  // what would cut the figure out.
  if (!o.stacked && o.edit) {
    const paint = canvasOf(900, 90);
    if (paint !== null) {
      const g = paint.g;
      g.fillStyle = "rgba(15,17,21,.85)";
      g.beginPath();
      g.roundRect(0, 0, 900, 90, 45);
      g.fill();
      g.font = "600 40px system-ui, sans-serif";
      g.fillStyle = ACCENT;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("Needs a stacked-alpha video", 450, 47);
    }
    const note = owned.mesh(
      new PlaneGeometry(1.5, 0.15),
      uiMaterial(owned.texture(o, paint)),
    );
    note.position.set(0, 0.25, 0.05);
    pivot.add(note);
  }
  let yaw = 0;
  let lastSeconds: number | null = null;
  return {
    root,
    tapTarget: figure,
    ground(y: number) {
      foot.position.y = y;
    },
    show(s: LookState) {
      feedClip(clip, s);
      if (s.viewer === null) return;
      // Toward the viewer, in the foot's frame (the root scaled): at
      // most 30 degrees either way, so it never shows its edge.
      const [vx, , vz] = s.viewer;
      const want = Math.min(
        CUTOUT_MAX_TURN,
        Math.max(
          -CUTOUT_MAX_TURN,
          Math.atan2(
            vx / scaleOf(root) - foot.position.x,
            vz / scaleOf(root) - foot.position.z,
          ),
        ),
      );
      const dt =
        lastSeconds === null ? 1 : Math.max(0, s.seconds - lastSeconds);
      lastSeconds = s.seconds;
      yaw += (want - yaw) * (1 - Math.exp(-dt * 3));
      pivot.rotation.y = yaw;
    },
  };
}

/** The look's own scale (its width over the reference). */
function scaleOf(object: Object3D): number {
  return object.scale.x;
}

/** The porthole: the prototype's `buildPorthole` at its reference width,
 *  its disc the clip's centred square. */
function portholeLook(owned: Owned, o: LookOptions) {
  const D = LOOK_REFERENCE_WIDTH_M * 0.55;
  const r = D / 2;
  const root = new Group();
  const front = new Group();
  front.position.z = 0.06;
  root.add(front);
  const clip = clipMaterial({ circle: true, crop: centredSquare(o.aspect) });
  const disc = owned.mesh(new PlaneGeometry(D, D), clip);
  disc.position.z = 0.012;
  front.add(disc);
  const bezel = owned.mesh(
    new TorusGeometry(r + 0.03, 0.035, 14, 96),
    new MeshLambertMaterial({ color: BEZEL }),
  );
  bezel.position.z = 0.012;
  front.add(bezel);
  const back = owned.mesh(
    new CylinderGeometry(r + 0.09, r + 0.09, 0.04, 96),
    new MeshLambertMaterial({ color: SLAB }),
  );
  back.rotation.x = Math.PI / 2;
  back.position.z = -0.01;
  front.add(back);
  const ringMaterial = new ShaderMaterial({
    uniforms: { p: { value: 0 } },
    vertexShader: CLIP_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const ring = owned.mesh(new PlaneGeometry(D + 0.26, D + 0.26), ringMaterial);
  ring.position.z = 0.03;
  front.add(ring);
  const glow = owned.texture(o, radialCanvas(GLOW_STOPS));
  const haloMaterial = uiMaterial(glow, {
    opacity: 0,
    blending: AdditiveBlending,
  });
  const halo = owned.mesh(new CircleGeometry(D * 1.05, 48), haloMaterial);
  halo.position.z = -0.03;
  halo.raycast = () => undefined;
  root.add(halo);
  const labelPaint = canvasOf(640, 150);
  const labelTexture = owned.texture(o, labelPaint);
  const label = owned.mesh(
    new PlaneGeometry(0.96, 0.225),
    uiMaterial(labelTexture, { side: DoubleSide }),
  );
  label.position.set(0, -r - 0.27, 0.03);
  front.add(label);
  let lastLabel = "";
  const drawLabel = (time: string): void => {
    if (labelPaint === null || labelTexture === null || time === lastLabel) {
      return;
    }
    lastLabel = time;
    const g = labelPaint.g;
    g.clearRect(0, 0, 640, 150);
    g.fillStyle = "rgba(15,17,21,.88)";
    g.beginPath();
    g.roundRect(20, 15, 600, 120, 60);
    g.fill();
    g.fillStyle = INK;
    g.beginPath();
    g.arc(86, 75, 38, 0, Math.PI * 2);
    g.fill();
    drawIcon(g, "play", 90, 75, 40, "#16181c");
    g.font = "650 54px system-ui, sans-serif";
    g.fillStyle = INK;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillText("Watch", 146, 77);
    g.font = "500 44px ui-monospace, Consolas, monospace";
    g.fillStyle = "#c9c2b6";
    g.fillText(time, 330, 78);
    labelTexture.needsUpdate = true;
  };
  return {
    root,
    tapTarget: front,
    show(s: LookState) {
      feedClip(clip, s);
      const p = ringMaterial.uniforms["p"];
      if (p !== undefined) p.value = Math.min(1, Math.max(0, s.progress));
      drawLabel(s.time.split(" / ").at(-1) ?? s.time);
      // A warm halo that breathes while the visitor is near.
      const near =
        s.viewer !== null && Math.hypot(s.viewer[0], s.viewer[2]) < HALO_NEAR_M;
      haloMaterial.opacity =
        glow === null || !near ? 0 : 0.34 + 0.16 * Math.sin(s.seconds / 0.7);
    },
  };
}

/** The window: the prototype's `buildWindow` at its reference width. The
 *  prototype's caption plate under the sill is left out: captions are
 *  the card's strip, as in every view. */
function windowLook(owned: Owned, o: LookOptions, ground: number) {
  const w = LOOK_REFERENCE_WIDTH_M;
  const h = w * o.aspect;
  const depth = 0.38;
  const root = new Group();
  const clip = clipMaterial({ inner: 0.42, depthWrite: true });
  const picture = owned.mesh(new PlaneGeometry(w, h), clip);
  picture.name = "video-window-clip";
  picture.position.z = -depth;
  root.add(picture);
  // The reveals: four quads from the wall back to the clip, lit at the
  // front edge, dark at the back, each side its own shade.
  const positions: number[] = [];
  const colours: number[] = [];
  const front = [0.52, 0.47, 0.42];
  const back = [0.09, 0.075, 0.065];
  const quad = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    shade: number,
  ): void => {
    const f = front.map((c) => c * shade);
    const b = back.map((c) => c * shade);
    const corners: [number, number, number, number[]][] = [
      [x0, y0, 0, f],
      [x1, y1, 0, f],
      [x1, y1, -depth, b],
      [x0, y0, 0, f],
      [x1, y1, -depth, b],
      [x0, y0, -depth, b],
    ];
    for (const [x, y, z, c] of corners) {
      positions.push(x, y, z);
      colours.push(...c);
    }
  };
  quad(-w / 2, -h / 2, -w / 2, h / 2, 0.9);
  quad(w / 2, h / 2, w / 2, -h / 2, 0.68);
  quad(-w / 2, h / 2, w / 2, h / 2, 0.42);
  quad(w / 2, -h / 2, -w / 2, -h / 2, 1.15);
  const reveals = new BufferGeometry();
  reveals.setAttribute("position", new Float32BufferAttribute(positions, 3));
  reveals.setAttribute("color", new Float32BufferAttribute(colours, 3));
  root.add(
    owned.mesh(
      reveals,
      new MeshBasicMaterial({
        vertexColors: true,
        toneMapped: false,
        side: DoubleSide,
      }),
    ),
  );
  // The timber frame round the opening: its four edges only, so nothing
  // lies over the clip itself.
  const timber = new MeshLambertMaterial({ color: TIMBER });
  owned.materials.push(timber);
  const tb = 0.06;
  const bar = (bw: number, bh: number, x: number, y: number): void => {
    const geometry = new BoxGeometry(bw, bh, 0.06);
    owned.geometries.push(geometry);
    const mesh = new Mesh(geometry, timber);
    mesh.name = "video-window-bar";
    mesh.position.set(x, y, -0.06);
    root.add(mesh);
  };
  bar(w, tb, 0, h / 2 - tb / 2);
  bar(w, tb, 0, -h / 2 + tb / 2);
  bar(tb, h, -w / 2 + tb / 2, 0);
  bar(tb, h, w / 2 - tb / 2, 0);
  // The stone surround with its keystone, and the sill.
  const m = 0.15;
  const outer = new Shape();
  outer.moveTo(-w / 2 - m, -h / 2);
  outer.lineTo(w / 2 + m, -h / 2);
  outer.lineTo(w / 2 + m, h / 2 + m);
  outer.lineTo(-w / 2 - m, h / 2 + m);
  outer.closePath();
  const hole = new Path();
  hole.moveTo(-w / 2, -h / 2);
  hole.lineTo(-w / 2, h / 2);
  hole.lineTo(w / 2, h / 2);
  hole.lineTo(w / 2, -h / 2);
  hole.closePath();
  outer.holes.push(hole);
  const stone = new MeshLambertMaterial({ color: STONE });
  owned.materials.push(stone);
  const stoneMesh = (
    geometry: BufferGeometry,
    x: number,
    y: number,
    z: number,
  ): void => {
    owned.geometries.push(geometry);
    const mesh = new Mesh(geometry, stone);
    mesh.position.set(x, y, z);
    root.add(mesh);
  };
  stoneMesh(
    new ExtrudeGeometry(outer, { depth: 0.05, bevelEnabled: false }),
    0,
    0,
    0,
  );
  stoneMesh(new BoxGeometry(0.2, 0.26, 0.08), 0, h / 2 + m * 0.6, 0.03);
  stoneMesh(
    new BoxGeometry(w + 2 * m + 0.12, 0.08, 0.2),
    0,
    -h / 2 - 0.04,
    0.08,
  );
  // The warm light it spills on the ground in front.
  const glow = owned.texture(o, radialCanvas(GLOW_STOPS));
  const spillMaterial = uiMaterial(glow, {
    opacity: 0,
    blending: AdditiveBlending,
  });
  const spill = owned.mesh(new PlaneGeometry(w * 2.4, 3), spillMaterial);
  spill.rotation.x = -Math.PI / 2;
  spill.position.set(0, ground + 0.015, 1.4);
  spill.raycast = () => undefined;
  root.add(spill);
  return {
    root,
    tapTarget: picture,
    ground(y: number) {
      spill.position.y = y + 0.015;
    },
    show(s: LookState) {
      feedClip(clip, s);
      spillMaterial.opacity =
        glow === null ? 0 : 0.16 * (0.85 + 0.15 * Math.sin(s.seconds / 0.9));
    },
  };
}

/** The stand-here projection: the prototype's `buildStandHere` at its
 *  reference width, a soft ellipse a little larger than the clip, just in
 *  front of the wall. */
function standHereLook(owned: Owned, o: LookOptions) {
  const w = LOOK_REFERENCE_WIDTH_M;
  const h = w * o.aspect;
  const root = new Group();
  const clip = clipMaterial({ ellipse: true, feather: 0.42 });
  const projection = owned.mesh(new PlaneGeometry(w * 1.12, h * 1.12), clip);
  projection.name = "video-stand-here-clip";
  projection.position.z = 0.03;
  root.add(projection);
  return {
    root,
    tapTarget: projection,
    show(s: LookState) {
      feedClip(clip, s);
      const shade = standHereShade(s.develop ?? 1, s.seconds);
      setUniform(clip, "opacity", shade.opacity);
      setUniform(clip, "tone", shade.tone);
      setUniform(clip, "tint", shade.tint);
      setUniform(clip, "feather", shade.feather);
    },
  };
}

/** A stand-here video's footprints. */
export interface StandHereSpot {
  /** In the station's frame: at the viewpoint on the ground, its toes
   *  (local -Z) the way the viewpoint looks. */
  readonly object: Object3D;
  /** Shaded by the develop (0 to 1) at the page clock `seconds`. */
  show(develop: number, seconds: number): void;
  dispose(): void;
}

/** The prototype's footprints: a dashed circle with two amber soles. */
function footprintCanvas(): { canvas: HTMLCanvasElement } | null {
  const c = canvasOf(512, 512);
  if (c === null) return null;
  const g = c.g;
  g.strokeStyle = "rgba(255,255,255,.85)";
  g.lineWidth = 6;
  g.setLineDash([22, 16]);
  g.beginPath();
  g.arc(256, 256, 236, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  const sole = (x: number, y: number, flip: boolean): void => {
    g.save();
    g.translate(x, y);
    g.scale(flip ? -1 : 1, 1);
    g.fillStyle = "rgba(241,180,92,.95)";
    g.beginPath();
    g.ellipse(0, -40, 34, 58, 0.08, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(4, 58, 26, 34, 0.05, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  sole(205, 250, false);
  sole(307, 250, true);
  return c;
}

/** The footprints at `viewpoint`: a 1.2 m disc over a 2.2 m pulse, both
 *  lying flat. Without a page their materials stay unpainted. */
export function standHereSpot(
  viewpoint: TourPictureViewpoint,
  canvasTexture: (canvas: HTMLCanvasElement) => CanvasTexture,
): StandHereSpot {
  const owned = new Owned();
  const paint = (
    painted: { canvas: HTMLCanvasElement } | null,
  ): CanvasTexture | null => {
    if (painted === null) return null;
    const t = canvasTexture(painted.canvas);
    owned.textures.push(t);
    return t;
  };
  const prints = paint(footprintCanvas());
  const glow = paint(radialCanvas(GLOW_STOPS));
  const printMaterial = uiMaterial(prints);
  const pulseMaterial = uiMaterial(glow, {
    opacity: 0,
    blending: AdditiveBlending,
  });
  const disc = owned.mesh(new PlaneGeometry(1.2, 1.2), printMaterial);
  const pulse = owned.mesh(new PlaneGeometry(2.2, 2.2), pulseMaterial);
  for (const flat of [disc, pulse]) {
    flat.rotation.x = -Math.PI / 2;
    flat.raycast = () => undefined;
  }
  pulse.position.y = 0.002;
  const object = new Group();
  object.name = "video-stand-here-spot";
  object.position.set(viewpoint.position[0], 0.014, viewpoint.position[2]);
  object.rotation.y = viewpointYaw(viewpoint);
  object.add(disc, pulse);
  return {
    object,
    show(develop, seconds) {
      const shade = standHereShade(develop, seconds);
      printMaterial.opacity = prints === null ? 0 : shade.footprints;
      pulseMaterial.opacity = glow === null ? 0 : Math.max(0, shade.pulse);
    },
    dispose() {
      object.removeFromParent();
      owned.dispose();
    },
  };
}

/** The drawing of `options.view`, at the reference width. */
/** One view's drawing before it is scaled: its root, what a tap hits,
 *  its per-frame show and, for a view with something on the ground, the
 *  ground's height in its own metres. */
interface BuiltLook {
  readonly root: Object3D;
  readonly tapTarget: Object3D;
  show(state: LookState): void;
  ground?(y: number): void;
}

function lookOf(owned: Owned, options: LookOptions, ground: number): BuiltLook {
  switch (options.view) {
    case "screen":
      return screenLook(owned, options, ground);
    case "cutout":
      return cutoutLook(owned, options, ground);
    case "porthole":
      return portholeLook(owned, options);
    case "window":
      return windowLook(owned, options, ground);
    case "standHere":
      return standHereLook(owned, options);
  }
}

/** The crop of a clip `aspect` high per unit wide to its centred square
 *  (u, v, width, height in the clip's 0..1). */
export function centredSquare(
  aspect: number,
): readonly [number, number, number, number] {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return [0, 0, 1, 1];
  if (aspect >= 1) {
    const h = 1 / aspect;
    return [0, (1 - h) / 2, 1, h];
  }
  return [(1 - aspect) / 2, 0, aspect, 1];
}

/** `options.view`'s drawing, `options.widthM` wide. */
export function videoLook(options: LookOptions): VideoLook {
  const owned = new Owned();
  const scale = options.widthM / LOOK_REFERENCE_WIDTH_M;
  // The ground in the look's own (reference) metres, at the scale it is
  // drawn at now: a width drag (`drawAtExtent`) rescales the root in
  // place. The folders' scale is not in it: that is the part's object's,
  // and `liftM` is already in the part's own metres.
  const groundAt = (liftM: number, at: number): number =>
    at > 0 ? -liftM / at : 0;
  const ground = groundAt(options.liftM, scale);
  const built = lookOf(owned, options, ground);
  const object = built.root;
  object.scale.setScalar(scale);
  markPlaceScale(object, options.widthM);
  // Clip and slab materials are owned too.
  object.traverse((o) => {
    const material = (o as Mesh).material as Material | undefined;
    if (material !== undefined && !owned.materials.includes(material)) {
      owned.materials.push(material);
    }
  });
  return {
    object,
    tapTarget: built.tapTarget,
    show: (state) => {
      built.show(state);
    },
    ground(liftM) {
      if (!Number.isFinite(liftM)) return;
      built.ground?.(groundAt(liftM, scaleOf(object)));
    },
    dispose() {
      object.removeFromParent();
      owned.dispose();
    },
  };
}
