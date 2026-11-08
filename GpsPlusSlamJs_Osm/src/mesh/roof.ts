/**
 * Roof geometry for every tagged `roof:shape` this package draws.
 *
 * Flat, `pyramidal` / `dome` / `onion` (roofs of revolution) and `skillion`
 * are cheap parametric shapes. The ridged shapes, `gabled` / `hipped` /
 * `gambrel` / `round`, take one of two builders:
 *
 * - **A rectangle** (the footprint fills its oriented bounding rectangle to
 *   2 %, has no courtyard and overhangs it by at most `maxOverhangM`) gets the
 *   box roof: a ridge along the rectangle with the tagged cross-section. Exact,
 *   cheap, and the common case in the corpus.
 * - **Everything else** gets the straight skeleton of its real outline
 *   (`roof-skeleton.ts`), courtyards included: the roof surface every wall
 *   slopes up from at one pitch, so an L-shaped house gets the two ridges and
 *   the valley it actually has, and no roof stands over the street.
 *
 * A skeleton can fail on a ring it cannot settle, so it runs down a FALLBACK
 * LADDER and the result says which step drew it (`method`) and whether that is
 * an approximation of the tag (`isApproximate`):
 *
 * 1. the tagged shape (gabled: the wing ends chosen as vertical gables);
 * 2. a hipped skeleton (gabled only);
 * 3. both again with a different nudge of the corners;
 * 4. the box roof, if its overhang is within the limit; also taken over a
 *    gabled-family skeleton that found no gable end, so a tagged ridge
 *    direction the skeleton cannot place is still drawn;
 * 5. a flat-topped prism at full height, so the building keeps its tagged
 *    height and nothing stands outside its walls.
 *
 * A ring above `SKELETON_VERTEX_CAP` corners starts at step 4: the simulation
 * is O(n^3) and a round tower drawn with hundreds of nodes is a revolved roof's
 * job, not a skeleton's. And `buildRoof` never throws: anything unforeseen
 * becomes the prism, or a flat cap, for that one building.
 *
 * **Licence note, and it binds:** the skeleton here is our own. Do not bring in
 * the `straight-skeleton` package's v3 in production OR in the harness: its npm
 * package declares MIT while wrapping a GPL implementation, and reading GPL
 * source with intent to reimplement is a derivation this Apache-2.0 package
 * must not contain.
 *
 * @see roof.ts.md
 */

import type { EnuPoint } from "./enu.js";
import { isCounterClockwise } from "./enu.js";
import type { RoofShape } from "./building-heights.js";
import type { MeshData } from "./mesh-data.js";
import { MeshBuilder } from "./mesh-data.js";
import type { GableRule, SkeletonRoof } from "./roof-skeleton.js";
import { skeletonRoof } from "./roof-skeleton.js";
import { skeletonMesh } from "./skeleton-mesh.js";
import type { TriangulationResult } from "./triangulate.js";
import { dropClosingPoint } from "./triangulate.js";
import { addWalls } from "./walls.js";
import { containsPoint } from "../spatial/point-in-ring.js";

export interface RoofOptions {
  readonly shape: RoofShape;
  /** Height of the eaves — where the walls stop. */
  readonly eaveHeightM: number;
  /** Height of the ridge or apex. Equals the eaves for a flat roof. */
  readonly ridgeHeightM: number;
  /**
   * `roof:direction`: the way the slopes FACE, downhill, in degrees clockwise
   * from north. Sets a skillion's slope and puts a ridge at right angles to it.
   */
  readonly directionDeg?: number;
  /** `roof:orientation=across`: the ridge runs across the long side. */
  readonly orientation?: "across";
  /**
   * How far the bounding rectangle may reach beyond the footprint and still
   * carry the box roof: as the exact roof of a near-rectangle, and as step 4
   * of the fallback ladder. Defaults to `RIDGE_OVERHANG_LIMIT_M`.
   */
  readonly maxOverhangM?: number;
}

/**
 * The overhang above which the box roof is not used.
 *
 * Swept at 0.5, 1 and 2 m over the corpus (2026-11-07): see `roof.ts.md`. One
 * metre is inside OSM's own footprint error, so below it the rectangle's roof
 * is the better shape, and above it the roof visibly spans a courtyard or a
 * street.
 */
const RIDGE_OVERHANG_LIMIT_M = 1;

/**
 * The most corners (all rings together) a footprint may have for a skeleton
 * roof; above it the ladder starts at the box roof. 128 and 256 draw the test
 * corpus identically (no ridged footprint there has more than 128 corners);
 * 128 halves the worst case, a ring of irregular corners running every rung.
 * Swept in `roof.ts.md`.
 */
const SKELETON_VERTEX_CAP = 128;

/** Which builder drew a roof; see the fallback ladder in the file header. */
type RoofMethod =
  | "flat"
  | "revolved"
  | "skillion"
  | "box"
  | "skeleton"
  | "hipped-skeleton"
  | "box-fallback"
  | "prism";

