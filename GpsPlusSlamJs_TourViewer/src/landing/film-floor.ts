/**
 * The film without WebGL: the same park drawn flat in SVG, projected with
 * the same camera angles and fitted the same way (the overview fits the
 * whole park, a close view its region beside the phone). Ported from
 * the prototype's `drawFloor`; used when WebGL is missing or its context is lost.
 *
 * `drawFloor` is pure (a string of SVG); `floorSignature` says when a
 * redraw would change anything, so a playing film without WebGL rebuilds
 * the drawing only when something visible in it changes.
 *
 * @see film-floor.ts.md
 */
import {
  LIGHT,
  PARK,
  REGIONS,
  ROUTE,
  STATIONS,
  STREAM,
  TREES,
} from "./film-park.js";
import { closeRect, viewParams, type FilmLayout } from "./film-layout.js";
import type { SceneState } from "./film-story.js";

const DEG = Math.PI / 180;
const C = PARK.colors;

type P2 = [number, number];
type P3 = readonly [number, number, number];

export interface FloorDrawing {
  /** The SVG viewBox, "x y w h". */
  readonly viewBox: string;
  /** The drawing and its labels. */
  readonly markup: string;
  /** Where the dashed line from the phone starts (the person's head), box px; or null. */
  readonly lead: readonly [number, number] | null;
}

function hex(c: string): [number, number, number] {
  return [
    Number.parseInt(c.slice(1, 3), 16),
    Number.parseInt(c.slice(3, 5), 16),
    Number.parseInt(c.slice(5, 7), 16),
  ];
}
function shade(c: string, k: number): string {
  return `rgb(${hex(c)
    .map((x) => Math.min(255, Math.max(0, Math.round(x * k))))
    .join(",")})`;
}
function hull(input: readonly P2[]): P2[] {
  const pts = [...input].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P2, a: P2, b: P2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [];
  const up: P2[] = [];
  for (const p of pts) {
    while (
      lo.length >= 2 &&
      cross(lo[lo.length - 2]!, lo[lo.length - 1]!, p) <= 0
    )
      lo.pop();
    lo.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (
      up.length >= 2 &&
      cross(up[up.length - 2]!, up[up.length - 1]!, p) <= 0
    )
      up.pop();
    up.push(p);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}
function slabOutline(w0: number, d0: number, r0: number, inset: number): P2[] {
  const w = w0 / 2 - inset;
  const d = d0 / 2 - inset;
  const r = r0 - inset;
  const out: P2[] = [];
  for (const c of [
    [w - r, d - r, 0],
    [-(w - r), d - r, 90],
    [-(w - r), -(d - r), 180],
    [w - r, -(d - r), 270],
  ] as const) {
    for (let k = 0; k <= 6; k++) {
      const a = (c[2] + k * 15) * DEG;
      out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
    }
  }
  return out;
}
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = (
    [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1],
    ] as const
  ).map((p) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / l, p[1] / l, p[2] / l] as P3;
  });
  const f: readonly (readonly [number, number, number])[] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  return { v, f };
})();

interface Face {
  readonly d: number;
  readonly s: string;
}

/**
 * The park as SVG for model state `S`, laid out for box `ly`.
 * `phoneOn`: the drawn phone is up (then a close view draws the dashed
 * line from the phone to the person).
 */
