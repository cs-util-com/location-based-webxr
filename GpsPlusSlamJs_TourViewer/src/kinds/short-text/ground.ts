/**
 * A short text as an arrow on the ground: marks laid along a route from
 * its spot toward the point it points to (`pointsTo`), ending 2 m short of
 * it, bent at its start by its `bendDeg`, in one of five styles - a ribbon
 * at knee height, floating vanes, footprints, guide lights set in the
 * paving, or one cast floor arrow (lying, hovering or upright, its caption
 * on the arrow where it fits) - and a caption plate beside the start.
 * Without a point it runs straight ahead along its front.
 *
 * The marks are laid out once from the record (`ground-route.ts`) and
 * never move with the visitor; they are laid out again only when the
 * point moves in the part's frame (the creator moved the spot). Only the
 * plate may turn (`orientation`), and in a visitor's view hovering pieces
 * float by time alone and a calm light runs along the marks - neither in
 * the editor nor under reduced motion.
 *
 * Its colours: the record's two (`color`, `darkColor`), else the role's
 * accent and the style's dark default. Drawn with unlit materials, its
 * shading baked into the colours, so it reads the same in any scene.
 *
 * @see ground.ts.md
 */

import type { TourGroundStyle } from "gps-plus-slam-app-framework/ar/tour-short-text";
import type { TourBlockOfKind } from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from "three";

import { easeAngle } from "../../angle-easing.js";
import { smoothingAlpha } from "../../surface-smoothing.js";
import type { WorldEnv, WorldPart } from "../../world-part.js";
import {
  GROUND_STYLE_WIDTH,
  groundFloatM,
  groundLetterM,
  groundRoute,
  groundScale,
  groundWidthScale,
  routeAt,
  type RoutePath,
} from "./ground-route.js";
import {
  canvasMeasure,
  makeCanvas,
  PLATE_PX_PER_EM,
  SHORT_TEXT_ACCENT,
  SHORT_TEXT_DEFAULT_ROLE,
  signPlate,
} from "./plate.js";

type TourShortTextBlock = TourBlockOfKind["shortText"];

/** Each style's dark colour where the record names none. */
export const GROUND_DARK_DEFAULT: Readonly<Record<TourGroundStyle, string>> = {
  ribbon: "#1d232b",
  vanes: "#151a20",
  footprints: "#151a20",
  lights: "#2a3038",
  floor: "#171c22",
};

/** The styles' measures (m where not said). */
const LOOK = {
  /** Ribbon: centre above the ground. */
  ribbonH: 0.4,
  /** Vanes: nose-up pitch (degrees), centre above the ground. */
  vanePitchDeg: 30,
  vaneH: 0.45,
  vaneMax: 16,
  /** Footprints: thickness. */
  printTh: 0.014,
  /** Guide lights: spacing; the V's arm angle (degrees). */
  lightSpacing: 0.8,
  vArmDeg: 38,
  /** Floor arrow: thickness, longest, hovering height, and the bottom of
   *  an upright arrow's head above the ground. */
  floorTh: 0.04,
  floorLenMax: 8,
  hoverH: 0.35,
  uprightBottom: 0.6,
  /** The caption plate's bottom on a post, and its lean back (degrees;
   *  floating plates lean less). */
  plateBottom: 0.3,
  tiltDeg: 35,
  floatTiltDeg: 28,
  /** How fast a turning plate follows the visitor (1/s). */
  turnRate: 7,
  /** The caption on the floor arrow: the tail kept free (m). */
  captionTail: 0.25,
} as const;

/** The travelling light's timings (s). */
const GLOW = {
  ribbonPeriod: 3.2,
  stepS: 0.42,
  restS: 1.8,
  runS: 1.5,
  flashS: 0.6,
  lightRestS: 1.6,
} as const;

const DEG = Math.PI / 180;
const FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const CAPTION_FONT = `650 ${String(PLATE_PX_PER_EM)}px ${FONT}`;

/** A cross-section point of a sweep (on the unit superellipse) and its
 *  normal. */
interface ProfilePoint {
  readonly x: number;
  readonly y: number;
  readonly nx: number;
  readonly ny: number;
}

/** A superellipse |x|^e + |y|^e = 1, 20 points counter-clockwise, with
 *  its normals: 4 is the ribbon's rounded flat section, 10 the floor
 *  arrow's bevelled slab. */
function profile(e: number): readonly ProfilePoint[] {
  const out: ProfilePoint[] = [];
  const p = 2 / e;
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push({
      x: Math.sign(c) * Math.abs(c) ** p,
      y: Math.sign(s) * Math.abs(s) ** p,
      nx: Math.sign(c) * Math.abs(c) ** (2 - p),
      ny: Math.sign(s) * Math.abs(s) ** (2 - p),
    });
  }
  return out;
}
const RIBBON_PROFILE = profile(4);
const SLAB_PROFILE = profile(10);

/** One ring of a sweep: a route sample and the width there; `back` faces
 *  backward (the barbs), `head` lies in the arrow's head. */
interface Ring {
  readonly x: number;
  readonly z: number;
  readonly tx: number;
  readonly tz: number;
  readonly w: number;
  readonly back?: boolean;
  readonly head?: boolean;
}

/** Rings along `path`: the shaft at width `w`, and a head of width
 *  `headW` over the last `headL` m; at the barbs two rings facing back
 *  close the shaft and open the head. */
