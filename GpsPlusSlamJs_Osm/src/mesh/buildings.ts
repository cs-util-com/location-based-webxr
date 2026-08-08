/**
 * OSM features → building volumes, honouring `building:part`.
 *
 * THE ONE IDEA THAT MAKES THIS WORTH BUILDING. Landmark detail in OSM is not a
 * model file and not a landmark database — it is many `building:part` polygons,
 * each with its own `height` and `min_height`, under the Simple 3D Buildings
 * schema. A naive one-polygon extrusion of Cologne Cathedral gives a box; the
 * SAME extruder applied per part, respecting `min_height`, gives something
 * recognisably cathedral-shaped. The detail is free if you honour the schema.
 *
 * THE RULE FOR COMBINING THEM, taken from OSM2World's `Building.java` because
 * it is the most complete implementation of the schema anywhere:
 *
 * - A building's parts are the `building:part` areas geometrically inside its
 *   outline (OSM2World also accepts `type=building` relation members with role
 *   `part`; we support both).
 * - **If a building has parts, the outline itself is NOT extruded** — the parts
 *   replace it. Extruding both is the single most visible S3DB mistake: every
 *   detailed building gets a box drawn through it.
 * - If it has no parts, the outline is its own only part.
 *
 * @see buildings.ts.md
 */

import type {
  LatLng,
  OsmFeature,
  OsmFeatureKey,
} from "../model/osm-feature.js";
import { featureKey } from "../model/osm-feature.js";
import { toGeometry } from "../model/osm-geometry.js";
import type { OsmGeometry } from "../model/osm-geometry.js";
import type { EnuFrame, EnuPoint } from "./enu.js";
import { ringToEnu } from "./enu.js";
import { isBelowSurface } from "../model/below-surface.js";
import { containsPoint } from "../spatial/point-in-ring.js";
import type { PlanarPoint } from "../spatial/point-in-ring.js";
import { isTallStructure, tallStructureHeightM } from "./tall-structures.js";
import {
  isBuilding,
  isBuildingPart,
  resolveHeights,
} from "./building-heights.js";
import type { BuildingHeights } from "./building-heights.js";
import { extrudeBuilding } from "./extrude.js";
import type { MeshData } from "./mesh-data.js";

/** One extruded volume, with the provenance to trace it back to OSM. */
export interface BuildingVolume {
  readonly feature: OsmFeatureKey;
  /** The outline this volume belongs to, when it is a part. */
  readonly parentFeature?: OsmFeatureKey;
  readonly heights: BuildingHeights;
  readonly mesh: MeshData;
  /**
   * True when the ROOF was approximated rather than generated exactly.
   *
   * Carried up from `buildRoof` so a consumer can count how much of what it
   * draws is real. Substituting "is the shape gabled or hipped?" for this is a
   * different claim — a gabled roof on an actual rectangle is exact, and that
   * is the common case §8's approximation trade rests on.
   */
  readonly roofIsApproximate: boolean;
  /**
   * The OUTER ring in ENU metres, kept so a consumer can ask what ground this
   * volume covers (F33, §5).
   *
   * Carried rather than recomputed: the rings already exist at the point this is
   * built, and re-deriving them would repeat the whole geometry conversion.
   * `poi-hosts.ts` is the consumer — it decides whether a POI marker standing
   * here belongs on this building's roof instead of at its own node.
   */
  readonly footprint: readonly EnuPoint[];
  /**
   * The volume's highest point, in the SAME frame as a marker's ground height
   * (DEC-S2, stage 1).
   *
   * WHY IT HAS TO BE CARRIED RATHER THAN DERIVED BY A CONSUMER. `heights` is
   * measured from the building's OWN base, and the base is `ground.lowest` —
   * computed here, passed into `extrudeBuilding`, baked into the mesh positions
   * and then dropped. Adding `totalHeightM` to a marker's own sampled ground
   * height is NOT the same number: on sloped terrain the two differ by the rise
   * under the footprint, which is metres on a hillside. A symbol placed with the
   * wrong one is buried in a roof at the bottom of a hill and floating over one
   * at the top — which reads as a terrain-sampling bug rather than as a marker
   * bug, and would be diagnosed in the wrong file.
   *
   * Carried for the same reason `footprint` is: the number already exists at the
   * point this is built, and re-deriving it outside means re-deriving the whole
   * ground sample.
   */
  readonly topHeightM: number;
}

