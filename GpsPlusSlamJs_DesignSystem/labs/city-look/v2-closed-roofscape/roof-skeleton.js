/**
 * A roof over any footprint: a weighted straight skeleton by wavefront
 * simulation, with holes. Every wall line moves inwards at its own weight;
 * the surface it sweeps is its roof plane. Weight 1 is a slope, weight 0 stays
 * put and sweeps a vertical gable. Pure, no three.js.
 *
 * Brute force on purpose: the next event is searched afresh every step, which
 * is O(n^3) at worst and fine for a house's few corners. A position is always
 * computed from the two lines that define it, so no error accumulates.
 *
 * @see roof-skeleton.js.md
 */

/** Two events this close in time are one event. */
const TIME_EPS = 1e-9;
/** A computed event may lie this far before now and still count. */
const PAST_EPS = 1e-7;
/** How far a hit may miss the end of a wall and still count. */
const SPAN_EPS = 1e-7;
/** Below this the two lines of a vertex are treated as parallel. */
const PARALLEL_EPS = 1e-11;
const MAX_STEPS_PER_WALL = 12;

/** Thrown for a footprint the simulation cannot finish. */
export class RoofFailure extends Error {}

/** Signed shoelace area, positive for counter-clockwise. */
export function ringArea(ring) {
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return twice / 2;
}

/** The outer ring counter-clockwise, holes clockwise: the inside on the left. */
export function orientRings(rings) {
  return rings.map((ring, index) => {
    const ccw = ringArea(ring) > 0;
    return ccw === (index === 0) ? ring : [...ring].reverse();
  });
}

function makeEdges(rings, weights) {
  const loops = [];
  rings.forEach((ring, r) => {
    const loop = [];
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) throw new RoofFailure("a zero-length wall");
      const nx = -dy / length;
      const ny = dx / length;
      loop.push({
        edge: {
          ring: r,
          at: i,
          dx: dx / length,
          dy: dy / length,
          nx,
          ny,
          c: nx * a.x + ny * a.y,
          w: weights?.[r]?.[i] ?? 1,
        },
        left: [{ x: a.x, y: a.y, t: 0 }],
        right: [{ x: b.x, y: b.y, t: 0 }],
      });
    });
    loops.push(loop);
  });
  return loops;
}

/** Where two offset wall lines cross at time `t`. */
function crossing(l, r, t) {
  const det = l.nx * r.ny - l.ny * r.nx;
  if (Math.abs(det) < PARALLEL_EPS) throw new RoofFailure("parallel walls");
  const cl = l.c + l.w * t;
  const cr = r.c + r.w * t;
  return {
    x: (cl * r.ny - cr * l.ny) / det,
    y: (l.nx * cr - r.nx * cl) / det,
    t,
  };
}

const prevIn = (loop, i) => loop[(i + loop.length - 1) % loop.length];
const nextIn = (loop, i) => loop[(i + 1) % loop.length];

/** The time this wall's stretch of wavefront shrinks to nothing, or null. */
function edgeCollapse(loop, i, now) {
  const { edge } = loop[i];
  const prev = prevIn(loop, i).edge;
  const next = nextIn(loop, i).edge;
  const span = (t) => {
    const a = crossing(prev, edge, t);
    const b = crossing(edge, next, t);
    return (b.x - a.x) * edge.dx + (b.y - a.y) * edge.dy;
  };
  const s0 = span(0);
  const rate = span(1) - s0;
  if (rate >= -1e-12) return null;
  const t = -s0 / rate;
  return t >= now - PAST_EPS ? Math.max(t, now) : null;
}

/** May this corner's walk end on `target`? Not on its own or next walls. */
function isCandidate(loop, i, target) {
  const l = i === 0 ? loop.length - 1 : i - 1;
  return (
    target !== loop[i] &&
    target !== loop[l] &&
    target !== nextIn(loop, i) &&
    target !== prevIn(loop, l)
  );
}

/** When and where a moving corner reaches wall `e`, or null. */
function reach(p0, vx, vy, e, now) {
  const denom = e.nx * vx + e.ny * vy - e.w;
  if (Math.abs(denom) < 1e-12) return null;
  const t = (e.c - e.nx * p0.x - e.ny * p0.y) / denom;
  if (t < now - PAST_EPS) return null;
  const hit = Math.max(t, now);
  // It has to arrive from the wall's inner side.
  const gap =
    e.nx * (p0.x + vx * now) + e.ny * (p0.y + vy * now) - e.c - e.w * now;
  if (gap < -1e-6) return null;
  return { t: hit, x: p0.x + vx * hit, y: p0.y + vy * hit };
}