function arrowRings(
  path: RoutePath,
  w: number,
  headW: number,
  headL: number,
): Ring[] {
  const rings: Ring[] = [];
  const hs = path.L - headL;
  let stepped = false;
  for (const q of path.pts) {
    if (!stepped && q.s >= hs) {
      stepped = true;
      rings.push(
        { ...q, w },
        { ...q, w, back: true, head: true },
        { ...q, w: headW, back: true, head: true },
        { ...q, w: headW, head: true },
      );
      continue;
    }
    rings.push(
      stepped
        ? {
            ...q,
            w: Math.max(0.004, (headW * (path.L - q.s)) / headL),
            head: true,
          }
        : { ...q, w },
    );
  }
  return rings;
}

/** A colour for a sweep's point: `q` on the section (none: an end cap)
 *  in ring `r`. */
type SweepColor = (q: ProfilePoint | null, r: Ring) => Color;

/** Light baked into an unlit colour: a face turned up full, one turned
 *  away darker. */
function shaded(c: Color, ny: number): [number, number, number] {
  const k = 0.62 + 0.38 * Math.max(0, ny);
  return [c.r * k, c.g * k, c.b * k];
}

/**
 * The section swept through `rings` at height `y`, `th` thick, into one
 * geometry with smooth normals, baked colours and end caps. Lying, the
 * width is level; `upright` turns the section a quarter turn, so the width
 * stands and the thickness lies across.
 */
function sweep(
  rings: readonly Ring[],
  y: number,
  th: number,
  section: readonly ProfilePoint[],
  colorAt: SweepColor,
  upright = false,
): BufferGeometry {
  const NP = section.length;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const R of rings) {
    const rx = -R.tz;
    const rz = R.tx;
    const A = Math.max(0.002, R.w / 2);
    const B = th / 2;
    for (const q of section) {
      const lat = upright ? -q.y * B : q.x * A;
      const ver = upright ? q.x * A : q.y * B;
      pos.push(R.x + rx * lat, y + ver, R.z + rz * lat);
      const ny = R.back === true ? 0 : upright ? q.nx : q.ny;
      col.push(...shaded(colorAt(q, R), ny));
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < NP; k++) {
      const a = i * NP + k;
      const b = i * NP + ((k + 1) % NP);
      idx.push(a, a + NP, b, b, a + NP, b + NP);
    }
  }
  const cap = (ri: number, sign: number) => {
    const R = rings[ri];
    if (R === undefined) return;
    const base = pos.length / 3;
    pos.push(R.x, y, R.z);
    col.push(...shaded(colorAt(null, R), 0.5));
    for (let k = 0; k < NP; k++) {
      const vi = (ri * NP + k) * 3;
      pos.push(pos[vi] ?? 0, pos[vi + 1] ?? 0, pos[vi + 2] ?? 0);
      col.push(col[vi] ?? 0, col[vi + 1] ?? 0, col[vi + 2] ?? 0);
    }
    for (let k = 0; k < NP; k++) {
      const a = base + 1 + k;
      const b = base + 1 + ((k + 1) % NP);
      if (sign < 0) idx.push(base, a, b);
      else idx.push(base, b, a);
    }
  };
  cap(0, -1);
  cap(rings.length - 1, 1);
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The soft shadow under a route: four vertices across each sample,
 *  clear outside and `alpha` in the middle, faded over its ends; on the
 *  ground. */