export interface BuildBuildingsOptions {
  readonly frame: EnuFrame;
  /** Ground elevation per feature, metres. Defaults to 0 everywhere. */
  readonly groundHeightM?: (position: LatLng) => number;
}

/**
 * Extrudes every building in `features`, honouring `building:part`.
 *
 * Features that are not buildings are ignored. A feature whose geometry cannot
 * be built is skipped rather than throwing — same contract as the rest of the
 * package, because the planet contains relations that cannot be closed.
 */
export function buildBuildings(
  features: Iterable<OsmFeature>,
  options: BuildBuildingsOptions,
): BuildingVolume[] {
  const { outlines, parts } = collectFootprints(features, options.frame);
  const { claimed, partsByOutline } = assignPartsToOutlines(outlines, parts);

  const volumes: BuildingVolume[] = [];

  for (const outline of outlines) {
    const key = featureKey(outline.feature);
    // A building WITH parts is not extruded itself — the parts replace it.
    // Drawing both is the most visible S3DB mistake there is, and since R5-7 it
    // is also what fixes the NESTED case: `assignPartsToOutlines` gives each part
    // to the smallest outline containing it, so Cologne Cathedral's
    // `way/645732604` (`building=tower`, height 157, "Nordturm") now owns
    // `way/207377042` and is suppressed right here.
    //
    // A SECOND RULE WAS TRIED AND REMOVED, and the reason is worth keeping:
    // "suppress any outline nested inside a larger outline that owns parts"
    // sounds like the same idea one level up, and it is not. Measured on this
    // repo's own corpus it suppressed NOTHING that the line above had not
    // already suppressed, cost 0.8-4.6 s per build at res-7 scale, and deleted
    // four legitimate buildings — an `industrial` under the cathedral and three
    // `kiosk`s in Heidelberg. Nesting inside a modelled building simply does not
    // imply duplicating it: a kiosk in a station concourse is a real building.
    if (claimed.has(key)) continue;
    volumes.push(
      volumeFor(
        outline.feature,
        outline.rings,
        undefined,
        options,
        groundUnder([outline], options),
      ),
    );
  }

  for (const [outlineKey, list] of partsByOutline) {
    // ONE GROUND FOR THE WHOLE BUILDING (W5, finding R3-1), sampled over the
    // outline AND every part, and handed to each of them unchanged.
    //
    // `min_height` is measured from the BUILDING's base, not from the terrain
    // under one part — so a per-part base displaces the parts of one building
    // relative to each other by the relief between them. That is what tore
    // Cologne Cathedral's spires off the model when the terrain grew from a
    // near-flat 600 m square to 2.8 km of real relief.
    //
    // The outline is included even though it is not extruded: it is part of the
    // building's extent, and excluding it would make the base depend on which
    // parts happened to arrive in this tile.
    const group = groundUnder(
      [...(outlineOf(outlines, outlineKey) ?? []), ...list],
      options,
    );
    for (const part of list) {
      volumes.push(
        volumeFor(part.feature, part.rings, outlineKey, options, group),
      );
    }
  }

  // A part with no containing outline is still a real volume — a tile boundary
  // can deliver it without its parent. Dropping it would erase the building.
  //
  // It keeps the per-footprint ground, because there is no building to share
  // one with. That is also what makes the grouping above safe to apply
  // unconditionally: the fallback is exactly the old behaviour.
  for (const part of parts) {
    const alreadyPlaced = [...partsByOutline.values()].some((list) =>
      list.includes(part),
    );
    if (alreadyPlaced) continue;
    volumes.push(
      volumeFor(
        part.feature,
        part.rings,
        undefined,
        options,
        groundUnder([part], options),
      ),
    );
  }

  // TALL STRUCTURES THAT ARE NOT BUILDINGS (F34, §5). Cologne's Südturm is
  // `man_made=tower` with no `building` tag, so nothing above selects it and a
  // 157 m landmark renders as nothing — which reads as a failed fetch rather
  // than as a tagging distinction.
  //
  // LAST, AND WITH ITS OWN EXCLUSIONS. `isTallStructure` refuses anything
  // `isBuilding` or `isBuildingPart` already claimed, so the Nordturm — which
  // carries BOTH `building=tower` and `man_made=tower` — is extruded exactly
  // once. Without that the two selectors would each produce a 157 m prism in the
  // same place, which is invisible until it z-fights.
  volumes.push(...tallStructureVolumes(features, options));

  return volumes;
}

