/**
 * Footprint + heights → a triangle mesh, as plain typed arrays.
 *
 * WHY TYPED ARRAYS AND NOT THREE.JS OBJECTS. The plan forbids this package from
 * depending on `three` (§4.2) — it is pure data, consumable from Node, from a
 * Worker and from the Investigation harness. So the output is exactly what a
 * `BufferGeometry` wants and nothing more: `Float32Array` positions and
 * normals, `Uint32Array` indices. The consumer app does the three lines that
 * turn those into a mesh, and owns the `new Worker(...)` call — the same split
 * the framework already uses for the occupancy mesher.
 *
 * `Float32Array` also means the result **transfers** across a worker boundary
 * rather than being copied, which §4.2 asks for explicitly and which matters at
 * building counts.
 *
 * WHY THE MESH IS IN LOCAL METRES. See `enu.ts`: degrees are anisotropic (~36 %
 * at 50.8° N) and Mercator metres are 58 % too long there. Both errors are
 * smooth and plausible, which is what makes them expensive to find.
 *
 * @see extrude.ts.md
 */

import type { EnuPoint } from "./enu.js";
import { isCounterClockwise } from "./enu.js";
import { triangulate } from "./triangulate.js";
import type { RoofShape } from "./building-heights.js";
import type { MeshData } from "./mesh-data.js";
import { MeshBuilder } from "./mesh-data.js";
import { buildRoof } from "./roof.js";

export interface ExtrudeOptions {
  /** Where the walls start, metres above the frame's ground plane. */
  readonly minHeightM: number;
  /** Where the walls stop and the roof begins. */
  readonly eaveHeightM: number;
  /** The very top. Equals `eaveHeightM` for a flat roof. */
  readonly totalHeightM: number;
  readonly roofShape: RoofShape;
  /** Ground elevation to offset the whole volume by. */
  readonly groundHeightM?: number;
  /**
   * Emit the underside.
   *
   * Off by default: a building's floor is never visible and doubles the cap
   * triangle count. On for a `building:part` that floats (`min_height > 0`),
   * where the underside genuinely is visible from below.
   */
  readonly includeFloor?: boolean;
}

/**
 * A building's buffers plus the one thing about them that is not geometry.
 *
 * `roof.ts` computes `isApproximate` carefully and its docstring promises a
 * consumer "that wants to know how much of what it draws is real can ask" — but
 * `extrudeBuilding` used to return a bare `MeshData`, so nothing could. The
 * demo substituted `roofShape === 'gabled' || roofShape === 'hipped'`, which is
 * a DIFFERENT claim: a gabled roof on an actual rectangle is exact, and that is
 * the common case the whole approximation trade rests on. The counter that
 * exists to check the census against real data was measuring something else.
 *
 * Extending `MeshData` rather than wrapping it keeps every existing consumer —
 * `mergeMeshes` included — working unchanged.
 */
export interface ExtrudedBuilding extends MeshData {
  /** True when the ROOF was approximated rather than generated exactly. */
  readonly roofIsApproximate: boolean;
}

/** An empty mesh, used for footprints that cannot form a volume. */
const EMPTY: ExtrudedBuilding = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  indices: new Uint32Array(0),
  triangleCount: 0,
  forcedEars: 0,
  roofIsApproximate: false,
};

/**
 * Extrudes a footprint into walls plus a roof.
 *
 * `rings[0]` is the outer ring; the rest are holes (courtyards). Returns an
 * empty mesh rather than throwing for input that cannot form a volume — a
 * degenerate building must cost itself and nothing else.
 */
export function extrudeBuilding(
  rings: readonly (readonly EnuPoint[])[],
  options: ExtrudeOptions,
): ExtrudedBuilding {
  const ground = options.groundHeightM ?? 0;
  const base = ground + options.minHeightM;
  const eave = ground + options.eaveHeightM;

  const cap = triangulate(rings);
  if (cap.indices.length === 0) return EMPTY;

  const builder = new MeshBuilder();

  // WALLS. Every ring contributes walls, holes included — a courtyard has
  // inner-facing walls, and omitting them leaves a building you can see through
  // from inside the yard.
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    if (ring === undefined) continue;
    // Outer rings face outward, holes face inward. Getting this wrong makes a
    // courtyard invisible under backface culling while looking fine in tests.
    addWalls(builder, ring, base, eave, r === 0);
  }

  // ROOF, from the eaves up. `flat` closes at the eave height.
  const roof = buildRoof(rings, cap, {
    shape: options.roofShape,
    eaveHeightM: eave,
    ridgeHeightM: ground + options.totalHeightM,
  });
  builder.append(roof);

  if (options.includeFloor === true || options.minHeightM > 0) {
    // A floating part's underside IS visible from the street below, which is
    // exactly the case `building:part` + `min_height` creates.
    addCap(builder, cap, base, false);
  }

  return {
    ...builder.build(cap.forcedEars + roof.forcedEars),
    roofIsApproximate: roof.isApproximate,
  };
}