function routeShadow(
  path: RoutePath,
  widthAt: (s: number) => number,
  blur: number,
  alpha: number,
): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const fade = (d: number) => Math.min(1, Math.max(0, d / 0.25));
  path.pts.forEach((q, i) => {
    const rx = -q.tz;
    const rz = q.tx;
    const w = widthAt(q.s) / 2;
    const k = alpha * fade(q.s) * fade(path.L - q.s + 0.05);
    for (const [o, a] of [
      [-(w + blur), 0],
      [-w * 0.6, k],
      [w * 0.6, k],
      [w + blur, 0],
    ] as const) {
      pos.push(q.x + rx * o, 0.006, q.z + rz * o);
      col.push(0, 0, 0, a);
    }
    if (i > 0) {
      for (let j = 0; j < 3; j++) {
        const a = (i - 1) * 4 + j;
        idx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/** One raised chevron `size` across, pointing along +Z, its base at
 *  y = 0, `depth` high; `grow` widens it (a dark rim under it). */
function chevron(size: number, depth: number, grow = 0): ExtrudeGeometry {
  const a = 0.28;
  const shape = new Shape(
    (
      [
        [-0.5, -0.22],
        [0, 0.28],
        [0.5, -0.22],
        [0.5, -0.22 - a],
        [0, 0.28 - a],
        [-0.5, -0.22 - a],
      ] as const
    ).map(([x, y]) => new Vector2(x * size, (y + 0.11) * size)),
  );
  const bevel = Math.min(depth * 0.45, size * 0.04);
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(0.002, depth - bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: size * (0.03 + grow),
    bevelSegments: 2,
    curveSegments: 1,
  });
  // The shape's +y becomes the route's front (+Z), its depth up.
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI);
  g.translate(0, bevel, 0);
  return g;
}

/** A sole and five toes, `l` long, pointing along +Z (`mirror`: a left
 *  foot), `grow` larger all round. */
const SOLE = [
  [0, -0.5],
  [0.1, -0.47],
  [0.13, -0.36],
  [0.12, -0.2],
  [0.13, -0.05],
  [0.16, 0.1],
  [0.17, 0.2],
  [0.13, 0.28],
  [0.05, 0.31],
  [-0.05, 0.32],
  [-0.14, 0.29],
  [-0.18, 0.2],
  [-0.17, 0.08],
  [-0.1, -0.02],
  [-0.08, -0.15],
  [-0.1, -0.3],
  [-0.12, -0.42],
  [-0.07, -0.48],
] as const;
const TOES = [
  [-0.115, 0.425, 0.06, 0.075],
  [-0.01, 0.44, 0.042, 0.05],
  [0.06, 0.415, 0.036, 0.043],
  [0.115, 0.38, 0.031, 0.037],
  [0.158, 0.33, 0.027, 0.031],
] as const;
const FOOT_WIDE = 1.25;
function foot(
  l: number,
  mirror: boolean,
  depth: number,
  grow = 0,
): ExtrudeGeometry {
  const kx = FOOT_WIDE * l;
  const m = mirror ? -1 : 1;
  const cy = -0.09 * l;
  let pts = SOLE.map(([x, y]) => new Vector2(m * x * kx, y * l));
  if (grow > 0) {
    pts = pts.map((p) => {
      const dx = p.x;
      const dy = p.y - cy;
      const n = Math.hypot(dx, dy);
      return n > 1e-6
        ? new Vector2((dx * (n + grow)) / n, cy + (dy * (n + grow)) / n)
        : p;
    });
  }
  if (mirror) pts.reverse();
  const shapes = [new Shape(pts)];
  for (const [x, y, rx, ry] of TOES) {
    shapes.push(
      new Shape().absellipse(
        m * x * kx,
        y * l,
        rx * kx + grow,
        ry * l + grow,
        0,
        Math.PI * 2,
        false,
        0,
      ),
    );
  }
  const bevel = Math.min(depth * 0.4, 0.005);
  const g = new ExtrudeGeometry(shapes, {
    depth: Math.max(0.002, depth - bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 1,
    curveSegments: 3,
  });
  // As a chevron: the sole's +y forward, its depth up; the turn mirrors
  // x, so the unmirrored outline is a right foot.
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI);
  g.translate(0, bevel, 0);
  return g;
}

/** The yaw (about +Y) that turns +Z to the direction (tx, tz). */
const yawOf = (tx: number, tz: number): number => Math.atan2(tx, tz);

/** A piece that hovers: its node, its seed and its resting height. */
interface Floater {
  readonly node: Object3D;
  readonly seed: number;
  readonly baseY: number;
}

/** A piece the travelling light passes: its material, its base colour,
 *  and where on the light's way it lies (0-1 along, or a step). */
interface Glowing {
  readonly material: MeshBasicMaterial;
  readonly base: Color;
  readonly at: number;
  readonly head?: boolean;
}

/** What one style laid along a route. */
interface Laid {
  readonly floaters: Floater[];
  readonly glowing: Glowing[];
  /** How the light runs: along the route (`along`, 0-1), from step to
   *  step (`steps`), or along to a flashing end (`run`). */
  readonly glow: "along" | "steps" | "run" | "none";
  readonly steps?: number;
  /** The caption is on the arrow: the plate hides. */
  readonly captionOnArrow: boolean;
  /** The plate: its bottom, whether it stands on a post, whether it
   *  floats, its lean, and its clearance from the route's centre. */
  readonly plate: {
    readonly bottom: number;
    readonly post: boolean;
    readonly floats: boolean;
    readonly tiltDeg: number;
    readonly clear: number;
  };
}

/** What a style is given to lay its marks. */
interface LayCtx {
  readonly block: TourShortTextBlock;
  readonly path: RoutePath;
  readonly ws: number;
  readonly em: number;
  readonly main: Color;
  readonly dark: Color;
  readonly mainHex: string;
  readonly darkHex: string;
  readonly arrow: Group;
  readonly add: <G extends BufferGeometry>(g: G) => G;
  readonly mat: <M extends Material>(m: M) => M;
  readonly texture: (canvas: HTMLCanvasElement) => Texture;
}

const basic = (
  params: ConstructorParameters<typeof MeshBasicMaterial>[0],
): MeshBasicMaterial => new MeshBasicMaterial({ toneMapped: false, ...params });

const shadowMaterial = (): MeshBasicMaterial =>
  basic({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

/** A flat dark disc under a piece, faint (no texture needed). */
function blob(c: LayCtx, w: number, d: number, opacity: number): Mesh {
  const g = c.add(new PlaneGeometry(w, d));
  g.rotateX(-Math.PI / 2);
  const m = new Mesh(
    g,
    c.mat(
      basic({ color: 0x000000, transparent: true, opacity, depthWrite: false }),
    ),
  );
  m.position.y = 0.005;
  m.renderOrder = 2;
  return m;
}

function layRibbon(c: LayCtx): Laid {
  const { path } = c;
  const w = GROUND_STYLE_WIDTH.ribbon(c.ws);
  const th = Math.max(0.028, w * 0.11);
  const h = LOOK.ribbonH;
  const headW = w * 2.1;
  const headL = Math.min(w * 1.6 + 0.1, path.L * 0.4);
  const low = c.dark.clone().multiplyScalar(0.45);
  const headLow = c.main.clone().multiplyScalar(0.5);
  const colorAt: SweepColor = (q, R) =>
    q === null
      ? R.head === true
        ? c.main
        : c.dark
      : R.head === true
        ? q.y < -0.35
          ? headLow
          : c.main
        : Math.abs(q.x) > 0.8
          ? c.main
          : q.y < -0.35
            ? low
            : c.dark;
  const body = new Group();
  c.arrow.add(body);
  const vertex = c.mat(basic({ vertexColors: true }));
  const shaft = new Mesh(
    c.add(
      sweep(arrowRings(path, w, headW, headL), h, th, RIBBON_PROFILE, colorAt),
    ),
    vertex,
  );
  body.add(shaft);
  const hs = path.L - headL;
  const shadow = new Mesh(
    c.add(
      routeShadow(
        path,
        (s) => (s < hs ? w : (headW * (path.L - s)) / headL),
        0.06 + 0.22 * h,
        0.34 * Math.sqrt(0.4 / Math.max(0.15, h)),
      ),
    ),
    c.mat(shadowMaterial()),
  );
  shadow.renderOrder = 2;
  c.arrow.add(shadow);
  const glowing: Glowing[] = [];
  const s0 = 0.3;
  const span = Math.max(0, hs - s0 - 0.12);
  const sp = Math.max(0.8, 2.4 * w);
  const n = span < 0.25 ? 0 : Math.max(1, Math.min(12, Math.floor(span / sp)));
  const chev = c.add(chevron(w * 0.62, Math.max(0.008, th * 0.35)));
  for (let i = 0; i < n; i++) {
    const s = s0 + ((i + 0.5) * span) / n;
    const q = routeAt(path, s);
    const material = c.mat(basic({ color: c.main.clone() }));
    const m = new Mesh(chev, material);
    m.position.set(q.x, h + th / 2 - 0.003, q.z);
    m.rotation.y = yawOf(q.tx, q.tz);
    m.renderOrder = 5;
    body.add(m);
    glowing.push({ material, base: c.main.clone(), at: s / path.L });
  }
  return {
    floaters: [{ node: body, seed: 1, baseY: 0 }],
    glowing,
    glow: "along",
    captionOnArrow: false,
    plate: {
      bottom: h + th / 2 + 0.05,
      post: false,
      floats: true,
      tiltDeg: LOOK.floatTiltDeg,
      clear: Math.max(0.12, w * 0.7),
    },
  };
}

function layVanes(c: LayCtx): Laid {
  const { path } = c;
  const S = GROUND_STYLE_WIDTH.vanes(c.ws);
  const h = LOOK.vaneH;
  const depth = Math.max(0.018, S * 0.06);
  const top = c.add(chevron(S, depth));
  const rim = c.add(chevron(S, depth * 0.8, 0.075));
  rim.translate(0, -depth * 0.45, 0);
  const topMat = c.mat(basic({ color: c.main }));
  const rimMat = c.mat(basic({ color: c.dark }));
  const s0 = 0.35;
  const sLast = Math.max(s0, path.L - 0.35 * S);
  const gap = Math.max(0.6, 1.6 * S);
  const n = Math.max(
    1,
    Math.min(LOOK.vaneMax, Math.floor((sLast - s0) / gap) + 1),
  );
  const floaters: Floater[] = [];
  for (let i = 0; i < n; i++) {
    const s = n === 1 ? sLast : s0 + (i * (sLast - s0)) / (n - 1);
    const q = routeAt(path, s);
    const vane = new Group();
    vane.rotation.order = "YXZ";
    // Nose up: the face leans back toward someone coming from behind.
    vane.rotation.set(-LOOK.vanePitchDeg * DEG, yawOf(q.tx, q.tz), 0);
    vane.position.set(q.x, h, q.z);
    const a = new Mesh(top, topMat);
    a.renderOrder = 5;
    const b = new Mesh(rim, rimMat);
    b.renderOrder = 4;
    vane.add(a, b);
    c.arrow.add(vane);
    const sh = blob(c, S * 1.1, S * 0.9, 0.18);
    sh.position.set(q.x, 0.005, q.z);
    sh.rotation.y = yawOf(q.tx, q.tz);
    c.arrow.add(sh);
    floaters.push({ node: vane, seed: 1 + i, baseY: h });
  }
  return {
    floaters,
    glowing: [],
    glow: "none",
    captionOnArrow: false,
    plate: {
      bottom: h + 0.05,
      post: false,
      floats: true,
      tiltDeg: LOOK.floatTiltDeg,
      clear: Math.max(0.15, S * 0.75),
    },
  };
}

function layFootprints(c: LayCtx): Laid {
  const { path } = c;
  const l = GROUND_STYLE_WIDTH.footprints(c.ws);
  const wPrint = FOOT_WIDE * l * 0.35;
  const th = LOOK.printTh;
  const rimW = Math.max(0.01, l * 0.035);
  const geos = {
    top: [c.add(foot(l, false, th)), c.add(foot(l, true, th))],
    rim: [
      c.add(foot(l, false, th * 0.75, rimW)),
      c.add(foot(l, true, th * 0.75, rimW)),
    ],
  };
  const rimMat = c.mat(basic({ color: c.dark }));
  const glowing: Glowing[] = [];
  let k = 0;
  const addPrint = (s: number, side: number, left: boolean, toeOut: number) => {
    const q = routeAt(path, s);
    const yaw = yawOf(q.tx, q.tz) + (left ? toeOut : -toeOut);
    const x = q.x + q.rx * side;
    const z = q.z + q.rz * side;
    const i = left ? 1 : 0;
    const rim = new Mesh(geos.rim[i], rimMat);
    rim.position.set(x, 0.006, z);
    rim.rotation.y = yaw;
    rim.renderOrder = 4;
    const material = c.mat(basic({ color: c.main.clone() }));
    const top = new Mesh(geos.top[i], material);
    top.position.set(x, 0.008, z);
    top.rotation.y = yaw;
    top.renderOrder = 5;
    c.arrow.add(rim, top);
    glowing.push({ material, base: c.main.clone(), at: k });
  };
  const pairX = 0.62 * wPrint;
  const stepX = 0.42 * wPrint;
  const toe = 7 * DEG;
  const stride = Math.max(0.55, 1.9 * l);
  const L = path.L;
  const room = L >= 2 * l + 0.25;
  // A pair at the start (stand here), single prints, a pair at the end
  // facing the target (stop and look).
  if (room) {
    addPrint(l / 2, -pairX, true, toe);
    addPrint(l / 2, pairX, false, toe);
    k++;
  }
  const a = l / 2;
  const zEnd = L - l / 2;
  const span = zEnd - a;
  const n = room ? Math.max(0, Math.round(span / stride) - 1) : 0;
  for (let i = 0; i < n; i++) {
    const left = i % 2 === 0;
    addPrint(a + (span * (i + 1)) / (n + 1), left ? -stepX : stepX, left, 0);
    k++;
  }
  addPrint(zEnd, -pairX, true, toe);
  addPrint(zEnd, pairX, false, toe);
  k++;
  return {
    floaters: [],
    glowing,
    glow: "steps",
    steps: k,
    captionOnArrow: false,
    plate: {
      bottom: LOOK.plateBottom,
      post: true,
      floats: false,
      tiltDeg: LOOK.tiltDeg,
      clear: Math.max(0.15, pairX + wPrint / 2 + 0.12),
    },
  };
}

function layLights(c: LayCtx): Laid {
  const { path } = c;
  const r = Math.max(0.02, GROUND_STYLE_WIDTH.lights(c.ws));
  const ringH = 0.02;
  const ring = c.add(new CylinderGeometry(r, r * 1.1, ringH, 28));
  const lens = c.add(
    new SphereGeometry(r * 0.66, 24, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(
      1,
      0.42,
      1,
    ),
  );
  const pool = c.add(new PlaneGeometry(r * 7, r * 7));
  pool.rotateX(-Math.PI / 2);
  const ringMat = c.mat(basic({ color: c.dark }));
  const glowing: Glowing[] = [];
  const L = path.L;
  const addLight = (
    x: number,
    z: number,
    s: number,
    head: boolean,
    scale = 1,
  ) => {
    const material = c.mat(basic({ color: c.main.clone() }));
    const glow = c.mat(
      basic({
        color: c.main.clone(),
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    const p = new Mesh(pool, glow);
    p.position.set(x, 0.007, z);
    p.scale.setScalar(scale);
    p.renderOrder = 3;
    const rg = new Mesh(ring, ringMat);
    rg.position.set(x, 0.004 + ringH / 2, z);
    rg.scale.setScalar(scale);
    rg.renderOrder = 4;
    const ln = new Mesh(lens, material);
    ln.position.set(x, 0.004 + ringH, z);
    ln.scale.setScalar(scale);
    ln.renderOrder = 5;
    c.arrow.add(p, rg, ln);
    glowing.push({
      material,
      base: c.main.clone(),
      at: s / Math.max(1e-6, L),
      head,
    });
  };
  const s0 = 0.3;
  const n = Math.max(1, Math.round((L - s0) / LOOK.lightSpacing));
  for (let i = 0; i < n; i++) {
    const s = s0 + (i * (L - s0)) / n;
    const q = routeAt(path, s);
    addLight(q.x, q.z, s, false);
  }
  // The V: the end light and two arms of two lights, swept back.
  const end = routeAt(path, L);
  const arm = Math.max(0.28, 3.6 * r);
  const a = LOOK.vArmDeg * DEG;
  addLight(end.x, end.z, L, true, 1.2);
  for (const side of [-1, 1]) {
    for (let k = 1; k <= 2; k++) {
      const back = k * arm * Math.cos(a);
      const off = side * k * arm * Math.sin(a);
      addLight(
        end.x - end.tx * back + end.rx * off,
        end.z - end.tz * back + end.rz * off,
        L,
        true,
        1.2,
      );
    }
  }
  return {
    floaters: [],
    glowing,
    glow: "run",
    captionOnArrow: false,
    plate: {
      bottom: LOOK.plateBottom,
      post: true,
      floats: false,
      tiltDeg: LOOK.tiltDeg,
      clear: Math.max(0.15, r * 3),
    },
  };
}

/** The caption's width on the arrow (m) at letter height `em`. */
function captionNeedM(caption: string, em: number): number {
  return (canvasMeasure()(CAPTION_FONT, caption) / PLATE_PX_PER_EM + 1) * em;
}

/** The caption painted in `color` (null: no canvas). */
function captionCanvas(
  caption: string,
  color: string,
): HTMLCanvasElement | null {
  const P = PLATE_PX_PER_EM;
  const w = Math.ceil(canvasMeasure()(CAPTION_FONT, caption) + P);
  const made = makeCanvas(w, 1.45 * P);
  if (made === null) return null;
  const { canvas, g } = made;
  g.font = CAPTION_FONT;
  g.fillStyle = color;
  g.textBaseline = "alphabetic";
  g.textAlign = "center";
  g.fillText(caption, w / 2, 1.06 * P);
  return canvas;
}

/** A strip along the route from `s0` to `s1`, `across` wide, at height
 *  `y`: on the top (lying), or on face `face` (+1 right, -1 left) of an
 *  upright arrow `th` thick; letters read from that side. */
function captionStrip(
  path: RoutePath,
  s0: number,
  s1: number,
  across: number,
  y: number,
  face: number,
  upright: boolean,
  th: number,
): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = Math.max(2, Math.ceil((s1 - s0) / 0.05));
  for (let i = 0; i <= n; i++) {
    const q = routeAt(path, s0 + ((s1 - s0) * i) / n);
    const u = face < 0 ? 1 - i / n : i / n;
    if (!upright) {
      // On the top: the letters' tops toward the arrow's left, read from
      // its right.
      pos.push(q.x - (q.rx * across) / 2, y, q.z - (q.rz * across) / 2);
      pos.push(q.x + (q.rx * across) / 2, y, q.z + (q.rz * across) / 2);
      uv.push(u, 1, u, 0);
    } else {
      const ox = q.x + q.rx * face * (th / 2 + 0.003);
      const oz = q.z + q.rz * face * (th / 2 + 0.003);
      pos.push(ox, y - across / 2, oz, ox, y + across / 2, oz);
      uv.push(u, 0, u, 1);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      if (upright && face > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function layFloor(c: LayCtx): Laid {
  const { path, block } = c;
  const place = block.floorPlacement ?? "lying";
  const upright = place === "upright";
  const th = LOOK.floorTh;
  const base = 1.2 + 0.1 * c.ws;
  let shaftW = GROUND_STYLE_WIDTH.floor(c.ws);
  const onArrow = block.captionOnArrow === true;
  if (onArrow) shaftW = Math.max(shaftW, 1.6 * c.em);
  const k = shaftW / (0.2 * base);
  const headW = 0.46 * base * k;
  const headL = Math.min(0.42 * base * k, path.L * 0.45);
  const h =
    place === "lying"
      ? 0.005 + th / 2
      : place === "hovering"
        ? LOOK.hoverH
        : LOOK.uprightBottom + headW / 2;
  // The top (both faces upright) in the main colour; flanks, bevels,
  // underside and ends dark.
  const colorAt: SweepColor = (q) =>
    q === null
      ? c.dark
      : (upright ? Math.abs(q.y) > 0.6 : q.y > 0.6) && Math.abs(q.x) < 0.9
        ? c.main
        : c.dark;
  const body = new Group();
  c.arrow.add(body);
  const L = path.L;
  const mesh = new Mesh(
    c.add(
      sweep(
        arrowRings(path, shaftW, headW, headL),
        h,
        th,
        SLAB_PROFILE,
        colorAt,
        upright,
      ),
    ),
    c.mat(basic({ vertexColors: true })),
  );
  mesh.renderOrder = 4;
  body.add(mesh);
  const hs = L - headL;
  const across = (s: number) => (s < hs ? shaftW : (headW * (L - s)) / headL);
  const shadow = new Mesh(
    c.add(
      place === "lying"
        ? routeShadow(path, (s) => across(s) + 0.03, 0.035, 0.42)
        : place === "hovering"
          ? routeShadow(
              path,
              across,
              0.06 + 0.22 * h,
              0.34 * Math.sqrt(0.4 / Math.max(0.15, h)),
            )
          : routeShadow(path, () => Math.max(0.1, th * 3), 0.22, 0.2),
    ),
    c.mat(shadowMaterial()),
  );
  shadow.renderOrder = 2;
  c.arrow.add(shadow);
  // The caption on the arrow, where it fits along the shaft.
  let fits = false;
  if (onArrow) {
    const need = captionNeedM(block.caption, c.em);
    const free = hs - LOOK.captionTail - 0.08;
    const canvas =
      need <= free ? captionCanvas(block.caption, c.darkHex) : null;
    if (canvas !== null) {
      fits = true;
      const s0 = LOOK.captionTail + (free - need) / 2;
      const map = c.texture(canvas);
      const ink = c.mat(
        basic({
          map,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      const acrossM = 1.45 * c.em;
      for (const face of upright ? [1, -1] : [1]) {
        const strip = new Mesh(
          c.add(
            captionStrip(
              path,
              s0,
              s0 + need,
              acrossM,
              upright ? h : h + th / 2 + 0.002,
              face,
              upright,
              th,
            ),
          ),
          ink,
        );
        strip.renderOrder = 7;
        body.add(strip);
      }
    }
  }
  return {
    floaters: place === "lying" ? [] : [{ node: body, seed: 1, baseY: 0 }],
    glowing: [],
    glow: "none",
    captionOnArrow: fits,
    plate: {
      bottom: LOOK.plateBottom,
      post: true,
      floats: false,
      tiltDeg: LOOK.tiltDeg,
      clear: Math.max(0.15, (upright ? th : headW / 2) + 0.15),
    },
  };
}

const LAY: Readonly<Record<TourGroundStyle, (c: LayCtx) => Laid>> = {
  ribbon: layRibbon,
  vanes: layVanes,
  footprints: layFootprints,
  lights: layLights,
  floor: layFloor,
};

const v = new Vector3();
const q = new Quaternion();
const inverse = new Matrix4();
const WHITE = new Color("#ffffff");

/** `block`'s point in its own frame, from its pose alone (the frame the
 *  renderer stands it in); null with no point. */
function targetFromPose(
  block: TourShortTextBlock,
): { x: number; z: number } | null {
  const p = block.pointsTo;
  if (p === undefined) return null;
  const at = block.pose.position;
  const turn = block.pose.rotation;
  v.set(p[0] - at[0], p[1] - at[1], p[2] - at[2]);
  v.applyQuaternion(q.set(turn[0], turn[1], turn[2], turn[3]).invert());
  return { x: v.x, z: v.z };
}

/** `block` as an arrow on the ground. */
export function groundPart(
  block: TourShortTextBlock,
  env: WorldEnv,
): WorldPart {
  const style: TourGroundStyle = block.style ?? "ribbon";
  const role = block.role ?? SHORT_TEXT_DEFAULT_ROLE;
  const mainHex = block.color ?? SHORT_TEXT_ACCENT[role];
  const darkHex = block.darkColor ?? GROUND_DARK_DEFAULT[style];
  const main = new Color(mainHex);
  const dark = new Color(darkHex);
  const play = env.mode === "play";
  const moves = () => play && env.reduceMotion?.() !== true;

  const object = new Group();
  object.name = "short-text-ground";
  const arrow = new Group();
  object.add(arrow);

  // Everything the plate and the marks made, freed on a new layout (the
  // marks) or on dispose (all).
  const kept: { dispose(): void }[] = [];
  let laidGeoms: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(t: T): T => {
    kept.push(t);
    return t;
  };

  // The caption plate, as on a sign but the caption only.
  const plateNode = new Group();
  const tiltNode = new Group();
  plateNode.add(tiltNode);
  object.add(plateNode);
  let em = groundLetterM(groundScale(block.readAtM, null));
  const plate = signPlate(block.caption, undefined, role, { icon: true });
  const lay = plate.layout;
  const plateMap =
    plate.canvas === null ? null : keep(env.canvasTexture(plate.canvas));
  const plateMaterial = keep(
    basic(
      plateMap === null
        ? { color: "#11151b", side: DoubleSide }
        : { map: plateMap, transparent: true, depthWrite: false },
    ),
  );
  const backMaterial = keep(basic({ color: "#232931" }));
  const plateGeometry = keep(new PlaneGeometry(1, 1));
  const backGeometry = keep(new BoxGeometry(1, 1, 1));
  const postGeometry = keep(new CylinderGeometry(1, 1.15, 1, 10));
  const face = new Mesh(plateGeometry, plateMaterial);
  face.renderOrder = 6;
  const backing = new Mesh(backGeometry, backMaterial);
  backing.renderOrder = 5;
  const post = new Mesh(postGeometry, backMaterial);
  tiltNode.add(face, backing);
  plateNode.add(post);

  /** Sizes the plate for the letter height `em`, on a post or not. */
  const sizePlate = (bottom: number, onPost: boolean, tiltDeg: number) => {
    const s = em / PLATE_PX_PER_EM;
    const bodyW = lay.bodyW * s;
    const bodyH = lay.bodyH * s;
    face.scale.set(lay.canvasW * s, lay.canvasH * s, 1);
    // The canvas holds a margin round the board: its centre is offset.
    face.position.set(
      (lay.canvasW / 2 - (lay.margin + lay.bodyW / 2)) * s,
      bodyH / 2 + (lay.margin + lay.bodyH / 2 - lay.canvasH / 2) * s,
      0.002,
    );
    backing.scale.set(bodyW * 0.99, bodyH * 0.98, 0.022);
    backing.position.set(0, bodyH / 2, -0.011);
    tiltNode.position.y = bottom;
    tiltNode.rotation.x = -tiltDeg * DEG;
    const r = Math.max(0.014, em * 0.1);
    post.visible = onPost;
    post.scale.set(r, bottom + 0.04, r);
    post.position.y = (bottom + 0.04) / 2;
    return bodyW;
  };

  let floaters: Floater[] = [];
  let glowing: Glowing[] = [];
  let glow: Laid["glow"] = "none";
  let steps = 0;
  let plateFloats = false;
  let plateBottom = 0;
  let plateYaw = 0;
  let laidFor: { x: number; z: number } | null = null;

  /** Lays the marks out for `target` (the part's frame), the plate
   *  beside their start. */
  const layout = (target: { x: number; z: number } | null) => {
    for (const g of laidGeoms) g.dispose();
    laidGeoms = [];
    arrow.clear();
    floaters = [];
    glowing = [];
    glow = "none";
    laidFor = target;
    const D = target === null ? null : Math.hypot(target.x, target.z);
    const scale = groundScale(block.readAtM, D);
    em = groundLetterM(scale);
    const route = groundRoute({
      target,
      scale,
      ...(block.bendDeg === undefined ? {} : { bendDeg: block.bendDeg }),
      ...(style === "floor" ? { lenCapM: LOOK.floorLenMax } : {}),
    });
    if (route.none) {
      // Too near to lay anything: the plate alone, facing away from it.
      sizePlate(LOOK.plateBottom, true, LOOK.tiltDeg);
      plateNode.position.set(0, 0, 0);
      plateNode.visible = true;
      plateFloats = false;
      plateBottom = LOOK.plateBottom;
      plateYaw = target === null ? Math.PI : yawOf(-target.x, -target.z);
      plateNode.rotation.y = plateYaw;
      return;
    }
    const laid = LAY[style]({
      block,
      path: route.path,
      ws: groundWidthScale(scale),
      em,
      main,
      dark,
      mainHex,
      darkHex,
      arrow,
      add: (g) => {
        laidGeoms.push(g);
        return g;
      },
      mat: (m) => {
        laidGeoms.push(m);
        return m;
      },
      texture: (canvas) => {
        const t = env.canvasTexture(canvas);
        laidGeoms.push(t);
        return t;
      },
    });
    floaters = laid.floaters;
    glowing = laid.glowing;
    glow = laid.glow;
    steps = laid.steps ?? 0;
    const p = laid.plate;
    const bodyW = sizePlate(p.bottom, p.post, p.tiltDeg);
    plateFloats = p.floats;
    plateBottom = p.bottom;
    // Beside the start, on the side away from the bend (the right when
    // it runs straight), facing back along the start: where a reader
    // looking along the arrow stands.
    const side = route.bendDeg > 0.5 ? -1 : 1;
    const first = routeAt(route.path, Math.min(0.15, route.path.L));
    const off = side * (bodyW / 2 + p.clear);
    plateNode.position.set(
      first.x + first.rx * off,
      0,
      first.z + first.rz * off,
    );
    plateYaw = yawOf(-route.t0X, -route.t0Z);
    plateNode.rotation.y = plateYaw;
    plateNode.visible = !laid.captionOnArrow;
  };
  layout(targetFromPose(block));

  const turns = block.orientation === "upright" || block.orientation === "face";
  let lastSeconds: number | null = null;
  let yaw: number | null = null;

  /** Where the record's point lies in the part's frame now (its parent's
   *  frame is the station's), or null with no point or no parent. */
  const targetNow = (): { x: number; z: number } | null => {
    const p = block.pointsTo;
    if (p === undefined || object.parent === null) return null;
    object.parent.updateWorldMatrix(true, false);
    object.updateWorldMatrix(false, false);
    v.set(p[0], p[1], p[2]);
    object.parent.localToWorld(v);
    object.worldToLocal(v);
    return { x: v.x, z: v.z };
  };

  return {
    object,
    update(frame) {
      const dt =
        lastSeconds === null
          ? Number.POSITIVE_INFINITY
          : Math.min(0.1, frame.seconds - lastSeconds);
      lastSeconds = frame.seconds;
      const now = targetNow();
      if (
        now !== null &&
        (laidFor === null ||
          Math.abs(now.x - laidFor.x) + Math.abs(now.z - laidFor.z) > 0.05)
      ) {
        layout(now);
      }
      if (turns && plateNode.visible) {
        object.updateMatrix();
        inverse.copy(object.matrix).invert();
        v.set(...frame.viewer).applyMatrix4(inverse);
        const target = Math.atan2(
          v.x - plateNode.position.x,
          v.z - plateNode.position.z,
        );
        yaw =
          yaw === null
            ? target
            : easeAngle(yaw, target, smoothingAlpha(1 / LOOK.turnRate, dt));
        plateNode.rotation.y = yaw;
      }
      const live = moves();
      const t = frame.seconds;
      for (const f of floaters) {
        f.node.position.y = f.baseY + (live ? groundFloatM(f.seed, t) : 0);
      }
      tiltNode.position.y =
        plateBottom + (live && plateFloats ? groundFloatM(51, t) : 0);
      for (const g of glowing) {
        g.material.color.copy(g.base).lerp(WHITE, live ? glowAt(g, t) : 0);
      }
    },
    dispose() {
      for (const g of laidGeoms) g.dispose();
      laidGeoms = [];
      for (const k of kept) k.dispose();
      arrow.clear();
    },
  };

  /** How much of the travelling light piece `g` holds at time `t` (0-1). */
  function glowAt(g: Glowing, t: number): number {
    if (glow === "along") {
      const ph = (t % GLOW.ribbonPeriod) / GLOW.ribbonPeriod;
      const pos = -0.15 + 2.6 * ph;
      return Math.min(1, 0.6 * Math.exp(-(((g.at - pos) / 0.14) ** 2)));
    }
    if (glow === "steps") {
      const T = steps * GLOW.stepS + GLOW.restS;
      const pos = (t % T) / GLOW.stepS - 0.5;
      return 0.6 * Math.exp(-(((g.at - pos) / 0.55) ** 2));
    }
    if (glow === "run") {
      const T = GLOW.runS + GLOW.flashS + GLOW.lightRestS;
      const tt = t % T;
      if (g.head === true) {
        return tt < GLOW.runS - 0.2
          ? 0
          : 0.6 *
              Math.max(
                0,
                Math.sin(
                  Math.PI *
                    Math.min(1, (tt - GLOW.runS + 0.2) / (GLOW.flashS + 0.2)),
                ),
              );
      }
      return tt < GLOW.runS + 0.3
        ? 0.6 * Math.exp(-(((g.at - tt / GLOW.runS) / 0.12) ** 2))
        : 0;
    }
    return 0;
  }
}