export interface RoofMesh extends MeshData {
  /**
   * True when the roof is not the tagged shape over the real outline: a
   * gambrel or round roof drawn as a plain gabled skeleton, a gabled roof that
   * fell back to hipped or found no gable end, the box roof as a fallback, the
   * prism, and the flat cap of a roof that could not be built.
   *
   * Surfaced rather than hidden: a consumer that wants to know how much of what
   * it draws is real can ask.
   */
  readonly isApproximate: boolean;
  /** The builder that drew it. */
  readonly method: RoofMethod;
  /**
   * The vertices `[0, surfaceVertices)` are the roof's own surfaces (slopes,
   * caps, hips); the rest are vertical walls the roof brings with it (gables,
   * the prism's sides), which a consumer colours as wall.
   */
  readonly surfaceVertices: number;
}

/**
 * Builds the roof for a footprint. Never throws: a roof that cannot be built
 * becomes a full-height prism, or failing that a flat cap at the eaves.
 */
export function buildRoof(
  rings: readonly (readonly EnuPoint[])[],
  cap: TriangulationResult,
  options: RoofOptions,
): RoofMesh {
  try {
    return dispatchRoof(rings, cap, options);
  } catch {
    try {
      return prismRoof(rings, cap, options);
    } catch {
      return {
        ...allSurface(flatCap(cap, options.eaveHeightM)),
        isApproximate: true,
        method: "flat",
      };
    }
  }
}

function dispatchRoof(
  rings: readonly (readonly EnuPoint[])[],
  cap: TriangulationResult,
  options: RoofOptions,
): RoofMesh {
  const rise = options.ridgeHeightM - options.eaveHeightM;
  const outer = rings[0];

  // No rise, no shape, or nothing to work with: a flat cap at the eaves. This
  // is also the fallback for every unrecognised `roof:shape`, because a flat
  // roof at the right height is a far smaller error than a confident wrong one.
  if (!(rise > 0) || outer === undefined || options.shape === "flat") {
    return exact(flatCap(cap, options.eaveHeightM), "flat");
  }

  const profile = REVOLVED_PROFILES.get(options.shape);
  if (profile !== undefined) {
    return exact(revolvedRoof(outer, options, profile), "revolved");
  }

  switch (options.shape) {
    case "skillion":
      return exact(skillionRoof(rings, cap, options), "skillion");
    case "gabled":
    case "hipped":
    case "gambrel":
    case "round":
      return ridgeRoof(rings, cap, options);
    default:
      return exact(flatCap(cap, options.eaveHeightM), "flat");
  }
}

/** A mesh that is all roof surface. */
function allSurface(mesh: MeshData): MeshData & { surfaceVertices: number } {
  return { ...mesh, surfaceVertices: mesh.positions.length / 3 };
}

/** The exact roof of a shape whose every vertex is roof surface. */
function exact(mesh: MeshData, method: RoofMethod): RoofMesh {
  return { ...allSurface(mesh), isApproximate: false, method };
}

/** A horizontal cap at the eaves — the flat roof, and the universal fallback. */
function flatCap(cap: TriangulationResult, heightM: number): MeshData {
  const builder = new MeshBuilder();
  const base = cap.vertices.map((p) =>
    builder.vertex(p.x, heightM, p.y, 0, 1, 0),
  );
  for (let i = 0; i + 2 < cap.indices.length; i += 3) {
    const a = base[cap.indices[i] as number];
    const b = base[cap.indices[i + 1] as number];
    const c = base[cap.indices[i + 2] as number];
    if (a === undefined || b === undefined || c === undefined) continue;
    builder.triangle(a, c, b);
  }
  return builder.build(cap.forcedEars);
}

/**
 * One point of a roof profile: `scale` shrinks the footprint towards its
 * centroid (1 is the eave ring, 0 the apex), `rise` is the fraction of the
 * roof's height (0 at the eaves, 1 at the top).
 */
interface ProfilePoint {
  readonly scale: number;
  readonly rise: number;
}

/** A pyramid, and a cone: straight from the eaves to one apex. */
const PYRAMID_PROFILE: readonly ProfilePoint[] = [
  { scale: 1, rise: 0 },
  { scale: 0, rise: 1 },
];

/**
 * A quarter circle in six steps of 15 degrees. Six, because fewer leaves the
 * 30-degree ring out and the dome reads as a faceted cone from the street.
 * The top is an exact zero, so the last ring collapses into an apex.
 */
const DOME_PROFILE: readonly ProfilePoint[] = quarterCircle().map(
  ({ out, up }) => ({ scale: out, rise: up }),
);

/**
 * An onion: a bulb wider than its own base, narrowing into a point. The bulge
 * is what separates it from a cone and what the eye reads on the building.
 */
const ONION_PROFILE: readonly ProfilePoint[] = [
  { scale: 1, rise: 0 },
  { scale: 1.2, rise: 0.12 },
  { scale: 1.3, rise: 0.3 },
  { scale: 1.1, rise: 0.5 },
  { scale: 0.6, rise: 0.7 },
  { scale: 0.25, rise: 0.85 },
  { scale: 0, rise: 1 },
];