/** Adds the quad strip for one ring between two heights. */
function addWalls(
  builder: MeshBuilder,
  ring: readonly EnuPoint[],
  bottomM: number,
  topM: number,
  outward: boolean,
): void {
  if (topM <= bottomM) return;

  const points = closedRing(ring);
  if (points.length < 3) return;

  // Normalise winding so the emitted quads face consistently, then flip for
  // holes. Real OSM rings arrive both ways round.
  const ccw = isCounterClockwise(points);
  const ordered = ccw === outward ? points : [...points].reverse();

  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    if (a === undefined || b === undefined) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue; // repeated node: a zero-area wall
    // Outward normal of a CCW ring is (dy, -dx) normalised, with Y up in 3D.
    const nx = dy / length;
    const nz = -dx / length;

    const i0 = builder.vertex(a.x, bottomM, a.y, nx, 0, nz);
    const i1 = builder.vertex(b.x, bottomM, b.y, nx, 0, nz);
    const i2 = builder.vertex(b.x, topM, b.y, nx, 0, nz);
    const i3 = builder.vertex(a.x, topM, a.y, nx, 0, nz);
    // REVERSED, for the same reason `addCap` reverses: everything in this file
    // works in the ENU frame — a counter-clockwise ring in (east, north) reads
    // as clockwise once Y is up — so the straightforward (i0, i1, i2) would
    // wind these quads INWARD while the normal above points outward, leaving
    // the wall lit correctly and culled backwards. `side: DoubleSide` in the
    // demo hides that, which is exactly why it needs a test rather than a look.
    //
    // This is NOT the ENU→render reflection; `MeshBuilder` owns that and
    // applies it to every vertex and every triangle centrally. This ordering is
    // about the ring's own winding and would be needed either way.
    builder.triangle(i0, i2, i1);
    builder.triangle(i0, i3, i2);
  }
}

/** Adds a horizontal cap at `heightM`. `up` chooses which way it faces. */
function addCap(
  builder: MeshBuilder,
  cap: ReturnType<typeof triangulate>,
  heightM: number,
  up: boolean,
): void {
  const ny = up ? 1 : -1;
  const base = cap.vertices.map((p) =>
    builder.vertex(p.x, heightM, p.y, 0, ny, 0),
  );
  for (let i = 0; i + 2 < cap.indices.length; i += 3) {
    const a = base[cap.indices[i] as number];
    const b = base[cap.indices[i + 1] as number];
    const c = base[cap.indices[i + 2] as number];
    if (a === undefined || b === undefined || c === undefined) continue;
    // The triangulator emits counter-clockwise triangles in the XY plane; seen
    // from above with Y up that is already front-facing, so a downward cap
    // reverses.
    if (up) builder.triangle(a, c, b);
    else builder.triangle(a, b, c);
  }
}

/** Appends the first point if the ring is not already closed. */
function closedRing(ring: readonly EnuPoint[]): EnuPoint[] {
  const points = [...ring];
  const first = points[0];
  const last = points[points.length - 1];
  if (
    points.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first.x === last.x &&
    first.y === last.y
  ) {
    points.pop();
  }
  return points;
}

/**
 * Merges meshes into one buffer.
 *
 * Batching matters more than it looks: one draw call per building is what makes
 * a city block unrenderable on a phone. **Batch per res-8 or res-9 cell, never
 * per fetch tile** — a fetch tile is res 7 (2.81 km across), and one merged
 * geometry spanning 2.8 km defeats frustum culling entirely, since the batch is
 * only ever wholly visible or wholly not. The fetch resolution and the render
 * batch resolution are different concerns.
 */
export function mergeMeshes(meshes: readonly MeshData[]): MeshData {
  const builder = new MeshBuilder();
  let forcedEars = 0;
  for (const mesh of meshes) {
    builder.append(mesh);
    forcedEars += mesh.forcedEars;
  }
  return builder.build(forcedEars);
}
