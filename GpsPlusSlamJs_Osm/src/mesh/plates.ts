/**
 * Ground plates: the flat areas that are neither buildings nor roads.
 *
 * WHY THEY EXIST. The round-2 feedback asked for them by name — _"Genauso alles an
 * Flächen, die so existieren, sowas wie ich Parkplatzfläche oder sowas … sollte man
 * auch alles wirklich als echte 3D-Geometrien rendern, so dass da die als flache
 * Platten quasi im 3D-Raum hängen."_ Car parks, pitches, landuse, water: every
 * polygon the scorer already reads and the 3D view never drew.
 *
 * WHY IT IS A THIN BUILDER. Almost everything it needs already exists and is tested:
 * `toGeometry` classifies the features (including the deliberately non-canonical rule
 * that a closed way carrying `highway` is a LineString rather than an area — way
 * 449879297, pinned by the C# oracle), and `triangulate` already fills rings with
 * holes for buildings. The only new decisions are which features qualify, and how the
 * surface follows terrain.
 *
 * WHY THE TERRAIN SAMPLING IS PER VERTEX, unlike a building. A building takes ONE
 * sample and sits at the minimum under its footprint (DEC-R2-19), because a building
 * is a rigid box. A plate is a surface: a 30 m car park sampled once would cut into
 * the ground at one end and float at the other, which is the artefact the building
 * change was made to remove. So plates drape.
 *
 * WHY IT DOES NOT DEPEND ON `three`. Same as every other builder here: the package
 * emits `Float32Array` positions and normals plus `Uint32Array` indices and stops
 * (plan §4.2), which is also what lets the whole build run in a Worker and transfer
 * rather than copy.
 *
 * @see plates.ts.md
 */

import type {
  LatLng,
  OsmFeature,
  OsmFeatureKey,
} from "../model/osm-feature.js";
import { featureKey } from "../model/osm-feature.js";
import { toGeometry } from "../model/osm-geometry.js";
import type { OsmTags } from "../model/osm-feature.js";
import { clipToBbox, type Bbox } from "../spatial/clip.js";
import { ringToEnu, type EnuFrame, type EnuPoint } from "./enu.js";
import { MeshBuilder, type MeshData } from "./mesh-data.js";
import { triangulate } from "./triangulate.js";

/**
 * Tag keys whose presence makes an area a ground plate.
 *
 * Chosen to match what the affordance rule table already scores — there is no point
 * drawing a surface the scorer ignores, and no point ignoring one it scores.
 */
const PLATE_KEYS = [
  "amenity",
  "landuse",
  "leisure",
  "natural",
  "surface",
  "man_made",
  "place",
  "tourism",
] as const;

/**
 * True when a feature's tags describe a ground surface this builder owns.
 *
 * The two exclusions are the interesting part, and both prevent a plate being drawn
 * where another builder is already drawing:
 *
 *  - **`building` / `building:part`** — a plate over a footprint sits inside the
 *    extruded volume and z-fights with its floor, and the building layer draws it
 *    already. `building` wins even when a plate-ish tag is also present.
 *  - **`highway`** — the road builder owns these. This is the way-449879297 rule seen
 *    from the other side: a closed `highway` way is a LineString, so filling it would
 *    put a blob where a ribbon belongs.
 */
export function isPlateArea(tags: OsmTags): boolean {
  if (tags["building"] !== undefined) return false;
  if (tags["building:part"] !== undefined) return false;
  if (tags["highway"] !== undefined) return false;
  return PLATE_KEYS.some((key) => tags[key] !== undefined);
}

export interface BuildPlatesOptions {
  readonly frame: EnuFrame;
  /**
   * Ground elevation at a position, metres. Defaults to 0 everywhere.
   *
   * Called PER VERTEX — see the module header for why a plate drapes where a
   * building does not.
   */
  readonly groundHeightM?: (position: LatLng) => number;
  /**
   * Clip areas to this box before triangulating them. Strongly recommended.
   *
   * WHY THIS EXISTS, and it is not a micro-optimisation. Triangulation is ear
   * clipping, which is **O(n²)** in ring size, while an OSM area's size is
   * unbounded — so an area far larger than the view costs quadratically for
   * geometry that is then drawn off screen. Measured 2026-07-31 on the
   * `building-block` fixture, one ordinary Cologne city block: it contains a
   * 316-member administrative boundary relation whose largest polygon is
   * 25 001 points, and triangulating it took **2 657 ms** — while a 4 867-point
   * one took 111.8 ms, i.e. points ×5.1 for time ×23.8. `buildAreaPlates` as a
   * whole cost 2 881 ms against 0.24–0.54 ms on fixtures without such a
   * relation, and it runs on every mesh build.
   *
   * Clipping first is the same principle `h3-feature-index` already applies
   * before covering, and for the same reason: bound the input, because the
   * algorithm downstream cannot bound itself.
   *
   * OPTIONAL, so a caller that genuinely wants unbounded areas still can — but
   * such a caller is accepting the quadratic knowingly.
   */
  readonly clipTo?: Bbox;
}

