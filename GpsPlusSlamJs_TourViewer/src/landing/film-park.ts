/**
 * The hero film's model park, "Mill Park": one data set for the 3D scene
 * and the flat drawing. World units: 1 unit is about 2.5 m; x east, y up,
 * z south (towards the viewer). Ported from the landing prototype.
 *
 * Pure data and geometry, built once at import; no DOM, no three.js.
 *
 * @see film-park.ts.md
 */
import { clamp01 } from "./clamp01.js";

export type XZ = readonly [number, number];
export type XYZ = readonly [number, number, number];

/** A polyline measured along its length. */
export interface MeasuredPath {
  readonly pts: readonly XZ[];
  /** Cumulative length at each point; `cum[0]` is 0. */
  readonly cum: readonly number[];
  readonly len: number;
  /** The point and unit tangent at arc length `s` (clamped). */
  at(s: number): { x: number; z: number; tx: number; tz: number };
  /** The arc length of the path point nearest (x, z). */
  nearest(x: number, z: number): number;
}

export interface Station {
  readonly n: number;
  readonly name: string;
  /** Index of the route control point the station sits on. */
  readonly ctrl: number;
  /** Where its pin stands, beside the path. */
  readonly pin: XZ;
  /** Arc length of the station along the route. */
  readonly s: number;
}

export interface Tree {
  readonly x: number;
  readonly z: number;
  /** 0 a broad tree, 1 a conifer. */
  readonly kind: 0 | 1;
  readonly s: number;
}

export interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

export interface House extends Box {
  readonly h: number;
  readonly roof: number;
}

export type EyeName = "mill" | "poster" | "scan";

export interface Eye {
  readonly pos: XYZ;
  readonly target: XYZ;
  readonly fov: number;
}

const DEG = Math.PI / 180;

/** Overview azimuth, degrees (the prototype's `az` 72). */
export const AZ = 72;
/** Close-view azimuth, degrees (the prototype's `az2` 4). */
export const AZ2 = 4;

function catmullRom(p0: XZ, p1: XZ, p2: XZ, p3: XZ, t: number): XZ {
  const t2 = t * t;
  const t3 = t2 * t;
  const c = (i: 0 | 1) =>
    0.5 *
    (2 * p1[i] +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  return [c(0), c(1)];
}

/** A Catmull-Rom spline through `ctrl`, `per` points per span. */
function spline(ctrl: readonly XZ[], per: number): XZ[] {
  const out: XZ[] = [];
  const at = (i: number) => ctrl[Math.min(ctrl.length - 1, Math.max(0, i))]!;
  for (let i = 0; i < ctrl.length - 1; i++) {
    for (let k = 0; k < per; k++) {
      out.push(catmullRom(at(i - 1), at(i), at(i + 1), at(i + 2), k / per));
    }
  }
  const last = ctrl[ctrl.length - 1]!;
  out.push([last[0], last[1]]);
  return out;
}

function measured(pts: readonly XZ[]): MeasuredPath {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(
      cum[i - 1]! +
        Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]),
    );
  }
  const len = cum[cum.length - 1]!;
  return {
    pts,
    cum,
    len,
    at(s) {
      const ss = Math.min(len, Math.max(0, Number.isFinite(s) ? s : 0));
      let lo = 0;
      let hi = cum.length - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (cum[m]! <= ss) lo = m;
        else hi = m;
      }
      const span = cum[hi]! - cum[lo]! || 1;
      const f = (ss - cum[lo]!) / span;
      const a = pts[lo]!;
      const b = pts[hi]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const dl = Math.hypot(dx, dz) || 1;
      return { x: a[0] + dx * f, z: a[1] + dz * f, tx: dx / dl, tz: dz / dl };
    },
    nearest(x, z) {
      let best = 0;
      let bd = Infinity;
      pts.forEach((p, i) => {
        const d = Math.hypot(p[0] - x, p[1] - z);
        if (d < bd) {
          bd = d;
          best = cum[i]!;
        }
      });
      return best;
    },
  };
}

const PER = 12;
const ROUTE_CTRL: readonly XZ[] = [
  [-7.4, -5.3],
  [-10.0, -5.1],
  [-12.0, -4.4],
  [-12.3, -1.0],
  [-11.4, 3.0],
  [-9.4, 5.6],
  [-6.4, 6.5],
  [-2.5, 8.4],
  [2.0, 8.5],
  [5.0, 7.0],
  [9.5, 7.4],
  [12.2, 5.0],
  [11.6, 1.6],
  [8.0, 0.2],
  [3.8, -1.4],
  [1.0, -3.0],
  [0.4, -5.0],
  [2.8, -5.9],
  [6.5, -6.6],
  [10.0, -7.2],
  [12.8, -6.0],
];

/** The tour's walk, start (beside the code) to end (the viewpoint). */
export const ROUTE: MeasuredPath = measured(spline(ROUTE_CTRL, PER));
export const ROUTE_LEN = ROUTE.len;

