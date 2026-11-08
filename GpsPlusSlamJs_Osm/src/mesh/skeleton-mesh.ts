/**
 * A skeleton roof as triangles: heights from `t`, a normal per face from its
 * plane, and no T-junction cracks.
 *
 * Simultaneous events leave corners a hair apart on a ridge, and a corner of
 * one face that ends on the middle of another face's edge (a T-junction).
 * Either shows as a pinhole of sky along the ridge. So the triangles are
 * STITCHED: corners within `WELD_M` become one corner, and a triangle with a
 * corner lying on one of its edges (within `ON_EDGE_M`) takes that corner in. The eave corners are
 * registered first and are never moved or merged with each other: they are
 * the wall tops, exactly.
 *
 * The roof's own surfaces (slopes and caps) are emitted first and the vertical
 * gables after them, so a caller can colour the first block as roof and the
 * rest as wall without looking at normals.
 *
 * @see skeleton-mesh.ts.md
 */

import type { MeshData } from "./mesh-data.js";
import { MeshBuilder } from "./mesh-data.js";
import type { SkeletonRoof } from "./roof-skeleton.js";
import {
  capTriangles,
  faceTriangles,
  SkeletonFailure,
} from "./roof-skeleton.js";

/**
 * Two corners nearer than this are one corner. Swept with `ON_EDGE_M` on 4,000
 * random stars (2026-11-08): from 1 to 4 mm no star failed both nudges, at
 * 6 mm 2 did; see `skeleton-mesh.ts.md`.
 */
const WELD_M = 0.003;
/** A corner this near a triangle's edge lies on that edge. */
const ON_EDGE_M = 0.002;
const NEIGHBOUR_CELLS = [-1, 0, 1] as const;

export interface SkeletonHeights {
  /** The height of `t = 0`, metres. */
  readonly eaveM: number;
  /** Metres of height per unit of `t`. */
  readonly slope: number;
}

export interface SkeletonMesh {
  readonly mesh: MeshData;
  /** The vertices `[0, surfaceVertices)` are slopes and caps; the rest are gables. */
  readonly surfaceVertices: number;
}

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A corner of the stitched roof; `pinned` corners are wall tops and never move. */
interface Corner extends Vec3 {
  readonly pinned: boolean;
}

interface Triangle {
  readonly a: Corner;
  readonly b: Corner;
  readonly c: Corner;
  /** The face's outward unit normal, in the builder's (east, up, north) frame. */
  readonly normal: Vec3;
  readonly surface: boolean;
}

/** The roof's triangles, stitched, in the builder's (east, up, north) frame. */
export function skeletonMesh(
  roof: SkeletonRoof,
  heights: SkeletonHeights,
): SkeletonMesh {
  const triangles = roofTriangles(roof, heights);
  const corners = new Corners();
  for (const t of triangles) {
    for (const p of [t.a, t.b, t.c]) if (p.pinned) corners.pin(p);
  }
  const welded = triangles.map((t) => ({
    ...t,
    a: corners.weld(t.a),
    b: corners.weld(t.b),
    c: corners.weld(t.c),
  }));
  const builder = new MeshBuilder();
  for (const t of welded) if (t.surface) emitStitched(builder, corners, t);
  const surfaceVertices = builder.vertexCount;
  for (const t of welded) if (!t.surface) emitStitched(builder, corners, t);
  const mesh = builder.build(0);
  assertClosed(mesh, heights.eaveM);
  return { mesh, surfaceVertices };
}

/**
 * Throws `SkeletonFailure` unless every edge above the eaves is shared by
 * exactly two triangles, wound against each other.
 *
 * Stitching closes the T-junctions and near-coincident events it can see; a
 * face with three corners on one line can still fold when its corners are
 * welded (about one roof in 4,000 random stars). The caller then tries the
 * next rung, so a fold never reaches the screen.
 */
