/**
 * The ground arrow's pure maths: the one scale and its curves, the route
 * every style follows (toward the point it points to, bent at its start,
 * stopping short of the point), the sun warning for its colours and the
 * float of its hovering pieces. No three.js: the drawing (`ground.ts`)
 * reads these, and the editor's handles read the scale's circle.
 *
 * The frame is the part's: metres, x right, z front (the part's +Z), the
 * start at the origin, on the ground. Seen from above, a bend `+` leaves
 * the start turned to the right of the straight line and curves back, so
 * the end always points at the target.
 *
 * @see ground-route.ts.md
 */

import {
  shortTextLetterHeightM,
  TOUR_GROUND_MAX_BEND_DEG,
  TOUR_SHORT_TEXT_MAX_READ_AT_M,
  TOUR_SHORT_TEXT_MIN_READ_AT_M,
  type TourGroundStyle,
} from "gps-plus-slam-app-framework/ar/tour-short-text";

/** The curves of the one scale, and the route's rules (m where not a
 *  scale). */
export const GROUND = {
  /** The letters follow the scale between these, then stop. */
  textMin: 2,
  textMax: 12,
  /** The arrow's length: `lenA` + `lenB` per unit of scale, within
   *  `lenMin` and `lenMax`. */
  lenA: 1,
  lenB: 0.75,
  lenMin: 1.2,
  lenMax: 24,
  /** The width follows the scale between these. */
  wMin: 2,
  wMax: 18,
  /** The scale from the target's distance D when none is set:
   *  `defA` + `defB` sqrt(D), within `defMin` and `defMax`. */
  defA: 2,
  defB: 1.6,
  defMin: 3,
  defMax: 16,
  /** The scale with neither a value nor a target. */
  defNoTarget: 6,
  /** Every style ends at least this far short of its target. */
  stopM: 2,
  /** With less room than this before the stop: no arrow, the plate only. */
  routeMinM: 0.5,
  /** The route's samples, about this far apart. */
  sampleM: 0.04,
  /** The editor's circle round the start: `ringA` + `ringB` per unit of
   *  scale (0.75 m at 6). */
  ringA: 0.3,
  ringB: 0.075,
} as const;

/** A number held in [lo, hi]; NaN gives lo. */
function held(x: number, lo: number, hi: number): number {
  return Number.isNaN(x) ? lo : Math.min(hi, Math.max(lo, x));
}

/** The scale where the record sets none: from the target's distance, or
 *  `defNoTarget` with no target. A set value is held in the format's
 *  bounds. */
export function groundScale(
  readAtM: number | undefined,
  distanceM: number | null,
): number {
  if (readAtM !== undefined && Number.isFinite(readAtM)) {
    return held(
      readAtM,
      TOUR_SHORT_TEXT_MIN_READ_AT_M,
      TOUR_SHORT_TEXT_MAX_READ_AT_M,
    );
  }
  if (distanceM === null || !Number.isFinite(distanceM)) {
    return GROUND.defNoTarget;
  }
  return held(
    GROUND.defA + GROUND.defB * Math.sqrt(Math.max(0, distanceM)),
    GROUND.defMin,
    GROUND.defMax,
  );
}

/** The letter height (m) at a scale: the short text's rule, the scale
 *  held between `textMin` and `textMax`. */
export function groundLetterM(scale: number): number {
  return shortTextLetterHeightM(held(scale, GROUND.textMin, GROUND.textMax));
}

/** The arrow's wanted length (m) at a scale. */
export function groundLengthM(scale: number): number {
  return held(GROUND.lenA + GROUND.lenB * scale, GROUND.lenMin, GROUND.lenMax);
}

/** Each style's width (m) from the width scale (`groundWidthScale`): the
 *  ribbon's width, a vane's span, a print's length, a light's radius, the
 *  floor arrow's shaft. */
export const GROUND_STYLE_WIDTH: Readonly<
  Record<TourGroundStyle, (ws: number) => number>