const STATION_SPECS: readonly Omit<Station, "s">[] = [
  { n: 1, name: "Mill wheel", ctrl: 2, pin: [-13.1, -6.3] },
  { n: 2, name: "Old oak", ctrl: 6, pin: [-5.2, 5.0] },
  { n: 3, name: "Pond", ctrl: 9, pin: [5.3, 5.2] },
  { n: 4, name: "Fountain", ctrl: 16, pin: [-1.4, -6.0] },
  { n: 5, name: "Viewpoint", ctrl: 20, pin: [14.4, -4.9] },
];
export const STATIONS: readonly Station[] = STATION_SPECS.map((s) => ({
  ...s,
  s: ROUTE.cum[s.ctrl * PER]!,
}));

const STREAM_CTRL: readonly XZ[] = [
  [-14.5, -13.9],
  [-14.2, -9],
  [-14.8, -3.5],
  [-14.1, 2.5],
  [-14.9, 8.5],
  [-14.5, 13.9],
];
/** The mill stream along the west edge (splined along z). */
export const STREAM: readonly XZ[] = spline(
  STREAM_CTRL.map((p) => [p[1], p[0]] as XZ),
  8,
).map((p) => [p[1], p[0]] as XZ);

function streamX(z: number): number {
  for (let i = 1; i < STREAM.length; i++) {
    if (STREAM[i]![1] >= z) {
      const a = STREAM[i - 1]!;
      const b = STREAM[i]!;
      const f = (z - a[1]) / (b[1] - a[1] || 1);
      return a[0] + (b[0] - a[0]) * f;
    }
  }
  return STREAM[STREAM.length - 1]![0];
}

/** Where the people stand, on the ground. */
export const SPOT = {
  mill: [-11.95, 1.0] as XZ,
  poster: [-6.15, -1.6] as XZ,
  scan: [-6.2, -2.6] as XZ,
};
/** What their phone looks at. */
export const LOOK = {
  mill: [-13.1, 1.61, -6.3] as XYZ,
  poster: [-6.2, 1.72, -5.5] as XYZ,
  scan: [-6.2, 1.64, -5.5] as XYZ,
};
/** The phone's eye-height cameras. */
export const EYES: Readonly<Record<EyeName, Eye>> = {
  mill: { pos: [SPOT.mill[0], 0.68, SPOT.mill[1]], target: LOOK.mill, fov: 56 },
  poster: {
    pos: [SPOT.poster[0], 0.68, SPOT.poster[1]],
    target: LOOK.poster,
    fov: 58,
  },
  scan: { pos: [SPOT.scan[0], 0.68, SPOT.scan[1]], target: LOOK.scan, fov: 50 },
};

/** Arc length where the first station's person stands. */
export const S_FIG = ROUTE.nearest(SPOT.mill[0], SPOT.mill[1]);
export const START = ROUTE.at(0);
/** From the code's spot to the route's start. */
export const LEAD_IN = Math.hypot(
  START.x - SPOT.scan[0],
  START.z - SPOT.scan[1],
);

export const PARK = {
  slab: { w: 36, d: 28, r: 2.6, grass: 0.3, earth: 0.9 },
  mill: {
    x0: -12.6,
    x1: -6.2,
    z0: -11.6,
    z1: -6.8,
    h: 2.6,
    roof: 1.7,
  } as House,
  barn: { x0: 6.6, x1: 11.2, z0: -13.0, z1: -10.2, h: 2.0, roof: 1.3 } as House,
  yard: { x0: -3.6, x1: 4.6, z0: -10.4, z1: -4.0 } as Box,
  fountain: { x: 0.2, z: -7.4 },
  pond: { x: 6.6, z: 3.6, rx: 3.3, rz: 2.0 },
  oak: { x: -3.4, z: 2.6, r: 2.1, h: 2.4 },
  lookout: { x: 14.3, z: -5.6, s: 2.6, h: 0.45 },
  poster: { x: -6.2, z: -5.6 },
  wheel: { x: -12.95, z: -9.2, y: 1.15, r: 1.45, w: 0.45 },
  streamW: 2.2,
  pathW: 0.9,
  pinH: 2.2,
  // Seen at eye height a pin stands lower, so the card above it and the
  // sheet below it both have room on the phone's screen.
  eyePinH: 1.3,
  colors: {
    grass: "#d3cfa6",
    grassSide: "#bdb68c",
    earth: "#b59f7e",
    path: "#f6f1e3",
    water: "#b8cbc3",
    waterLine: "#e3ece6",
    wall: "#efe7d4",
    roof: "#a49a86",
    roof2: "#b8a48a",
    dark: "#6c665b",
    paving: "#e7dfc9",
    tree: "#a7ae7c",
    conifer: "#8c9a6c",
    trunk: "#8a735a",
    ink: "#2a2824",
    paper: "#f4eedf",
    route: "#cf4428",
    stone: "#d8cfba",
    wood: "#a88c6c",
    sky: "#dfe7e3",
  },
} as const;

/** The sun's direction (unit), from the overview azimuth. */
export const LIGHT: XYZ = (() => {
  const la = (AZ - 55) * DEG;
  const c = Math.sqrt(1 - 0.82 * 0.82);
  return [Math.sin(la) * c, 0.82, Math.cos(la) * c];
})();