/** The earliest wall this reflex corner runs into, or `best`. */
function cornerHit(loops, loopIndex, i, now, best) {
  const loop = loops[loopIndex];
  const l = prevIn(loop, i).edge;
  const r = loop[i].edge;
  if (l.dx * r.dy - l.dy * r.dx > -1e-9) return best;
  const p0 = crossing(l, r, 0);
  const p1 = crossing(l, r, 1);
  const vx = p1.x - p0.x;
  const vy = p1.y - p0.y;
  let found = best;
  loops.forEach((other, m) => {
    other.forEach((target, j) => {
      if (m === loopIndex && !isCandidate(loop, i, target)) return;
      const e = target.edge;
      const hit = reach(p0, vx, vy, e, now);
      if (!hit || (found && hit.t >= found.t - TIME_EPS)) return;
      const a = crossing(prevIn(other, j).edge, e, hit.t);
      const b = crossing(e, nextIn(other, j).edge, hit.t);
      if ((hit.x - a.x) * e.dx + (hit.y - a.y) * e.dy < -SPAN_EPS) return;
      if ((b.x - hit.x) * e.dx + (b.y - hit.y) * e.dy < -SPAN_EPS) return;
      found = { kind: "split", t: hit.t, loop: loopIndex, i, other: m, j };
    });
  });
  return found;
}

function nextEvent(loops, now) {
  let best = null;
  loops.forEach((loop, l) => {
    loop.forEach((_, i) => {
      const t = edgeCollapse(loop, i, now);
      if (t !== null && (!best || t < best.t)) {
        best = { kind: "edge", t, loop: l, i };
      }
    });
  });
  loops.forEach((loop, l) => {
    loop.forEach((_, i) => {
      best = cornerHit(loops, l, i, now, best);
    });
  });
  return best;
}

function closeItem(faces, item) {
  const points = [...item.left];
  for (let i = item.right.length - 1; i >= 0; i--) {
    const p = item.right[i];
    const last = points[points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 1e-9 || p.t !== last.t) {
      points.push(p);
    }
  }
  if (points.length < 3) return;
  const { edge } = item;
  faces.push({
    ring: edge.ring,
    at: edge.at,
    vertical: edge.w === 0,
    nx: edge.nx,
    ny: edge.ny,
    dx: edge.dx,
    dy: edge.dy,
    points,
  });
}

/** Closes a whole loop at `t`: every wall ends at its two corners of then. */
function closeLoop(faces, loop, t) {
  if (loop.length >= 3) {
    const corners = loop.map((item, i) =>
      crossing(prevIn(loop, i).edge, item.edge, t),
    );
    loop.forEach((item, i) => {
      item.left.push(corners[i]);
      item.right.push(corners[(i + 1) % loop.length]);
    });
  }
  for (const item of loop) closeItem(faces, item);
}

function applyEdge(faces, loops, event) {
  const loop = loops[event.loop];
  if (loop.length <= 3) {
    closeLoop(faces, loop, event.t);
    loops.splice(event.loop, 1);
    return;
  }
  const item = loop[event.i];
  const prev = prevIn(loop, event.i);
  const next = nextIn(loop, event.i);
  const a = crossing(prev.edge, item.edge, event.t);
  const b = crossing(item.edge, next.edge, event.t);
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: event.t };
  item.left.push(m);
  item.right.push(m);
  closeItem(faces, item);
  prev.right.push(m);
  next.left.push(m);
  loop.splice(event.i, 1);
}

const rotated = (list, from) => [...list.slice(from), ...list.slice(0, from)];

function applySplit(faces, loops, event) {
  const loop = loops[event.loop];
  const other = loops[event.other];
  const { t, i, j } = event;
  const l = prevIn(loop, i);
  const r = loop[i];
  const target = other[j];
  const q = crossing(l.edge, r.edge, t);
  const a = crossing(prevIn(other, j).edge, target.edge, t);
  const b = crossing(target.edge, nextIn(other, j).edge, t);
  l.right.push(q);
  r.left.push(q);
  // The hit wall ends here and goes on as two; its neighbours note the two
  // corners, so their faces carry the same vertices and no crack can open.
  prevIn(other, j).right.push(a);
  nextIn(other, j).left.push(b);
  target.left.push(a);
  target.right.push(b);
  closeItem(faces, target);
  const first = { edge: target.edge, left: [a], right: [q] };
  const second = { edge: target.edge, left: [q], right: [b] };

  const fromR = rotated(loop, i);
  if (event.loop === event.other) {
    const at = fromR.indexOf(target);
    const pieces = [
      [...fromR.slice(0, at), first],
      [second, ...fromR.slice(at + 1)],
    ];
    loops.splice(event.loop, 1);
    for (const piece of pieces) {
      if (piece.length >= 3) loops.push(piece);
      else closeLoop(faces, piece, t);
    }
    return;
  }
  const merged = [...fromR, second, ...rotated(other, j).slice(1), first];
  for (const index of [event.loop, event.other].sort((x, y) => y - x)) {
    loops.splice(index, 1);
  }
  loops.push(merged);
}