/**
 * The shapes drawn by `revolvedRoof`, by their profile.
 *
 * The dome is a real quarter circle, no longer a pyramid. The pyramid was
 * argued indistinguishable at walking distance under a shallow roof; on the
 * Frauenkirche and the Berliner Dom the dome IS the landmark, and half way up a
 * dome stands at 87 % of its radius where a pyramid is at 50 %.
 *
 * A map, not an object: `extrudeBuilding` is public and a JavaScript caller
 * can pass any string as the shape; on an object `toString` found an inherited
 * function and the building came back with no roof (review finding 5).
 */
const REVOLVED_PROFILES: ReadonlyMap<string, readonly ProfilePoint[]> = new Map(
  [
    ["pyramidal", PYRAMID_PROFILE],
    ["dome", DOME_PROFILE],
    ["onion", ONION_PROFILE],
  ],
);

/** A quarter circle from (1, 0) to (0, 1) in 15-degree steps, ending exactly. */
function quarterCircle(): { out: number; up: number }[] {
  return Array.from({ length: 7 }, (_, i) => {
    if (i === 6) return { out: 0, up: 1 };
    const angle = (i * Math.PI) / 12;
    return { out: Math.cos(angle), up: Math.sin(angle) };
  });
}

/**
 * A roof of revolution: the footprint scaled towards its centroid ring by
 * ring, one band of faces between each pair of rings, closing in an apex
 * (every profile ends at scale 0). One builder for the pyramid, the dome, the
 * onion.
 *
 * The centroid is the AREA centroid of the open ring, not the vertex average:
 * OSM rings repeat their first node as their last, which counted it twice and
 * pulled an octagon's apex a ninth of its radius towards that node, and a wall
 * drawn with many short segments pulled the average towards itself. Not the
 * bbox centre either, because an L-shaped footprint's bbox centre can fall
 * outside the building entirely, and an apex hanging in the air outside its
 * own walls is the most obviously wrong thing this file could produce.
 *
 * Flat-shaded: every face carries its own normal, from the same winding it is
 * emitted with. Holes are not carried into a roof of revolution: a courtyard
 * under a pyramid is not a shape OSM describes, and guessing would be
 * inventing geometry.
 */
function revolvedRoof(
  rawOuter: readonly EnuPoint[],
  options: RoofOptions,
  profile: readonly ProfilePoint[],
): MeshData {
  // Counter-clockwise first. `extrudeBuilding` passes rings through raw and
  // real OSM footprints arrive both ways round, so without this the roof's
  // orientation depends on the mapper's drawing direction — half the pyramids
  // would face inward while their walls (which `addWalls` DOES normalise) faced
  // outward, giving a building that is wrong only from above.
  const open = dropClosingPoint(rawOuter);
  const outer = isCounterClockwise(open) ? open : [...open].reverse();
  const centre = areaCentroid(outer);
  const rise = options.ridgeHeightM - options.eaveHeightM;
  const builder = new MeshBuilder();

  const ringAt = (point: ProfilePoint): Vec3[] =>
    outer.map((p) => ({
      x: centre.x + point.scale * (p.x - centre.x),
      y: options.eaveHeightM + point.rise * rise,
      z: centre.y + point.scale * (p.y - centre.y),
    }));
  const face = (a: Vec3, b: Vec3, c: Vec3): void => {
    const n = faceNormal(a, b, c);
    builder.triangle(
      builder.vertex(a.x, a.y, a.z, n.x, n.y, n.z),
      builder.vertex(b.x, b.y, b.z, n.x, n.y, n.z),
      builder.vertex(c.x, c.y, c.z, n.x, n.y, n.z),
    );
  };

  let lower = ringAt(profile[0] ?? { scale: 1, rise: 0 });
  for (let k = 1; k < profile.length; k++) {
    const point = profile[k] as ProfilePoint;
    const upper = ringAt(point);
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      const a0 = lower[i] as Vec3;
      const b0 = lower[j] as Vec3;
      const a1 = upper[i] as Vec3;
      const b1 = upper[j] as Vec3;
      if (a0.x === b0.x && a0.z === b0.z) continue;
      // b BEFORE a — this file works in the ENU frame, where Y-up makes a
      // counter-clockwise (east, north) ring read as clockwise, so the natural
      // edge order winds this face downward and `faceNormal` would then agree
      // with it, lighting the roof from underneath. Reversing fixes the normal
      // and the emitted winding together, which is why both use this order.
      // (The ENU→render reflection is separate and lives in `MeshBuilder`.)
      face(b0, a0, a1);
      if (point.scale > 0) face(b0, a1, b1);
    }
    lower = upper;
  }

  // Every profile here ends in an apex (scale 0), so there is no lid to close.
  return builder.build(0);
}