/** The outline footprint for a key, as a one-element list, or `undefined`. */
function outlineOf(
  outlines: readonly Footprint[],
  key: OsmFeatureKey,
): Footprint[] | undefined {
  const found = outlines.find((outline) => featureKey(outline.feature) === key);
  return found === undefined ? undefined : [found];
}

interface Footprint {
  readonly feature: OsmFeature;
  readonly rings: EnuPoint[][];
}

/**
 * A footprint in ANY planar frame — ENU metres, or `x = lng, y = lat`.
 *
 * The outline/part assignment below is pure planar geometry: containment by
 * crossing parity is affine-invariant, and the ENU map scales longitude by a
 * constant `cos(lat)` across a frame, so the AREA ORDER a smallest-containing
 * rule depends on is preserved too. That is what lets `nav/obstacles.ts` apply
 * the identical rule to lat/lng rings without an ENU frame ever entering it.
 */
interface PlanarFootprint {
  readonly feature: OsmFeature;
  readonly rings: readonly (readonly PlanarPoint[])[];
}

/** A building volume as the obstacle index sees it: lat/lng, no frame. */
export interface SolidFootprint {
  readonly feature: OsmFeature;
  /** The outline this is a part of, when it is one. */
  readonly parentFeature?: OsmFeatureKey;
  /** Outer ring first, then holes, as `x = lng, y = lat`. */
  readonly rings: readonly (readonly PlanarPoint[])[];
}

/**
 * The building volumes that are SOLID, in lat/lng — parts where an outline has
 * them, the outline itself where it does not.
 *
 * **The same rule `buildBuildings` extrudes, and deliberately the same code**
 * for the part that is subtle: `assignPartsToOutlines`, with its
 * smallest-containing choice and its key tie-break. Two implementations of that
 * would drift, and the drift would show as an agent walking through a building
 * that is plainly drawn on screen.
 *
 * **NO AREA CAP, and that is a measured deviation from DEC-R11-9.** The decision
 * asked for a footprint-area threshold above which an outline stops being
 * solid, to stop a castle-sized outline sealing its own courtyard, and asked
 * for the value to be measured against `testdata/sites/` rather than guessed.
 * The measurement says there is no such threshold to find:
 *
 * - **The hazard is not in the corpus.** Heidelberg's defensive castle
 *   (`way/254154168`, `historic=castle`, `castle_type=defensive`) carries **no
 *   `building` tag at all**, so it never becomes a volume under any rule. The
 *   way the design cites as `historic=castle` + `building=university`
 *   (`way/32200575`) is **533 m²** — an ordinary building, not an enclosure.
 * - **A cap would break real buildings.** The largest outlines the parts rule
 *   leaves standing are Cologne's train station at ~14 000 m², a Berlin office
 *   block at ~10 200 m² and Tokyo's Keio department store at ~7 200 m². Any cap
 *   low enough to catch a bailey makes all three walk-through, which is a
 *   louder bug than the one it prevents.
 *
 * `site-building-obstacles.test.ts` pins both facts, so a corpus refresh that
 * introduces a real enclosure fails rather than passes quietly.
 *
 * **A volume that starts above the ground does not obstruct it.** `min_height`
 * is what marks an arch or a canopy as passable underneath, and walking under a
 * gateway is the exact move the demo needs at a castle.
 */