function assertClosed(mesh: MeshData, eaveM: number): void {
  const { positions, indices } = mesh;
  const key = (i: number): string =>
    `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
  // The positions are float32 and `eaveM` a float64, so the eave is compared
  // as float32 too: rounded up by more than the 1e-6 (from |eave| >= 32 m),
  // every eave vertex read as raised and no roof up there closed.
  const eave = Math.fround(eaveM);
  const raised = (i: number): boolean =>
    (positions[i * 3 + 1] as number) > eave + 1e-6;
  const edges = new Map<string, { count: number; raised: boolean }>();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]] as number[];
    tri.forEach((p, k) => {
      const q = tri[(k + 1) % 3] as number;
      const id = `${key(p)}>${key(q)}`;
      const seen = edges.get(id);
      edges.set(id, {
        count: (seen?.count ?? 0) + 1,
        raised: raised(p) || raised(q),
      });
    });
  }
  for (const [id, edge] of edges) {
    const [from, to] = id.split(">");
    const open = edge.raised && !edges.has(`${to}>${from}`);
    if (edge.count > 1 || open) {
      throw new SkeletonFailure("the stitched roof is not closed");
    }
  }
}

function roofTriangles(
  roof: SkeletonRoof,
  heights: SkeletonHeights,
): Triangle[] {
  const out: Triangle[] = [];
  const lift = (p: { x: number; y: number; t: number }): Corner => ({
    x: p.x,
    y: heights.eaveM + p.t * heights.slope,
    z: p.y,
    pinned: p.t === 0,
  });
  for (const face of roof.faces) {
    const normal = face.vertical
      ? { x: -face.nx, y: 0, z: -face.ny }
      : unit({
          x: (-heights.slope * face.nx) / face.weight,
          y: 1,
          z: (-heights.slope * face.ny) / face.weight,
        });
    for (const [a, b, c] of faceTriangles(face)) {
      out.push({
        a: lift(a),
        b: lift(b),
        c: lift(c),
        normal,
        surface: !face.vertical,
      });
    }
  }
  const capT = roof.ridgeT;
  for (const cap of roof.caps) {
    for (const [a, b, c] of capTriangles(cap)) {
      out.push({
        a: lift({ ...a, t: capT }),
        b: lift({ ...b, t: capT }),
        c: lift({ ...c, t: capT }),
        normal: { x: 0, y: 1, z: 0 },
        surface: true,
      });
    }
  }
  return out;
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

const gap = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The registered corners, bucketed by `WELD_M` cells for the weld lookup. */
class Corners {
  readonly all: Corner[] = [];
  private readonly cells = new Map<number, Corner[]>();

  /** Registers a wall-top corner as it is; equal ones are one. */
  pin(p: Corner): void {
    const known = this.near(p, 0);
    if (known === undefined) this.add(p);
  }

  /**
   * The registered corner within `WELD_M` of `p`, or `p`, now registered.
   * A raised corner never welds onto a wall top: near a sharp eave corner
   * the two faces' copies of one event would otherwise land one on the wall
   * top and one beside it, and the faces would no longer share an edge.
   */
  weld(p: Corner): Corner {
    if (p.pinned) return this.near(p, 0) ?? p;
    const known = this.near(p, WELD_M, false);
    if (known !== undefined) return known;
    this.add(p);
    return p;
  }

  private add(p: Corner): void {
    this.all.push(p);
    const key = cellKey(cellOf(p.x), cellOf(p.y), cellOf(p.z));
    const list = this.cells.get(key);
    if (list === undefined) this.cells.set(key, [p]);
    else list.push(p);
  }

  /** The nearest registered corner within `reach` (0: an exact match). */
  private near(p: Vec3, reach: number, pinned = true): Corner | undefined {
    let best: Corner | undefined;
    let bestGap = reach;
    this.forAround(p, (q) => {
      if (q.pinned && !pinned) return;
      const d = gap(p, q);
      if (d < bestGap || (d === 0 && best === undefined)) {
        best = q;
        bestGap = d;
      }
    });
    return best;
  }

  /**
   * Visits the registered corners in the 27 cells around `p`. Numeric cell
   * keys and no intermediate arrays: this is the stitch's hot path (string
   * keys here were about half of all roof time, measured 2026-11-08).
   */
  private forAround(p: Vec3, visit: (q: Corner) => void): void {
    const cx = cellOf(p.x);
    const cy = cellOf(p.y);
    const cz = cellOf(p.z);
    for (const dx of NEIGHBOUR_CELLS) {
      for (const dy of NEIGHBOUR_CELLS) {
        for (const dz of NEIGHBOUR_CELLS) {
          this.cells.get(cellKey(cx + dx, cy + dy, cz + dz))?.forEach(visit);
        }
      }
    }
  }
}

function cellOf(v: number): number {
  return Math.floor(v / WELD_M);
}

/**
 * One number per cell. Two cells may share a key; that only adds candidates,
 * which the distance check then rejects, so a collision is never a wrong weld.
 */
function cellKey(x: number, y: number, z: number): number {
  return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;
}

/** True when `p` lies strictly inside edge a-b, within `ON_EDGE_M` of it. */
function onEdge(p: Vec3, a: Vec3, b: Vec3): boolean {
  const length = gap(a, b);
  if (length === 0) return false;
  const along =
    ((p.x - a.x) * (b.x - a.x) +
      (p.y - a.y) * (b.y - a.y) +
      (p.z - a.z) * (b.z - a.z)) /
    length;
  if (along <= WELD_M || along >= length - WELD_M) return false;
  const k = along / length;
  const q = {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
  };
  return gap(p, q) < ON_EDGE_M;
}

/** True when `p` is outside the box around `t`, grown by `ON_EDGE_M`. */
function outsideBox(p: Vec3, t: Triangle): boolean {
  const m = ON_EDGE_M;
  const { a, b, c } = t;
  return (
    p.x < Math.min(a.x, b.x, c.x) - m ||
    p.x > Math.max(a.x, b.x, c.x) + m ||
    p.y < Math.min(a.y, b.y, c.y) - m ||
    p.y > Math.max(a.y, b.y, c.y) + m ||
    p.z < Math.min(a.z, b.z, c.z) - m ||
    p.z > Math.max(a.z, b.z, c.z) + m
  );
}

/** The registered corners strictly inside edge `a`-`b`, from `a` to `b`. */
function cornersOn(
  corners: Corners,
  t: Triangle,
  a: Corner,
  b: Corner,
): Corner[] {
  return corners.all
    .filter((p) => !outsideBox(p, t) && onEdge(p, a, b))
    .map((p) => ({ p, along: gap(a, p) }))
    .sort((x, y) => x.along - y.along)
    .map(({ p }) => p);
}

/**
 * Emits a triangle, with every corner that sits on one of its edges made a
 * corner of the mesh too.
 *
 * In ONE pass, not by splitting recursively: two corners a few millimetres
 * apart and each within `ON_EDGE_M` of the line through the other can each
 * lie on an edge of the other's half, and a recursive split then never ends.
 * Here the triangle becomes the polygon of its corners and the corners on its
 * edges, fanned from its centre, so every polygon edge belongs to exactly one
 * new triangle and the neighbour across it sees the same corners.
 */
function emitStitched(
  builder: MeshBuilder,
  corners: Corners,
  t: Triangle,
): void {
  const { a, b, c } = t;
  if (gap(a, b) === 0 || gap(b, c) === 0 || gap(c, a) === 0) return;
  const ring = withoutSpikes([
    a,
    ...cornersOn(corners, t, a, b),
    b,
    ...cornersOn(corners, t, b, c),
    c,
    ...cornersOn(corners, t, c, a),
  ]);
  if (ring.length < 3) return;
  if (ring.length === 3) {
    emit(builder, {
      ...t,
      a: ring[0] as Corner,
      b: ring[1] as Corner,
      c: ring[2] as Corner,
    });
    return;
  }
  const centre: Corner = {
    x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
    y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length,
    z: ring.reduce((sum, p) => sum + p.z, 0) / ring.length,
    pinned: false,
  };
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length] as Corner;
    emit(builder, { ...t, a: centre, b: p, c: q });
  });
}

/**
 * The ring with every out-and-back spike `x, p, x` cut to `x`.
 *
 * A corner a few millimetres from a triangle corner, inside the angle there,
 * lies on both edges that meet at it; the ring then runs out to the triangle
 * corner and back. The sliver between the two runs has no area, and the
 * neighbours across those two edges carry its two edges in opposite
 * directions, so they close it between themselves. A sliver triangle whose
 * corner lies on its opposite edge reduces to two corners and is dropped.
 */
function withoutSpikes(ring: Corner[]): Corner[] {
  const out = [...ring];
  let i = 0;
  while (out.length >= 3 && i < out.length) {
    const before = out[(i + out.length - 1) % out.length];
    const after = out[(i + 1) % out.length];
    if (before === after) {
      const drop = [i, (i + 1) % out.length].sort((x, y) => y - x);
      for (const k of drop) out.splice(k, 1);
      i = 0;
    } else i++;
  }
  return out;
}

/** Appends one triangle, wound so its geometric normal agrees with the face's. */
function emit(builder: MeshBuilder, t: Triangle): void {
  const { a, normal: n } = t;
  const ux = t.b.x - a.x;
  const uy = t.b.y - a.y;
  const uz = t.b.z - a.z;
  const vx = t.c.x - a.x;
  const vy = t.c.y - a.y;
  const vz = t.c.z - a.z;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  const [b, c] = cx * n.x + cy * n.y + cz * n.z >= 0 ? [t.b, t.c] : [t.c, t.b];
  builder.triangle(
    builder.vertex(a.x, a.y, a.z, n.x, n.y, n.z),
    builder.vertex(b.x, b.y, b.z, n.x, n.y, n.z),
    builder.vertex(c.x, c.y, c.z, n.x, n.y, n.z),
  );
}
