/**
 * An inferred roof as a thin sheet with an overhang, in the mesh frame (east,
 * up, minus north). The overhang and the sheet's edge are what a box lacks at
 * street level, and a thin edge is how a card model reads. Pure buffers.
 *
 * @see v3-roof-shell.js.md
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossOf = (u, v) => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

/** Collects flat polygons, wound to face `outward`, with one flag each. */
function polygonSink() {
  const positions = [];
  const normals = [];
  const indices = [];
  const roofFlags = [];
  const unitNormal = (points, outward) => {
    const [a, b, c] = points;
    const n = crossOf(sub(b, a), sub(c, a));
    const length = Math.sqrt(dot(n, n));
    const sign = dot(n, outward) < 0 ? -1 : 1;
    return n.map((v) => (v / length) * sign);
  };
  return {
    /** `points` is a convex flat loop of 3 or 4 corners. */
    add(points, outward, flag = 1) {
      const normal = unitNormal(points, outward);
      const start = positions.length / 3;
      for (const point of points) {
        positions.push(...point);
        normals.push(...normal);
        roofFlags.push(flag);
      }
      const [a, b, c] = points;
      const wound = dot(crossOf(sub(b, a), sub(c, a)), normal) > 0;
      for (let i = 1; i + 1 < points.length; i++) {
        const [p, q] = wound ? [i, i + 1] : [i + 1, i];
        indices.push(start, start + p, start + q);
      }
    },
    build: () => ({
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      roofFlags,
      triangleCount: indices.length / 3,
      forcedEars: 0,
    }),
  };
}

/** Maps (along, across, up) in box units to the mesh frame, and directions. */
function boxFrame({ centre, axis, cross }) {
  const at = (along, across, y) => [
    centre.x + axis.x * along + cross.x * across,
    y,
    -(centre.y + axis.y * along + cross.y * across),
  ];
  const dir = (along, across, up) => [
    axis.x * along + cross.x * across,
    up,
    -(axis.y * along + cross.y * across),
  ];
  return { at, dir };
}

function gabledSheet(sink, { at, dir }, g) {
  const { outerL, outerW, halfLength, halfWidth, eaveY, topAt, t } = g;
  const edge = topAt(outerW);
  const ridge = topAt(0);
  for (const side of [-1, 1]) {
    const sheet = (lift, normal) =>
      sink.add(
        [
          at(-outerL, side * outerW, edge + lift),
          at(outerL, side * outerW, edge + lift),
          at(outerL, 0, ridge + lift),
          at(-outerL, 0, ridge + lift),
        ],
        normal,
      );
    sheet(0, dir(0, side * 0.3, 1));
    sheet(-t, dir(0, -side * 0.3, -1));
    sink.add(
      [
        at(-outerL, side * outerW, edge),
        at(outerL, side * outerW, edge),
        at(outerL, side * outerW, edge - t),
        at(-outerL, side * outerW, edge - t),
      ],
      dir(0, side, 0),
    );
    // The chevron's edge at both ends of this slope.
    for (const end of [-1, 1]) {
      sink.add(
        [
          at(end * outerL, side * outerW, edge),
          at(end * outerL, 0, ridge),
          at(end * outerL, 0, ridge - t),
          at(end * outerL, side * outerW, edge - t),
        ],
        dir(end, 0, 0),
      );
    }
  }
  for (const end of [-1, 1]) {
    sink.add(
      [
        at(end * halfLength, -halfWidth, eaveY),
        at(end * halfLength, halfWidth, eaveY),
        at(end * halfLength, 0, ridge - t),
      ],
      dir(end, 0, 0),
      0,
    );
  }
}

function hippedSheet(sink, { at, dir }, g) {
  const { outerL, outerW, halfLength, halfWidth, topAt, t } = g;
  const ridgeHalf = Math.max(0, halfLength - halfWidth);
  const edge = topAt(outerW);
  const ridge = topAt(0);
  for (const [lift, sign] of [
    [0, 1],
    [-t, -1],
  ]) {
    for (const side of [-1, 1]) {
      const crest =
        ridgeHalf > 0
          ? [at(ridgeHalf, 0, ridge + lift), at(-ridgeHalf, 0, ridge + lift)]
          : [at(0, 0, ridge + lift)];
      sink.add(
        [
          at(-outerL, side * outerW, edge + lift),
          at(outerL, side * outerW, edge + lift),
          ...crest,
        ],
        dir(0, side * 0.3 * sign, sign),
      );
      sink.add(
        [
          at(side * outerL, -outerW, edge + lift),
          at(side * outerL, outerW, edge + lift),
          at(side * ridgeHalf, 0, ridge + lift),
        ],
        dir(side * 0.3 * sign, 0, sign),
      );
    }
  }
  for (const side of [-1, 1]) {
    sink.add(
      [
        at(-outerL, side * outerW, edge),
        at(outerL, side * outerW, edge),
        at(outerL, side * outerW, edge - t),
        at(-outerL, side * outerW, edge - t),
      ],
      dir(0, side, 0),
    );
    sink.add(
      [
        at(side * outerL, -outerW, edge),
        at(side * outerL, outerW, edge),
        at(side * outerL, outerW, edge - t),
        at(side * outerL, -outerW, edge - t),
      ],
      dir(side, 0, 0),
    );
  }
}

/**
 * A roof sheet over `box` (see `fitRectangle`): buffers shaped like the
 * library's `MeshData`, plus `roofFlags`, 1 per vertex of the sheet and 0 of a
 * gable wall. The sheet's top reaches `eaveY + riseM`; its underside meets the
 * wall line at `eaveY`, so the walls end inside it.
 */
export function roofShell({ box, shape, eaveY, riseM, overhangM, thicknessM }) {
  const { halfLength, halfWidth } = box;
  const t = thicknessM;
  const slope = (riseM - t) / halfWidth;
  const geometry = {
    halfLength,
    halfWidth,
    eaveY,
    t,
    outerL: halfLength + overhangM,
    outerW: halfWidth + overhangM,
    topAt: (across) => eaveY + riseM - slope * across,
  };
  const sink = polygonSink();
  const frame = boxFrame(box);
  if (shape === "hipped") hippedSheet(sink, frame, geometry);
  else gabledSheet(sink, frame, geometry);
  return sink.build();
}