export function solidBuildingFootprints(
  features: Iterable<OsmFeature>,
): SolidFootprint[] {
  const { outlines, parts } = collectPlanarFootprints(features);
  const { claimed, partsByOutline } = assignPartsToOutlines(outlines, parts);
  const solid: SolidFootprint[] = [];

  /**
   * PASSABLE UNDERNEATH, for the two reasons a volume can be.
   *
   * - **`min_height > 0`** is the S3DB form for a gateway or an arch, and
   *   obstructing the ground under one seals the route through it — the design
   *   names walking under a gate as the case that matters.
   * - **`building=roof` is a canopy**: a roof on posts, with the ground under it
   *   walkable by construction. It needs its own rule because most canopies
   *   carry no `min_height` at all, so the first rule misses them — and they are
   *   not small. Cologne's station forecourt canopy is **~16 200 m², the largest
   *   single outline in the whole corpus**, so treating it as solid puts a
   *   building-sized hole in the middle of the one site the demo opens on. The
   *   cost, stated: a roof mapped over solid walls becomes walk-through, which
   *   is rarer than the canopy case and fails towards movement rather than
   *   towards an invisible obstruction.
   *
   * **APPLIED HERE, AFTER THE ASSIGNMENT, AND THAT ORDER IS LOAD-BEARING.**
   * Filtering these out before `assignPartsToOutlines` changes which outlines
   * get CLAIMED: a building whose only parts float would have nothing left to
   * claim it, so its whole outline came back solid while the extruder drew it as
   * a few floating slabs. The corpus test caught it at Cologne and Berlin;
   * nothing in a hand-built fixture would have.
   */
  const obstructsTheGround = (feature: OsmFeature): boolean =>
    resolveHeights(feature.tags).minHeightM <= 0 &&
    feature.tags["building"] !== "roof";

  for (const outline of outlines) {
    // An outline WITH parts is not solid itself — the parts replace it, which
    // is what keeps a courtyard between them open.
    if (claimed.has(featureKey(outline.feature))) continue;
    if (!obstructsTheGround(outline.feature)) continue;
    solid.push({ feature: outline.feature, rings: outline.rings });
  }
  for (const [outlineKey, list] of partsByOutline) {
    for (const part of list) {
      if (!obstructsTheGround(part.feature)) continue;
      solid.push({
        feature: part.feature,
        parentFeature: outlineKey,
        rings: part.rings,
      });
    }
  }
  // A part with no containing outline is still a real volume — a tile boundary
  // can deliver it without its parent, and dropping it would erase a building.
  const placed = new Set(
    [...partsByOutline.values()].flat().map((part) => part.feature),
  );
  for (const part of parts) {
    if (placed.has(part.feature)) continue;
    if (!obstructsTheGround(part.feature)) continue;
    solid.push({ feature: part.feature, rings: part.rings });
  }

  return solid;
}

/** Splits the buildable features into outlines and parts, in lat/lng. */
function collectPlanarFootprints(features: Iterable<OsmFeature>): {
  outlines: PlanarFootprint[];
  parts: PlanarFootprint[];
} {
  const outlines: PlanarFootprint[] = [];
  const parts: PlanarFootprint[] = [];

  for (const feature of features) {
    // The same below-surface predicate the scorer and the extruder use: one
    // definition, or the disagreement moves rather than going away.
    if (isBelowSurface(feature)) continue;
    const part = isBuildingPart(feature);
    if (!part && !isBuilding(feature)) continue;
    const rings = toPlanarRings(feature);
    if (rings === undefined) continue;
    (part ? parts : outlines).push({ feature, rings });
  }
  return { outlines, parts };
}

/** A feature's rings as `x = lng, y = lat`, or `undefined` when unusable. */
function toPlanarRings(
  feature: OsmFeature,
): readonly (readonly PlanarPoint[])[] | undefined {
  const geometry = toGeometry(feature);
  if (!geometry.ok) return undefined;
  const rings = ringsOf(geometry.geometry);
  if (rings.length === 0) return undefined;
  return rings.map((ring) => ring.map((p) => ({ x: p.lng, y: p.lat })));
}

/**
 * Volumes for tall structures that are not tagged as buildings (F34, §5).
 *
 * ITS OWN FUNCTION rather than a fourth loop inside `buildBuildings`, which the
 * complexity gate insisted on and which is right independently: this selects on
 * a different key, resolves height by a different rule, and has no relationship
 * with the outline/part pairing the rest of that function is about.
 *
 * Cologne's Südturm is the case that named it — `man_made=tower` with no
 * `building` tag, a 157 m landmark that rendered as nothing.
 */
function tallStructureVolumes(
  features: Iterable<OsmFeature>,
  options: BuildBuildingsOptions,
): BuildingVolume[] {
  const volumes: BuildingVolume[] = [];
  for (const feature of features) {
    if (!isTallStructure(feature)) continue;
    // NO FALLBACK HEIGHT, deliberately — see `tall-structures.ts`. A tower with
    // no height tag could be 5 m or 300 m, and a guess at that scale is a
    // landmark-sized lie in a view whose whole job is being checked by eye.
    const heightM = tallStructureHeightM(feature);
    if (heightM === undefined) continue;
    const rings = toEnuRings(feature, options.frame);
    if (rings === undefined) continue;
    volumes.push(
      volumeFor(
        feature,
        rings,
        undefined,
        options,
        groundUnder([{ feature, rings }], options),
        heightM,
      ),
    );
  }
  return volumes;
}