export function drawFloor(
  S: SceneState,
  phoneOn: boolean,
  ly: FilmLayout,
): FloorDrawing {
  const view = S.view;
  const VP = viewParams(view, ly);
  const ca = Math.cos(VP.az);
  const sa = Math.sin(VP.az);
  const ce = Math.cos(VP.el);
  const se = Math.sin(VP.el);
  const B: P3 = [sa * ce, se, ca * ce];
  const Lt = LIGHT;
  let minX = 1e9;
  let minY = 1e9;
  let maxX = -1e9;
  let maxY = -1e9;
  const pr = (x: number, y: number, z: number, keep = true): P2 => {
    const X = x * ca - z * sa;
    const Y = se * sa * x - ce * y + se * ca * z;
    if (keep) {
      minX = Math.min(minX, X);
      maxX = Math.max(maxX, X);
      minY = Math.min(minY, Y);
      maxY = Math.max(maxY, Y);
    }
    return [X, Y];
  };
  const depth = (x: number, y: number, z: number) =>
    x * B[0] + y * B[1] + z * B[2];
  const ptsStr = (arr: readonly P3[], keep = true) =>
    arr
      .map((p) => {
        const q = pr(p[0], p[1], p[2], keep);
        return `${q[0].toFixed(2)},${q[1].toFixed(2)}`;
      })
      .join(" ");
  const poly = (arr: readonly P3[], fill: string, extra = "") =>
    `<polygon points="${ptsStr(arr)}" fill="${fill}"${extra}/>`;
  const face = (arr: readonly P3[], n0: P3, base: string): Face | null => {
    const l = Math.hypot(n0[0], n0[1], n0[2]);
    const n: P3 = [n0[0] / l, n0[1] / l, n0[2] / l];
    if (n[0] * B[0] + n[1] * B[1] + n[2] * B[2] <= 0.0005) return null;
    const k =
      0.64 + 0.4 * Math.max(0, n[0] * Lt[0] + n[1] * Lt[1] + n[2] * Lt[2]);
    const col = shade(base, k);
    let d = 0;
    for (const p of arr) d += depth(p[0], p[1], p[2]);
    return {
      d: d / arr.length,
      s: poly(
        arr,
        col,
        ` stroke="${col}" stroke-width=".05" stroke-linejoin="round"`,
      ),
    };
  };
  const faces = (list: readonly (Face | null)[]) =>
    list
      .filter((f): f is Face => f !== null)
      .sort((a, b) => a.d - b.d)
      .map((f) => f.s)
      .join("");
  const box = (
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    c: string,
  ) => [
    face(
      [
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [0, 1, 0],
      c,
    ),
    face(
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [0, 0, 1],
      c,
    ),
    face(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      [0, 0, -1],
      c,
    ),
    face(
      [
        [x1, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
      [1, 0, 0],
      c,
    ),
    face(
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ],
      [-1, 0, 0],
      c,
    ),
  ];
  const roof = (b: typeof PARK.mill, c: string) => {
    const o = 0.3;
    const xa = b.x0 - o;
    const xb = b.x1 + o;
    const za = b.z0 - o;
    const zb = b.z1 + o;
    const zm = (b.z0 + b.z1) / 2;
    const y0 = b.h;
    const y1 = b.h + b.roof;
    const a = zb - zm;
    return [
      face(
        [
          [xa, y0, zb],
          [xb, y0, zb],
          [xb, y1, zm],
          [xa, y1, zm],
        ],
        [0, a, b.roof],
        c,
      ),
      face(
        [
          [xa, y0, za],
          [xb, y0, za],
          [xb, y1, zm],
          [xa, y1, zm],
        ],
        [0, a, -b.roof],
        c,
      ),
      face(
        [
          [b.x0, y0, za + o],
          [b.x0, y0, zb - o],
          [b.x0, y1, zm],
        ],
        [-1, 0, 0],
        C.wall,
      ),
      face(
        [
          [b.x1, y0, za + o],
          [b.x1, y0, zb - o],
          [b.x1, y1, zm],
        ],
        [1, 0, 0],
        C.wall,
      ),
    ];
  };
  /** A point on the circle of radius `r` around (x, z), at height `y`. */
  const rim = (x: number, z: number, r: number, a: number, y: number): P3 => [
    x + Math.cos(a) * r,
    y,
    z + Math.sin(a) * r,
  ];
  /** One face per side of an n-sided round shape: each side's two angles
   *  and the angle of its middle. */
  const roundSides = (
    n: number,
    side: (a0: number, a1: number, am: number) => Face | null,
  ): (Face | null)[] => {
    const out: (Face | null)[] = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 2 * Math.PI;
      const a1 = ((i + 1) / n) * 2 * Math.PI;
      out.push(side(a0, a1, (a0 + a1) / 2));
    }
    return out;
  };
  const prism = (
    x: number,
    z: number,
    r: number,
    y0: number,
    y1: number,
    n: number,
    c: string,
    top?: string,
  ) => {
    const out = roundSides(n, (a0, a1, am) =>
      face(
        [
          rim(x, z, r, a0, y0),
          rim(x, z, r, a1, y0),
          rim(x, z, r, a1, y1),
          rim(x, z, r, a0, y1),
        ],
        [Math.cos(am), 0, Math.sin(am)],
        c,
      ),
    );
    const cap = Array.from({ length: n }, (_, i) =>
      rim(x, z, r, (i / n) * 2 * Math.PI, y1),
    );
    out.push(face(cap, [0, 1, 0], top ?? c));
    return out;
  };
  const cone = (
    x: number,
    z: number,
    r: number,
    y0: number,
    h: number,
    n: number,
    c: string,
  ) =>
    roundSides(n, (a0, a1, am) =>
      face(
        [rim(x, z, r, a0, y0), rim(x, z, r, a1, y0), [x, y0 + h, z]],
        [Math.cos(am) * h, r, Math.sin(am) * h],
        c,
      ),
    );
  const blob = (
    x: number,
    y: number,
    z: number,
    r: number,
    sy: number,
    c: string,
  ) =>
    ICO.f.map((f) => {
      const pts = f.map((i) => {
        const p = ICO.v[i]!;
        return [x + p[0] * r, y + p[1] * r * sy, z + p[2] * r] as P3;
      });
      const n = [0, 1, 2].map(
        (k) => (ICO.v[f[0]]![k]! + ICO.v[f[1]]![k]! + ICO.v[f[2]]![k]!) / 3,
      );
      return face(pts, [n[0]!, n[1]! / sy, n[2]!], c);
    });
  const shadowOf = (pts3: readonly P3[]) => {
    const g: P2[] = [];
    for (const p of pts3) {
      g.push([p[0], p[2]]);
      g.push([p[0] - (Lt[0] / Lt[1]) * p[1], p[2] - (Lt[2] / Lt[1]) * p[1]]);
    }
    return poly(
      hull(g).map((q) => [q[0], 0.03, q[1]] as P3),
      "rgba(70,56,30,.17)",
    );
  };
  const ring = (
    x: number,
    z: number,
    rx: number,
    rz: number,
    y: number,
    n: number,
  ) => {
    const o: P3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      o.push([x + Math.cos(a) * rx, y, z + Math.sin(a) * rz]);
    }
    return o;
  };
  const ribbon = (
    pts: readonly (readonly [number, number])[],
    w: number,
    y: number,
  ) => {
    const Lf: P3[] = [];
    const R: P3[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      const nx = ((-dz / l) * w) / 2;
      const nz = ((dx / l) * w) / 2;
      Lf.push([pts[i]![0] + nx, y, pts[i]![1] + nz]);
      R.unshift([pts[i]![0] - nx, y, pts[i]![1] - nz]);
    }
    return Lf.concat(R);
  };

  const P = PARK;
  const Sl = P.slab;
  const out: string[] = [];
  const ol = slabOutline(Sl.w, Sl.d, Sl.r, 0);
  const top = -Sl.grass - Sl.earth;
  out.push(
    poly(
      hull(
        ol.concat(
          ol.map(
            (q) =>
              [
                q[0] - (Lt[0] / Lt[1]) * 1.6,
                q[1] - (Lt[2] / Lt[1]) * 1.6,
              ] as P2,
          ),
        ),
      ).map((q) => [q[0], top, q[1]] as P3),
      "rgba(70,56,30,.12)",
    ),
  );
  const sides: (Face | null)[] = [];
  for (let i = 0; i < ol.length; i++) {
    const a = ol[i]!;
    const b = ol[(i + 1) % ol.length]!;
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    let nx = b[1] - a[1];
    let nz = -(b[0] - a[0]);
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
    sides.push(
      face(
        [
          [a[0], -Sl.grass, a[1]],
          [b[0], -Sl.grass, b[1]],
          [b[0], top, b[1]],
          [a[0], top, a[1]],
        ],
        [nx, 0, nz],
        C.earth,
      ),
    );
    sides.push(
      face(
        [
          [a[0], 0, a[1]],
          [b[0], 0, b[1]],
          [b[0], -Sl.grass, b[1]],
          [a[0], -Sl.grass, a[1]],
        ],
        [nx, 0, nz],
        C.grassSide,
      ),
    );
  }
  out.push(faces(sides));
  out.push(
    poly(
      ol.map((q) => [q[0], 0, q[1]] as P3),
      C.grass,
    ),
  );
  out.push(poly(ribbon(STREAM, P.streamW, 0.01), C.water));
  const Y = P.yard;
  out.push(
    poly(
      [
        [Y.x0, 0.01, Y.z0],
        [Y.x1, 0.01, Y.z0],
        [Y.x1, 0.01, Y.z1],
        [Y.x0, 0.01, Y.z1],
      ],
      C.paving,
      ` stroke="${C.stone}" stroke-width=".12"`,
    ),
  );
  out.push(
    poly(
      ring(P.pond.x, P.pond.z, P.pond.rx, P.pond.rz, 0.012, 36),
      C.water,
      ` stroke="${C.stone}" stroke-width=".18"`,
    ),
  );
  out.push(poly(ribbon(ROUTE.pts, P.pathW, 0.02), C.path));
  for (const bd of [P.mill, P.barn]) {
    const yy = bd.h + bd.roof * 0.6;
    out.push(
      shadowOf([
        [bd.x0, yy, bd.z0],
        [bd.x1, yy, bd.z0],
        [bd.x1, yy, bd.z1],
        [bd.x0, yy, bd.z1],
      ]),
    );
  }
  for (const t of TREES) {
    const hc = (t.kind ? 1.6 : 2.0) * t.s;
    const r = (t.kind ? 0.75 : 0.95) * t.s;
    out.push(shadowOf(ring(t.x, t.z, r, r, hc, 8)));
  }
  out.push(
    shadowOf(
      ring(P.oak.x, P.oak.z, P.oak.r * 0.95, P.oak.r * 0.95, P.oak.h + 1.2, 10),
    ),
  );
  // the wedge the person's phone looks along
  const fg = S.fig && S.fig.k > 0.5 ? S.fig : null;
  if (fg?.look && S.wedge > 0.5) {
    const wl = 4.4;
    const hw = 17 * DEG;
    const wy = Math.atan2(fg.look[0] - fg.x, fg.look[1] - fg.z);
    out.push(
      poly(
        [
          [fg.x, 0.04, fg.z],
          [fg.x + Math.sin(wy - hw) * wl, 0.04, fg.z + Math.cos(wy - hw) * wl],
          [fg.x + Math.sin(wy + hw) * wl, 0.04, fg.z + Math.cos(wy + hw) * wl],
        ],
        "rgba(207,68,40,.22)",
      ),
    );
  }
  for (let sd = 0.3; sd < S.route; sd += 0.62) {
    const q = ROUTE.at(sd);
    const pp = pr(q.x, 0.05, q.z);
    out.push(
      `<ellipse cx="${pp[0].toFixed(2)}" cy="${pp[1].toFixed(2)}" rx=".17" ry="${(0.17 * se).toFixed(3)}" fill="${C.route}"/>`,
    );
  }
  const objs: Face[] = [];
  const add = (x: number, z: number, s: string) =>
    objs.push({ d: depth(x, 0, z), s });
  const Mi = P.mill;
  add(
    (Mi.x0 + Mi.x1) / 2,
    (Mi.z0 + Mi.z1) / 2,
    faces(
      box(Mi.x0, Mi.x1, 0, Mi.h, Mi.z0, Mi.z1, C.wall).concat(
        roof(Mi, C.roof),
        box(-8.9, -8.1, 0, 1.3, Mi.z1, Mi.z1 + 0.05, C.dark),
        box(-11.4, -10.6, 1.2, 1.9, Mi.z1, Mi.z1 + 0.05, C.dark),
        box(-7.4, -6.8, 1.2, 1.9, Mi.z1, Mi.z1 + 0.05, C.dark),
      ),
    ),
  );
  const Wh = P.wheel;
  const wr: P3[] = [];
  for (let i = 0; i <= 16; i++) {
    const aw = (i / 16) * 2 * Math.PI;
    wr.push([
      Wh.x - Wh.w,
      Wh.y + Math.cos(aw) * Wh.r,
      Wh.z + Math.sin(aw) * Wh.r,
    ]);
  }
  add(
    Wh.x,
    Wh.z + 2.5,
    `<polygon points="${ptsStr(wr)}" fill="none" stroke="${shade(C.wood, 0.8)}" stroke-width=".26"/>`,
  );
  const Bn = P.barn;
  add(
    (Bn.x0 + Bn.x1) / 2,
    (Bn.z0 + Bn.z1) / 2,
    faces(
      box(Bn.x0, Bn.x1, 0, Bn.h, Bn.z0, Bn.z1, C.wall).concat(
        roof(Bn, C.roof2),
        box(8.5, 9.3, 0, 1.2, Bn.z1, Bn.z1 + 0.05, C.dark),
      ),
    ),
  );
  const F = P.fountain;
  add(
    F.x,
    F.z,
    faces(
      prism(F.x, F.z, 1.0, 0, 0.38, 12, C.stone, C.water).concat(
        prism(F.x, F.z, 0.18, 0.38, 1.1, 6, C.stone),
        prism(F.x, F.z, 0.45, 1.1, 1.22, 8, C.stone, C.water),
      ),
    ),
  );
  const LK = P.lookout;
  const hs = LK.s / 2;
  add(
    LK.x,
    LK.z,
    faces(
      box(LK.x - hs, LK.x + hs, 0, LK.h, LK.z - hs, LK.z + hs, C.stone).concat(
        box(
          LK.x + hs - 0.12,
          LK.x + hs,
          LK.h,
          LK.h + 0.8,
          LK.z - hs,
          LK.z + hs,
          C.wood,
        ),
        box(
          LK.x - hs,
          LK.x + hs,
          LK.h,
          LK.h + 0.8,
          LK.z - hs,
          LK.z - hs + 0.12,
          C.wood,
        ),
      ),
    ),
  );
  for (const t of TREES) {
    const trunk = prism(
      t.x,
      t.z,
      0.13 * t.s,
      0,
      (t.kind ? 0.5 : 0.9) * t.s,
      5,
      C.trunk,
    );
    const crown = t.kind
      ? cone(t.x, t.z, 0.75 * t.s, 0.4 * t.s, 2.6 * t.s, 7, C.conifer)
      : blob(t.x, 1.75 * t.s, t.z, 0.95 * t.s, 0.9, C.tree);
    add(t.x, t.z, faces(trunk) + faces(crown));
  }
  const O = P.oak;
  add(
    O.x,
    O.z,
    faces(prism(O.x, O.z, 0.32, 0, O.h, 6, C.trunk)) +
      faces(
        blob(O.x - 0.5, O.h + 0.9, O.z, O.r * 0.8, 0.85, C.tree).concat(
          blob(O.x + 0.7, O.h + 0.7, O.z + 0.3, O.r * 0.75, 0.85, C.tree),
          blob(O.x, O.h + 1.4, O.z - 0.4, O.r * 0.8, 0.85, C.tree),
        ),
      ),
  );
  const PO = P.poster;
  if (S.poster > 0.5) {
    add(
      PO.x,
      PO.z,
      faces(
        box(
          PO.x - 0.06,
          PO.x + 0.06,
          0,
          1.0,
          PO.z - 0.06,
          PO.z + 0.06,
          C.wood,
        ).concat(
          box(
            PO.x - 0.5,
            PO.x + 0.5,
            0.9,
            2.1,
            PO.z + 0.06,
            PO.z + 0.12,
            "#ffffff",
          ),
        ),
      ),
    );
  }
  const bigOver = view === "over" ? 1.9 : 1.25;
  let figHead: P2 | null = null;
  if (fg) {
    const hgt = 0.62 * bigOver;
    const wp = pr(fg.x, 0, fg.z);
    const wh = pr(fg.x, hgt, fg.z);
    const col = fg.who === "maker" ? C.route : C.ink;
    figHead = pr(fg.x, hgt + 0.25, fg.z, false);
    add(
      fg.x,
      fg.z,
      `<line x1="${wp[0].toFixed(2)}" y1="${(wp[1] - 0.15).toFixed(2)}" x2="${wh[0].toFixed(2)}" y2="${(wh[1] + 0.3).toFixed(2)}" stroke="${col}" stroke-width="${(0.2 * bigOver).toFixed(2)}" stroke-linecap="round"/><circle cx="${wh[0].toFixed(2)}" cy="${wh[1].toFixed(2)}" r="${(0.09 * bigOver).toFixed(2)}" fill="${C.paper}" stroke="${C.ink}" stroke-width=".05"/>`,
    );
  }
  objs.sort((a, b) => a.d - b.d).forEach((o) => out.push(o.s));
  const labels: {
    x: number;
    y: number;
    n: string;
    t: string;
    who?: "maker" | "visitor";
  }[] = [];
  STATIONS.forEach((st, k) => {
    if ((S.pins[k] ?? 0) < 0.5) return;
    const x = st.pin[0];
    const z = st.pin[1];
    const g = pr(x, 0, z);
    const hd = pr(x, P.pinH, z);
    const tip = pr(x, P.pinH - 0.85, z);
    out.push(
      `<ellipse cx="${g[0].toFixed(2)}" cy="${g[1].toFixed(2)}" rx=".42" ry="${(0.42 * se).toFixed(2)}" fill="rgba(42,40,36,.22)"/>`,
    );
    out.push(
      `<line x1="${g[0].toFixed(2)}" y1="${g[1].toFixed(2)}" x2="${tip[0].toFixed(2)}" y2="${tip[1].toFixed(2)}" stroke="${C.ink}" stroke-width=".07"/>`,
    );
    out.push(
      `<path d="M${tip[0].toFixed(2)} ${tip[1].toFixed(2)} L${(hd[0] - 0.5).toFixed(2)} ${(hd[1] + 0.28).toFixed(2)} L${(hd[0] + 0.5).toFixed(2)} ${(hd[1] + 0.28).toFixed(2)} Z" fill="${shade(C.route, 0.85)}"/>`,
    );
    out.push(
      `<circle cx="${hd[0].toFixed(2)}" cy="${hd[1].toFixed(2)}" r=".6" fill="${C.route}"/><circle cx="${(hd[0] - 0.06).toFixed(2)}" cy="${(hd[1] - 0.05).toFixed(2)}" r=".23" fill="#fff"/>`,
    );
    labels.push({ x: hd[0], y: hd[1] - 0.75, n: String(st.n), t: st.name });
  });
  if (S.poster > 0.5) {
    const pt = pr(PO.x, 2.4, PO.z);
    labels.push({ x: pt[0], y: pt[1] - 0.2, n: "", t: "Start: the code" });
  }
  if (fg && figHead) {
    labels.push({
      x: figHead[0],
      y: figHead[1] - 0.1,
      n: "",
      t: fg.who === "maker" ? "You" : "A visitor",
      who: fg.who,
    });
  }

  // fit: the overview fits everything drawn; a close view fits its region into the space left of the phone
  let vb: [number, number, number, number];
  let s: number;
  if (view === "over") {
    const pad = 1.2;
    const padTop = 2.4;
    const v0: [number, number, number, number] = [
      minX - pad,
      minY - padTop,
      maxX - minX + 2 * pad,
      maxY - minY + pad + padTop,
    ];
    s = Math.min(ly.W / v0[2], ly.H / v0[3]);
    vb = [
      v0[0] - (ly.W / s - v0[2]) / 2,
      v0[1] - (ly.H / s - v0[3]) / 2,
      ly.W / s,
      ly.H / s,
    ];
  } else {
    let bx0 = 1e9;
    let by0 = 1e9;
    let bx1 = -1e9;
    let by1 = -1e9;
    for (const p of REGIONS[view]) {
      const q = pr(p[0], p[1], p[2], false);
      bx0 = Math.min(bx0, q[0]);
      bx1 = Math.max(bx1, q[0]);
      by0 = Math.min(by0, q[1]);
      by1 = Math.max(by1, q[1]);
    }
    const fr = closeRect(ly);
    const fw = fr.x1 - fr.x0;
    const fh = fr.y1 - fr.y0;
    const bw = bx1 - bx0;
    const bh = by1 - by0;
    s = Math.min(fw / bw, fh / bh);
    vb = [
      bx0 - (fr.x0 + (fw - bw * s) / 2) / s,
      by0 - (fr.y0 + (fh - bh * s) / 2) / s,
      ly.W / s,
      ly.H / s,
    ];
  }
  const fs = 12 / s;
  let lab = "";
  for (const l of labels) {
    const lx = (l.x - vb[0]) * s;
    const lyy = (l.y - vb[1]) * s;
    if (lx < 34 || lx > ly.W - 34 || lyy < 18 || lyy > ly.H - 4) continue;
    const w = (l.t.length * 0.5 + (l.n ? 1.9 : 1.2)) * fs;
    const h = 1.55 * fs;
    const x0 = l.x - w / 2;
    const y0 = l.y - h;
    const fill = l.n || l.who ? "rgba(251,248,239,.94)" : C.ink;
    const tcol = l.n || l.who ? (l.who === "maker" ? C.route : C.ink) : C.paper;
    const num = l.n
      ? `<circle cx="${(x0 + h / 2).toFixed(2)}" cy="${(y0 + h / 2).toFixed(2)}" r="${(h / 2 - 1.6 / s).toFixed(2)}" fill="${C.route}"/><text x="${(x0 + h / 2).toFixed(2)}" y="${(y0 + h / 2).toFixed(2)}" font-family="system-ui, sans-serif" font-weight="700" font-size="${(fs * 0.9).toFixed(2)}" fill="#fff" text-anchor="middle" dominant-baseline="central">${l.n}</text>`
      : "";
    lab +=
      `<g class="lf-lb" data-x="${l.x.toFixed(2)}" data-h="${h.toFixed(3)}" data-fs="${fs.toFixed(3)}" data-n="${l.n ? 1 : 0}">` +
      `<rect x="${x0.toFixed(2)}" y="${y0.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${(h / 2).toFixed(2)}" fill="${fill}" stroke="${l.who === "maker" ? C.route : C.ink}" stroke-width="${(1 / s).toFixed(3)}"/>` +
      num +
      `<text x="${(l.n ? x0 + h + 0.3 * fs : l.x).toFixed(2)}" y="${(y0 + h / 2).toFixed(2)}" font-family="${l.who ? "system-ui, sans-serif" : "Georgia, serif"}"${l.who ? "" : ' font-style="italic"'} font-weight="600" font-size="${fs.toFixed(2)}" fill="${tcol}"${l.n ? "" : ' text-anchor="middle"'} dominant-baseline="central" class="lf-nm">${l.t}</text></g>`;
  }
  const lead: readonly [number, number] | null =
    figHead && phoneOn && view !== "over"
      ? [(figHead[0] - vb[0]) * s, (figHead[1] - vb[1]) * s]
      : null;
  return {
    viewBox: vb.map((v) => v.toFixed(2)).join(" "),
    markup: out.join("") + lab,
    lead,
  };
}

/**
 * What a redraw depends on, coarsely: the view, which pins stand, the
 * code, where the person is (to a unit), the wedge, the phone, and the
 * route drawn to 1.5 units. Equal signatures draw the same picture.
 */
export function floorSignature(S: SceneState, phoneOn: boolean): string {
  const f = S.fig;
  return [
    S.view,
    S.pins.map((v) => (v > 0.5 ? 1 : 0)).join(""),
    S.poster > 0.5,
    f && f.k > 0.5 ? `${f.who}${Math.round(f.x)},${Math.round(f.z)}` : "-",
    S.wedge > 0.5,
    phoneOn,
    Math.floor(S.route / 1.5),
  ].join("|");
}