/**
 * A single sloped plane, high on one side.
 *
 * `roof:direction` says which way the slope FACES, "from high (ridge) to low
 * (eaves)". 256 of 266 skillions in the corpus carry it, and the mansard of
 * the Heiliggeistkirche is mapped as skillion parts facing north and south off
 * the nave. Without the tag the slope runs along the footprint's longest edge,
 * which is right for the lean-to and shed cases an untagged skillion usually
 * is.
 */
function skillionRoof(
  rings: readonly (readonly EnuPoint[])[],
  cap: TriangulationResult,
  options: RoofOptions,
): MeshData {
  const outer = rings[0] ?? [];
  // `axis` points UPHILL: the height grows along it.
  const axis =
    options.directionDeg === undefined
      ? longestAxis(outer)
      : uphillOf(options.directionDeg);
  const projected = outer.map((p) => p.x * axis.x + p.y * axis.y);
  const min = Math.min(...projected);
  const max = Math.max(...projected);
  const span = max - min;

  const heightAt = (p: EnuPoint): number => {
    if (span === 0) return options.eaveHeightM;
    const t = (p.x * axis.x + p.y * axis.y - min) / span;
    return (
      options.eaveHeightM + t * (options.ridgeHeightM - options.eaveHeightM)
    );
  };

  // THE PLANE'S OWN NORMAL, not (0, 1, 0). A skillion is by definition a sloped
  // plane; giving it the flat-roof normal makes it shade exactly like a flat
  // roof, so the slope shows only in silhouette and the `roof:shape` tag looks
  // like it did nothing. The surface is y = eave + slope·(p·axis − min), so in
  // 3D (X = ENU x, Y = up, Z = ENU y) the upward normal is
  // (−∂Y/∂X, 1, −∂Y/∂Z) = (−slope·axis.x, 1, −slope·axis.y).
  const slope =
    span === 0 ? 0 : (options.ridgeHeightM - options.eaveHeightM) / span;
  const nx = -slope * axis.x;
  const nz = -slope * axis.y;
  const nLength = Math.hypot(nx, 1, nz);

  const builder = new MeshBuilder();
  const base = cap.vertices.map((p) => {
    const y = heightAt(p);
    return builder.vertex(p.x, y, p.y, nx / nLength, 1 / nLength, nz / nLength);
  });
  for (let i = 0; i + 2 < cap.indices.length; i += 3) {
    const a = base[cap.indices[i] as number];
    const b = base[cap.indices[i + 1] as number];
    const c = base[cap.indices[i + 2] as number];
    if (a === undefined || b === undefined || c === undefined) continue;
    builder.triangle(a, c, b);
  }
  return builder.build(cap.forcedEars);
}

/**
 * One line of a ridged roof's cross-section: `across` is the fraction of the
 * half-width out from the ridge (1 at the eaves, 0 at the ridge), `rise` the
 * fraction of the roof's height.
 */
interface CrossPoint {
  readonly across: number;
  readonly rise: number;
}

const STRAIGHT_SLOPE: readonly CrossPoint[] = [
  { across: 1, rise: 0 },
  { across: 0, rise: 1 },
];

/** A barn roof: a steep lower slope, then a shallow upper one. */
const GAMBREL_SLOPE: readonly CrossPoint[] = [
  { across: 1, rise: 0 },
  { across: 0.7, rise: 0.6 },
  { across: 0, rise: 1 },
];

/** A barrel vault: a quarter circle each side of the ridge. */
const ROUND_SLOPE: readonly CrossPoint[] = quarterCircle().map(
  ({ out, up }) => ({ across: out, rise: up }),
);

/** A map for the same reason as `REVOLVED_PROFILES`. */
const CROSS_SECTIONS: ReadonlyMap<string, readonly CrossPoint[]> = new Map([
  ["gambrel", GAMBREL_SLOPE],
  ["round", ROUND_SLOPE],
]);

/**
 * A ridged roof: the box roof on a rectangle, the skeleton ladder otherwise.
 *
 * The ridge runs along the long side unless `roof:orientation=across` turns
 * it, or `roof:direction` names the way the slopes face, which puts the ridge
 * at right angles to that. On a rectangle that is the box roof's axis; on a
 * skeleton roof it picks which wing ends become gables (`gableRule`).
 */
function ridgeRoof(
  rings: readonly (readonly EnuPoint[])[],
  cap: TriangulationResult,
  options: RoofOptions,
): RoofMesh {
  const outer = rings[0] ?? [];
  const found = orientedBoundingBox(outer);
  if (found === undefined) {
    return {
      ...allSurface(flatCap(cap, options.eaveHeightM)),
      isApproximate: true,
      method: "flat",
    };
  }
  const box = turnedBox(found, options);
  const limit = options.maxOverhangM ?? RIDGE_OVERHANG_LIMIT_M;
  const boxFits = boxOverhangM(rings, found) <= limit;
  if (boxFits && rings.length === 1 && isRectangular(outer, found)) {
    return { ...boxRoof(box, options), isApproximate: false, method: "box" };
  }
  const skeleton = skeletonOrNothing(rings, box, options, boxFits);
  if (skeleton !== undefined) return skeleton;
  if (boxFits) {
    return {
      ...boxRoof(box, options),
      isApproximate: true,
      method: "box-fallback",
    };
  }
  return prismRoof(rings, cap, options);
}