/** Splits the input into building outlines and `building:part` volumes. */
function collectFootprints(
  features: Iterable<OsmFeature>,
  frame: EnuFrame,
): { outlines: Footprint[]; parts: Footprint[] } {
  const outlines: Footprint[] = [];
  const parts: Footprint[] = [];

  for (const feature of features) {
    // NOT EXTRUDED IF IT IS NOT ON THE SURFACE. The scorer stopped underground
    // features vetoing the ground above them; without this the geometry still
    // stands an underground structure on the street, so the two halves of the
    // pipeline disagree about the same feature.
    //
    // The same predicate as the scorer, deliberately: one definition of "below
    // the surface", or the disagreement simply moves rather than going away.
    if (isBelowSurface(feature)) continue;
    const part = isBuildingPart(feature);
    if (!part && !isBuilding(feature)) continue;
    const rings = toEnuRings(feature, frame);
    if (rings === undefined) continue;
    (part ? parts : outlines).push({ feature, rings });
  }
  return { outlines, parts };
}

/**
 * Assigns each part to the SMALLEST outline containing it.
 *
 * Containment is tested on a REPRESENTATIVE POINT rather than on every vertex:
 * parts routinely share an edge with their outline, so an all-vertices test
 * would reject the common case on a floating-point tie.
 *
 * SMALLEST, NOT FIRST (R5-7, DEC-R5-2). This was `outlines.find(...)`, and with
 * NESTED outlines that made the answer depend on the order Overpass happened to
 * serialise the payload in. Cologne Cathedral has `way/645732604` (the Nordturm,
 * `building=tower`) inside `way/4532022` (`building=cathedral`); the cathedral
 * sorts first, so it claimed the tower's own `building:part` volumes and the
 * tower was left owning nothing to suppress it with. Area expresses what is
 * actually meant — "the most specific claim about this piece of ground" — where
 * "first" expresses nothing at all.
 *
 * ORDER-INDEPENDENCE IS PART OF THE CONTRACT (N3), not a side effect: equal
 * areas break the tie on the feature key, so the same tile builds identically
 * whatever order its elements arrived in. Without that, a smallest-area rule is
 * still a coin flip wherever two containing outlines are the same size.
 *
 * WHY IT IS ONE PASS WITH A BOX REJECT, and the numbers are the argument.
 * `parts x outlines x vertices` is the shape however it is written, but the
 * first version of this change wrote it as `filter(...)` followed by an argmin
 * over the result — a full scan of every outline for every part, plus a
 * throwaway array each time, where the `find` it replaced had at least stopped
 * early. Measured on a res-7-scale input (each corpus fixture tiled 7x7, since
 * `buildBuildings` has no distance filter and a whole fetch tile really does go
 * in), total build time:
 *
 *   site                  before    filter+argmin    this
 *   heidelberg-altstadt   4699 ms       10 671 ms   630 ms
 *   manhattan-midtown     2580 ms        5 707 ms   328 ms
 *   cologne-cathedral     2018 ms        2 855 ms   344 ms
 *
 * So the naive form was a 2-4x regression, and precomputing each outline's
 * bounding box and area ONCE — then rejecting on the box, and on "cannot beat
 * the best area so far", before running any point-in-polygon test — is 4-7x
 * faster than the code this round started from. Two float comparisons discard
 * the overwhelming majority of (part, outline) pairs on a city tile.
 */
function assignPartsToOutlines<F extends PlanarFootprint>(
  outlines: readonly F[],
  parts: readonly F[],
): {
  claimed: Set<OsmFeatureKey>;
  partsByOutline: Map<OsmFeatureKey, F[]>;
} {
  const claimed = new Set<OsmFeatureKey>();
  const partsByOutline = new Map<OsmFeatureKey, F[]>();

  // GENERIC OVER THE FOOTPRINT, so one implementation of this rule serves both
  // frames: `buildBuildings` passes ENU footprints and gets ENU ones back,
  // `solidBuildingFootprints` passes lat/lng and gets lat/lng back. The rule
  // itself is affine-invariant, which is why that is sound rather than merely
  // convenient — see `PlanarFootprint`.

  // Once per outline, not once per (part, outline) pair.
  const indexed = outlines.map((outline) => {
    const ring = outline.rings[0] ?? [];
    return {
      ring,
      area: ringArea(ring),
      bounds: ringBounds(ring),
      key: featureKey(outline.feature),
    };
  });

  for (const part of parts) {
    const point = representativePoint(part.rings[0] ?? []);
    const best = smallestContaining(indexed, point);
    if (best === undefined) continue;
    claimed.add(best);
    const list = partsByOutline.get(best) ?? [];
    list.push(part);
    partsByOutline.set(best, list);
  }
  return { claimed, partsByOutline };
}