/** One filled ground area. */
export interface AreaPlate {
  readonly feature: OsmFeatureKey;
  readonly mesh: MeshData;
}

/** Builds a plate per qualifying area in `features`. Skips everything else. */
export function buildAreaPlates(
  features: Iterable<OsmFeature>,
  options: BuildPlatesOptions,
): AreaPlate[] {
  const plates: AreaPlate[] = [];
  for (const feature of features) {
    if (!isPlateArea(feature.tags)) continue;
    const polygons = polygonsOf(feature, options.frame, options.clipTo);
    for (const rings of polygons) {
      const mesh = plateMesh(rings, options);
      // A degenerate ring triangulates to nothing. Skipped rather than emitted:
      // real OSM contains collapsed ways, and an empty mesh in the list would be a
      // draw call for no pixels plus a feature id that appears to have geometry.
      if (mesh === undefined) continue;
      plates.push({ feature: featureKey(feature), mesh });
    }
  }
  return plates;
}

/**
 * A feature's polygons as ENU rings, outer first then holes.
 *
 * CLIPPED BEFORE CONVERSION when `clipTo` is given — before `ringToEnu` and
 * therefore before triangulation, which is the whole point: see `clipTo` for
 * the measured quadratic this bounds.
 */
function polygonsOf(
  feature: OsmFeature,
  frame: EnuFrame,
  clipTo: Bbox | undefined,
): EnuPoint[][][] {
  const result = toGeometry(feature);
  if (result.ok !== true) return [];
  const geometry =
    clipTo === undefined
      ? result.geometry
      : clipToBbox(result.geometry, clipTo);
  // Clipped away entirely — outside the area being built, not a failure.
  if (geometry === undefined) return [];
  const toRings = (polygon: readonly (readonly LatLng[])[]): EnuPoint[][] =>
    polygon.map((ring) => ringToEnu(ring, frame));

  if (geometry.kind === "polygon") return [toRings(geometry.rings)];
  if (geometry.kind === "multipolygon") return geometry.polygons.map(toRings);
  // Points and linestrings are not plates. Silently skipped rather than coerced:
  // the classifier is the authority on what shape a feature is.
  return [];
}

/** Triangulates one polygon into an upward-facing surface at ground height. */
function plateMesh(
  rings: readonly EnuPoint[][],
  options: BuildPlatesOptions,
): MeshData | undefined {
  const triangulated = triangulate(rings);
  if (triangulated.indices.length === 0) return undefined;

  const builder = new MeshBuilder();
  const sample = options.groundHeightM;
  const indices = triangulated.vertices.map((point) => {
    const height =
      sample === undefined ? 0 : sample(options.frame.toLatLng(point));
    // NORMAL STRAIGHT UP. A plate is horizontal by construction, so there is
    // nothing to compute — and a per-face normal would only differ by the noise in
    // the terrain samples, which would make a flat car park look faceted.
    return builder.vertex(
      point.x,
      Number.isFinite(height) ? height : 0,
      point.y,
      0,
      1,
      0,
    );
  });

  for (let i = 0; i + 2 < triangulated.indices.length; i += 3) {
    const a = indices[triangulated.indices[i] ?? 0];
    const b = indices[triangulated.indices[i + 1] ?? 0];
    const c = indices[triangulated.indices[i + 2] ?? 0];
    if (a === undefined || b === undefined || c === undefined) continue;
    builder.triangle(a, b, c);
  }

  // `forcedEars` FORWARDED, not dropped. It is the triangulator's honesty flag —
  // non-zero means the input was degenerate somewhere and the result may contain a
  // sliver. The mesh layer surfaces these rather than hiding them (the same reason
  // `roofIsApproximate` exists), and a builder that swallowed it would make the
  // count under-report how much of the real planet is malformed.
  return builder.build(triangulated.forcedEars);
}