> = {
  ribbon: (ws) => 0.12 + 0.04 * ws,
  vanes: (ws) => 0.3 + 0.03 * ws,
  footprints: (ws) => 0.26 + 0.015 * ws,
  lights: (ws) => 0.06 + 0.005 * ws,
  floor: (ws) => 0.2 * (1.2 + 0.1 * ws),
};

/** The width scale at a scale. */
export function groundWidthScale(scale: number): number {
  return held(scale, GROUND.wMin, GROUND.wMax);
}

/** The editor circle's radius (m) at a scale, and the scale at a radius
 *  (held in the format's bounds): a dot on the circle stays under the
 *  pointer that drags it. */
export function groundRingM(scale: number): number {
  return GROUND.ringA + GROUND.ringB * scale;
}
export function groundScaleAtRingM(radiusM: number): number {
  return held(
    (radiusM - GROUND.ringA) / GROUND.ringB,
    TOUR_SHORT_TEXT_MIN_READ_AT_M,
    TOUR_SHORT_TEXT_MAX_READ_AT_M,
  );
}

/** A bend held to the format's bounds (degrees); not finite: 0. */
export function groundBendDeg(bendDeg: number | undefined): number {
  return bendDeg === undefined || !Number.isFinite(bendDeg)
    ? 0
    : held(bendDeg, -TOUR_GROUND_MAX_BEND_DEG, TOUR_GROUND_MAX_BEND_DEG);
}

/** A sample of a route: its point, its direction (unit), and how far
 *  along it lies (m). */
interface RouteSample {
  readonly x: number;
  readonly z: number;
  readonly tx: number;
  readonly tz: number;
  readonly s: number;
}

/** A route's samples and its length along the curve (m). */
export interface RoutePath {
  readonly pts: readonly RouteSample[];
  readonly L: number;
}

/** The route, or why there is none. */
export type GroundRoute =
  | {
      readonly none: true;
      /** The room before the stop (m). */
      readonly roomM: number;
    }
  | {
      readonly none: false;
      /** The straight line's direction (unit), toward the target. */
      readonly dirX: number;
      readonly dirZ: number;
      /** The direction the route leaves its start in (unit). */
      readonly t0X: number;
      readonly t0Z: number;
      /** How far along the straight line it ends (m). */
      readonly lengthM: number;
      readonly bendDeg: number;
      /** The farthest the route strays from the straight line (m, signed:
       *  + to the right). */
      readonly sideM: number;
      readonly path: RoutePath;
    };

/** Samples along a level cubic from (0, 0) leaving along t0 to p3
 *  arriving along d, every ~`ds` m by arc length. */
function cubicPath(
  t0: readonly [number, number],
  p3: readonly [number, number],
  d: readonly [number, number],
  ds: number,
): RoutePath {
  const k = Math.hypot(p3[0], p3[1]) * 0.38;
  const p1 = [t0[0] * k, t0[1] * k] as const;
  const p2 = [p3[0] - d[0] * k, p3[1] - d[1] * k] as const;
  const N = 96;
  const raw: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    // The start is the origin, so its Bernstein term is zero.
    const u = i / N;
    const b = 3 * (1 - u) ** 2 * u;
    const c = 3 * (1 - u) * u * u;
    const e = u ** 3;
    raw.push([
      b * p1[0] + c * p2[0] + e * p3[0],
      b * p1[1] + c * p2[1] + e * p3[1],
    ]);
  }
  const cum = [0];
  for (let i = 1; i <= N; i++) {
    const p = raw[i]!;
    const q = raw[i - 1]!;
    cum.push(cum[i - 1]! + Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  const L = cum[N]!;
  const n = Math.max(2, Math.ceil(L / ds));
  const pts: RouteSample[] = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = (L * i) / n;
    while (j < N - 1 && cum[j + 1]! < s) j++;
    const a = raw[j]!;
    const b = raw[j + 1]!;
    const f = (s - cum[j]!) / Math.max(1e-9, cum[j + 1]! - cum[j]!);
    const tx = b[0] - a[0];
    const tz = b[1] - a[1];
    const tl = Math.hypot(tx, tz);
    pts.push({
      x: a[0] + (b[0] - a[0]) * f,
      z: a[1] + (b[1] - a[1]) * f,
      tx: tl > 1e-9 ? tx / tl : t0[0],
      tz: tl > 1e-9 ? tz / tl : t0[1],
      s,
    });
  }
  // The ends exactly: the start at the origin, the end on the line.
  pts[0] = { x: 0, z: 0, tx: t0[0], tz: t0[1], s: 0 };
  pts[n] = { x: p3[0], z: p3[1], tx: d[0], tz: d[1], s: L };
  return { pts, L };
}