/** The key of the smallest indexed outline containing `point`, ties on key. */
function smallestContaining(
  indexed: readonly IndexedOutline[],
  point: PlanarPoint,
): OsmFeatureKey | undefined {
  let bestKey: OsmFeatureKey | undefined;
  let bestArea = Infinity;

  for (const candidate of indexed) {
    if (!withinBounds(candidate.bounds, point)) continue;
    // A strictly larger area cannot win, and an equal one only wins on the key
    // tie-break — so in neither case is the polygon test worth running.
    if (candidate.area > bestArea) continue;
    if (
      candidate.area === bestArea &&
      bestKey !== undefined &&
      candidate.key >= bestKey
    ) {
      continue;
    }
    if (!containsPoint(candidate.ring, point)) continue;
    bestKey = candidate.key;
    bestArea = candidate.area;
  }
  return bestKey;
}

function withinBounds(bounds: RingBounds, point: PlanarPoint): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

interface RingBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface IndexedOutline {
  readonly ring: readonly PlanarPoint[];
  readonly area: number;
  readonly bounds: RingBounds;
  readonly key: OsmFeatureKey;
}

/** Axis-aligned bounds of a ring, for rejecting a point cheaply. */
function ringBounds(ring: readonly PlanarPoint[]): RingBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, maxX, minY, maxY };
}

