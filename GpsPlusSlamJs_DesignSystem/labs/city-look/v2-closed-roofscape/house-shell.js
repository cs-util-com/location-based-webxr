/**
 * A planned house as plain triangles: walls, gables and slopes, in render axes
 * (east, up, -north), every face wound outwards so one-sided materials work.
 * Pure: it appends to arrays and knows no three.js.
 *
 * @see house-shell.js.md
 */
import { triangulateCap, triangulateFace } from "./roof-skeleton.js";

/** A wall's foot, just under the ground disc, so no seam shows at its base. */
const WALL_FOOT_M = -0.2;

/** Two corners nearer than this are one corner. */
const WELD_M = 0.006;
/** A corner this near a triangle's edge lies on that edge. */
const ON_EDGE_M = 0.004;
const MAX_SPLITS = 12;

const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** How far along a-b the point `p` lies, if it lies strictly on that edge. */
function onEdge(p, a, b) {
  const length = gap(a, b);
  if (length === 0) return false;
  const along =
    ((p[0] - a[0]) * (b[0] - a[0]) +
      (p[1] - a[1]) * (b[1] - a[1]) +
      (p[2] - a[2]) * (b[2] - a[2])) /
    length;
  if (along <= WELD_M || along >= length - WELD_M) return false;
  const k = along / length;
  const q = [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
  return gap(p, q) < ON_EDGE_M;
}

/** Emits a triangle, split at every corner that sits on one of its edges. */
function emitSplit(out, corners, a, b, c, colour, depth) {
  if (gap(a, b) === 0 || gap(b, c) === 0 || gap(c, a) === 0) return;
  if (depth < MAX_SPLITS) {
    for (const p of corners) {
      if (onEdge(p, a, b)) {
        emitSplit(out, corners, a, p, c, colour, depth + 1);
        emitSplit(out, corners, p, b, c, colour, depth + 1);
        return;
      }
      if (onEdge(p, b, c)) {
        emitSplit(out, corners, a, b, p, colour, depth + 1);
        emitSplit(out, corners, a, p, c, colour, depth + 1);
        return;
      }
      if (onEdge(p, c, a)) {
        emitSplit(out, corners, a, b, p, colour, depth + 1);
        emitSplit(out, corners, p, b, c, colour, depth + 1);
        return;
      }
    }
  }
  for (const point of [a, b, c]) {
    out.positions.push(point[0], point[1], point[2]);
    out.colours.push(colour[0], colour[1], colour[2]);
  }
}

/**
 * One house's triangles without T-junctions: corners a hair apart become one,
 * and a long edge is split where a shorter one ends against it. Near-parallel
 * walls leave such corners on ridges, and each shows as a pinhole of sky.
 */
function stitch(local, out) {
  const corners = [];
  const weld = (p) => {
    const known = corners.find((q) => gap(p, q) < WELD_M);
    if (known) return known;
    corners.push(p);
    return p;
  };
  const triangles = [];
  for (let i = 0; i < local.positions.length; i += 9) {
    const at = (n) => local.positions.slice(i + n, i + n + 3);
    triangles.push({
      a: weld(at(0)),
      b: weld(at(3)),
      c: weld(at(6)),
      colour: local.colours.slice(i, i + 3),
    });
  }
  for (const { a, b, c, colour } of triangles) {
    emitSplit(out, corners, a, b, c, colour, 0);
  }
}

/** Appends one triangle, flipped if needed so its normal agrees with `want`. */
function triangle(sink, a, b, c, want, colour) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx === 0 && ny === 0 && nz === 0) return;
  const agrees = nx * want[0] + ny * want[1] + nz * want[2] >= 0;
  const ordered = agrees ? [a, b, c] : [a, c, b];
  for (const point of ordered) {
    sink.positions.push(point[0], point[1], point[2]);
    sink.colours.push(colour[0], colour[1], colour[2]);
  }
}

/**
 * The foot-to-eave walls. Inside is on a ring's left, so outwards is its right.
 * A vertical gable stands on its wall: it starts at the eave, the same line.
 */
function appendWalls(rings, eaveM, sink, colour) {
  for (const ring of rings) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const out = [b.y - a.y, 0, b.x - a.x];
      const a0 = [a.x, WALL_FOOT_M, -a.y];
      const b0 = [b.x, WALL_FOOT_M, -b.y];
      const a1 = [a.x, eaveM, -a.y];
      const b1 = [b.x, eaveM, -b.y];
      triangle(sink, a0, b0, b1, out, colour);
      triangle(sink, a0, b1, a1, out, colour);
    });
  }
}

/** The eave's underside: wall line to roof edge, facing the ground. */
function appendSoffits(plan, sink, colour) {
  const { rings, roofRings, eaveM } = plan;
  const lift = (p) => [p.x, eaveM, -p.y];
  rings.forEach((ring, r) => {
    const over = roofRings[r];
    if (over === ring) return;
    ring.forEach((a, i) => {
      const next = (i + 1) % ring.length;
      const b = ring[next];
      const down = [0, -1, 0];
      triangle(sink, lift(a), lift(b), lift(over[next]), down, colour);
      triangle(sink, lift(a), lift(over[next]), lift(over[i]), down, colour);
    });
  });
}

function appendRoof(plan, sink, { triangulate, rgb }) {
  const { roof, eaveM, tan } = plan;
  const wall = rgb(plan.colours.wall);
  const slope = rgb(plan.colours.roof);
  const at = (p) => [p.x, eaveM + p.t * tan, -p.y];
  for (const face of roof.faces) {
    const want = face.vertical ? [-face.nx, 0, face.ny] : [0, 1, 0];
    const colour = face.vertical ? wall : slope;
    for (const [a, b, c] of triangulateFace(face, triangulate)) {
      triangle(sink, at(a), at(b), at(c), want, colour);
    }
  }
  const topM = eaveM + roof.ridgeT * tan;
  for (const cap of roof.caps) {
    for (const [a, b, c] of triangulateCap(cap, triangulate)) {
      const lift = (p) => [p.x, topM, -p.y];
      triangle(sink, lift(a), lift(b), lift(c), [0, 1, 0], slope);
    }
  }
}

function appendLid(plan, sink, { triangulate, rgb }) {
  const colour = rgb(plan.colours.roof);
  const [outer, ...holes] = plan.rings;
  const lid = { outer, holes };
  for (const [a, b, c] of triangulateCap(lid, triangulate)) {
    const lift = (p) => [p.x, plan.eaveM, -p.y];
    triangle(sink, lift(a), lift(b), lift(c), [0, 1, 0], colour);
  }
}

/**
 * Appends `plan` to `sink` (`{ positions, colours }`, flat arrays).
 * `plan`: `{ rings, roofRings, roof, eaveM, tan, colours: { wall, roof } }`:
 * `roofRings` are the rings the roof stands on, past the walls by the eave and
 * corner for corner the same; `roof` null gives a flat lid at the eave. Tools: `triangulate(contour, holes)` and
 * `rgb(colour)` returning `[r, g, b]`.
 */
export function appendHouse(plan, sink, tools) {
  const local = { positions: [], colours: [] };
  appendWalls(plan.rings, plan.eaveM, local, tools.rgb(plan.colours.wall));
  appendSoffits(plan, local, tools.rgb(plan.colours.wall));
  if (plan.roof) appendRoof(plan, local, tools);
  else appendLid(plan, local, tools);
  stitch(local, sink);
}