/**
 * Steps 1 to 3 of the ladder, or `undefined` to go on to the box roof or the
 * prism: above the corner cap, when every rung failed, and when a gabled-family
 * roof found no gable and the box roof fits.
 */
function skeletonOrNothing(
  rings: readonly (readonly EnuPoint[])[],
  box: OrientedBox,
  options: RoofOptions,
  boxFits: boolean,
): RoofMesh | undefined {
  if (cornerCount(rings) > SKELETON_VERTEX_CAP) return undefined;
  const skeleton = skeletonLadder(rings, box, options);
  if (skeleton === undefined) return undefined;
  return boxFits && lostItsGables(skeleton, options) ? undefined : skeleton;
}

/**
 * True when a gabled, gambrel or round roof came back from the skeleton with
 * no gable at all. The box roof, where it fits, then keeps the tag: on a
 * quadrilateral tagged `roof:orientation=across` the gables belong on the long
 * walls, which are not wing ends of the all-slopes skeleton, so the skeleton
 * finds none (39 of the corpus's 52 across-tagged skeleton roofs, 2026-11-08).
 */
function lostItsGables(roof: RoofMesh, options: RoofOptions): boolean {
  return (
    options.shape !== "hipped" &&
    roof.surfaceVertices === roof.positions.length / 3
  );
}

/** The corners of all rings, a repeated closing point not counted. */
function cornerCount(rings: readonly (readonly EnuPoint[])[]): number {
  return rings.reduce((sum, ring) => sum + dropClosingPoint(ring).length, 0);
}

/** One rung of the skeleton ladder. */
interface SkeletonRequest {
  readonly gableEnds?: GableRule;
  readonly method: RoofMethod;
  readonly approximate: (roof: SkeletonRoof) => boolean;
}

/**
 * The skeleton rungs for this shape, in order. `hipped` is all slopes and
 * exact. The gabled family first asks for gable ends; gambrel and round have no
 * cross-section on a skeleton yet, so they are drawn as a plain gabled roof and
 * say so. A gabled roof with no gable end found is a hipped roof in all but
 * name, so it says so too.
 */
function skeletonRequests(
  box: OrientedBox,
  options: RoofOptions,
): SkeletonRequest[] {
  const hipped: SkeletonRequest = {
    method: options.shape === "hipped" ? "skeleton" : "hipped-skeleton",
    approximate: () => options.shape !== "hipped",
  };
  if (options.shape === "hipped") return [hipped];
  const gabled: SkeletonRequest = {
    gableEnds: gableRule(box, options),
    method: "skeleton",
    approximate: (roof) => options.shape !== "gabled" || roof.gables === 0,
  };
  return [gabled, hipped];
}

/**
 * Which wing ends become gables. Untagged: every wing end whose neighbours are
 * not wing ends too. Tagged with `roof:orientation` or `roof:direction`: the
 * ends whose wall faces along the tagged ridge axis.
 */
function gableRule(box: OrientedBox, options: RoofOptions): GableRule {
  const tagged =
    options.orientation !== undefined || options.directionDeg !== undefined;
  return tagged ? { kind: "axis", axis: box.axis } : { kind: "neighbours" };
}

/** Steps 1 to 3 of the ladder; `undefined` when every rung failed. */
function skeletonLadder(
  rings: readonly (readonly EnuPoint[])[],
  box: OrientedBox,
  options: RoofOptions,
): RoofMesh | undefined {
  const requests = skeletonRequests(box, options);
  for (const attempt of [0, 1]) {
    for (const request of requests) {
      const mesh = trySkeleton(rings, request, attempt, options);
      if (mesh !== undefined) return mesh;
    }
  }
  return undefined;
}

/** The roof of one rung, or `undefined` when its skeleton or mesh failed. */
function trySkeleton(
  rings: readonly (readonly EnuPoint[])[],
  request: SkeletonRequest,
  attempt: number,
  options: RoofOptions,
): RoofMesh | undefined {
  try {
    const roof = skeletonRoof(rings, {
      attempt,
      ...(request.gableEnds === undefined
        ? {}
        : { gableEnds: request.gableEnds }),
    });
    return roof.ridgeT > 0
      ? skeletonRoofMesh(roof, request, options)
      : undefined;
  } catch {
    // Any error, not only a SkeletonFailure: an unforeseen throw in one rung
    // used to escape the ladder, so the box rung was never tried (M2 review
    // finding 6). The next rung, and in the end the prism, is still a roof.
    return undefined;
  }
}