/** Absolute shoelace area of a ring, in square metres of the ENU frame. */
function ringArea(ring: readonly PlanarPoint[]): number {
  if (ring.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a === undefined || b === undefined) continue;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/**
 * The terrain under a BUILDING: where its base sits, and how far the ground rises.
 *
 * SAMPLED AT EVERY OUTER-RING VERTEX, not once at an anchor (DEC-R2-19). One sample
 * was the original behaviour and it is only correct on flat ground: on a slope it
 * leaves the building cut into the hill at one end and floating at the other. That
 * was documented as a known seam and was tolerable while consumers rendered a
 * near-flat 600 m terrain square; once terrain covers a whole city with real relief
 * it goes from rare to routine.
 *
 * TAKES THE WHOLE BUILDING, NOT ONE FOOTPRINT (W5, finding R3-1). Every volume of
 * one building has to share a base, because `min_height` is measured from the
 * building's base rather than from the terrain under one part — so sampling per
 * part displaces the parts of one building relative to each other by the relief
 * between them. On Cologne Cathedral that is metres, and it is what made the spires
 * read as separate low-polygon objects stuck on top of the model.
 *
 * Only the OUTER ring of each footprint is sampled. Inner rings are holes —
 * courtyards — and are by definition inside the outer ring's extent, so they cannot
 * lower the base or raise the rise. Sampling them would cost work and change
 * nothing.
 *
 * `rise` is 0 on flat ground, which is what keeps the common case byte-identical to
 * the previous behaviour.
 */
function groundUnder(
  footprints: readonly Footprint[],
  options: BuildBuildingsOptions,
): { lowest: number; rise: number } {
  const sample = options.groundHeightM;
  if (sample === undefined) return { lowest: 0, rise: 0 };

  let lowest = Infinity;
  let highest = -Infinity;
  for (const footprint of footprints) {
    const outer = footprint.rings[0];
    if (outer === undefined) continue;
    for (const point of outer) {
      const height = sample(options.frame.toLatLng(point));
      // A provider that answers NaN would otherwise poison every vertex of the
      // building through the comparison below, and a NaN position silently drops a
      // triangle rather than reporting anything.
      if (!Number.isFinite(height)) continue;
      if (height < lowest) lowest = height;
      if (height > highest) highest = height;
    }
  }
  if (!Number.isFinite(lowest)) return { lowest: 0, rise: 0 };
  return { lowest, rise: highest - lowest };
}

function volumeFor(
  feature: OsmFeature,
  rings: EnuPoint[][],
  parentFeature: OsmFeatureKey | undefined,
  options: BuildBuildingsOptions,
  /**
   * The ground for the whole BUILDING this volume belongs to (W5).
   *
   * Passed in rather than computed here, which is the entire change: computing
   * it here is what made it per-footprint, and per-footprint is what displaced
   * the parts of one building relative to each other.
   */
  ground: { lowest: number; rise: number },
  /**
   * An externally-resolved total height, metres (F34, §5).
   *
   * Only the tall-structure path passes one. A `man_made=tower` has no
   * `building` tag, so `resolveHeights` would treat it as an untagged building
   * and hand back `DEFAULT_BUILDING_HEIGHT_M` — a 157 m landmark drawn 6 m
   * tall, which is a worse answer than not drawing it. Passing the height in
   * keeps the S3DB resolution untouched for everything that really is a
   * building.
   */
  overrideHeightM?: number,
): BuildingVolume {
  const resolved = resolveHeights(feature.tags);
  const heights =
    overrideHeightM === undefined
      ? resolved
      : {
          ...resolved,
          eaveHeightM: overrideHeightM,
          totalHeightM: overrideHeightM,
          // A tower is a shaft: no roof shape is claimed, and the height is
          // tagged rather than guessed, so neither flag should say otherwise.
          roofShape: "flat" as const,
          heightIsGuessed: false,
        };

  const mesh = extrudeBuilding(rings, {
    minHeightM: heights.minHeightM,
    // THE WALLS RUN DOWN TO THE LOWEST GROUND, THE ROOF STAYS ABOVE THE HIGHEST.
    // Both halves are needed and neither alone is right: basing at the minimum
    // without lengthening the walls drops the roof below its tagged height on the
    // high side, and lengthening without re-basing leaves the building floating on
    // the low side. Together, nothing floats and nothing is buried.
    //
    // The tagged height is measured from the building's OWN base, not from the
    // lowest point of the terrain under it, so on steep ground the wall is
    // legitimately taller than `height=`. That is the accepted consequence of
    // DEC-R2-19 and it changes existing output deliberately.
    eaveHeightM: heights.eaveHeightM + ground.rise,
    totalHeightM: heights.totalHeightM + ground.rise,
    roofShape: heights.roofShape,
    groundHeightM: ground.lowest,
  });

  const roofIsApproximate = mesh.roofIsApproximate;
  const footprint = rings[0] ?? [];
  // The absolute top: the base the walls actually stand on, plus the height the
  // roof reaches above that base.
  const topHeightM = ground.lowest + heights.totalHeightM + ground.rise;
  return parentFeature === undefined
    ? {
        feature: featureKey(feature),
        heights,
        mesh,
        roofIsApproximate,
        footprint,
        topHeightM,
      }
    : {
        feature: featureKey(feature),
        parentFeature,
        heights,
        footprint,
        mesh,
        roofIsApproximate,
        topHeightM,
      };
}

/** A feature's rings in the local ENU frame, or `undefined` if it has none. */
function toEnuRings(
  feature: OsmFeature,
  frame: EnuFrame,
): EnuPoint[][] | undefined {
  const geometry = toGeometry(feature);
  if (!geometry.ok) return undefined;
  const rings = ringsOf(geometry.geometry);
  if (rings.length === 0) return undefined;
  return rings.map((ring) => ringToEnu(ring, frame));
}

/**
 * The rings of an areal geometry.
 *
 * A multipolygon contributes only its FIRST polygon: a building mapped as
 * several disjoint polygons is a data error rather than a shape, and extruding
 * all of them with one set of heights would be inventing buildings.
 */
function ringsOf(geometry: OsmGeometry): readonly (readonly LatLng[])[] {
  switch (geometry.kind) {
    case "polygon":
      return geometry.rings;
    case "multipolygon":
      return geometry.polygons[0] ?? [];
    default:
      return [];
  }
}

/** A point guaranteed to lie inside a simple ring, for containment tests. */
function representativePoint(ring: readonly PlanarPoint[]): PlanarPoint {
  if (ring.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  // The centroid is inside for convex rings and for the great majority of real
  // building parts. A concave part whose centroid falls outside is assigned to
  // no outline and extruded standalone — visible, and not wrong.
  return { x: x / ring.length, y: y / ring.length };
}