/**
 * The route from the start (the origin) toward `target` (the part's
 * frame; null: straight ahead along +Z, with no stop), leaving at
 * `bendDeg` (held to the format's bounds) off the straight line and
 * arriving along it. It ends `groundLengthM(scale)` along the straight
 * line, at most `lenCapM`, and never closer than `GROUND.stopM` to the
 * target; with less than `GROUND.routeMinM` of room there is none.
 */
export function groundRoute(input: {
  readonly target: { readonly x: number; readonly z: number } | null;
  readonly scale: number;
  readonly bendDeg?: number;
  readonly lenCapM?: number;
}): GroundRoute {
  const { target } = input;
  const D = target === null ? 0 : Math.hypot(target.x, target.z);
  const ahead = target === null || !(D > 1e-3);
  const dirX = ahead ? 0 : target.x / D;
  const dirZ = ahead ? 1 : target.z / D;
  const want = Math.min(groundLengthM(input.scale), input.lenCapM ?? Infinity);
  const room = target === null ? Infinity : D - GROUND.stopM;
  if (room < GROUND.routeMinM) return { none: true, roomM: room };
  const lengthM = Math.min(want, room);
  const bendDeg = groundBendDeg(input.bendDeg);
  const b = (bendDeg * Math.PI) / 180;
  // Right of the line, seen from above (y up): (-dirZ, dirX).
  const rX = -dirZ;
  const rZ = dirX;
  const t0X = Math.cos(b) * dirX + Math.sin(b) * rX;
  const t0Z = Math.cos(b) * dirZ + Math.sin(b) * rZ;
  const path = cubicPath(
    [t0X, t0Z],
    [dirX * lengthM, dirZ * lengthM],
    [dirX, dirZ],
    GROUND.sampleM,
  );
  let sideM = 0;
  for (const q of path.pts) {
    const d = q.x * rX + q.z * rZ;
    if (Math.abs(d) > Math.abs(sideM)) sideM = d;
  }
  return { none: false, dirX, dirZ, t0X, t0Z, lengthM, bendDeg, sideM, path };
}

/** The point, the direction (unit) and its right `s` m along `path`
 *  (held to the path), between its samples. */
export function routeAt(
  path: RoutePath,
  s: number,
): {
  readonly x: number;
  readonly z: number;
  readonly tx: number;
  readonly tz: number;
  readonly rx: number;
  readonly rz: number;
} {
  const n = path.pts.length - 1;
  const u = (held(s, 0, path.L) / Math.max(1e-9, path.L)) * n;
  const i = Math.min(n - 1, Math.floor(u));
  const f = u - i;
  const a = path.pts[i]!;
  const b = path.pts[i + 1]!;
  let tx = a.tx + (b.tx - a.tx) * f;
  let tz = a.tz + (b.tz - a.tz) * f;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  return {
    x: a.x + (b.x - a.x) * f,
    z: a.z + (b.z - a.z) * f,
    tx,
    tz,
    rx: -tz,
    rz: tx,
  };
}