/** A skeleton as a roof mesh: the top time is the tagged ridge height. */
function skeletonRoofMesh(
  roof: SkeletonRoof,
  request: SkeletonRequest,
  options: RoofOptions,
): RoofMesh {
  const rise = options.ridgeHeightM - options.eaveHeightM;
  const { mesh, surfaceVertices } = skeletonMesh(roof, {
    eaveM: options.eaveHeightM,
    slope: rise / roof.ridgeT,
  });
  return {
    ...mesh,
    surfaceVertices,
    isApproximate: request.approximate(roof),
    method: request.method,
  };
}

/**
 * The last rung: a flat lid at the tagged top with walls from the eaves up to
 * it. Keeps the building's height and its outline, both of which a flat cap at
 * the eaves would lose.
 */
function prismRoof(
  rings: readonly (readonly EnuPoint[])[],
  cap: TriangulationResult,
  options: RoofOptions,
): RoofMesh {
  const builder = new MeshBuilder();
  builder.append(flatCap(cap, options.ridgeHeightM));
  const surfaceVertices = builder.vertexCount;
  rings.forEach((ring, r) => {
    addWalls(builder, ring, options.eaveHeightM, options.ridgeHeightM, r === 0);
  });
  return {
    ...builder.build(cap.forcedEars),
    surfaceVertices,
    isApproximate: true,
    method: "prism",
  };
}

/**
 * The box roof over the oriented bounding rectangle.
 *
 * `gabled` runs the ridge the full length of the rectangle, so the short ends
 * are vertical gable walls. `hipped` pulls the ridge in by a quarter of the
 * rectangle's length at each end, so all four sides slope — which is the actual
 * difference between the two shapes. `gambrel` and `round` are gabled roofs
 * with a bent and a curved cross-section.
 */
function boxRoof(
  box: OrientedBox,
  options: RoofOptions,
): MeshData & { surfaceVertices: number } {
  const { centre, axis, cross: crossAxis, halfLength, halfWidth } = box;
  const profile = CROSS_SECTIONS.get(options.shape) ?? STRAIGHT_SLOPE;
  const inset = options.shape === "hipped" ? halfLength / 2 : 0;
  const rise = options.ridgeHeightM - options.eaveHeightM;

  const at = (along: number, across: number, height: number): Vec3 => ({
    x: centre.x + axis.x * along + crossAxis.x * across,
    y: height,
    z: centre.y + axis.y * along + crossAxis.y * across,
  });
  // Line `k` of the cross-section on side `side` (-1 or +1), end to end. Only
  // the ridge line is pulled in, and only when hipped.
  const line = (k: number, side: number): { start: Vec3; end: Vec3 } => {
    const point = profile[k] as CrossPoint;
    const pull = k === profile.length - 1 ? inset : 0;
    const height = options.eaveHeightM + point.rise * rise;
    const across = side * point.across * halfWidth;
    return {
      start: at(-halfLength + pull, across, height),
      end: at(halfLength - pull, across, height),
    };
  };

  const builder = new MeshBuilder();
  const quad = (p: Vec3, q: Vec3, r: Vec3, s: Vec3): void => {
    const n = faceNormal(p, q, r);
    const i0 = builder.vertex(p.x, p.y, p.z, n.x, n.y, n.z);
    const i1 = builder.vertex(q.x, q.y, q.z, n.x, n.y, n.z);
    const i2 = builder.vertex(r.x, r.y, r.z, n.x, n.y, n.z);
    const i3 = builder.vertex(s.x, s.y, s.z, n.x, n.y, n.z);
    builder.triangle(i0, i1, i2);
    builder.triangle(i0, i2, i3);
  };
  const tri = (p: Vec3, q: Vec3, r: Vec3): void => {
    const n = faceNormal(p, q, r);
    builder.triangle(
      builder.vertex(p.x, p.y, p.z, n.x, n.y, n.z),
      builder.vertex(q.x, q.y, q.z, n.x, n.y, n.z),
      builder.vertex(r.x, r.y, r.z, n.x, n.y, n.z),
    );
  };

  // The slopes, one strip per step of the cross-section on each side. Eave →
  // ridge → ridge → eave, NOT eave → eave → ridge: in the ENU frame Y-up makes
  // a counter-clockwise (east, north) loop read as clockwise, so going round
  // the eave first winds every face downward and `faceNormal`, derived from
  // that same winding, then points down too — a roof lit from underneath and
  // backfacing from above. The same reason `flatCap` emits (a, c, b).
  // Independent of the ENU→render reflection, which `MeshBuilder` applies
  // centrally to every vertex and triangle.
  for (let k = 0; k + 1 < profile.length; k++) {
    const low = line(k, -1);
    const high = line(k + 1, -1);
    quad(low.start, high.start, high.end, low.end);
    const lowPlus = line(k, 1);
    const highPlus = line(k + 1, 1);
    quad(lowPlus.end, highPlus.end, highPlus.start, lowPlus.start);
  }
  // A hipped roof's ends are roof too; anyone else's are vertical gable walls.
  const slopes = builder.vertexCount;

  // The ends: a hip when hipped, a vertical gable wall otherwise, closing the
  // volume. Without them a gabled building is open at both ends — visible
  // from the street, and a classic omission. Each end is the cross-section's
  // outline, fanned from its first eave corner: convex for every profile
  // here, and exactly the old single triangle for a straight slope. Reversed
  // for the same handedness reason as the slopes above.
  const outline = (end: "start" | "end", from: number): Vec3[] => {
    const points: Vec3[] = [];
    for (let k = 0; k < profile.length; k++) points.push(line(k, from)[end]);
    for (let k = profile.length - 2; k >= 0; k--) {
      points.push(line(k, -from)[end]);
    }
    return points;
  };
  for (const points of [outline("start", -1), outline("end", 1)]) {
    const first = points[0] as Vec3;
    for (let i = 1; i + 1 < points.length; i++) {
      tri(first, points[i + 1] as Vec3, points[i] as Vec3);
    }
  }

  return {
    ...builder.build(0),
    surfaceVertices: inset > 0 ? builder.vertexCount : slopes,
  };
}