const CAMX = Math.sin(AZ * DEG);
const CAMZ = Math.cos(AZ * DEG);
const CAM2X = Math.sin(AZ2 * DEG);
const CAM2Z = Math.cos(AZ2 * DEG);

const M = PARK.mill;
/** What each close view must show (fitted beside the phone). */
export const REGIONS: Readonly<Record<"mill" | "poster", readonly XYZ[]>> = {
  mill: [
    [-13.1, PARK.pinH + 1.0, -6.3],
    [-13.1, 0, -6.3],
    [-13.4, 2.8, -9.2],
    [-12.6, M.h + M.roof, -9.2],
    [-9.6, M.h + M.roof, -9.2],
    [SPOT.mill[0], 1.9, SPOT.mill[1]],
    [SPOT.mill[0], 0, SPOT.mill[1] + 0.8],
    [-14.2, 0, -2.5],
    [-10.4, 0, -2.5],
  ],
  poster: [
    [-6.2, 2.7, -5.6],
    [-6.2, 0, -5.6],
    [START.x, 0, START.z],
    [SPOT.poster[0], 1.9, SPOT.poster[1]],
    [SPOT.poster[0], 0, SPOT.poster[1] + 0.7],
    [SPOT.scan[0], 0, SPOT.scan[1]],
    [-10.4, 0, -4.4],
    [-2.2, 0, -4.4],
    [-6.2, 0, -7.6],
    [-6.2, 0, 0.6],
  ],
};

function segDist(x: number, z: number, a: XZ, b: XZ): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = dx * dx + dz * dz || 1;
  const t = clamp01(((x - a[0]) * dx + (z - a[1]) * dz) / l);
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}

/**
 * The trees: a deterministic scatter (a fixed-seed Park-Miller), kept off
 * the paths, the buildings and the water, and out of every line of sight
 * the story needs.
 */
export const TREES: readonly Tree[] = (() => {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const inBox = (b: Box, x: number, z: number, m: number) =>
    x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m;
  const near = (x: number, z: number, d: number) => {
    for (let i = 0; i < ROUTE.pts.length; i += 2) {
      const p = ROUTE.pts[i]!;
      if (Math.hypot(p[0] - x, p[1] - z) < d) return true;
    }
    return false;
  };
  const sightLines: readonly (readonly [XZ, XZ])[] = [
    [SPOT.mill, [-13.1, -6.3]],
    [SPOT.mill, [-13.0, -9.2]],
    [SPOT.poster, [-6.2, -5.6]],
    [SPOT.scan, [-6.2, -5.6]],
  ];
  // nothing may stand between the close-view camera and the spots the story needs
  const keep2 = (
    [
      SPOT.mill,
      SPOT.poster,
      SPOT.scan,
      [-13.1, -6.3],
      [-6.2, -5.6],
      [-13.0, -9.2],
    ] as XZ[]
  ).map((k) => [k, [k[0] + CAM2X * 4.4, k[1] + CAM2Z * 4.4] as XZ] as const);
  const P = PARK;
  const out: Tree[] = [];
  for (let gx = -16.5; gx <= 16.5; gx += 2.4) {
    for (let gz = -12.6; gz <= 12.6; gz += 2.4) {
      const x = gx + (rnd() - 0.5) * 1.8;
      const z = gz + (rnd() - 0.5) * 1.8;
      const kind = rnd() < 0.32 ? 1 : 0;
      const s = 0.78 + rnd() * 0.42;
      const excluded =
        Math.abs(x) > 16.9 ||
        Math.abs(z) > 12.9 ||
        (Math.abs(x) > 15.4 && Math.abs(z) > 10.4) ||
        near(x, z, 1.7) ||
        near(x - CAMX * 1.9, z - CAMZ * 1.9, 1.55) ||
        inBox(P.mill, x, z, 1.0) ||
        inBox(P.barn, x, z, 0.9) ||
        inBox(P.yard, x, z, 0.6) ||
        (x < -12.6 && z > -11 && z < -7.5) ||
        Math.abs(x - streamX(z)) < 2.1 ||
        ((x - P.pond.x) / (P.pond.rx + 1)) ** 2 +
          ((z - P.pond.z) / (P.pond.rz + 1)) ** 2 <
          1 ||
        Math.hypot(x - P.oak.x, z - P.oak.z) < 3.2 ||
        Math.hypot(x - P.lookout.x, z - P.lookout.z) < 2.6 ||
        Math.hypot(x - P.poster.x, z - P.poster.z) < 1.6 ||
        STATIONS.some(
          (st) =>
            Math.hypot(x - st.pin[0], z - st.pin[1]) < 1.6 ||
            Math.hypot(x - CAMX * 2.2 - st.pin[0], z - CAMZ * 2.2 - st.pin[1]) <
              2.0,
        ) ||
        sightLines.some((l) => segDist(x, z, l[0], l[1]) < 1.9) ||
        keep2.some((l) => segDist(x, z, l[0], l[1]) < 1.8) ||
        (x > -7.2 && x < 0 && z > -4.2 && z < 2.6);
      if (!excluded) out.push({ x, z, kind, s });
    }
  }
  return out;
})();