/** The sun warning's rule: a dark part reads too faintly against pale
 *  paving in direct sun below this contrast ratio. */
export const GROUND_SUN_MIN_RATIO = 3;

/** An sRGB channel (0-1) to linear light. */
function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** `#rrggbb` as linear RGB, or null for anything else. */
function linearRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (m === null) return null;
  return [m[1]!, m[2]!, m[3]!].map((h) => linear(parseInt(h, 16) / 255)) as [
    number,
    number,
    number,
  ];
}

const sunCache = new Map<string, number>();

/**
 * How `hex` (`#rrggbb`) reads against pale paving (#c1c3c3) in direct sun,
 * as a luminance contrast ratio (1 = none, 21 = the most): both as flat
 * matt patches facing up, seen from above, under a sky and a sun at 1.6
 * times the place's normal brightness, the colour with a small sun
 * highlight. A face turned up is the brightest a dark part gets, so the
 * estimate errs toward warning. NaN for a value that is no colour.
 */
export function sunContrast(hex: string): number {
  const cached = sunCache.get(hex);
  if (cached !== undefined) return cached;
  const part = linearRgb(hex);
  const pave = linearRgb("#c1c3c3");
  if (part === null || pave === null) return Number.NaN;
  const bright = 1.6;
  const lx = -30;
  const ly = 50;
  const lz = 20;
  const ll = Math.hypot(lx, ly, lz);
  const nl = Math.max(0, ly / ll);
  // The half vector of the sun and the eye straight above.
  const hx = lx / ll;
  const hy = ly / ll + 1;
  const hz = lz / ll;
  const hl = Math.hypot(hx, hy, hz);
  const nh = hy / hl;
  const vh = nh;
  const sky = 2.3 * bright;
  const dir = 0.9 * bright * nl;
  const a = 0.55 * 0.55;
  const a2 = a * a;
  const d = nh * nh * (a2 - 1) + 1;
  const D = a2 / (Math.PI * d * d);
  const gv = nl * Math.sqrt(a2 + (1 - a2));
  const gl = Math.sqrt(a2 + (1 - a2) * nl * nl);
  const vis = 0.5 / Math.max(gv + gl, 1e-6);
  const F = 0.04 + 0.96 * (1 - vh) ** 5;
  const spec = dir * F * vis * D;
  const shade = (rgb: readonly number[], s: number) =>
    rgb.map((x) => Math.min(1, (x * (sky + dir)) / Math.PI + s));
  const lum = (rgb: readonly number[]) =>
    0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
  const lp = lum(shade(pave, 0));
  const lc = lum(shade(part, spec));
  const r =
    Math.round(((Math.max(lp, lc) + 0.05) / (Math.min(lp, lc) + 0.05)) * 100) /
    100;
  sunCache.set(hex, r);
  return r;
}

/** The float of the hovering pieces. */
const GROUND_FLOAT = {
  /** The largest piece's amplitude (m); each piece 0.6-1 of it. */
  ampM: 0.025,
  /** The period (s); each piece 0.8-1.25 of it. */
  periodS: 3.5,
} as const;

/** A steady pseudo-random number in [0, 1) for `n`. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** How far (m) the hovering piece `seed` floats above its height at time
 *  `t` (s): by time alone, never by the visitor; out of phase per piece,
 *  and a second, faster sine at a quarter of the strength, so it drifts
 *  rather than bobs. */
export function groundFloatM(seed: number, t: number): number {
  const a = GROUND_FLOAT.ampM * (0.6 + 0.4 * hash01(seed));
  const per = GROUND_FLOAT.periodS * (0.8 + 0.45 * hash01(seed + 7.3));
  const ph = 2 * Math.PI * hash01(seed + 3.1);
  return (
    a *
    (0.8 * Math.sin((2 * Math.PI * t) / per + ph) +
      0.2 * Math.sin((2 * Math.PI * t) / (per * 0.37) + 2.3 * ph))
  );
}