/**
 * `box` with its ridge turned by `roof:orientation` or `roof:direction`.
 *
 * Turned by the same right-handed swap as in `orientedBoundingBox`: `axis`
 * becomes `cross` and `cross` becomes `-axis`. A plain swap would mirror the
 * frame and turn the roof inside out.
 */
function turnedBox(box: OrientedBox, options: RoofOptions): OrientedBox {
  let across = options.orientation === "across";
  if (options.directionDeg !== undefined) {
    // The slopes face `direction`, so the ridge runs at right angles to it:
    // along whichever side of the box is closer to perpendicular. Wins over
    // `roof:orientation`, being the more specific of the two.
    const facing = uphillOf(options.directionDeg);
    across =
      Math.abs(facing.x * box.axis.x + facing.y * box.axis.y) >
      Math.abs(facing.x * box.cross.x + facing.y * box.cross.y);
  }
  if (!across) return box;
  return {
    centre: box.centre,
    axis: box.cross,
    cross: { x: -box.axis.x, y: -box.axis.y },
    halfLength: box.halfWidth,
    halfWidth: box.halfLength,
  };
}

/**
 * The furthest the bounding rectangle reaches outside the footprint, in
 * metres: a grid over the rectangle, each sample outside the outer ring or
 * inside a hole measured to the nearest wall. At most 33 x 33 samples, and at
 * least one every half metre on a small building.
 */
function boxOverhangM(
  rings: readonly (readonly EnuPoint[])[],
  box: OrientedBox,
): number {
  const steps = (half: number): number =>
    Math.min(32, Math.max(2, Math.ceil((2 * half) / 0.5)));
  const nAlong = steps(box.halfLength);
  const nAcross = steps(box.halfWidth);
  const [outer, ...holes] = rings;
  if (outer === undefined) return 0;
  let worst = 0;
  for (let i = 0; i <= nAlong; i++) {
    const along = -box.halfLength + (2 * box.halfLength * i) / nAlong;
    for (let j = 0; j <= nAcross; j++) {
      const across = -box.halfWidth + (2 * box.halfWidth * j) / nAcross;
      const point = {
        x: box.centre.x + box.axis.x * along + box.cross.x * across,
        y: box.centre.y + box.axis.y * along + box.cross.y * across,
      };
      const inside =
        containsPoint(outer, point) &&
        !holes.some((hole) => containsPoint(hole, point));
      if (!inside) worst = Math.max(worst, distanceToWalls(rings, point));
    }
  }
  return worst;
}

/** Distance from `point` to the nearest edge of any ring. */
function distanceToWalls(
  rings: readonly (readonly EnuPoint[])[],
  point: EnuPoint,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as EnuPoint;
      const b = ring[(i + 1) % ring.length] as EnuPoint;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      const t =
        lengthSq === 0
          ? 0
          : ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
      const clamped = Math.max(0, Math.min(1, t));
      best = Math.min(
        best,
        Math.hypot(
          point.x - (a.x + clamped * dx),
          point.y - (a.y + clamped * dy),
        ),
      );
    }
  }
  return best;
}

/** Unit `(east, north)` vector pointing UPHILL, against `roof:direction`. */
function uphillOf(directionDeg: number): EnuPoint {
  const radians = (directionDeg * Math.PI) / 180;
  return { x: -Math.sin(radians), y: -Math.cos(radians) };
}

/**
 * The area centroid of an open ring; the vertex average when it has no area.
 * See `revolvedRoof` for why the vertex average is wrong otherwise.
 */