function contains(ring, p) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/** The loops left at the limit, as flat tops: `{ outer, holes }`. */
function capsFrom(loops, t) {
  const rings = loops.map((loop) =>
    loop.map((item, i) => crossing(prevIn(loop, i).edge, item.edge, t)),
  );
  const outers = rings.filter((ring) => ringArea(ring) > 0);
  const holes = rings.filter((ring) => ringArea(ring) < 0);
  return outers.map((outer) => ({
    outer,
    holes: holes.filter((hole) => contains(outer, hole[0])),
  }));
}

/**
 * `rings`: outer first, oriented by `orientRings`. Options: `weights`, one array
 * per ring, a wall's weight (default 1, 0 for a gable); `maxT`, where to stop
 * and close with a flat top. Returns `{ faces, caps, ridgeT }`. A face is one
 * wall's swept surface, its `points` carrying `t`, the time reached: height is
 * `eave + t * slope`. RoofFailure when the simulation cannot finish.
 */
export function roofSkeleton(rings, { weights, maxT = Infinity } = {}) {
  const loops = makeEdges(rings, weights);
  const wallCount = rings.reduce((sum, ring) => sum + ring.length, 0);
  const faces = [];
  let now = 0;
  for (let step = 0; loops.length > 0; step++) {
    if (step > wallCount * MAX_STEPS_PER_WALL) {
      throw new RoofFailure("no end in sight");
    }
    const event = nextEvent(loops, now);
    if (!event && maxT === Infinity) throw new RoofFailure("no event left");
    if (!event || event.t > maxT) {
      const caps = capsFrom(loops, maxT);
      for (const loop of loops) closeLoop(faces, loop, maxT);
      return { faces, caps, ridgeT: maxT };
    }
    now = event.t;
    if (event.kind === "edge") applyEdge(faces, loops, event);
    else applySplit(faces, loops, event);
  }
  return { faces, caps: [], ridgeT: now };
}

/** A face's triangles, as triples of its own points. */
export function triangulateFace(face, triangulate) {
  // Along the wall against height: the map keeps the polygon simple.
  const flat = face.points.map((p) => ({
    x: p.x * face.dx + p.y * face.dy,
    y: p.t,
  }));
  const ccw = ringArea(flat) > 0;
  const contour = ccw ? flat : [...flat].reverse();
  const points = ccw ? face.points : [...face.points].reverse();
  return triangulate(contour, []).map(([a, b, c]) => [
    points[a],
    points[b],
    points[c],
  ]);
}

/** A cap's triangles, as triples of `{ x, y }`. */
export function triangulateCap(cap, triangulate) {
  const all = [cap.outer, ...cap.holes].flat();
  return triangulate(cap.outer, cap.holes).map(([a, b, c]) => [
    all[a],
    all[b],
    all[c],
  ]);
}

const triangleArea = (a, b, c) =>
  Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;

/** The plan area the roof covers: its footprint's, if it is sound. */
export function planArea(roof, triangulate) {
  let area = 0;
  for (const face of roof.faces) {
    if (face.vertical) continue;
    for (const [a, b, c] of triangulateFace(face, triangulate)) {
      area += triangleArea(a, b, c);
    }
  }
  for (const cap of roof.caps) {
    for (const [a, b, c] of triangulateCap(cap, triangulate)) {
      area += triangleArea(a, b, c);
    }
  }
  return area;
}

/** True when any wall stayed vertical, so the roof has a gable. */
export function hasGable(roof) {
  return roof.faces.some((face) => face.vertical);
}

/**
 * The outer walls whose whole slope is one triangle resting on the wall itself:
 * the ends of a wing, the walls a gable belongs to. Their ring positions, sorted.
 */
export function triangularEnds(roof) {
  const ends = [];
  for (const face of roof.faces) {
    if (face.ring !== 0 || face.vertical) continue;
    if (face.points.length !== 3) continue;
    if (face.points.filter((p) => p.t === 0).length !== 2) continue;
    ends.push(face.at);
  }
  return ends.sort((a, b) => a - b);
}