function areaCentroid(ring: readonly EnuPoint[]): EnuPoint {
  // Relative to the first vertex, so a ring far from the frame's origin does
  // not lose its centroid to cancellation.
  const origin = ring[0] ?? { x: 0, y: 0 };
  let twice = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as EnuPoint;
    const b = ring[(i + 1) % ring.length] as EnuPoint;
    const ax = a.x - origin.x;
    const ay = a.y - origin.y;
    const bx = b.x - origin.x;
    const by = b.y - origin.y;
    const crossAB = ax * by - bx * ay;
    twice += crossAB;
    x += (ax + bx) * crossAB;
    y += (ay + by) * crossAB;
  }
  if (Math.abs(twice) < 1e-9) return vertexAverage(ring);
  return { x: origin.x + x / (3 * twice), y: origin.y + y / (3 * twice) };
}

function vertexAverage(ring: readonly EnuPoint[]): EnuPoint {
  if (ring.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/** Unit vector along the ring's longest edge. */
function longestAxis(ring: readonly EnuPoint[]): EnuPoint {
  let best = { x: 1, y: 0 };
  let bestLength = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length > bestLength) {
      bestLength = length;
      best = { x: dx / length, y: dy / length };
    }
  }
  return best;
}

interface OrientedBox {
  readonly centre: EnuPoint;
  /** Unit vector along the box's long side. */
  readonly axis: EnuPoint;
  /** Unit vector across it. */
  readonly cross: EnuPoint;
  readonly halfLength: number;
  readonly halfWidth: number;
}

/**
 * Minimum-area bounding rectangle by rotating calipers over edge directions.
 *
 * The minimum-area rectangle of a convex polygon always has a side flush with
 * one of its edges, so testing each edge direction is exact rather than a
 * search. Applied to the raw ring rather than its convex hull, which is a
 * simplification: for a concave footprint the result is still a valid enclosing
 * rectangle, just not provably minimal — and this shape is an approximation
 * anyway for exactly those footprints.
 */
function orientedBoundingBox(
  ring: readonly EnuPoint[],
): OrientedBox | undefined {
  if (ring.length < 3) return undefined;

  let best: OrientedBox | undefined;
  let bestArea = Number.POSITIVE_INFINITY;

  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;

    const axis = { x: dx / length, y: dy / length };
    const cross = { x: -axis.y, y: axis.x };

    let minA = Number.POSITIVE_INFINITY;
    let maxA = Number.NEGATIVE_INFINITY;
    let minC = Number.POSITIVE_INFINITY;
    let maxC = Number.NEGATIVE_INFINITY;
    for (const p of ring) {
      const along = p.x * axis.x + p.y * axis.y;
      const across = p.x * cross.x + p.y * cross.y;
      minA = Math.min(minA, along);
      maxA = Math.max(maxA, along);
      minC = Math.min(minC, across);
      maxC = Math.max(maxC, across);
    }

    const area = (maxA - minA) * (maxC - minC);
    if (area >= bestArea) continue;
    bestArea = area;

    const midA = (minA + maxA) / 2;
    const midC = (minC + maxC) / 2;
    let halfLength = (maxA - minA) / 2;
    let halfWidth = (maxC - minC) / 2;
    let finalAxis = axis;
    let finalCross = cross;
    // Keep `axis` the LONG side, so "the ridge runs along the axis" is true.
    //
    // `cross` is `axis` rotated +90°, and `ridgeRoof` relies on that handedness
    // to decide which way its faces point. A plain swap would leave
    // `finalCross === axis === rot(−90°)(finalCross')`, i.e. a MIRRORED frame,
    // and every normal derived from it would flip — so a rectangle drawn from a
    // corner on its short side would produce an inside-out roof while the same
    // rectangle drawn from the next corner round came out fine. Negating keeps
    // the frame right-handed; the box is symmetric about its centre, so which
    // side counts as +across is arbitrary.
    if (halfWidth > halfLength) {
      [halfLength, halfWidth] = [halfWidth, halfLength];
      finalAxis = cross;
      finalCross = { x: -axis.x, y: -axis.y };
    }

    best = {
      centre: {
        x: axis.x * midA + cross.x * midC,
        y: axis.y * midA + cross.y * midC,
      },
      axis: finalAxis,
      cross: finalCross,
      halfLength,
      halfWidth,
    };
  }
  return best;
}

/** True when the footprint fills its bounding rectangle, i.e. IS a rectangle. */
function isRectangular(ring: readonly EnuPoint[], box: OrientedBox): boolean {
  const boxArea = box.halfLength * box.halfWidth * 4;
  if (boxArea === 0) return false;
  let ringArea = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (a === undefined || b === undefined) continue;
    ringArea += a.x * b.y - b.x * a.y;
  }
  // 2 % tolerance: a mapper's rectangle is rarely exact to the millimetre. A
  // footprint inside it gets the box roof, every other one the skeleton; the
  // sweep in roof.ts.md shows how many move between the two.
  return Math.abs(Math.abs(ringArea) / 2 / boxArea - 1) < 0.02;
}

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Unit normal of the triangle `a,b,c`, wound counter-clockwise when seen from the front. */
function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length === 0) return { x: 0, y: 1, z: 0 };
  return { x: nx / length, y: ny / length, z: nz / length };
}
